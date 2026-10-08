import { useSyncExternalStore } from "react";
export type AccessState = {
	status: "checking" | "authenticated" | "required";
	setupRequired?: boolean;
	expires?: number;
	error?: string;
};
let state: AccessState = { status: "checking" };
let generation = 0;
let abort = new AbortController();
const listeners = new Set<() => void>();
const cleaners = new Set<() => void>();
let deadline: ReturnType<typeof setTimeout> | undefined;
export const accessState = () => state;
export const accessGeneration = () => generation;
export const accessSignal = () => abort.signal;
export function onAccessLost(clean: () => void) {
	cleaners.add(clean);
	return () => cleaners.delete(clean);
}
const publish = (next: AccessState) => {
	state = next;
	for (const listener of listeners) listener();
};
export function accessRequired(
	error = "Sign in to continue",
	broadcast = false,
) {
	generation++;
	abort.abort();
	abort = new AbortController();
	if (deadline) clearTimeout(deadline);
	for (const clean of cleaners) clean();
	for (const name of ["localStorage", "sessionStorage"] as const) {
		try {
			const storage = globalThis[name];
			if (!storage) continue;
			for (const key of Object.keys(storage))
				if (
					/^(factory-|factory\/|bobs-factory-|bob-)/.test(key) &&
					![
						"factory-theme",
						"factory-settled-view",
						// Device consent and deferred unsubscribe cleanup must survive
						// session loss; this contains no subscription keys or run data.
						"factory-push-device-v1",
					].includes(key)
				)
					storage.removeItem(key);
		} catch {
			/* Storage may be disabled. In-memory state is still cleared. */
		}
	}
	publish({ status: "required", setupRequired: state.setupRequired, error });
	if (broadcast) channel?.postMessage("logout");
}
export function useAccess() {
	return useSyncExternalStore((listener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}, accessState);
}
let request = 0;
export async function checkAccess(background = false) {
	const id = ++request,
		epoch = generation;
	if (!background || state.status !== "authenticated")
		publish({ ...state, status: "checking" });
	try {
		const response = await fetch("/api/auth/status", {
			cache: "no-store",
			credentials: "same-origin",
			signal: accessSignal(),
		});
		if (!response.ok) throw new Error("Factory access unavailable");
		const result = await response.json();
		if (id !== request || epoch !== generation) return;
		if (deadline) clearTimeout(deadline);
		if (result.authenticated && result.expires > Date.now()) {
			publish({ status: "authenticated", expires: result.expires });
			deadline = setTimeout(
				() => accessRequired("Your session expired. Sign in again.", true),
				result.expires - Date.now(),
			);
		} else {
			state = { status: "required", setupRequired: result.setupRequired };
			accessRequired("Sign in to continue");
		}
	} catch {
		if (id === request && epoch === generation)
			accessRequired(
				"Connect to Factory to sign in. Offline access is unavailable.",
			);
	}
}
const channel =
	typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
		? new BroadcastChannel("factory-auth")
		: undefined;
if (channel)
	channel.onmessage = () => accessRequired("Signed out in another tab");
