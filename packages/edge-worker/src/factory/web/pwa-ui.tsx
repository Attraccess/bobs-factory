import { useState } from "react";
import { client } from "./client";
import { installApp, reconnect, updateApp, usePwa } from "./pwa";
import {
	acknowledgeDraft,
	recoveredDrafts,
	restorationNotice,
} from "./restoration";
import { Button, Modal } from "./ui";
export function DraftNotice({
	conflict,
	draftKey,
}: {
	conflict: boolean;
	draftKey: string;
}) {
	if (!conflict) return null;
	return (
		<div className="connection-error" role="alert">
			This draft was written against questions, a review, or settings that have
			since changed. Review the current state and adjust your draft before
			sending.{" "}
			<Button variant="ghost" onClick={() => acknowledgeDraft(draftKey)}>
				I reviewed the current state
			</Button>
		</div>
	);
}
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
			<Modal
				open={help}
				onOpenChange={setHelp}
				title="Bob’s Factory on your device"
			>
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
					{pwa.installed && <p>You’re using the standalone app.</p>}
					<p>
						Open the factory’s stable HTTPS address with the server running and
						Tailscale connected, then use your browser’s installation menu.
					</p>
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
					<p>
						Offline mode opens only the app shell. Current runs and actions need
						the server and tailnet. Installing or updating leaves backend runs
						running. Push notifications will follow separately.
					</p>
					<p>
						To uninstall, remove the app from your Dock or Home Screen, or use
						the browser’s app settings. Site data may differ between Safari and
						its installed app.
					</p>
					{error && <p role="alert">{error}</p>}
				</div>
			</Modal>
		</>
	);
}
export function ConnectionNotice({ hasData }: { hasData: boolean }) {
	const pwa = usePwa(),
		[later, setLater] = useState(false);
	const update = pwa.status === "mismatch" || pwa.waiting;
	const connectionDetail =
		pwa.error &&
		!/Failed to fetch|Load failed|NetworkError|The server or tailnet connection is unavailable/.test(
			pwa.error,
		)
			? pwa.error
			: undefined;
	return (
		<>
			{pwa.status !== "ready" && (
				<div className="connection-error" role="status">
					{pwa.status === "mismatch"
						? "Factory updated. Actions are paused until you update."
						: pwa.status === "checking"
							? "Checking the factory connection and refreshing current state…"
							: "Can’t reach the factory. The server and tailnet connection are required for current runs and actions."}
					{hasData && pwa.status !== "checking" && (
						<p>
							Already-loaded information may be stale. Your drafts stay here; no
							offline actions are queued.
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
						Your drafts and reading position will be preserved. Active runs
						continue on the server.
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

export function RecoveredDrafts() {
	const [saved] = useState(recoveredDrafts),
		[dismissed, setDismissed] = useState(false);
	const entries = Object.entries(saved).filter(
		([key, draft]) =>
			/^(chat|answers|feedback\/text|recipe\/(json|modal-json)|composer\/inputs)/.test(
				key,
			) &&
			draft.value &&
			JSON.stringify(draft.value) !== "{}" &&
			draft.value !== "",
	);
	if (dismissed || !entries.length) return null;
	return (
		<details className="update-notice">
			<summary>Drafts recovered by this update ({entries.length})</summary>
			<p>
				These are copies saved before updating, including drafts whose question
				or gate may no longer be open. Review current state before sending
				anything.
			</p>
			{entries.map(([key, draft]) => (
				<label key={key}>
					{key}
					<textarea
						readOnly
						value={
							typeof draft.value === "string"
								? draft.value
								: JSON.stringify(draft.value, null, 2)
						}
						rows={3}
					/>
				</label>
			))}
			<Button variant="ghost" onClick={() => setDismissed(true)}>
				Dismiss recovered copies
			</Button>
		</details>
	);
}
