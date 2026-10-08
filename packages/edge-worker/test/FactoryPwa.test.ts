import { createHash } from "node:crypto";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { factoryWebAssets } from "../src/factory/FactoryWebAssets.js";
import { accessRequired, checkAccess } from "../src/factory/web/auth-state.js";
import {
	installApp,
	pwaState,
	startPwa,
	uiBuild,
} from "../src/factory/web/pwa.js";
import {
	completeRestoration,
	decodeSnapshot,
	forgetView,
	loadRestoration,
	preserveForUpdate,
	rememberView,
	restorationNotice,
	restoredView,
} from "../src/factory/web/restoration.js";

beforeEach(async () => {
	const previous = globalThis.fetch;
	globalThis.fetch = async () =>
		Response.json({ authenticated: true, expires: Date.now() + 3600000 });
	await checkAccess();
	globalThis.fetch = previous;
});
const build = "b".repeat(24),
	oldBuild = "a".repeat(24),
	prefix = "bobs-factory-shell-";
const html = "<!doctype html><html>factory shell</html>";
const script = `/app.${"1".repeat(24)}.js`;
const resources = [
	{ path: "/", type: "text/html", body: html },
	{ path: script, type: "application/javascript", body: "app" },
].map((r) => ({
	...r,
	sha256: createHash("sha256").update(r.body).digest("hex"),
	integrity: `sha256-${createHash("sha256").update(r.body).digest("base64")}`,
}));
const origin = "https://factory.test";
// Exercise the actual bundled Workbox modules, rather than mocking their API.
const workerSource = buildSync({
	entryPoints: [new URL("../src/factory/web/sw.js", import.meta.url).pathname],
	bundle: true,
	write: false,
	format: "iife",
	platform: "browser",
	define: {
		"process.env.NODE_ENV": '"production"',
		__SHELL__: JSON.stringify({ build, resources }),
	},
}).outputFiles[0].text;
const urlOf = (key: string | Request) =>
	new URL(typeof key === "string" ? key : key.url, origin).href;
function worker() {
	const stored = new Map<string, Map<string, Response>>();
	const caches = {
		keys: async () => [...stored.keys()],
		delete: async (name: string) => stored.delete(name),
		match: async (key: string | Request, options: { cacheName: string }) =>
			stored.get(options.cacheName)?.get(urlOf(key))?.clone(),
		open: async (name: string) => {
			if (!stored.has(name)) stored.set(name, new Map());
			const cache = stored.get(name)!;
			return {
				keys: async () => [...cache.keys()].map((url) => new Request(url)),
				delete: async (key: string | Request) => cache.delete(urlOf(key)),
				put: async (key: string | Request, response: Response) => {
					cache.set(urlOf(key), response.clone());
				},
				match: async (key: string | Request) => cache.get(urlOf(key))?.clone(),
			};
		},
	};
	const clients = [
		{ id: "tab-old", url: `${origin}/` },
		{ id: "tab-new", url: `${origin}/` },
	];
	const handlers = new Map<string, (event: any) => void>();
	const fetch = vi.fn(async (key: string | Request) => {
		const resource = resources.find((r) => urlOf(r.path) === urlOf(key))!;
		return new Response(resource.body, {
			headers: { "Content-Type": resource.type, "X-Factory-Build": build },
		});
	});
	const self = {
		location: new URL(`${origin}/sw.js`),
		caches,
		registration: {
			waiting: undefined as unknown,
			installing: undefined as unknown,
		},
		clients: { matchAll: async () => clients, claim: vi.fn(async () => {}) },
		skipWaiting: vi.fn(async () => {}),
		addEventListener: (name: string, handler: (event: any) => void) =>
			handlers.set(name, handler),
	};
	runInNewContext(workerSource, {
		self,
		caches,
		// Node's mocked fetch does not enforce browser SRI. Simulate that boundary here.
		fetch: async (key: string | Request) => {
			const response = await fetch(key);
			if (typeof key !== "string" && key.integrity) {
				const integrity = `sha256-${createHash("sha256")
					.update(Buffer.from(await response.clone().arrayBuffer()))
					.digest("base64")}`;
				if (integrity !== key.integrity)
					throw new TypeError("Factory shell integrity mismatch");
			}
			return response;
		},
		location: self.location,
		URL,
		Response,
		Request,
		ExtendableEvent: class {},
		FetchEvent: class {},
		setTimeout,
		Map,
		Set,
	});
	async function dispatch(name: string, data: any = {}) {
		let response: Promise<Response> | undefined;
		const waits: Promise<{ error?: unknown }>[] = [];
		handlers.get(name)!({
			type: name,
			...data,
			waitUntil: (value: Promise<unknown>) =>
				waits.push(
					value.then(
						() => ({}),
						(error) => ({ error }),
					),
				),
			respondWith: (value: Promise<Response>) => {
				response = value;
			},
		});
		// Workbox may extend the event lifetime during installation itself.
		for (let index = 0; index < waits.length; index++) {
			const { error } = await waits[index];
			if (error) throw error;
		}
		return response;
	}
	const message = (id: string, data: any) =>
		dispatch("message", {
			source: { id, url: `${origin}/` },
			data,
			ports: [{ postMessage: vi.fn() }],
		});
	return { stored, caches, clients, fetch, self, dispatch, message };
}
afterEach(() => {
	vi.unstubAllGlobals();
});

it("serves one complete build snapshot and refuses incomplete publication", () => {
	const root = mkdtempSync(join(tmpdir(), "factory-shell-"));
	const source = new URL("../dist/factory/web/", import.meta.url);
	const pointer = JSON.parse(
		readFileSync(new URL("current.json", source), "utf8"),
	);
	try {
		cpSync(new URL(pointer.directory, source), join(root, pointer.directory), {
			recursive: true,
		});
		writeFileSync(join(root, "current.json"), JSON.stringify(pointer));
		mkdirSync(join(root, ".stage-incomplete"));
		writeFileSync(join(root, ".stage-incomplete/index.html"), "partial build");
		const url = pathToFileURL(`${root}/`);
		const snapshot = factoryWebAssets(url);
		const index = snapshot.assets.find((a) => a.path === "/")!;
		const original = Buffer.from(index.bytes);
		writeFileSync(
			join(root, pointer.directory, "index.html"),
			"corrupted build",
		);
		expect(index.bytes).toEqual(original);
		expect(() => factoryWebAssets(url)).toThrow("Incomplete factory shell");
		writeFileSync(
			join(root, "current.json"),
			JSON.stringify({ directory: `build-${"0".repeat(24)}` }),
		);
		expect(() => factoryWebAssets(url)).toThrow();
		expect(snapshot.build).toBe(pointer.directory.slice(6));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("precaches only a complete verified shell and ignores runtime data and mutations", async () => {
	const w = worker();
	await w.dispatch("install");
	expect([...w.stored.get(prefix + build)!.keys()]).toEqual(
		resources.map((r) => urlOf(r.path)),
	);
	expect(w.self.skipWaiting).not.toHaveBeenCalled();
	w.fetch.mockClear();
	for (const path of [
		"/api/runs",
		"/api/events",
		"/api/runs/r/artifacts/x",
		"/api/runs/r/screenshots/0",
		"/api/runs/r/activity/entries/0",
		"/unknown",
		`${script}?v=x`,
		`https://other.test${script}`,
	]) {
		expect(
			await w.dispatch("fetch", {
				request: {
					method: "GET",
					mode: "navigate",
					url: new URL(path, origin).href,
				},
			}),
		).toBeUndefined();
	}
	expect(
		await w.dispatch("fetch", {
			request: { method: "POST", url: `${origin}/`, mode: "navigate" },
		}),
	).toBeUndefined();
	expect(w.fetch).not.toHaveBeenCalled();
	const response = await w.dispatch("fetch", {
		request: new Request(origin + script),
	});
	expect(await response!.text()).toBe("app");
});

it.each([
	"wrong bytes",
	"authentication page",
	"partial build",
])("keeps the previous shell when installation receives %s", async (cause) => {
	const w = worker();
	await (await w.caches.open(prefix + oldBuild)).put("/", new Response("old"));
	w.fetch.mockImplementation(
		async () =>
			new Response(cause, {
				status: cause === "partial build" ? 503 : 200,
				headers: {
					"Content-Type": "text/html",
					"X-Factory-Build": cause === "authentication page" ? "" : build,
				},
			}),
	);
	await expect(w.dispatch("install")).rejects.toThrow(/shell/);
	expect(w.stored.has(prefix + build)).toBe(false);
	expect(
		await (await (await w.caches.open(prefix + oldBuild)).match("/"))!.text(),
	).toBe("old");
});

it("uses shell navigation fallback only for its root, without masking access denials", async () => {
	const w = worker();
	await w.dispatch("install");
	w.fetch.mockRejectedValue(new TypeError("Offline"));
	const response = await w.dispatch("fetch", {
		request: { url: `${origin}/`, method: "GET", mode: "navigate" },
	});
	expect(await response!.text()).toBe(html);
	w.fetch.mockResolvedValue(new Response("Denied", { status: 403 }));
	const denied = await w.dispatch("fetch", {
		request: { url: `${origin}/`, method: "GET", mode: "navigate" },
	});
	expect(denied!.status).toBe(403);
	w.fetch.mockResolvedValue(new Response("proxy unavailable", { status: 502 }));
	const unavailable = await w.dispatch("fetch", {
		request: { url: `${origin}/`, method: "GET", mode: "navigate" },
	});
	expect(await unavailable!.text()).toBe(html);
	w.fetch.mockResolvedValue(
		new Response("Authentication page", { status: 200 }),
	);
	const authentication = await w.dispatch("fetch", {
		request: { url: `${origin}/`, method: "GET", mode: "navigate" },
	});
	expect(await authentication!.text()).toBe("Authentication page");
});

it("retains unknown and older tab caches, including a waiting update, then prunes after old clients close", async () => {
	const w = worker();
	await w.dispatch("install");
	await w.caches.open(prefix + oldBuild);
	await w.caches.open("user-preferences");
	await w.dispatch("activate");
	expect(w.stored.has(prefix + oldBuild)).toBe(true);
	expect(w.self.clients.claim).not.toHaveBeenCalled();
	await w.message("tab-old", { type: "HELLO", build: oldBuild });
	await w.message("tab-new", { type: "HELLO", build });
	expect(w.stored.has(prefix + oldBuild)).toBe(true);
	await w.caches.open(prefix + "c".repeat(24));
	w.self.registration.waiting = {};
	await w.message("tab-new", { type: "HELLO", build });
	expect(w.stored.has(prefix + "c".repeat(24))).toBe(true);
	w.self.registration.waiting = undefined;
	w.clients.shift();
	await w.message("tab-new", { type: "HELLO", build });
	expect(w.stored.has(prefix + oldBuild)).toBe(false);
	expect(w.stored.has("user-preferences")).toBe(true);
	await w.message("tab-new", { type: "ACTIVATE", build: "wrong" });
	expect(w.self.skipWaiting).not.toHaveBeenCalled();
	await w.message("tab-new", { type: "ACTIVATE", build });
	expect(w.self.skipWaiting).toHaveBeenCalledOnce();
});

function storage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
		removeItem: (key: string) => {
			values.delete(key);
		},
		values,
	};
}
function browserState() {
	vi.stubGlobal("location", { hash: "#/runs/r" });
	vi.stubGlobal("document", {
		querySelectorAll: () => [{ dataset: { restore: "recipe-test" } }],
		querySelector: () => ({ setAttribute: vi.fn() }),
	});
	vi.stubGlobal("CSS", { escape: (value: string) => value });
}

it("keeps the connected app usable without workers and prompts for installation only on explicit request", async () => {
	const window = new EventTarget();
	vi.stubGlobal("window", window);
	vi.stubGlobal(
		"document",
		Object.assign(new EventTarget(), { readyState: "complete" }),
	);
	vi.stubGlobal("navigator", {});
	vi.stubGlobal("matchMedia", () => ({ matches: false }));
	vi.stubGlobal("isSecureContext", false);
	vi.stubGlobal("sessionStorage", storage());
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () => new Response(JSON.stringify({ build: uiBuild, protocol: 1 })),
		),
	);
	const refresh = vi.fn(async () => {});
	startPwa(refresh);
	await vi.waitFor(() => expect(pwaState().status).toBe("ready"));
	expect(refresh).toHaveBeenCalledOnce();
	const prompt = vi.fn(async () => {});
	const event = Object.assign(
		new Event("beforeinstallprompt", { cancelable: true }),
		{ prompt, userChoice: Promise.resolve({ outcome: "dismissed" }) },
	);
	window.dispatchEvent(event);
	expect(event.defaultPrevented).toBe(true);
	expect(prompt).not.toHaveBeenCalled();
	await installApp();
	expect(prompt).toHaveBeenCalledOnce();
	expect(pwaState().install).toBeUndefined();
	expect(pwaState().status).toBe("ready");
	window.dispatchEvent(new Event("appinstalled"));
	expect(pwaState().installed).toBe(true);
});
it("round-trips only view state and excludes every editable surface", () => {
	browserState();
	const saved = storage(),
		otherTab = storage();
	vi.stubGlobal("sessionStorage", saved);
	rememberView("composer/inputs", { prompt: "launch draft" });
	rememberView("composer/execution", {
		identityProfile: "native-claude",
		toolProfile: "shared",
	});
	rememberView("chat/r", "chat draft");
	rememberView("answers/r", { 0: "clarification draft" }, "old-question");
	rememberView("feedback/text/r", "feedback", "old-gate");
	rememberView("recipe/json/test", "{}", "old-recipe");
	rememberView("recipe/machine-capacity", { limit: "7" }, "old-limit");
	rememberView(
		"recipe/title-settings",
		{ value: { runner: "codex", model: "cheap" } },
		"old-title-settings",
	);
	rememberView("inspector/selection", { runId: "r", name: "plan" });
	rememberView("reading/r/all", {
		following: false,
		anchor: { key: "entry/2", cursor: "cursor", offset: 4 },
		expanded: ["entry/2"],
	});
	preserveForUpdate(build, saved);
	expect(otherTab.values.size).toBe(0);
	const snapshot = decodeSnapshot([...saved.values.values()][0]);
	expect(snapshot).toMatchObject({
		schema: 2,
		target: build,
		route: "#/runs/r",
		details: [],
		views: { "reading/r/all": { value: { anchor: { cursor: "cursor" } } } },
	});
	loadRestoration(build, saved);
	for (const key of [
		"chat/r",
		"composer/inputs",
		"composer/execution",
		"answers/r",
		"feedback/text/r",
		"recipe/json/test",
		"recipe/title-settings",
		"recipe/machine-capacity",
	]) {
		expect(restoredView(key)).toBeUndefined();
		expect(snapshot?.views[key]).toBeUndefined();
	}
	completeRestoration();
	expect(saved.values.size).toBe(0);
});
it.each([
	"",
	"/access",
	"/execution",
	"/identities",
	"/tools",
	"/capacity",
	"/titles",
])("restores Settings%s without unsaved inputs through updates", (section) => {
	browserState();
	const route = `#/settings${section}`;
	vi.stubGlobal("location", { hash: route });
	const saved = storage();
	vi.stubGlobal("sessionStorage", saved);
	rememberView("recipe/machine-capacity", { limit: "7" });
	rememberView("recipe/title-settings", { value: { model: "cheap" } });
	preserveForUpdate(build, saved);
	expect(decodeSnapshot([...saved.values.values()][0])).toMatchObject({
		route,
		views: {},
	});
	location.hash = "#/";
	loadRestoration(build, saved);
	expect(location.hash).toBe(route);
	expect(restoredView("recipe/machine-capacity")).toBeUndefined();
	expect(restoredView("recipe/title-settings")).toBeUndefined();
	completeRestoration();
	expect(saved.values.size).toBe(0);
});
it.each([
	"#/settings/unknown",
	"#/settings/tools/extra",
	"#/settings/tools?redirect=evil",
	"https://example.test/settings/tools",
])("rejects unsupported update routes: %s", (route) => {
	expect(
		decodeSnapshot(
			JSON.stringify({
				schema: 2,
				target: build,
				route,
				expires: Date.now() + 1000,
				views: {},
				details: [],
			}),
		),
	).toBeUndefined();
});
it.each([
	false,
	true,
])("preserves the Settings route without inputs during updates with signed-out state %s", (signedOut) => {
	browserState();
	vi.stubGlobal("location", { hash: "#/settings" });
	const saved = storage();
	vi.stubGlobal("sessionStorage", saved);
	rememberView("chat/r", "private draft");
	rememberView("inspector/selection", { runId: "r", name: "plan" });
	if (signedOut) accessRequired("Signed out");
	preserveForUpdate(build, saved);
	const snapshot = decodeSnapshot([...saved.values.values()][0]);
	expect(snapshot?.route).toBe("#/settings");
	expect(snapshot?.views["chat/r"]).toBeUndefined();
	expect(snapshot?.views["inspector/selection"]).toEqual(
		signedOut ? undefined : { value: { runId: "r", name: "plan" } },
	);
	location.hash = "#/";
	loadRestoration(build, saved);
	expect(location.hash).toBe("#/settings");
	completeRestoration();
	expect(saved.values.size).toBe(0);
});
it("preserves review routes and reading progress without feedback", () => {
	browserState();
	vi.stubGlobal("location", {
		hash: "#/runs/r/review?page=overview&rev=current",
	});
	const saved = storage();
	const progressKey = "review/progress/factory-review/r/head/guide";
	const positionKey = "position/factory-review/r/head/guide/position/0";
	const feedbackKey = "feedback/text/factory-review/r/head/guide/feedback/gate";
	const progress = {
		page: 0,
		reviewed: {},
		disclosures: {},
		checked: { "feature-0/0": true },
		visited: { overview: true, "chapter:feature-0": true },
	};
	rememberView(progressKey, progress);
	rememberView(positionKey, 700);
	rememberView(feedbackKey, "Keep this feedback with this revision", "gate");
	preserveForUpdate(build, saved);
	const snapshot = decodeSnapshot([...saved.values.values()][0]);
	expect(snapshot?.route).toBe("#/runs/r/review?page=overview&rev=current");
	expect(snapshot?.views[progressKey]?.value).toEqual(progress);
	expect(snapshot?.views[positionKey]?.value).toBe(700);
	expect(snapshot?.views[feedbackKey]).toBeUndefined();
	loadRestoration(build, saved);
	expect(restoredView(progressKey)).toEqual(progress);
	expect(restoredView(positionKey)).toBe(700);
	expect(restoredView(feedbackKey)).toBeUndefined();
	completeRestoration();
});
it.each([
	{ checked: { "feature-0/0": false } },
	{ disclosures: { "feature-0": false } },
	{ visited: { "chapter:feature-0": true, overview: true } },
])("preserves explicit Overview progress through updates: %j", (changes) => {
	browserState();
	const saved = storage();
	const key = "review/progress/factory-review/r/head/guide";
	const progress = {
		page: 0,
		reviewed: {},
		checked: {},
		disclosures: {},
		visited: {},
		...changes,
	};
	rememberView(key, progress);
	preserveForUpdate(build, saved);
	expect(
		decodeSnapshot([...saved.values.values()][0])?.views[key]?.value,
	).toEqual(progress);
	// Simulate a fresh app's in-memory state before consuming this tab's snapshot.
	forgetView(key);
	loadRestoration(build, saved);
	expect(restoredView(key)).toEqual(progress);
	completeRestoration();
	forgetView(key);
});
it("retains a tab's document position at zero rather than falling back to shared storage", () => {
	browserState();
	const saved = storage();
	const key = "position/bob-today-position";
	rememberView(key, 0);
	preserveForUpdate(build, saved);
	expect(decodeSnapshot([...saved.values.values()][0])?.views[key]?.value).toBe(
		0,
	);
	loadRestoration(build, saved);
	expect(restoredView(key)).toBe(0);
	completeRestoration();
	forgetView(key);
});
it("keeps browsing defaults out of update snapshots while preserving edits and explicit panel choices", () => {
	browserState();
	const saved = storage();
	for (let i = 0; i < 301; i++) {
		rememberView(`panels/visited-${i}`, {});
		rememberView(`chat/visited-${i}`, "");
		rememberView(`answers/visited-${i}`, {});
		rememberView(`feedback/open/visited-${i}`, false);
		rememberView(`review/progress/visited-${i}`, {
			page: 0,
			reviewed: {},
			checked: {},
			disclosures: {},
			visited: {},
		});
		rememberView(`reading/visited-${i}/all`, {
			following: true,
			expanded: [],
			groups: [],
		});
	}
	rememberView("chat/edited", "keep this");
	rememberView("panels/edited", { clarify: false, work: true });
	rememberView("recipe/json/edited", "");
	rememberView("answers/cleared", { 0: "answer" });
	rememberView("answers/cleared", {});
	rememberView("chat/cleared", "draft");
	rememberView("chat/cleared", "");
	try {
		preserveForUpdate(build, saved);
		const snapshot = decodeSnapshot([...saved.values.values()][0])!;
		for (let i = 0; i < 301; i++)
			expect(
				Object.keys(snapshot.views).some((key) => key.includes(`visited-${i}`)),
			).toBe(false);
		expect(snapshot.views).toMatchObject({
			"panels/edited": { value: { clarify: false, work: true } },
		});
		expect(snapshot.views["answers/cleared"]).toBeUndefined();
		expect(snapshot.views["chat/cleared"]).toBeUndefined();
		loadRestoration(build, saved);
		expect(restoredView("chat/edited")).toBeUndefined();
		expect(restoredView("panels/edited")).toEqual({
			clarify: false,
			work: true,
		});
		expect(restoredView("recipe/json/edited")).toBeUndefined();
		completeRestoration();
	} finally {
		for (const key of ["chat/edited", "panels/edited", "recipe/json/edited"])
			forgetView(key);
	}
});
it("never postpones an update for denied storage or oversized old inputs", () => {
	browserState();
	rememberView("chat/huge", "x".repeat(512001));
	expect(restoredView("chat/huge")).toBeUndefined();
	expect(() =>
		preserveForUpdate(build, {
			setItem: () => {
				throw new Error("Denied");
			},
			getItem: () => null,
		}),
	).not.toThrow();
	expect(() => preserveForUpdate(build, storage())).not.toThrow();
});
it("rejects expired, malformed and unexpected snapshot surfaces", () => {
	const snapshot = {
		schema: 2,
		target: build,
		route: "#/",
		expires: Date.now() - 1,
		views: {},
		details: [],
	};
	expect(decodeSnapshot(JSON.stringify(snapshot))).toBeUndefined();
	expect(decodeSnapshot("{")).toBeUndefined();
	expect(
		decodeSnapshot(
			JSON.stringify({
				...snapshot,
				expires: Date.now() + 1000,
				views: { "query/r": { value: [] } },
			}),
		),
	).toBeUndefined();
	for (const [key, value] of [
		["composer/execution", { identityProfile: 1 }],
		["composer/execution", { credential: "secret" }],
		["recipe/role", { workflowId: "r" }],
		["recipe/title-settings", { value: { model: 4 } }],
		["recipe/machine-capacity", { limit: 7 }],
		["today/skipped", 4],
		["reading/r", { following: false, groups: 2 }],
		["position/review", -1],
		["position/review", "700"],
		["position/review", null],
	])
		expect(
			decodeSnapshot(
				JSON.stringify({
					...snapshot,
					expires: Date.now() + 1000,
					views: { [String(key)]: { value } },
				}),
			),
		).toBeUndefined();
});

it("keeps startup usable when access to sessionStorage itself throws", () => {
	browserState();
	const original = Object.getOwnPropertyDescriptor(
		globalThis,
		"sessionStorage",
	);
	Object.defineProperty(globalThis, "sessionStorage", {
		configurable: true,
		get() {
			throw new Error("Storage denied");
		},
	});
	try {
		expect(() => loadRestoration(build)).not.toThrow();
		expect(restorationNotice()).toMatch(/storage is unavailable/);
		expect(() => preserveForUpdate(build)).not.toThrow();
	} finally {
		if (original) Object.defineProperty(globalThis, "sessionStorage", original);
		else delete (globalThis as any).sessionStorage;
	}
});
it("ignores and removes legacy update snapshots without reading their inputs", () => {
	browserState();
	const saved = storage();
	saved.setItem(
		"bobs-factory-update-v1",
		JSON.stringify({
			schema: 1,
			target: build,
			expires: Date.now() + 1000,
			route: "#/recipes",
			details: [],
			drafts: {
				"answers/r": { value: { 0: "old answer" } },
				"chat/r": { value: "old chat" },
			},
		}),
	);
	saved.setItem(
		"bob-composer-execution",
		JSON.stringify({ identityProfile: "old-profile" }),
	);
	loadRestoration(build, saved);
	expect(saved.getItem("bob-composer-execution")).toBeNull();
	expect(saved.getItem("bobs-factory-update-v1")).toBeNull();
	expect(restoredView("answers/r")).toBeUndefined();
	expect(restoredView("chat/r")).toBeUndefined();
	expect(location.hash).toBe("#/runs/r");
});
