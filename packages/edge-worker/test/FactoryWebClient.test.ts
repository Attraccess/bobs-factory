import {
	MutationObserver,
	QueryClient,
	QueryObserver,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { api, useAction } from "../src/factory/web/client.js";

vi.mock("@tanstack/react-query", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-query")>()),
	useMutation: vi.fn(),
	useQueryClient: vi.fn(),
}));

afterEach(() => {
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
			if (options.method === "PUT") {
				const saved = JSON.parse(options.body as string);
				writes.push(saved.workflows);
				return Response.json(saved);
			}
			if (!staleRead)
				return new Promise<Response>((resolve) => {
					staleRead = resolve;
				});
			return Response.json(
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
		staleRead!(Response.json(initial));
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
		vi.fn(async () =>
			Response.json({ error: "Invalid workflow call" }, { status: 409 }),
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

it("retains title settings through a stale refresh and unrelated recipe saves", async () => {
	const cache = new QueryClient();
	const original = {
		workflows: [{ id: "simple" }],
		titleGeneration: { runner: "claude" },
	};
	cache.setQueryData(["config"], original);
	let resolveStale!: (response: Response) => void;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_path: string, options: RequestInit = {}) =>
			options.method === "PUT"
				? Response.json(
						_path === "/api/title-settings"
							? { titleGeneration: JSON.parse(options.body as string) }
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
	resolveStale(Response.json(original));
	await oldRead.catch(() => {});
	await mutation.mutate({
		path: "/api/workflows",
		method: "PUT",
		body: { workflows: [{ id: "simple", name: "Updated" }] },
	});
	expect(cache.getQueryData(["config"])).toEqual({
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
