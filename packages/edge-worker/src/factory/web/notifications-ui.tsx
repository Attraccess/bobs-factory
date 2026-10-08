import { useCallback, useEffect, useState } from "react";
import { useFormState } from "./form-state";
import {
	disablePush,
	enablePush,
	type PushStatus,
	pushApi,
	pushPreference,
	pushRegistration,
	pushSupported,
	reconcilePush,
} from "./notifications";
import { usePwa } from "./pwa";
import { Button, Modal } from "./ui";
export function NotificationsControl() {
	const connection = usePwa();
	const [open, setOpen] = useState(false),
		[busy, setBusy] = useState(false),
		[error, setError] = useState(""),
		[message, setMessage] = useState("");
	const [label, setLabel] = useFormState(
		open ? "open" : "closed",
		"This browser",
	);
	const [status, setStatus] = useState<PushStatus>(),
		[enabled, setEnabled] = useState(false);
	const [registration, setRegistration] = useState<ServiceWorkerRegistration>(),
		[permission, setPermission] = useState<
			NotificationPermission | "unsupported"
		>("unsupported");
	const supported = pushSupported();
	const refresh = useCallback(async () => {
		if (connection.status !== "ready") return;
		setPermission(supported ? Notification.permission : "unsupported");
		const worker = await pushRegistration();
		setRegistration(worker);
		const current = await reconcilePush(worker);
		setStatus(current.status);
		setEnabled(current.enabled);
	}, [connection.status, supported]);
	useEffect(() => {
		const foreground = () => {
			if (!document.hidden) void refresh().catch((e) => setError(e.message));
		};
		foreground();
		window.addEventListener("online", foreground);
		window.addEventListener("storage", foreground);
		document.addEventListener("visibilitychange", foreground);
		return () => {
			window.removeEventListener("online", foreground);
			window.removeEventListener("storage", foreground);
			document.removeEventListener("visibilitychange", foreground);
		};
	}, [refresh]);
	const perform = async (action: () => Promise<unknown>) => {
		setBusy(true);
		setError("");
		setMessage("");
		try {
			await action();
			await refresh();
		} catch (e) {
			setPermission(supported ? Notification.permission : "unsupported");
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	};
	const ownId = pushPreference().id;
	return (
		<>
			<Button
				variant="ghost"
				onClick={() => {
					setOpen(true);
					void refresh().catch((e) => setError(e.message));
				}}
			>
				Notifications
			</Button>
			<Modal open={open} onOpenChange={setOpen} title="Notifications">
				<div className="modal-body install-help">
					<p>
						Receive new questions, reviews, runs needing help, and successful
						completions. Notifications contain only Factory’s name and event
						type.
					</p>
					<p>
						Browser support: {supported ? "available" : "unavailable"}.
						Permission: {permission}. This device:{" "}
						{enabled ? "Enabled" : "Disabled"}.
					</p>
					{!supported && (
						<p>
							Use a supported browser over HTTPS. On iPhone or iPad (16.4+),
							install this address to the Home Screen and open the app there. If
							Brave does not offer installation, use Safari.
						</p>
					)}
					{status?.diagnostic && <p role="status">{status.diagnostic}</p>}
					<label>
						Device label
						<input
							value={label}
							maxLength={80}
							onChange={(e) => setLabel(e.target.value)}
						/>
					</label>
					<div className="actions">
						<Button
							disabled={
								busy ||
								enabled ||
								!supported ||
								!registration ||
								!status?.available ||
								!label.trim() ||
								connection.status !== "ready"
							}
							onClick={() => {
								// Permission must start in this direct click, before any network/lock/worker await.
								const permissionRequest = Notification.requestPermission();
								void perform(() =>
									enablePush(
										permissionRequest,
										registration!,
										status!.publicKey!,
										label.trim(),
									),
								);
							}}
						>
							Enable this device
						</Button>
						<Button
							variant="ghost"
							disabled={busy || (!enabled && !ownId)}
							onClick={() => void perform(() => disablePush(registration))}
						>
							Disable this device
						</Button>
						<Button
							variant="ghost"
							disabled={busy || !enabled}
							onClick={() =>
								void perform(async () => {
									const result = await pushApi<{ message: string }>(
										`/devices/${ownId}/test`,
										{ method: "POST", body: "{}" },
									);
									setMessage(result.message);
								})
							}
						>
							Send test
						</Button>
					</div>
					<p>
						Tests use the real push service. Acceptance does not prove display.
						Check browser and OS notification settings; Brave desktop also needs
						its Google-services push setting.
					</p>
					{message && <p role="status">{message}</p>}
					{error && <p role="alert">{error}</p>}
					<ul>
						{status?.devices.map((device) => (
							<li key={device.id}>
								<strong>{device.label}</strong>
								{device.id === ownId ? " (this device)" : ""}:{" "}
								{device.enabled ? "Enabled" : "Disabled"}; delivery{" "}
								{device.health === "accepted"
									? "accepted by provider, receipt unconfirmed"
									: device.health}
								.
								<div className="actions">
									{device.enabled && (
										<Button
											variant="ghost"
											disabled={busy}
											onClick={() =>
												void perform(() =>
													device.id === ownId
														? disablePush(registration)
														: pushApi(`/devices/${device.id}`, {
																method: "PATCH",
																body: JSON.stringify({ enabled: false }),
															}),
												)
											}
										>
											Disable {device.label}
										</Button>
									)}
									<Button
										variant="ghost"
										disabled={busy}
										onClick={() =>
											void perform(async () => {
												if (device.id === ownId)
													await disablePush(registration);
												await pushApi(`/devices/${device.id}`, {
													method: "DELETE",
												});
											})
										}
									>
										Remove {device.label}
									</Button>
								</div>
							</li>
						))}
					</ul>
					<p>
						Each browser profile or installed app is a separate device. Enable
						other devices from that device. Events already pending, skipped
						during an outage, or created before enablement are never replayed.
						Unreachable devices may miss notifications.
					</p>
				</div>
			</Modal>
		</>
	);
}
