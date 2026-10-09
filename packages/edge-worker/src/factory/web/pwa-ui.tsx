import { useEffect, useReducer, useState } from "react";
import { client } from "./client";
import {
	installApp,
	reconnect,
	unreachableAfter,
	updateApp,
	usePwa,
} from "./pwa";
import { restorationNotice } from "./restoration";
import { Bob, Button, Modal } from "./ui";
export function InstallControl() {
	const pwa = usePwa();
	const [help, setHelp] = useState(false);
	const [error, setError] = useState("");
	return (
		<>
			<Button
				variant="ghost"
				className="install-control"
				onClick={() => setHelp(true)}
				aria-label="Install app and help"
			>
				{pwa.installed ? "App help" : "Install app"}
			</Button>
			<Modal open={help} onOpenChange={setHelp} title="Install Bob’s Factory">
				<div className="modal-body install-help">
					{pwa.install && !pwa.installed && (
						<Button
							onClick={() =>
								void installApp().catch(() =>
									setError("Use your browser’s installation menu."),
								)
							}
						>
							Install Bob’s Factory
						</Button>
					)}
					<ul>
						<li>
							<strong>Mac Chrome:</strong> use the address bar install icon or
							menu → Cast, save, and share → Install page as app.
						</li>
						<li>
							<strong>Mac Brave:</strong> use the address bar install icon or
							menu → Save and Share → Install.
						</li>
						<li>
							<strong>Mac Safari:</strong> File or Share → Add to Dock (macOS
							Sonoma 14 or later).
						</li>
						<li>
							<strong>iPhone Safari:</strong> Share → Add to Home Screen. Enable
							Open as Web App when offered.
						</li>
						<li>
							<strong>iPhone Brave:</strong> look for Add to Home Screen in its
							menu. If absent, open this address in Safari and install there.
						</li>
						<li>
							<strong>Android Chrome:</strong> menu → Install and create
							shortcut → Install.
						</li>
					</ul>
					{error && <p role="alert">{error}</p>}
				</div>
			</Modal>
		</>
	);
}
export function ConnectionNotice({
	hasData,
	signedOut = false,
}: {
	hasData: boolean;
	signedOut?: boolean;
}) {
	const pwa = usePwa(),
		[later, setLater] = useState(false);
	const update = pwa.status === "mismatch" || pwa.waiting;
	const connectionDetail =
		pwa.error &&
		!/Failed to fetch|Load failed|NetworkError|The factory connection is unavailable/.test(
			pwa.error,
		)
			? pwa.error
			: undefined;
	// Once data is loaded, the header and the unreachable dialog report connection loss.
	const banner =
		pwa.status === "mismatch" ||
		(pwa.status !== "ready" && (signedOut || !hasData));
	return (
		<>
			{banner && (
				<div className="connection-error" role="status">
					{pwa.status === "mismatch"
						? signedOut
							? "Factory updated. Update the app before signing in."
							: "Factory updated. Actions are paused until you update."
						: pwa.status === "checking"
							? "Checking the factory connection and refreshing current state…"
							: "Can’t reach the factory. Check your connection and try again. Current runs and actions need the factory server."}
					{hasData && pwa.status !== "checking" && (
						<p>
							Already-loaded information may be stale. Unsent edits remain only
							in this open form; no offline actions are queued.
						</p>
					)}
					{pwa.status !== "mismatch" && (
						<Button
							variant="ghost"
							busy={pwa.updating}
							onClick={() => void reconnect()}
						>
							Retry connection
						</Button>
					)}
				</div>
			)}
			{update && (
				<div className="update-notice" role="status">
					<strong>{later ? "Update deferred" : "Update available"}</strong>{" "}
					<span>
						{signedOut
							? "Update this device’s app to continue. Active runs continue on the server."
							: "Unsent edits will be discarded. Active runs continue on the server."}
					</span>
					<div className="actions">
						<Button
							busy={pwa.updating}
							onClick={() => void updateApp(() => client.isMutating())}
						>
							Update now
						</Button>
						{!later && (
							<Button
								variant="ghost"
								disabled={pwa.updating}
								onClick={() => setLater(true)}
							>
								Later
							</Button>
						)}
					</div>
				</div>
			)}
			{(pwa.updateError ||
				connectionDetail ||
				pwa.warning ||
				restorationNotice()) && (
				<p className="connection-error" role="alert">
					{pwa.updateError ??
						connectionDetail ??
						pwa.warning ??
						restorationNotice()}
				</p>
			)}
		</>
	);
}
// Short outages, such as returning to a background tab, only change Bob's face.
const quietGrace = 1500;
export function useConnectionIndicator() {
	const pwa = usePwa(),
		[, rerender] = useReducer((n: number) => n + 1, 0),
		offline = pwa.status === "offline",
		visibleAt = (pwa.offlineSince ?? 0) + quietGrace;
	useEffect(() => {
		if (!offline) return;
		const wait = visibleAt - Date.now();
		if (wait <= 0) return;
		const timer = setTimeout(rerender, wait);
		return () => clearTimeout(timer);
	}, [offline, visibleAt]);
	const unreachable = offline && pwa.failures >= unreachableAfter;
	return {
		mood: unreachable ? "oops" : offline ? "reconnecting" : undefined,
		status: unreachable
			? ("unreachable" as const)
			: offline && Date.now() >= visibleAt
				? ("reconnecting" as const)
				: undefined,
	};
}
export function ConnectionStatus({
	status,
}: {
	status?: "reconnecting" | "unreachable";
}) {
	const pwa = usePwa(),
		[dismissed, setDismissed] = useState(false);
	useEffect(() => {
		if (pwa.status !== "offline") setDismissed(false);
	}, [pwa.status]);
	return (
		<>
			<span className="connection-status" aria-live="polite">
				{status === "unreachable" ? (
					<button type="button" onClick={() => setDismissed(false)}>
						Offline · details
					</button>
				) : status === "reconnecting" ? (
					"Reconnecting…"
				) : null}
			</span>
			<Modal
				open={status === "unreachable" && !dismissed}
				onOpenChange={(open) => setDismissed(!open)}
				title="Can’t reach the factory"
				description="Everything on this page is still here."
			>
				<div className="modal-body connection-modal">
					<Bob mood="oops" size={72} />
					<p>
						Bob tried to reconnect {pwa.failures} times without luck. Unsent
						edits and open panels stay as they are, and Bob keeps retrying in
						the background. Actions resume once Factory is reachable again.
					</p>
					<p className="muted">
						Already-loaded information may be stale. Active runs continue on the
						server.
					</p>
					<div className="actions">
						<Button busy={pwa.retrying} onClick={() => void reconnect()}>
							Retry now
						</Button>
						<Button variant="secondary" onClick={() => setDismissed(true)}>
							Keep working
						</Button>
					</div>
				</div>
			</Modal>
		</>
	);
}
