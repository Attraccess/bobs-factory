const { contextBridge, ipcRenderer } = require("electron");
// Only the packaged launcher loads this preload. Factory web contents never do.
contextBridge.exposeInMainWorld("factoryLauncher", {
	connect: (remote) => ipcRenderer.invoke("launcher-connect", remote),
});
