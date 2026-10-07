import { useSyncExternalStore } from "react";
import { loadRestoration, preserveForUpdate } from "./restoration";

declare const __FACTORY_BUILD__: string;
export const uiBuild =
	typeof __FACTORY_BUILD__ === "string" ? __FACTORY_BUILD__ : "unbuilt";
export const protocol = 1;
type InstallEvent = Event & {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: string }>;
};
type State = {
	status: "checking" | "ready" | "offline" | "mismatch";
	serverBuild?: string;
	install?: InstallEvent;
	installed: boolean;
	waiting: boolean;
	updating: boolean;
	error?: string;
	updateError?: string;
	warning?: string;
};
let state: State = {
	status: "checking",
	installed: false,
	waiting: false,
	updating: false,
};
const listeners = new Set<() => void>();
export function pwaState() {
	return state;
}
function change(update: Partial<State>) {
	state = { ...state, ...update };
	for (const notify of listeners) notify();
}
export function usePwa() {
	return useSyncExternalStore((notify) => {
		listeners.add(notify);
		return () => listeners.delete(notify);
	}, pwaState);
}
export function disconnected(
	message = "The factory connection is unavailable.",
) {
	if (state.status !== "mismatch")
		change({ status: "offline", error: message });
}
export function versionMismatch(build?: string) {
	change({ status: "mismatch", serverBuild: build, error: undefined });
}
let check: Promise<boolean> | undefined;
export async function checkVersion(): Promise<boolean> {
	if (check) return check;
	check = (async () => {
		try {
			const response = await fetch("/api/version", {
				cache: "no-store",
				signal: AbortSignal.timeout(8000),
			});
			if (!response.ok)
				throw new Error(`Factory connection unavailable (${response.status})`);
			const version = await response.json();
			if (
				typeof version.build !== "string" ||
				version.protocol !== protocol ||
				version.build !== uiBuild
			) {
				versionMismatch(version.build);
				return false;
			}
			change({
				serverBuild: version.build,
				error: undefined,
				status: state.status === "ready" ? "ready" : "checking",
			});
			return true;
		} catch (error) {
			disconnected((error as Error).message);
			return false;
		} finally {
			check = undefined;
		}
	})();
	return check;
}
export function authoritativeReady() {
	if (state.status === "checking")
		change({ status: "ready", error: undefined });
}
export function assertWritable() {
	if (state.updating || state.status !== "ready")
		throw new Error(
			state.status === "mismatch"
				? "Factory updated. Preserve drafts and update before sending."
				: "Actions are paused until the factory reconnects and refreshes current state.",
		);
}
let registration: ServiceWorkerRegistration | undefined;
let refresh: (() => Promise<void>) | undefined;
export async function reconnect() {
	if (state.updating) return;
	if (await checkVersion()) {
		try {
			await refresh?.();
			authoritativeReady();
		} catch (error) {
			disconnected((error as Error).message);
		}
	}
	void registration?.update().catch(() => {});
}
function workerMessage(
	worker: ServiceWorker,
	type: string,
	build?: string,
): Promise<{ build: string }> {
	return new Promise((resolve, reject) => {
		const channel = new MessageChannel();
		const timer = setTimeout(() => {
			channel.port1.close();
			reject(
				new Error("The new offline shell is not ready. Update postponed."),
			);
		}, 8000);
		channel.port1.onmessage = (event) => {
			clearTimeout(timer);
			channel.port1.close();
			resolve(event.data);
		};
		worker.postMessage({ type, build }, [channel.port2]);
	});
}
export function startPwa(refreshData: () => Promise<void>) {
	refresh = refreshData;
	loadRestoration(uiBuild);
	change({
		installed:
			matchMedia("(display-mode: standalone)").matches ||
			Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
	});
	window.addEventListener("beforeinstallprompt", (event) => {
		event.preventDefault();
		change({ install: event as InstallEvent });
	});
	window.addEventListener("appinstalled", () =>
		change({ installed: true, install: undefined }),
	);
	window.addEventListener("offline", () => disconnected());
	window.addEventListener("online", () => void reconnect());
	const refreshRoute = () => {
		if (state.status !== "mismatch") change({ status: "checking" });
		void reconnect();
	};
	window.addEventListener("hashchange", refreshRoute);
	if ("serviceWorker" in navigator)
		navigator.serviceWorker.addEventListener("message", (event) => {
			if (event.data?.type !== "FACTORY_NOTIFICATION") return;
			const destination = event.data.destination;
			if (
				typeof destination !== "string" ||
				!/^\/#\/(?:runs\/[A-Za-z0-9_-]{1,200}(?:\/review)?)?$/.test(destination)
			)
				return;
			if (state.status !== "mismatch") change({ status: "checking" });
			const hash = destination.slice(1);
			if (location.hash === hash) refreshRoute();
			else location.hash = hash;
		});
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") void reconnect();
	});
	if (isSecureContext && "serviceWorker" in navigator) {
		const register = async () => {
			try {
				registration = await navigator.serviceWorker.register("/sw.js", {
					scope: "/",
					updateViaCache: "none",
				});
				const announce = () =>
					navigator.serviceWorker.controller?.postMessage({
						type: "HELLO",
						build: uiBuild,
					});
				navigator.serviceWorker.addEventListener("controllerchange", () => {
					announce();
					change({ waiting: true });
				}); // Other tabs retain their mounted UI.
				announce();
				const observe = () =>
					change({ waiting: Boolean(registration?.waiting) });
				observe();
				registration.addEventListener("updatefound", () =>
					registration?.installing?.addEventListener("statechange", observe),
				);
			} catch {
				change({
					warning:
						"Offline shell unavailable in this browser. You can continue using the connected app.",
				});
			}
		};
		if (document.readyState === "complete") void register();
		else window.addEventListener("load", () => void register(), { once: true });
	}
	void reconnect();
}
export async function installApp() {
	const event = state.install;
	if (!event) return;
	await event.prompt();
	await event.userChoice;
	change({ install: undefined });
}
let writes = 0;
export function beginWrite() {
	assertWritable();
	writes++;
	return () => {
		writes--;
	};
}
export async function updateApp(mutating: () => number) {
	if (state.updating) return;
	change({ updating: true, updateError: undefined });
	try {
		// Freeze new actions, then let existing sends and their query callbacks settle.
		const deadline = Date.now() + 15000;
		while (writes || mutating()) {
			if (Date.now() > deadline)
				throw new Error(
					"A request is still in progress. Update postponed; wait for it to settle.",
				);
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		await checkVersion();
		const target = state.serverBuild;
		if (!target || state.status === "offline")
			throw new Error("Reconnect to the factory before updating.");
		if (registration) {
			await Promise.race([
				registration.update(),
				new Promise<never>((_, reject) =>
					setTimeout(
						() =>
							reject(
								new Error(
									"The offline shell update timed out. Try again when the connection is stable.",
								),
							),
						10000,
					),
				),
			]);
			if (registration.installing)
				await new Promise<void>((resolve, reject) => {
					const worker = registration!.installing!;
					const timer = setTimeout(
						() =>
							reject(
								new Error(
									"The offline shell is still downloading. Try Update again shortly.",
								),
							),
						10000,
					);
					worker.addEventListener("statechange", () => {
						if (worker.state === "installed" || worker.state === "redundant") {
							clearTimeout(timer);
							worker.state === "installed"
								? resolve()
								: reject(
										new Error(
											"The new shell could not be installed. Update postponed.",
										),
									);
						}
					});
				});
			const worker = registration.waiting ?? registration.active;
			if (!worker || (await workerMessage(worker, "BUILD")).build !== target)
				throw new Error(
					"The complete new offline shell is not available yet. Update postponed.",
				);
			preserveForUpdate(target);
			if (worker === registration.waiting) {
				await workerMessage(worker, "ACTIVATE", target);
				await new Promise<void>((resolve, reject) => {
					const timer = setTimeout(
						() =>
							reject(
								new Error(
									"The update did not activate. Your edits remain here; try again.",
								),
							),
						8000,
					);
					const listener = () => {
						if (worker.state === "activated") {
							clearTimeout(timer);
							resolve();
						} else if (worker.state === "redundant") {
							clearTimeout(timer);
							reject(new Error("Update superseded. Try again."));
						}
					};
					worker.addEventListener("statechange", listener);
					listener();
				});
			}
			worker.postMessage({ type: "CLAIM", build: target });
			// Navigation follows the registration's active worker; no controllerchange-triggered reload.
		} else {
			if ("serviceWorker" in navigator && navigator.serviceWorker.controller)
				throw new Error(
					"Offline update registration is unavailable. Reconnect and try again before reloading.",
				);
			preserveForUpdate(target);
		}
		location.reload();
	} catch (error) {
		change({ updating: false, updateError: (error as Error).message });
	}
}
