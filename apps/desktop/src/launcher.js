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

let appState;
const appOutput = document.querySelector("#app-update-status");
async function updateAction(action, input) {
	try {
		appState = await window.factoryLauncher.updates(
			action,
			input,
			appState?.revision,
		);
		if (appState.unavailable) {
			appOutput.textContent = appState.unavailable;
			return;
		}
		document.querySelector("#app-channel").value = appState.settings.channel;
		document.querySelector("#app-policy").value =
			appState.settings.overrides[appState.settings.channel] ?? "default";
		document.querySelector("#app-paused").checked = appState.settings.paused;
		document.querySelector("#app-pin").value = appState.settings.pin ?? "";
		const candidate = appState.pending?.candidate;
		appOutput.textContent = `Installed UI: ${appState.installed.version} ${appState.installed.commit ?? "unknown"} ${appState.installed.target ?? "unknown"}\nChannel: ${appState.settings.channel}; effective policy: ${appState.effectivePolicy}; overrides: ${JSON.stringify(appState.settings.overrides)}\n${appState.message}\n${candidate ? `Candidate: ${candidate.channel} ${candidate.version} ${candidate.commit} ${candidate.target}\nManifest: ${candidate.manifestSha256}` : "No pending app candidate"}\n${appState.transaction ? `Transaction: ${appState.transaction.phase}` : ""}\n${appState.error ?? ""}`;
	} catch (error) {
		appOutput.textContent = error.message;
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
		// Install/retry consent binds the full candidate displayed above, never window close or Quit.
		updateAction(
			action,
			action === "install" || action === "retry"
				? [
						appState.pending.candidate.channel,
						appState.pending.candidate.version,
						appState.pending.candidate.commit,
						appState.pending.candidate.target,
						appState.pending.candidate.manifestSha256,
					].join(":")
				: undefined,
		);
	});
document.querySelector("#app-save").addEventListener("click", () =>
	updateAction("configure", {
		channel: document.querySelector("#app-channel").value,
		policy: document.querySelector("#app-policy").value,
		paused: document.querySelector("#app-paused").checked,
		pin: document.querySelector("#app-pin").value.trim() || null,
	}),
);
void updateAction("status");
