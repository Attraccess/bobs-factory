const { contextBridge, ipcRenderer } = require("electron");
// The shared dashboard can open local native settings, never acquire filesystem
// authority or modify the selected remote host through this bridge.
contextBridge.exposeInMainWorld("factoryDesktop", {
	openAppUpdates: () => ipcRenderer.invoke("desktop-open-updates"),
});
