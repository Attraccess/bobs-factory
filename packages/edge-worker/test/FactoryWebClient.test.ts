import {
	MutationObserver,
	QueryClient,
	QueryObserver,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { artifactType, RenderArtifact } from "../src/factory/web/artifacts.js";
import {
	accessRequired,
	accessState,
	checkAccess,
} from "../src/factory/web/auth-state.js";
import {
	api,
	artifactsOf,
	client,
	useAction,
	validateLiveConnection,
} from "../src/factory/web/client.js";
import {
	authoritativeReady,
	checkVersion,
	disconnected,
	pwaState,
	uiBuild,
} from "../src/factory/web/pwa.js";
import { qaExecution } from "./fixtures/qa.js";

vi.mock("@tanstack/react-query", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-query")>()),
	useMutation: vi.fn(),
	useQueryClient: vi.fn(),
}));

vi.mock("../src/factory/web/pwa.js", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../src/factory/web/pwa.js")>();
	return { ...original, usePwa: () => original.pwaState() };
});
const factoryResponse = (body: unknown, init: ResponseInit = {}) =>
	Response.json(body, {
		...init,
		headers: { ...init.headers, "X-Factory-Build": uiBuild },
	});
const version = () => factoryResponse({ build: uiBuild, protocol: 1 });
beforeEach(async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => version()),
	);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			factoryResponse({ authenticated: true, expires: Date.now() + 60000 }),
		),
	);
	await checkAccess();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => version()),
	);
	await checkVersion();
	authoritativeReady();
});

afterEach(() => {
	client.clear();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

function action(cache: QueryClient) {
	vi.mocked(useQueryClient).mockReturnValue(cache);
	// biome-ignore lint/correctness/useHookAtTopLevel: React hooks are mocked; the mutation runs through a real query observer.
	useAction();
	return new MutationObserver(
		cache,
		vi.mocked(useMutation).mock.calls.at(-1)![0],
	);
}

it("preserves consecutive permission revocations after failed refreshes and a late stale read", async () => {
	const cache = new QueryClient();
	const initial = {
		repositories: [{ id: "repo", name: "Repo" }],
		defaultRunner: "claude",
		defaultWorkflow: "simple",
		workflows: [
			{
				id: "simple",
				allowedTriggers: ["manual", "ticket-assignment"],
				launchFields: [{ name: "prompt", required: true }],
			},
		],
	};
	cache.setQueryData(["config"], initial);
	const writes: (typeof initial.workflows)[] = [];
	let staleRead: ((response: Response) => void) | undefined;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_path: string, options: RequestInit = {}) => {
			if (_path === "/api/version") return version();
			if (options.method === "PUT") {
				const saved = JSON.parse(options.body as string);
				writes.push(saved.workflows);
				return factoryResponse(saved);
			}
			if (!staleRead)
				return new Promise<Response>((resolve) => {
					staleRead = resolve;
				});
			return factoryResponse(
				{ error: "Config refresh unavailable" },
				{ status: 503 },
			);
		}),
	);
	const query = new QueryObserver(cache, {
		queryKey: ["config"],
		queryFn: ({ signal }) => api("/api/config", { signal }),
		staleTime: Infinity,
		retry: false,
	});
	const unsubscribe = query.subscribe(() => {});
	const oldRead = query.refetch();
	const mutation = action(cache);
	const revoke = (trigger: string) => {
		const current = cache.getQueryData<typeof initial>(["config"])!;
		return mutation.mutate({
			path: "/api/workflows",
			method: "PUT",
			body: {
				defaultWorkflow: current.defaultWorkflow,
				workflows: current.workflows.map((workflow) => ({
					...workflow,
					allowedTriggers: workflow.allowedTriggers.filter(
						(value) => value !== trigger,
					),
				})),
			},
		});
	};
	try {
		await revoke("manual");
		expect(mutation.getCurrentResult().status).toBe("success");
		expect(query.getCurrentResult().error?.message).toBe(
			"Config refresh unavailable",
		);
		staleRead!(factoryResponse(initial));
		await checkVersion();
		authoritativeReady();
		await oldRead;
		await revoke("ticket-assignment");
		expect(writes.map(([workflow]) => workflow.allowedTriggers)).toEqual([
			["ticket-assignment"],
			[],
		]);
		expect(cache.getQueryData(["config"])).toEqual({
			...initial,
			workflows: [{ ...initial.workflows[0], allowedTriggers: [] }],
		});
	} finally {
		unsubscribe();
		cache.clear();
	}
});

it("retains saved config when a workflow write is rejected", async () => {
	const cache = new QueryClient();
	const saved = {
		defaultWorkflow: "simple",
		workflows: [{ id: "simple", allowedTriggers: [] }],
	};
	cache.setQueryData(["config"], saved);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path) =>
			path === "/api/version"
				? version()
				: factoryResponse({ error: "Invalid workflow call" }, { status: 409 }),
		),
	);
	try {
		await expect(
			action(cache).mutate({ path: "/api/workflows", method: "PUT", body: {} }),
		).rejects.toThrow("Invalid workflow call");
		expect(cache.getQueryData(["config"])).toEqual(saved);
	} finally {
		cache.clear();
	}
});

it("blocks offline and stale writes without sending a mutation", async () => {
	const fetch = vi.fn(async () =>
		factoryResponse({ build: "different", protocol: 1 }),
	);
	vi.stubGlobal("fetch", fetch);
	disconnected();
	await expect(
		api("/api/runs", { method: "POST", body: "{}" }),
	).rejects.toThrow("paused");
	expect(fetch).not.toHaveBeenCalled();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => version()),
	);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			factoryResponse({ authenticated: true, expires: Date.now() + 60000 }),
		),
	);
	await checkAccess();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => version()),
	);
	await checkVersion();
	authoritativeReady();
	vi.stubGlobal("fetch", fetch);
	await expect(
		api("/api/runs", { method: "POST", body: "{}" }),
	).rejects.toThrow("version");
	expect(fetch.mock.calls).toEqual([["/api/version", expect.any(Object)]]);
	expect(pwaState().status).toBe("mismatch");
});
it("checks response versions before consuming potentially incompatible data", async () => {
	const response = factoryResponse(
		{ sensitive: "incompatible" },
		{ headers: {} },
	);
	response.headers.set("X-Factory-Build", "different");
	const json = vi.spyOn(response, "json");
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => response),
	);
	await expect(api("/api/config")).rejects.toThrow("version changed");
	expect(json).not.toHaveBeenCalled();
	expect(pwaState().status).toBe("mismatch");
});

it("releases a rejected SSE response before retrying or waiting for an update", async () => {
	const cancel = vi.fn();
	const response = new Response(new ReadableStream({ cancel }), {
		headers: { "Content-Type": "text/event-stream" },
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => factoryResponse({ build: "different", protocol: 1 })),
	);
	await expect(validateLiveConnection(response)).rejects.toThrow("version");
	expect(cancel).toHaveBeenCalledOnce();
});

it("sends the original title-settings revision despite a refresh during the version check", async () => {
	client.setQueryData(["config"], { configRevision: "old-tab" });
	let sentRevision: string | null = null;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path: string, options: RequestInit = {}) => {
			if (path === "/api/version") {
				client.setQueryData(["config"], { configRevision: "new-tab" });
				return version();
			}
			sentRevision = new Headers(options.headers).get("X-Factory-Config");
			return factoryResponse(
				{
					error:
						"Recipe settings changed. Refresh and review your draft before sending.",
				},
				{ status: 409 },
			);
		}),
	);
	await expect(
		api("/api/title-settings", { method: "PUT", body: '{"model":"unsaved"}' }),
	).rejects.toThrow("settings changed");
	expect(sentRevision).toBe("old-tab");
});

it("retains title settings through a stale refresh and unrelated recipe saves", async () => {
	const cache = new QueryClient();
	const original = {
		configRevision: "original",
		workflows: [{ id: "simple" }],
		titleGeneration: { runner: "claude" },
	};
	cache.setQueryData(["config"], original);
	let resolveStale!: (response: Response) => void;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_path: string, options: RequestInit = {}) =>
			_path === "/api/version"
				? version()
				: options.method === "PUT"
					? factoryResponse(
							_path === "/api/title-settings"
								? {
										titleGeneration: JSON.parse(options.body as string),
										configRevision: "saved",
									}
								: JSON.parse(options.body as string),
						)
					: new Promise<Response>((resolve) => {
							resolveStale = resolve;
						}),
		),
	);
	const oldRead = cache.fetchQuery({
		queryKey: ["config"],
		queryFn: () => api("/api/config"),
	});
	const mutation = action(cache);
	await mutation.mutate({
		path: "/api/title-settings",
		method: "PUT",
		body: { runner: "codex", model: "cheap" },
	});
	resolveStale(factoryResponse(original));
	await oldRead.catch(() => {});
	await mutation.mutate({
		path: "/api/workflows",
		method: "PUT",
		body: { workflows: [{ id: "simple", name: "Updated" }] },
	});
	expect(cache.getQueryData(["config"])).toEqual({
		configRevision: "saved",
		workflows: [{ id: "simple", name: "Updated" }],
		titleGeneration: { runner: "codex", model: "cheap" },
	});
	cache.clear();
});

it("settles failures only through explicit follow-up provenance, independently of mutable titles", async () => {
	const { settleReason } = await import("../src/factory/web/client.js");
	const now = Date.now();
	const run = {
		id: "first",
		title: "Same title",
		status: "failed",
		createdAt: new Date(now - 1000).toISOString(),
	};
	const unrelated = {
		id: "second",
		title: "Same title",
		createdAt: new Date(now).toISOString(),
	};
	expect(settleReason(run, [run, unrelated], now)).toBeUndefined();
	const followup = {
		...unrelated,
		title: "A different generated title",
		triggerOrigin: { type: "manual", manual: { sourceRunId: "first" } },
	};
	expect(settleReason(run, [run, followup], now)).toBe(
		"↻ Replaced by a newer run",
	);
});

it("keeps capacity queues active without rendering human attention", async () => {
	const { active, attention } = await import("../src/factory/web/client.js");
	expect(active("capacity-waiting")).toBe(true);
	expect(active("stopping")).toBe(true);
	expect(attention({ status: "capacity-waiting" })).toBeUndefined();
});

it("classifies QA before screenshot artifacts, including previews, and renders zero-image receipts and observations", () => {
	const qa = qaExecution("blocked");
	qa.observations = [
		{
			id: "help",
			summary: "Optional help wording",
			evidence: "Observed ambiguous text",
		},
	];
	expect(artifactType(qa)).toBe("qa");
	expect(
		artifactType({
			__artifactPreview: true,
			keys: ["qaContract", "results", "screenshots"],
			size: 10000,
		}),
	).toBe("qa");
	expect(artifactType({ screenshots: [] })).toBe("screenshots");
	const html = renderToStaticMarkup(
		createElement(RenderArtifact, {
			name: "capture",
			v: qa,
			run: { id: "qa" },
			onImage: () => {},
		}),
	);
	expect(html).toContain("Test account unavailable");
	expect(html).toContain("Optional help wording");
	expect(html).toContain("Record is persisted");
	expect(html).toContain("0/1 criteria passed");
	expect(
		artifactsOf({ outputs: { capture: { screenshots: [] } } })[0].title,
	).toBe("Screenshots");
	expect(artifactsOf({ outputs: { capture: qa } })[0].title).toBe(
		"QA and screenshots",
	);
});

it("handles 401 before version errors, clears sensitive caches and prevents late response repopulation", async () => {
	client.setQueryData(["run", "private"], { transcript: "private content" });
	let complete!: (response: Response) => void;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (path: string) =>
			path === "/api/version"
				? version()
				: new Promise<Response>((resolve) => {
						complete = resolve;
					}),
		),
	);
	const late = api("/api/runs");
	while (!complete) await new Promise((resolve) => setTimeout(resolve, 0));
	accessRequired("Signed out");
	complete(factoryResponse([{ transcript: "late private content" }]));
	await expect(late).rejects.toThrow("Session changed");
	expect(client.getQueryData(["run", "private"])).toBeUndefined();
	expect(accessState().status).toBe("required");
});

it("keeps credential management mounted during verified-session refresh, but clears private state on denial", async () => {
	client.setQueryData(["run", "private"], { transcript: "private content" });
	let respond!: (response: Response) => void;
	vi.stubGlobal(
		"fetch",
		vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					respond = resolve;
				}),
		),
	);
	const refreshed = checkAccess(true);
	expect(accessState().status).toBe("authenticated");
	const expires = Date.now() + 120000;
	respond(factoryResponse({ authenticated: true, expires }));
	await refreshed;
	expect(accessState()).toEqual({ status: "authenticated", expires });
	expect(client.getQueryData(["run", "private"])).toEqual({
		transcript: "private content",
	});

	const revoked = checkAccess(true);
	respond(factoryResponse({ authenticated: false, setupRequired: false }));
	await revoked;
	expect(accessState().status).toBe("required");
	expect(client.getQueryData(["run", "private"])).toBeUndefined();

	const signedOut = checkAccess(true);
	expect(accessState().status).toBe("checking");
	respond(factoryResponse({}, { status: 401 }));
	await signedOut;
	expect(accessState().status).toBe("required");
});
