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
