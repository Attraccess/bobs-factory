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
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { factoryWebAssets } from "../src/factory/FactoryWebAssets.js";
import {
	installApp,
	pwaState,
	startPwa,
	uiBuild,
} from "../src/factory/web/pwa.js";
import {
	acknowledgeDraft,
	completeRestoration,
	decodeSnapshot,
	draftRevision,
	forgetDraft,
	loadRestoration,
	preserveForUpdate,
	rememberDraft,
	restorationNotice,
	restoredDraft,
	revisionOf,
	useRestorableState,
} from "../src/factory/web/restoration.js";
import {
	emptyFeedback,
	feedbackKey,
	loadFeedback,
	normalizeFeedback,
	serializeFeedback,
} from "../src/factory/web/review-feedback.js";
import { feedbackSession } from "../src/factory/web/review-feedback-session.js";
import { reviewKey } from "../src/factory/web/review-state.js";

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
it("round-trips bounded tab-local drafts, identifiers and stable reading anchors, then consumes restoration", () => {
	browserState();
	const saved = storage(),
		otherTab = storage();
	vi.stubGlobal("sessionStorage", saved);
	rememberDraft("composer/inputs", { prompt: "launch draft" });
	rememberDraft("chat/r", "chat draft");
	rememberDraft("answers/r", { 0: "clarification draft" }, "old-question");
	rememberDraft("feedback/text/r", "feedback", "old-gate");
	rememberDraft("recipe/json/test", "{}", "old-recipe");
	rememberDraft("recipe/machine-capacity", { limit: "7" }, "old-limit");
	rememberDraft(
		"recipe/title-settings",
		{ value: { runner: "codex", model: "cheap" } },
		"old-title-settings",
	);
	rememberDraft("inspector/selection", { runId: "r", name: "plan" });
	rememberDraft("reading/r/all", {
		following: false,
		anchor: { key: "entry/2", cursor: "cursor", offset: 4 },
		expanded: ["entry/2"],
	});
	preserveForUpdate(build, saved);
	expect(otherTab.values.size).toBe(0);
	const snapshot = decodeSnapshot([...saved.values.values()][0]);
	expect(snapshot).toMatchObject({
		schema: 1,
		target: build,
		route: "#/runs/r",
		details: ["recipe-test"],
		drafts: { "reading/r/all": { value: { anchor: { cursor: "cursor" } } } },
	});
	loadRestoration(build, saved);
	expect(restoredDraft("chat/r")).toBe("chat draft");
	expect(restoredDraft("recipe/machine-capacity")).toEqual({ limit: "7" });
	expect(snapshot?.drafts["recipe/machine-capacity"]?.revision).toBe(
		"old-limit",
	);
	expect(restoredDraft("recipe/title-settings")).toEqual({
		value: { runner: "codex", model: "cheap" },
	});
	expect(snapshot?.drafts["recipe/title-settings"]?.revision).toBe(
		"old-title-settings",
	);
	completeRestoration();
	expect(saved.values.size).toBe(0);
});
it("preserves dedicated review routes, disclosures and revision-scoped feedback during updates", () => {
	browserState();
	vi.stubGlobal("location", { hash: "#/runs/r/review" });
	const saved = storage();
	const progressKey = "review/progress/factory-review/r/head/guide";
	const positionKey = "position/factory-review/r/head/guide/position/0";
	const feedbackKey = "feedback/text/factory-review/r/head/guide/feedback/gate";
	const progress = {
		page: 0,
		reviewed: {},
		disclosures: { "0/evidence": true },
	};
	rememberDraft(progressKey, progress);
	rememberDraft(positionKey, 700);
	rememberDraft(feedbackKey, "Keep this feedback with this revision", "gate");
	preserveForUpdate(build, saved);
	const snapshot = decodeSnapshot([...saved.values.values()][0]);
	expect(snapshot?.route).toBe("#/runs/r/review");
	expect(snapshot?.drafts[progressKey]?.value).toEqual(progress);
	expect(snapshot?.drafts[positionKey]?.value).toBe(700);
	expect(snapshot?.drafts[feedbackKey]).toEqual({
		value: "Keep this feedback with this revision",
		revision: "gate",
	});
	loadRestoration(build, saved);
	expect(restoredDraft(progressKey)).toEqual(progress);
	expect(restoredDraft(positionKey)).toBe(700);
	expect(restoredDraft(feedbackKey)).toBe(
		"Keep this feedback with this revision",
	);
	completeRestoration();
});
it("retains a tab's document position at zero rather than falling back to shared storage", () => {
	browserState();
	const saved = storage();
	const key = "position/bob-today-position";
	rememberDraft(key, 0);
	preserveForUpdate(build, saved);
	expect(
		decodeSnapshot([...saved.values.values()][0])?.drafts[key]?.value,
	).toBe(0);
	loadRestoration(build, saved);
	expect(restoredDraft(key)).toBe(0);
	completeRestoration();
	forgetDraft(key);
});
it("keeps browsing defaults out of update snapshots while preserving edits and explicit panel choices", () => {
	browserState();
	const saved = storage();
	for (let i = 0; i < 301; i++) {
		rememberDraft(`panels/visited-${i}`, {});
		rememberDraft(`chat/visited-${i}`, "");
		rememberDraft(`answers/visited-${i}`, {});
		rememberDraft(`feedback/open/visited-${i}`, false);
		rememberDraft(`reading/visited-${i}/all`, {
			following: true,
			expanded: [],
			groups: [],
		});
	}
	rememberDraft("chat/edited", "keep this");
	rememberDraft("panels/edited", { clarify: false, work: true });
	rememberDraft("recipe/json/edited", "");
	rememberDraft("answers/cleared", { 0: "answer" });
	rememberDraft("answers/cleared", {});
	rememberDraft("chat/cleared", "draft");
	rememberDraft("chat/cleared", "");
	try {
		preserveForUpdate(build, saved);
		const snapshot = decodeSnapshot([...saved.values.values()][0])!;
		for (let i = 0; i < 301; i++)
			expect(
				Object.keys(snapshot.drafts).some((key) =>
					key.includes(`visited-${i}`),
				),
			).toBe(false);
		expect(snapshot.drafts).toMatchObject({
			"chat/edited": { value: "keep this" },
			"panels/edited": { value: { clarify: false, work: true } },
			"recipe/json/edited": { value: "" },
		});
		expect(snapshot.drafts["answers/cleared"]).toBeUndefined();
		expect(snapshot.drafts["chat/cleared"]).toBeUndefined();
		loadRestoration(build, saved);
		expect(restoredDraft("chat/edited")).toBe("keep this");
		expect(restoredDraft("panels/edited")).toEqual({
			clarify: false,
			work: true,
		});
		expect(restoredDraft("recipe/json/edited")).toBe("");
		completeRestoration();
	} finally {
		for (const key of ["chat/edited", "panels/edited", "recipe/json/edited"])
			forgetDraft(key);
	}
});
it("still postpones updates rather than dropping too many meaningful drafts", () => {
	browserState();
	try {
		for (let i = 0; i < 301; i++)
			rememberDraft(`chat/edited-${i}`, `draft ${i}`);
		expect(() => preserveForUpdate(build, storage())).toThrow("too large");
		expect(restoredDraft("chat/edited-0")).toBe("draft 0");
		expect(restoredDraft("chat/edited-300")).toBe("draft 300");
	} finally {
		for (let i = 0; i < 301; i++) forgetDraft(`chat/edited-${i}`);
	}
});
it("postpones when storage is denied or drafts exceed the bound and retains edits", () => {
	browserState();
	rememberDraft("chat/r", "keep this draft");
	expect(() =>
		preserveForUpdate(build, {
			setItem: () => {
				throw new Error("Denied");
			},
			getItem: () => null,
		}),
	).toThrow("Update postponed");
	expect(restoredDraft("chat/r")).toBe("keep this draft");
	rememberDraft("chat/huge", "x".repeat(512001));
	expect(() => preserveForUpdate(build, storage())).toThrow("too large");
	rememberDraft("chat/huge", undefined);
	expect(() => rememberDraft("transcript/r", [])).toThrow("Unknown");
});
it("rejects expired, malformed and unexpected snapshot surfaces", () => {
	const snapshot = {
		schema: 1,
		target: build,
		route: "#/",
		expires: Date.now() - 1,
		drafts: {},
		details: [],
	};
	expect(decodeSnapshot(JSON.stringify(snapshot))).toBeUndefined();
	expect(decodeSnapshot("{")).toBeUndefined();
	expect(
		decodeSnapshot(
			JSON.stringify({
				...snapshot,
				expires: Date.now() + 1000,
				drafts: { "query/r": { value: [] } },
			}),
		),
	).toBeUndefined();
	for (const [key, value] of [
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
					drafts: { [String(key)]: { value } },
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
		expect(() => preserveForUpdate(build)).toThrow("Update postponed");
	} finally {
		if (original) Object.defineProperty(globalThis, "sessionStorage", original);
		else delete (globalThis as any).sessionStorage;
	}
});
it("marks changed questions/gates/recipes as stale drafts instead of accepting them", () => {
	rememberDraft(
		"answers/conflict",
		{ 0: "keep me" },
		revisionOf(["old question"]),
	);
	let stale = false;
	function Probe() {
		const [value, , conflict] = useRestorableState(
			"answers/conflict",
			{},
			revisionOf(["new question"]),
		);
		stale = conflict;
		return createElement("span", {}, JSON.stringify(value));
	}
	expect(renderToStaticMarkup(createElement(Probe))).toContain("keep me");
	expect(stale).toBe(true);
	// Acknowledgement is a user action; it is not done during snapshot loading.
	vi.stubGlobal("window", { dispatchEvent: vi.fn() });
	vi.stubGlobal(
		"CustomEvent",
		class {
			constructor(
				public name: string,
				public data: unknown,
			) {}
		},
	);
	acknowledgeDraft("answers/conflict");
	expect(window.dispatchEvent).toHaveBeenCalledOnce();
});

it.each([
	"head",
	"guide",
	"gate",
])("recovers this tab's feedback as stale when the review %s changes", (changed) => {
	browserState();
	vi.stubGlobal("localStorage", storage());
	const run = {
		id: `revision-${changed}`,
		status: "waiting",
		reviewGate: { id: "old-gate", headSha: "old-head", status: "pending" },
	};
	const guide = { summary: "Original guide" };
	const key = feedbackKey(reviewKey(run, guide), run.reviewGate.id);
	const revision = revisionOf([key, run.reviewGate, run.status, undefined]);
	const draft = {
		...emptyFeedback(),
		feedback: "Keep my additional feedback",
		items: [
			{
				text: "Keep my item comment",
				target: {
					path: "/summary",
					page: 0,
					pageTitle: "Overview",
					kind: "Text block",
					label: "Summary",
					context: "Original guide",
					order: [0, 0],
				},
			},
		],
	};
	const snapshotKey = `feedback/draft/${key}`;
	rememberDraft(snapshotKey, draft, revision);
	const saved = storage();
	preserveForUpdate(build, saved);
	forgetDraft(snapshotKey);
	loadRestoration(build, saved);
	const current = structuredClone(run);
	if (changed === "head") current.reviewGate.headSha = "new-head";
	if (changed === "gate") current.reviewGate.id = "new-gate";
	const currentGuide =
		changed === "guide" ? { summary: "Revised guide" } : guide;
	const currentKey = feedbackKey(
		reviewKey(current, currentGuide),
		current.reviewGate.id,
	);
	const recovered = feedbackSession(currentKey).getSnapshot().draft;
	let stale = false;
	function Probe() {
		const [, , conflict] = useRestorableState(
			`feedback/draft/${currentKey}`,
			recovered,
			revisionOf([currentKey, current.reviewGate, current.status, undefined]),
		);
		stale = conflict;
		return null;
	}
	renderToStaticMarkup(createElement(Probe));
	expect(recovered).toEqual(normalizeFeedback(draft));
	expect(stale).toBe(true);
	expect(draftRevision(`feedback/draft/${currentKey}`)).toBe(revision);
	expect(
		loadFeedback(
			feedbackKey(
				reviewKey({ ...current, id: "other-run" }, currentGuide),
				current.reviewGate.id,
			),
		),
	).toEqual(emptyFeedback());
	forgetDraft(`feedback/draft/${currentKey}`);
	forgetDraft(snapshotKey);
	completeRestoration();
});

it("preserves collected feedback per tab through updates and migrates earlier text snapshots", () => {
	browserState();
	const local = storage(),
		saved = storage();
	vi.stubGlobal("localStorage", local);
	const key = "factory-review/update/feedback/gate",
		snapshotKey = `feedback/draft/${key}`;
	const session = feedbackSession(key);
	const item = {
		text: "Keep my item comment",
		target: {
			path: "/summary",
			page: 0,
			pageTitle: "Summary",
			kind: "Text block",
			label: "Summary",
			context: "Original guide",
			order: [0, 0],
		},
	};
	session.update((d) => ({
		...d,
		feedback: "Keep additional feedback",
		open: true,
		collectedOpen: true,
		editing: "/summary",
		items: [item],
	}));
	const draft = session.getSnapshot().draft;
	rememberDraft(snapshotKey, draft, "old-gate-state");
	try {
		preserveForUpdate(build, saved);
		const snapshot = decodeSnapshot([...saved.values.values()][0])!;
		expect(snapshot.drafts[snapshotKey]).toEqual({
			value: draft,
			revision: "old-gate-state",
		});
		forgetDraft(snapshotKey);
		local.setItem(
			key,
			JSON.stringify({ ...emptyFeedback(), feedback: "Another tab" }),
		);
		loadRestoration(build, saved);
		expect(feedbackSession(key).getSnapshot().draft).toEqual(draft);
		let stale = false;
		function Probe() {
			const [, , conflict] = useRestorableState(
				snapshotKey,
				emptyFeedback(),
				"new-gate-state",
			);
			stale = conflict;
			return null;
		}
		renderToStaticMarkup(createElement(Probe));
		expect(stale).toBe(true);
		const invalid = structuredClone(snapshot);
		invalid.drafts[snapshotKey].value.items[0].target.order = [-1];
		expect(decodeSnapshot(JSON.stringify(invalid))).toBeUndefined();
		completeRestoration();
		forgetDraft(snapshotKey);
		const otherTab = {
			...draft,
			feedback: "Another tab's general feedback",
			items: [{ ...item, text: "Another tab's unsent item comment" }],
		};
		local.setItem(key, JSON.stringify(otherTab));
		rememberDraft(
			`feedback/text/${key}`,
			"Original tab text",
			"legacy-gate-state",
		);
		rememberDraft(`feedback/open/${key}`, true);
		expect(loadFeedback(key).feedback).toBe("Original tab text");
		expect(loadFeedback(key).open).toBe(true);
		expect(restoredDraft(snapshotKey)).toEqual({
			...emptyFeedback(),
			feedback: "Original tab text",
			open: true,
			collectedOpen: false,
			editing: undefined,
		});
		expect(draftRevision(snapshotKey)).toBe("legacy-gate-state");
		expect(restoredDraft(`feedback/text/${key}`)).toBeUndefined();
		expect(restoredDraft(`feedback/open/${key}`)).toBeUndefined();
		expect(
			serializeFeedback(loadFeedback(key), {
				revision: "abc123",
				goal: "Review the update",
				identity: key,
			}),
		).toBe(
			`Review feedback\nRevision: abc123\nGuide: Review the update\nReview: ${key}\n\nAdditional feedback\n\nOriginal tab text`,
		);
		expect(JSON.parse(local.getItem(key)!)).toEqual(otherTab);
		rememberDraft(snapshotKey, emptyFeedback());
		expect(restoredDraft(snapshotKey)).toBeUndefined();
	} finally {
		for (const surface of [
			snapshotKey,
			`feedback/text/${key}`,
			`feedback/open/${key}`,
		])
			forgetDraft(surface);
	}
});

it.each([
	{ text: "Legacy text only", open: undefined },
	{ text: undefined, open: true },
])("isolates partial legacy snapshots from shared feedback: %j", ({
	text,
	open,
}) => {
	browserState();
	const local = storage();
	vi.stubGlobal("localStorage", local);
	const key = "factory-review/partial-legacy/feedback/gate";
	const textKey = `feedback/text/${key}`,
		openKey = `feedback/open/${key}`,
		draftKey = `feedback/draft/${key}`;
	local.setItem(key, JSON.stringify({ feedback: "Other tab", open: true }));
	if (text !== undefined) rememberDraft(textKey, text, "legacy-gate");
	if (open !== undefined) rememberDraft(openKey, open, "legacy-gate");
	try {
		const draft = normalizeFeedback({
			...emptyFeedback(),
			feedback: text ?? "",
			open: open ?? false,
		});
		expect(loadFeedback(key)).toEqual(draft);
		expect(loadFeedback(key)).toEqual(draft);
		expect(draftRevision(draftKey)).toBe("legacy-gate");
	} finally {
		for (const surface of [textKey, openKey, draftKey]) forgetDraft(surface);
	}
});
