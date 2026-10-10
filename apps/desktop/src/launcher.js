const status = document.querySelector("#status");
async function connect(remote) {
	status.textContent = "Connecting…";
	try {
		await window.factoryLauncher.connect(remote);
	} catch (error) {
		status.textContent = error.message;
	}
}
document.querySelector("#local").addEventListener("click", () => connect(null));
document
	.querySelector("#remote")
	.addEventListener("click", () =>
		connect(document.querySelector("#origin").value),
	);

let appState,
	formRevision,
	requestBusy = false,
	dirty = false,
	editGeneration = 0,
	actionError = "";
const appOutput = document.querySelector("#app-update-status");
const fields = ["channel", "policy", "paused", "pin"].map((id) =>
	document.querySelector(`#app-${id}`),
);
for (const field of fields) {
	const edited = () => {
		dirty = true;
		editGeneration++;
	};
	field.addEventListener("input", edited);
	field.addEventListener("change", edited);
}
function syncForm() {
	document.querySelector("#app-channel").value = appState.settings.channel;
	document.querySelector("#app-policy").value =
		appState.settings.overrides[appState.settings.channel] ?? "default";
	document.querySelector("#app-paused").checked = appState.settings.paused;
	document.querySelector("#app-pin").value = appState.settings.pin ?? "";
	formRevision = appState.revision;
}
function render() {
	if (!appState) return;
	if (appState.unavailable) {
		appOutput.textContent = appState.unavailable;
		return;
	}
	const candidate = appState.pending?.candidate,
		transaction = appState.transaction;
	appOutput.textContent = `Installed UI: ${appState.installed.version} ${appState.installed.commit ?? "unknown"} ${appState.installed.target ?? "unknown"}\nChannel: ${appState.settings.channel}; effective policy: ${appState.effectivePolicy}; overrides: ${JSON.stringify(appState.settings.overrides)}\n${appState.message}\n${candidate ? `Candidate: ${candidate.channel} ${candidate.version} ${candidate.commit} ${candidate.target}\nManifest: ${candidate.manifestSha256}\n${appState.pending.staged ? "Downloaded and verified" : "Pending verification"}` : "No pending app candidate"}\n${transaction ? `Transaction: ${transaction.phase}${transaction.release ? `; result: ${transaction.release.outcome}` : ""}\n${transaction.error ?? ""}` : ""}\n${appState.error ?? ""}\n${actionError}`;
	for (const id of ["install", "retry"])
		document.querySelector(`#app-${id}`).disabled =
			requestBusy || !candidate || !appState.activationSupported;
}
async function updateAction(action, input, revision = appState?.revision) {
	if (requestBusy) return;
	requestBusy = true;
	const generation = editGeneration;
	render();
	try {
		const next = await window.factoryLauncher.updates(action, input, revision);
		appState = next;
		if (action !== "status") actionError = "";
		if (!next.unavailable) {
			if (action === "configure" && generation === editGeneration)
				dirty = false;
			if (!dirty) syncForm();
		}
	} catch (error) {
		actionError = error.message;
	} finally {
		requestBusy = false;
		render();
	}
}
for (const [id, action] of [
	["check", "check"],
	["verify", "verify-installation"],
	["install", "install"],
	["retry", "retry"],
	["cancel", "cancel"],
	["recover", "recover"],
])
	document.querySelector(`#app-${id}`).addEventListener("click", () => {
		if ((action === "install" || action === "retry") && !appState?.pending)
			return;
		// Capture the exact displayed candidate and revision together. A background
		// poll may refresh later, but cannot silently consent to a different release.
		const displayed = appState;
		void updateAction(
			action,
			action === "install" || action === "retry"
				? [
						displayed.pending.candidate.channel,
						displayed.pending.candidate.version,
						displayed.pending.candidate.commit,
						displayed.pending.candidate.target,
						displayed.pending.candidate.manifestSha256,
					].join(":")
				: undefined,
			displayed?.revision,
		);
	});
document.querySelector("#app-save").addEventListener("click", () =>
	updateAction(
		"configure",
		{
			channel: document.querySelector("#app-channel").value,
			policy: document.querySelector("#app-policy").value,
			paused: document.querySelector("#app-paused").checked,
			pin: document.querySelector("#app-pin").value.trim() || null,
		},
		formRevision,
	),
);
document.querySelector("#app-reset").addEventListener("click", () => {
	if (requestBusy) return;
	dirty = false;
	actionError = "";
	void updateAction("status");
});
// Read-only polling refreshes notification, pending work and terminal outcomes.
// Form edits retain their original revision until saved or explicitly discarded.
const refresh = () => {
	if (!document.hidden) void updateAction("status");
};
const poll = setInterval(refresh, 3000);
document.addEventListener("visibilitychange", refresh);
window.addEventListener("focus", refresh);
window.addEventListener("beforeunload", () => clearInterval(poll));
void updateAction("status");
