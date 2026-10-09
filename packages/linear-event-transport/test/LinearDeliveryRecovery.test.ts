import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LinearClient } from "@linear/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { LinearIssueTrackerService } from "../src/LinearIssueTrackerService.js";

afterEach(() => vi.useRealTimers());

it.each([
	"wrapped",
	"direct",
])("redelivers the same activity after a %s Linear INPUT_ERROR confirms it was never created", async (shape) => {
	vi.useFakeTimers();
	const home = mkdtempSync(join(tmpdir(), "linear-missing-recovery-"));
	const mutations: string[] = [];
	const client = new LinearClient({ accessToken: `missing-${shape}` });
	client.client.request = vi.fn(async (_doc, variables: any) => {
		if (!variables.input) {
			const response = {
				status: 400,
				errors: [
					{
						message: "Entity not found: AgentActivity",
						extensions: {
							code: "INPUT_ERROR",
							userPresentableMessage:
								"Could not find referenced AgentActivity.",
						},
					},
				],
			};
			throw shape === "wrapped" ? { raw: { response } } : { response };
		}
		mutations.push(variables.input.id);
		if (mutations.length === 1)
			throw new Error("Connection closed before mutation acceptance");
		return {
			agentActivityCreate: {
				success: true,
				agentActivity: { id: variables.input.id },
				lastSyncId: 1,
			},
		};
	}) as any;
	const tracker = new LinearIssueTrackerService(client, undefined, undefined, {
		workspaceId: `missing-${shape}`,
		factoryHome: home,
		requestIntervalMs: 0,
	});
	try {
		await expect(
			tracker.createAgentActivity({
				agentSessionId: "session",
				content: { type: "response", body: "Implementation completed" },
			}),
		).rejects.toThrow();
		await vi.advanceTimersByTimeAsync(30_000);
		await tracker.flushActivityDelivery();
		expect(tracker.getActivityDeliveryStatus()).toMatchObject({
			pending: 0,
			delivered: 1,
		});
		expect(mutations).toHaveLength(2);
		expect(mutations[1]).toBe(mutations[0]);
	} finally {
		tracker.stopDelivery();
		rmSync(home, { recursive: true, force: true });
	}
});

it.each([
	{ type: "response", operational: false },
	{ type: "thought", operational: true },
])("returns a delivered $type milestone while unrelated transcript backlog is still draining", async ({
	type,
	operational,
}) => {
	const home = mkdtempSync(join(tmpdir(), "linear-own-receipt-"));
	let releaseFirst!: () => void;
	let releaseTail!: () => void;
	let tailStarted!: () => void;
	const first = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	const tail = new Promise<void>((resolve) => {
		releaseTail = resolve;
	});
	const started = new Promise<void>((resolve) => {
		tailStarted = resolve;
	});
	const client = new LinearClient({ accessToken: "own-receipt" });
	client.client.request = vi.fn(async (_doc, variables: any) => {
		if (variables.input.content.body === "First") await first;
		if (variables.input.content.body === "Routine tail") {
			tailStarted();
			await tail;
		}
		return {
			agentActivityCreate: {
				success: true,
				agentActivity: { id: variables.input.id },
				lastSyncId: 1,
			},
		};
	}) as any;
	const tracker = new LinearIssueTrackerService(client, undefined, undefined, {
		workspaceId: "own-receipt",
		factoryHome: home,
		requestIntervalMs: 0,
	});
	const work = [
		tracker.createAgentActivity({
			agentSessionId: "session",
			content: { type: "thought", body: "First" },
		}),
	];
	work.push(
		tracker.createAgentActivity({
			agentSessionId: "other-session",
			content: { type: "thought", body: "Routine tail" },
		}),
	);
	let delivered = false;
	work.push(
		tracker
			.createAgentActivity(
				{
					agentSessionId: "session",
					content: { type, body: "Final response" },
				},
				{ operational },
			)
			.then((receipt) => {
				delivered = true;
				return receipt;
			}),
	);
	try {
		releaseFirst();
		await started;
		await vi.waitFor(() => expect(delivered).toBe(true), { timeout: 500 });
		expect(tracker.getActivityDeliveryStatus()).toMatchObject({
			delivered: 2,
			pending: 1,
		});
	} finally {
		releaseFirst();
		releaseTail();
		await Promise.allSettled(work);
		tracker.stopDelivery();
		rmSync(home, { recursive: true, force: true });
	}
});
