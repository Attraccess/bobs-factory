import { LinearClient } from "@linear/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { LinearIssueTrackerService } from "../src/LinearIssueTrackerService.js";

afterEach(() => vi.useRealTimers());

it("keeps compact delivered receipts that still deduplicate and reject changed content after restart", async () => {
	const { mkdtempSync, rmSync, readFileSync, readdirSync } = await import(
		"node:fs"
	);
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const home = mkdtempSync(join(tmpdir(), "linear-compact-receipt-"));
	const input = {
		id: "fa46e14c-29a9-46e9-9a02-26276d10d34f",
		agentSessionId: "session",
		content: {
			type: "response",
			body: "Distinct full delivery payload".repeat(1000),
		},
	};
	let mutations = 0;
	function tracker() {
		const client = new LinearClient({ accessToken: "compact-receipt-test" });
		client.client.request = vi.fn(async (_doc, variables: any) => {
			mutations++;
			return {
				agentActivityCreate: {
					success: true,
					agentActivity: { id: variables.input.id },
					lastSyncId: 1,
				},
			};
		}) as any;
		return new LinearIssueTrackerService(client, undefined, undefined, {
			workspaceId: "compact-workspace",
			factoryHome: home,
			requestIntervalMs: 0,
		});
	}
	try {
		const first = tracker();
		await first.createAgentActivity(input);
		first.stopDelivery();
		const directory = join(home, "state", "linear-activity-delivery");
		const saved = readFileSync(
			join(directory, readdirSync(directory)[0]),
			"utf8",
		);
		expect(saved.length).toBeLessThan(2000);
		const restarted = tracker();
		await restarted.createAgentActivity(input);
		await expect(
			restarted.createAgentActivity({
				...input,
				content: { type: "response", body: "Changed delivery" },
			}),
		).rejects.toThrow("identity");
		expect(mutations).toBe(1);
		expect(restarted.getActivityDeliveryStatus()).toMatchObject({
			delivered: 1,
			pending: 0,
		});
		restarted.stopDelivery();
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

it("budgets simultaneous tracker and direct SDK requests together across one credential/workspace", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
	const requests: number[] = [];
	function tracker() {
		const client = new LinearClient({ accessToken: "shared-budget-test" });
		client.client.request = vi.fn(async () => {
			requests.push(Date.now());
			return { issue: { id: "issue", reactions: [] } };
		}) as any;
		return new LinearIssueTrackerService(client, undefined, undefined, {
			workspaceId: "budget-workspace",
			requestIntervalMs: 2000,
		});
	}
	const one = tracker();
	const two = tracker();
	const work = Promise.all([
		one.fetchIssue("one"),
		two.getClient().issue("two"),
		one.fetchIssue("three"),
	]);
	await vi.advanceTimersByTimeAsync(0);
	expect(requests).toEqual([0]);
	await vi.advanceTimersByTimeAsync(4000);
	await work;
	expect(requests).toEqual([0, 2000, 4000]);
});

it("reuses one SDK client budget when a tracker wrapper is rebuilt", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
	const client = new LinearClient({ accessToken: "same-client-rebuild" });
	const requests: number[] = [];
	client.client.request = vi.fn(async () => {
		requests.push(Date.now());
		return { issue: { id: "issue", reactions: [] } };
	}) as any;
	const options = {
		workspaceId: "same-client-workspace",
		requestIntervalMs: 2000,
	};
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
	const work = Promise.all([before.fetchIssue("one"), after.fetchIssue("two")]);
	await vi.advanceTimersByTimeAsync(4000);
	expect(requests).toEqual([0, 2000]);
	await work;
});

it("prioritizes a newly queued question ahead of a routine backlog while delivery is already draining", async () => {
	const { mkdtempSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const home = mkdtempSync(join(tmpdir(), "linear-priority-arrival-"));
	const sent: any[] = [];
	let release!: () => void;
	const firstResponse = new Promise<void>((resolve) => {
		release = resolve;
	});
	const client = new LinearClient({ accessToken: "priority-arrival-test" });
	client.client.request = vi.fn(async (_doc, variables: any) => {
		sent.push(variables.input.content);
		if (sent.length === 1) await firstResponse;
		return {
			agentActivityCreate: {
				success: true,
				agentActivity: { id: variables.input.id },
				lastSyncId: 1,
			},
		};
	}) as any;
	const tracker = new LinearIssueTrackerService(client, undefined, undefined, {
		workspaceId: "priority-arrival",
		factoryHome: home,
		requestIntervalMs: 0,
	});
	try {
		const initial = tracker.createAgentActivity({
			agentSessionId: "session",
			content: { type: "thought", body: "Initial progress" },
		});
		const routine = Array.from({ length: 8 }, (_, index) =>
			tracker.createAgentActivity({
				agentSessionId: "session",
				content: { type: "thought", body: `Progress ${index}` },
			}),
		);
		const question = tracker.createAgentActivity({
			agentSessionId: "session",
			content: { type: "elicitation", body: "Which target?" },
		});
		const outcomes = Promise.allSettled([initial, ...routine, question]);
		release();
		await outcomes;
		expect(sent.slice(0, 2)).toEqual([
			{ type: "thought", body: "Initial progress" },
			{ type: "elicitation", body: "Which target?" },
		]);
		expect(tracker.getActivityDeliveryStatus()).toMatchObject({
			delivered: 10,
			pending: 0,
		});
	} finally {
		tracker.stopDelivery();
		rmSync(home, { recursive: true, force: true });
	}
});

it("retains a final event after throttling and delivers it once after restart", async () => {
	const { mkdtempSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const home = mkdtempSync(join(tmpdir(), "linear-outbox-test-"));
	const sent: any[] = [];
	function tracker(throttled: boolean) {
		const client = new LinearClient({ accessToken: "outbox-restart-test" });
		client.client.request = vi.fn(async (_doc, variables: any) => {
			if (throttled)
				throw {
					response: {
						status: 400,
						errors: [{ extensions: { code: "RATELIMITED" } }],
						headers: new Headers({ "retry-after": "1" }),
					},
				};
			sent.push(variables.input);
			return {
				agentActivityCreate: {
					success: true,
					agentActivity: { id: variables.input.id },
					lastSyncId: 1,
				},
			};
		}) as any;
		return new LinearIssueTrackerService(client, undefined, undefined, {
			workspaceId: "restart-workspace",
			factoryHome: home,
			requestIntervalMs: 0,
		});
	}
	try {
		const first = tracker(true);
		await expect(
			first.createAgentActivity({
				agentSessionId: "session",
				content: { type: "response", body: "Delivered PR with validation" },
			}),
		).rejects.toThrow();
		expect(first.getActivityDeliveryStatus().pending).toBe(1);
		first.stopDelivery();
		const second = tracker(false);
		vi.useFakeTimers();
		await vi.advanceTimersByTimeAsync(30_000);
		await second.flushActivityDelivery();
		expect(second.getActivityDeliveryStatus()).toMatchObject({
			pending: 0,
			delivered: 1,
		});
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			agentSessionId: "session",
			content: { type: "response", body: "Delivered PR with validation" },
			id: expect.stringMatching(/^[a-f0-9-]{36}$/),
		});
		await second.flushActivityDelivery();
		expect(sent).toHaveLength(1);
		second.stopDelivery();
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

it("reconciles an acknowledged-by-provider but lost mutation response before redelivery", async () => {
	const { mkdtempSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const home = mkdtempSync(join(tmpdir(), "linear-ambiguous-test-"));
	let remote: any;
	let mutations = 0;
	const client = new LinearClient({ accessToken: "ambiguous-test" });
	client.client.request = vi.fn(async (_doc, variables: any) => {
		if (variables.input) {
			mutations++;
			remote = {
				id: variables.input.id,
				content: variables.input.content,
				agentSession: { id: variables.input.agentSessionId },
			};
			throw new Error("connection closed after server accepted mutation");
		}
		return { agentActivity: remote };
	}) as any;
	try {
		const tracker = new LinearIssueTrackerService(
			client,
			undefined,
			undefined,
			{
				workspaceId: "ambiguous-workspace",
				factoryHome: home,
				requestIntervalMs: 0,
			},
		);
		await expect(
			tracker.createAgentActivity({
				agentSessionId: "session",
				content: { type: "elicitation", body: "Which deployment target?" },
			}),
		).rejects.toThrow();
		vi.useFakeTimers();
		await vi.advanceTimersByTimeAsync(30_000);
		await tracker.flushActivityDelivery();
		expect(tracker.getActivityDeliveryStatus()).toMatchObject({
			pending: 0,
			delivered: 1,
		});
		expect(mutations).toBe(1);
		tracker.stopDelivery();
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

it("shares pending delivery across concurrent service instances without overwriting either final", async () => {
	const { mkdtempSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const home = mkdtempSync(join(tmpdir(), "linear-concurrent-test-"));
	function tracker() {
		const client = new LinearClient({ accessToken: "concurrent-outbox-test" });
		client.client.request = vi.fn(async () => {
			throw {
				response: {
					status: 400,
					errors: [{ extensions: { code: "RATELIMITED" } }],
				},
			};
		}) as any;
		return new LinearIssueTrackerService(client, undefined, undefined, {
			workspaceId: "concurrent-workspace",
			factoryHome: home,
			requestIntervalMs: 0,
		});
	}
	try {
		vi.useFakeTimers();
		const one = tracker();
		const two = tracker();
		await expect(
			one.createAgentActivity({
				agentSessionId: "one",
				content: { type: "response", body: "First delivered PR" },
			}),
		).rejects.toThrow();
		// The shared cooldown means this second event is queued without another request.
		const second = expect(
			two.createAgentActivity({
				agentSessionId: "two",
				content: { type: "response", body: "Second delivered PR" },
			}),
		).rejects.toThrow();
		await vi.advanceTimersByTimeAsync(30_000);
		await second;
		expect(one.getActivityDeliveryStatus().pending).toBe(2);
		expect(two.getActivityDeliveryStatus().pending).toBe(2);
		one.stopDelivery();
		two.stopDelivery();
		const restarted = tracker();
		expect(restarted.getActivityDeliveryStatus().pending).toBe(2);
		restarted.stopDelivery();
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

it("binds a durable activity identity to its session and content", async () => {
	const { mkdtempSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const home = mkdtempSync(join(tmpdir(), "linear-identity-test-"));
	const client = new LinearClient({ accessToken: "identity-test" });
	const request = vi.fn(async (_doc, variables: any) => ({
		agentActivityCreate: {
			success: true,
			agentActivity: { id: variables.input.id },
			lastSyncId: 1,
		},
	}));
	client.client.request = request as any;
	try {
		const tracker = new LinearIssueTrackerService(
			client,
			undefined,
			undefined,
			{
				workspaceId: "identity-workspace",
				factoryHome: home,
				requestIntervalMs: 0,
			},
		);
		const input = {
			id: "13f45f5b-27d2-4f31-87a9-ceeff4b36b36",
			agentSessionId: "session",
			content: { type: "response", body: "Delivered PR" },
		};
		await tracker.createAgentActivity(input);
		await tracker.createAgentActivity(input);
		await expect(
			tracker.createAgentActivity({
				...input,
				content: { type: "response", body: "Different result" },
			}),
		).rejects.toThrow("identity");
		expect(request).toHaveBeenCalledTimes(1);
		tracker.stopDelivery();
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

it("coalesces unchanged routine polling while retaining a question and final during throttling", async () => {
	const { mkdtempSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const home = mkdtempSync(join(tmpdir(), "linear-coalesce-test-"));
	const client = new LinearClient({ accessToken: "coalesce-test" });
	const request = vi.fn(async () => {
		throw {
			response: {
				status: 400,
				errors: [{ extensions: { code: "RATELIMITED" } }],
			},
		};
	});
	client.client.request = request as any;
	try {
		const tracker = new LinearIssueTrackerService(
			client,
			undefined,
			undefined,
			{
				workspaceId: "coalesce-workspace",
				factoryHome: home,
				requestIntervalMs: 0,
			},
		);
		const poll = {
			agentSessionId: "session",
			content: { type: "thought", body: "CI is waiting for a runner" },
		};
		await expect(tracker.createAgentActivity(poll)).rejects.toThrow();
		for (let index = 0; index < 20; index++)
			await expect(tracker.createAgentActivity(poll)).rejects.toThrow();
		await expect(
			tracker.createAgentActivity({
				agentSessionId: "session",
				content: { type: "elicitation", body: "Which target?" },
			}),
		).rejects.toThrow();
		await expect(
			tracker.createAgentActivity({
				agentSessionId: "session",
				content: { type: "response", body: "Delivered PR" },
			}),
		).rejects.toThrow();
		expect(tracker.getActivityDeliveryStatus().pending).toBe(3);
		expect(request).toHaveBeenCalledTimes(1);
		tracker.stopDelivery();
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

it("reuses an in-flight delivery owner during service replacement", async () => {
	const { mkdtempSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const home = mkdtempSync(join(tmpdir(), "linear-replacement-test-"));
	let finish!: (result: any) => void;
	let mutations = 0;
	const response = new Promise((resolve) => {
		finish = resolve;
	});
	function tracker() {
		const client = new LinearClient({ accessToken: "replacement-test" });
		client.client.request = vi.fn(async (_doc, variables: any) => {
			if (variables.input) {
				mutations++;
				return response;
			}
			return { agentActivity: null };
		}) as any;
		return new LinearIssueTrackerService(client, undefined, undefined, {
			workspaceId: "replacement-workspace",
			factoryHome: home,
			requestIntervalMs: 0,
		});
	}
	try {
		const input = {
			id: "8c46263e-4fce-412c-ae38-9bfa4c10f3cb",
			agentSessionId: "session",
			content: { type: "response", body: "Delivered PR" },
		};
		const one = tracker();
		const first = one.createAgentActivity(input);
		await Promise.resolve();
		one.stopDelivery();
		const two = tracker();
		const second = expect(
			two.createAgentActivity(input),
		).resolves.toMatchObject({ success: true, agentActivityId: input.id });
		finish({
			agentActivityCreate: {
				success: true,
				agentActivity: { id: input.id },
				lastSyncId: 1,
			},
		});
		await first;
		await second;
		expect(mutations).toBe(1);
		expect(two.getActivityDeliveryStatus()).toMatchObject({
			pending: 0,
			delivered: 1,
		});
		two.stopDelivery();
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

it("honors provider throttling across concurrent sessions and sends their final before routine progress", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
	const requests: { at: number; type?: string }[] = [];
	const client = new LinearClient({ accessToken: "priority-throttle-test" });
	client.client.request = vi.fn(async (_doc, variables: any) => {
		requests.push({ at: Date.now(), type: variables.input?.content.type });
		if (requests.length === 1)
			throw {
				response: {
					status: 400,
					errors: [{ extensions: { code: "RATELIMITED" } }],
					headers: new Headers({ "retry-after": "120" }),
				},
			};
		return {
			agentActivityCreate: {
				success: true,
				agentActivity: { id: variables.input.id ?? "activity" },
				lastSyncId: 1,
			},
		};
	}) as any;
	const tracker = new LinearIssueTrackerService(client, undefined, undefined, {
		workspaceId: "priority-throttle",
		requestIntervalMs: 2000,
	});
	await expect(
		tracker.createAgentActivity({
			agentSessionId: "one",
			content: { type: "thought", body: "Working" },
		}),
	).rejects.toThrow();
	const progress = tracker.createAgentActivity({
		agentSessionId: "one",
		content: { type: "thought", body: "Still working" },
	});
	const final = tracker.createAgentActivity({
		agentSessionId: "two",
		content: { type: "response", body: "Delivered PR" },
	});
	await vi.advanceTimersByTimeAsync(119_999);
	expect(requests).toEqual([{ at: 0, type: "thought" }]);
	await vi.advanceTimersByTimeAsync(2001);
	await Promise.all([progress, final]);
	expect(requests).toEqual([
		{ at: 0, type: "thought" },
		{ at: 120_000, type: "response" },
		{ at: 122_000, type: "thought" },
	]);
});

it("keeps independent credentials out of each other's throttle window", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
	const one = new LinearClient({ accessToken: "independent-one" });
	one.client.request = vi.fn(async () => {
		throw {
			response: { status: 429, headers: new Headers({ "retry-after": "120" }) },
		};
	}) as any;
	const two = new LinearClient({ accessToken: "independent-two" });
	const independent = vi.fn(async () => ({
		issue: { id: "issue", reactions: [] },
	}));
	two.client.request = independent as any;
	const a = new LinearIssueTrackerService(one, undefined, undefined, {
		workspaceId: "independent",
	});
	const b = new LinearIssueTrackerService(two, undefined, undefined, {
		workspaceId: "independent",
	});
	await expect(a.fetchIssue("one")).rejects.toThrow();
	expect((await b.fetchIssue("two")).id).toBe("issue");
	expect(independent).toHaveBeenCalledTimes(1);
});

it("retains direct documentation comments and reconciles a lost provider response without reposting", async () => {
	const { mkdtempSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const home = mkdtempSync(join(tmpdir(), "linear-comment-test-"));
	let comment: any;
	let mutations = 0;
	const client = new LinearClient({ accessToken: "comment-outbox-test" });
	client.client.request = vi.fn(async (_doc, variables: any) => {
		if (variables.input) {
			mutations++;
			comment = { ...variables.input, issue: { id: "issue" }, reactions: [] };
			throw new Error("lost comment response");
		}
		return { comment };
	}) as any;
	try {
		const tracker = new LinearIssueTrackerService(
			client,
			undefined,
			undefined,
			{
				workspaceId: "comment-workspace",
				factoryHome: home,
				requestIntervalMs: 0,
			},
		);
		await expect(
			tracker.createComment("issue", {
				body: "Decision: keep one server-wide language default.",
			}),
		).rejects.toThrow();
		expect(tracker.getActivityDeliveryStatus().pending).toBe(1);
		vi.useFakeTimers();
		await vi.advanceTimersByTimeAsync(30_000);
		await tracker.flushActivityDelivery();
		expect(
			(
				await tracker.createComment("issue", {
					body: "Decision: keep one server-wide language default.",
				})
			).body,
		).toBe("Decision: keep one server-wide language default.");
		expect(tracker.getActivityDeliveryStatus()).toMatchObject({
			pending: 0,
			delivered: 1,
		});
		expect(mutations).toBe(1);
		tracker.stopDelivery();
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
