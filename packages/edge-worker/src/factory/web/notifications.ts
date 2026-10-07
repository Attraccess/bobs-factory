import { checkVersion, uiBuild } from "./pwa";
export interface PushDevice {
	id: string;
	label: string;
	enabled: boolean;
	health: string;
	registeredAt: number;
	lastAttemptAt?: number;
	backoffUntil: number;
}
export interface PushStatus {
	available: boolean;
	publicKey?: string;
	diagnostic?: string;
	devices: PushDevice[];
}
export interface PushPreference {
	id?: string;
	optOut: boolean;
	cleanup?: string;
	intent?: string;
}
const preferenceKey = "factory-push-device-v1";
export function pushSupported() {
	return (
		globalThis.isSecureContext &&
		"Notification" in globalThis &&
		"serviceWorker" in navigator &&
		"PushManager" in globalThis
	);
}
export function pushPreference(): PushPreference {
	try {
		const value = JSON.parse(localStorage.getItem(preferenceKey) ?? "null");
		return value && typeof value.optOut === "boolean"
			? {
					id: typeof value.id === "string" ? value.id : undefined,
					optOut: value.optOut,
					intent: typeof value.intent === "string" ? value.intent : undefined,
					cleanup:
						typeof value.cleanup === "string" ? value.cleanup : undefined,
				}
			: { optOut: true };
	} catch {
		return { optOut: true };
	}
}
export function savePushPreference(value: PushPreference) {
	// Failure to save consent state must prevent an automatic return to enabled.
	localStorage.setItem(preferenceKey, JSON.stringify(value));
}
export async function pushApi<T>(
	path = "",
	options: RequestInit = {},
): Promise<T> {
	if (!(await checkVersion()))
		throw new Error(
			"Reconnect or update Factory before managing notifications.",
		);
	const response = await fetch(`/api/push${path}`, {
		...options,
		cache: "no-store",
		signal: AbortSignal.timeout(10000),
		headers: {
			"Content-Type": "application/json",
			"X-Factory-Request": "1",
			"X-Factory-Build": uiBuild,
		},
	});
	if (response.headers.get("X-Factory-Build") !== uiBuild)
		throw new Error("Update Factory before managing notifications.");
	const data = await response.json();
	if (!response.ok)
		throw new Error(data.error ?? "Notification request failed");
	return data;
}
export async function pushRegistration() {
	if (!pushSupported()) return undefined;
	// Use the existing worker and its explicit update policy. Never register a second worker.
	const registration = await navigator.serviceWorker.getRegistration("/");
	if (registration?.active) return registration;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			navigator.serviceWorker.ready,
			new Promise<undefined>((resolve) => {
				timer = setTimeout(() => resolve(undefined), 5000);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
export function applicationKey(key: string) {
	return Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
		c.charCodeAt(0),
	);
}
export function keyMatches(subscription: PushSubscription, key: string) {
	const bytes = subscription.options.applicationServerKey;
	return (
		!!bytes &&
		Array.from(new Uint8Array(bytes)).join() ===
			Array.from(applicationKey(key)).join()
	);
}
export async function enablePush(
	permission: Promise<NotificationPermission>,
	registration: ServiceWorkerRegistration,
	publicKey: string,
	label: string,
) {
	if ((await permission) !== "granted")
		throw new Error(
			"Notifications are not allowed. Change browser settings to enable them.",
		);
	const enable = async () => {
		const intent = crypto.randomUUID();
		savePushPreference({ ...pushPreference(), optOut: true, intent });
		const stillWanted = () => pushPreference().intent === intent;
		let subscription = await registration.pushManager.getSubscription();
		if (subscription && !keyMatches(subscription, publicKey)) {
			await subscription.unsubscribe();
			subscription = null;
		}
		subscription ??= await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: applicationKey(publicKey),
		});
		try {
			if (!stillWanted())
				throw new Error("Notification enable was cancelled by another tab.");
			const device = await pushApi<{ id: string }>("/devices", {
				method: "POST",
				body: JSON.stringify({ label, subscription: subscription.toJSON() }),
			});
			try {
				if (!stillWanted())
					throw new Error("Notification enable was cancelled by another tab.");
				savePushPreference({ id: device.id, optOut: false, intent });
			} catch (error) {
				await pushApi(`/devices/${device.id}`, {
					method: "PATCH",
					body: JSON.stringify({ enabled: false }),
				});
				throw error;
			}
		} catch (error) {
			await subscription.unsubscribe();
			throw error;
		}
	};
	if (navigator.locks)
		await navigator.locks.request("factory-push-registration", enable);
	else await enable();
}
export async function disablePush(registration?: ServiceWorkerRegistration) {
	const current = { ...pushPreference(), intent: crypto.randomUUID() };
	savePushPreference({ ...current, optOut: true, cleanup: current.id });
	// Stop the browser immediately, even if the protected server cannot be reached.
	const subscription = await registration?.pushManager.getSubscription();
	let unsubscribeError: unknown;
	try {
		await subscription?.unsubscribe();
	} catch (error) {
		unsubscribeError = error;
	}
	if (current.id) {
		await pushApi(`/devices/${current.id}`, {
			method: "PATCH",
			body: JSON.stringify({ enabled: false }),
		});
		savePushPreference({ ...current, optOut: true });
	}
	if (unsubscribeError)
		throw new Error(
			"Device targeting stopped. Browser unsubscribe failed; retry Disable when connected.",
		);
}
export async function reconcilePush(registration?: ServiceWorkerRegistration) {
	const reconcile = () => reconcilePushUnlocked(registration);
	return navigator.locks
		? navigator.locks.request("factory-push-registration", reconcile)
		: reconcile();
}
async function reconcilePushUnlocked(registration?: ServiceWorkerRegistration) {
	const preference = pushPreference();
	if (preference.cleanup) {
		try {
			await pushApi(`/devices/${preference.cleanup}`, { method: "DELETE" });
			savePushPreference({ ...preference, cleanup: undefined });
		} catch {
			/* Keep the explicit opt-out and retry cleanup on the next foreground. */
		}
	}
	const status = await pushApi<PushStatus>();
	const subscription = await registration?.pushManager.getSubscription();
	const own = status.devices.find((device) => device.id === preference.id);
	const granted = pushSupported() && Notification.permission === "granted";
	const enabled =
		granted &&
		!preference.optOut &&
		!!subscription &&
		!!status.publicKey &&
		keyMatches(subscription, status.publicKey) &&
		own?.enabled === true;
	// Revocation, key rotation, remote removal or disable require explicit opt-in again.
	if (!enabled && !preference.optOut && preference.id) {
		savePushPreference({
			...preference,
			optOut: true,
			cleanup: own?.enabled ? preference.id : undefined,
		});
		if (own?.enabled) {
			try {
				await pushApi(`/devices/${preference.id}`, {
					method: "PATCH",
					body: JSON.stringify({ enabled: false }),
				});
				savePushPreference({ ...preference, optOut: true });
			} catch {
				/* Deferred cleanup. */
			}
		}
	}
	if (!enabled && subscription) await subscription.unsubscribe();
	return { status, enabled, own };
}
