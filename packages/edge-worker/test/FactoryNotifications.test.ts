import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	disablePush,
	enablePush,
	pushPreference,
	reconcilePush,
	savePushPreference,
} from "../src/factory/web/notifications.js";
import {
	authoritativeReady,
	checkVersion,
	pwaState,
	uiBuild,
} from "../src/factory/web/pwa.js";

const key = Buffer.alloc(65, 1).toString("base64url");
const response = (body: unknown, status = 200) =>
	Response.json(body, { status, headers: { "X-Factory-Build": uiBuild } });
let devices: { id: string; enabled: boolean }[];
let permission = "granted";
const subscription = {
	options: { applicationServerKey: Buffer.alloc(65, 1).buffer },
	toJSON: () => ({
		endpoint: "https://fcm.googleapis.com/fcm/send/x",
		keys: {},
	}),
	unsubscribe: vi.fn(async () => true),
};
const registration = {
	pushManager: {
		getSubscription: vi.fn(async () => subscription),
		subscribe: vi.fn(async () => subscription),
	},
} as unknown as ServiceWorkerRegistration;
beforeEach(async () => {
	const values = new Map<string, string>();
	devices = [{ id: "one", enabled: true }];
	permission = "granted";
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
	vi.stubGlobal("isSecureContext", true);
	vi.stubGlobal("PushManager", class {});
	vi.stubGlobal("Notification", {
		get permission() {
			return permission;
		},
		requestPermission: vi.fn(),
	});
	vi.stubGlobal("navigator", {
		serviceWorker: {},
		locks: {
			request: async (_name: string, fn: () => Promise<unknown>) => fn(),
		},
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path: string) =>
			path === "/api/version"
				? response({ build: uiBuild, protocol: 1 })
				: path === "/api/push"
					? response({ available: true, publicKey: key, devices })
					: response({ id: "one", ok: true }),
		),
	);
	await checkVersion();
	authoritativeReady();
	vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());
it("never requests permission during reconciliation, respects remote disable and requires explicit enable", async () => {
	savePushPreference({ id: "one", optOut: false });
	devices[0]!.enabled = false;
	expect((await reconcilePush(registration)).enabled).toBe(false);
	expect(pushPreference().optOut).toBe(true);
	expect(subscription.unsubscribe).toHaveBeenCalled();
	expect(Notification.requestPermission).not.toHaveBeenCalled();
	expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
	expect(
		vi
			.mocked(fetch)
			.mock.calls.every(([, options]) => options?.method !== "POST"),
	).toBe(true);
});
it("rolls back failed registration without marking Factory offline", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path: string) =>
			path === "/api/version"
				? response({ build: uiBuild, protocol: 1 })
				: response({ error: "Push temporarily unavailable" }, 503),
		),
	);
	await expect(
		enablePush(Promise.resolve("granted"), registration, key, "browser"),
	).rejects.toThrow("Push temporarily unavailable");
	expect(subscription.unsubscribe).toHaveBeenCalled();
	expect(pushPreference().optOut).toBe(true);
	expect(pwaState().status).toBe("ready");
});
it("does not subscribe on denial and reconciles revocation without restoring consent", async () => {
	await expect(
		enablePush(Promise.resolve("denied"), registration, key, "browser"),
	).rejects.toThrow(/not allowed/);
	expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
	savePushPreference({ id: "one", optOut: false });
	permission = "denied";
	expect((await reconcilePush(registration)).enabled).toBe(false);
	expect(pushPreference().optOut).toBe(true);
	expect(
		vi
			.mocked(fetch)
			.mock.calls.some(([, options]) => options?.method === "PATCH"),
	).toBe(true);
});
it("unsubscribes before a failed server cleanup and preserves an opt-out to reconcile later", async () => {
	savePushPreference({ id: "one", optOut: false });
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path: string) => {
			if (path === "/api/version")
				return response({ build: uiBuild, protocol: 1 });
			expect(subscription.unsubscribe).toHaveBeenCalled();
			return response({ error: "unavailable" }, 503);
		}),
	);
	await expect(disablePush(registration)).rejects.toThrow("unavailable");
	expect(pushPreference()).toMatchObject({
		id: "one",
		optOut: true,
		cleanup: "one",
	});
});

it("keeps a later cross-tab disable when an earlier enable finishes registration", async () => {
	savePushPreference({ id: "one", optOut: true });
	let registered: ((value: Response) => void) | undefined;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path: string, options: RequestInit = {}) => {
			if (path === "/api/version")
				return response({ build: uiBuild, protocol: 1 });
			if (options.method === "POST")
				return new Promise<Response>((resolve) => {
					registered = resolve;
				});
			return response({ ok: true });
		}),
	);
	const enabling = enablePush(
		Promise.resolve("granted"),
		registration,
		key,
		"browser",
	);
	const rejected = expect(enabling).rejects.toThrow(/cancelled/);
	await vi.waitFor(() => expect(registered).toBeDefined());
	await disablePush(registration);
	registered!(response({ id: "one" }));
	await rejected;
	expect(pushPreference().optOut).toBe(true);
	expect(subscription.unsubscribe).toHaveBeenCalled();
});
