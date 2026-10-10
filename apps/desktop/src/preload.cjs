const { contextBridge, ipcRenderer } = require("electron");
// Only the packaged launcher loads this preload. Factory web contents never do.
contextBridge.exposeInMainWorld("factoryLauncher", {
	updates: (action, input, revision) =>
		ipcRenderer.invoke("launcher-updates", action, input, revision),
	connect: (remote) => ipcRenderer.invoke("launcher-connect", remote),
});
