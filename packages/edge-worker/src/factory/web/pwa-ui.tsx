import { useState } from "react";
import { client } from "./client";
import { installApp, reconnect, updateApp, usePwa } from "./pwa";
import { restorationNotice } from "./restoration";
import { Button, Modal } from "./ui";
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
export function ConnectionNotice({ hasData }: { hasData: boolean }) {
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
	return (
		<>
			{pwa.status !== "ready" && (
				<div className="connection-error" role="status">
					{pwa.status === "mismatch"
						? "Factory updated. Actions are paused until you update."
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
						Unsent edits will be discarded. Active runs continue on the server.
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
