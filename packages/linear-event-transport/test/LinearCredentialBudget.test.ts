import { LinearClient } from "@linear/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { LinearIssueTrackerService } from "../src/LinearIssueTrackerService.js";

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it("shares the rotated credential's cooldown with another SDK client", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
	const client = new LinearClient({ accessToken: "rotation-before" });
	client.client.request = vi.fn(async () => {
		throw {
			response: { status: 429, headers: new Headers({ "retry-after": "120" }) },
		};
	}) as any;
	const options = { workspaceId: "rotation-workspace", requestIntervalMs: 0 };
	const tracker = new LinearIssueTrackerService(
		client,
		undefined,
		undefined,
		options,
	);
	tracker.setAccessToken("rotation-after");
	await expect(tracker.getClient().issue("throttled")).rejects.toBeDefined();

	const requests: number[] = [];
	const other = new LinearClient({ accessToken: "rotation-after" });
	other.client.request = vi.fn(async () => {
		requests.push(Date.now());
		return { issue: { id: "issue", reactions: [] } };
	}) as any;
	const shared = new LinearIssueTrackerService(
		other,
		undefined,
		undefined,
		options,
	);
	const work = shared.getClient().issue("after-rotation");
	await vi.advanceTimersByTimeAsync(0);
	expect(requests).toEqual([]);
	await vi.advanceTimersByTimeAsync(119_999);
	expect(requests).toEqual([]);
	await vi.advanceTimersByTimeAsync(1);
	await work;
	expect(requests).toEqual([120_000]);
});

it("shares an OAuth-refreshed credential's cooldown with another SDK client", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						access_token: "oauth-budget-after",
						refresh_token: "oauth-budget-refresh-after",
					}),
				),
		),
	);
	const client = new LinearClient({ accessToken: "oauth-budget-before" });
	const authorization: string[] = [];
	client.client.request = vi.fn(async () => {
		const token = new Headers(client.options.headers).get("Authorization")!;
		authorization.push(token);
		throw {
			response: {
				status: token === "Bearer oauth-budget-before" ? 401 : 429,
				headers: new Headers({ "retry-after": "120" }),
			},
		};
	}) as any;
	const options = {
		workspaceId: "oauth-budget-workspace",
		requestIntervalMs: 0,
	};
	const tracker = new LinearIssueTrackerService(
		client,
		{
			clientId: "fixture-client",
			clientSecret: "fixture-secret",
			refreshToken: "fixture-refresh",
			workspaceId: options.workspaceId,
		},
		undefined,
		options,
	);
	await expect(tracker.getClient().issue("expired")).rejects.toBeDefined();
	expect(authorization).toEqual([
		"Bearer oauth-budget-before",
		"Bearer oauth-budget-after",
	]);

	const requests: number[] = [];
	const other = new LinearClient({ accessToken: "oauth-budget-after" });
	other.client.request = vi.fn(async () => {
		requests.push(Date.now());
		return { issue: { id: "issue", reactions: [] } };
	}) as any;
	const shared = new LinearIssueTrackerService(
		other,
		undefined,
		undefined,
		options,
	);
	const work = shared.getClient().issue("after-refresh");
	await vi.advanceTimersByTimeAsync(0);
	expect(requests).toEqual([]);
	await vi.advanceTimersByTimeAsync(120_000);
	await work;
	expect(requests).toEqual([120_000]);
});

it("keeps queued requests on their captured credential when either service rotates a shared SDK", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
	const client = new LinearClient({ accessToken: "queued-before" });
	const requests: { at: number; authorization: string | null }[] = [];
	client.client.request = vi.fn(async (_document, _variables, headers) => {
		requests.push({
			at: Date.now(),
			authorization:
				new Headers(headers).get("Authorization") ??
				new Headers(client.options.headers).get("Authorization"),
		});
		return { issue: { id: "issue", reactions: [] } };
	}) as any;
	const options = { workspaceId: "queued-workspace", requestIntervalMs: 2000 };
	const before = new LinearIssueTrackerService(
		client,
		undefined,
		undefined,
		options,
	);
	const after = new LinearIssueTrackerService(
		client,
		undefined,
		undefined,
		options,
	);
	const first = before.getClient().issue("first");
	const queued = after.getClient().issue("queued");
	await vi.advanceTimersByTimeAsync(0);
	after.setAccessToken("queued-after");
	const rotated = before.getClient().issue("rotated");
	await vi.advanceTimersByTimeAsync(2000);
	await Promise.all([first, queued, rotated]);
	expect(requests).toEqual([
		{ at: 0, authorization: "Bearer queued-before" },
		{ at: 0, authorization: "Bearer queued-after" },
		{ at: 2000, authorization: "Bearer queued-before" },
	]);
});
