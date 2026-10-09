import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { f1AgentHandlers } from "../../../apps/f1/src/MockAgentRunner.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";

const provider = vi.hoisted(() => ({
	comments: [] as any[],
	activities: [] as any[],
}));
// The external SDK boundary is controlled; the worker's real FactoryTools hook,
// TicketTracking policy and durable comment outbox execute unchanged.
vi.mock("@linear/sdk", async (original) => {
	const actual = await original<typeof import("@linear/sdk")>();
	return {
		...actual,
		LinearClient: class {
			async issue() {
				return {
					id: "issue",
					identifier: "EX-1",
					title: "Decision documentation",
					url: "https://linear.app/example/issue/EX-1/example",
					description: "Scope",
					state: Promise.resolve({
						id: "started",
						name: "In Progress",
						type: "started",
					}),
					team: Promise.resolve({ id: "team" }),
					labels: async () => ({ nodes: [] }),
					comments: async () => ({ nodes: provider.comments, pageInfo: {} }),
					attachments: async () => ({ nodes: [], pageInfo: {} }),
				};
			}
			async team() {
				return {
					states: async () => ({
						nodes: [{ id: "started", name: "In Progress", type: "started" }],
						pageInfo: {},
					}),
				};
			}
			async createAgentActivity(input: any) {
				provider.activities.push(input);
				return { success: true, agentActivityId: input.id };
			}
			async createComment(input: any) {
				provider.comments.push({ ...input });
				return { success: true, commentId: input.id };
			}
			async comment({ id }: any) {
				return provider.comments.find((comment) => comment.id === id);
			}
		},
	};
});

async function availablePort(): Promise<number> {
	const probe = createServer();
	await new Promise<void>((resolve, reject) => {
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", resolve);
	});
	const address = probe.address();
	if (!address || typeof address === "string")
		throw new Error("No ephemeral test port");
	await new Promise<void>((resolve, reject) =>
		probe.close((error) => (error ? reject(error) : resolve())),
	);
	return address.port;
}

it("publishes the actual record-decisions hook as one durable Linear comment while lifecycle milestones stay in the transcript", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-decision-docs-"));
	const workflow = WorkflowSchema.parse({
		id: "decision-documentation",
		name: "Decision documentation",
		steps: [
			{
				id: "record-decisions",
				name: "Record decisions",
				type: "tool",
				tool: "record-decisions",
			},
		],
	});
	const runtime = new WorkflowRuntime(home, {});
	const run = runtime.create({
		repositoryId: "repo",
		workflow,
		workspace: home,
		title: "Decision documentation",
		input: "Document the accepted decision",
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	run.ticketReference = {
		provider: "native",
		platform: "linear",
		workspaceId: "workspace",
		id: "issue",
		url: "https://linear.app/example/issue/EX-1/example",
	};
	run.ticketSync = {
		receipts: [],
		transcript: { sessionId: "verified-transcript" },
	};
	run.outputs.ticket = { title: "Decision documentation" };
	run.outputs.clarify = {
		decisions: [
			{
				decision: "Use one server-wide default language",
				rationale: "Readers share a consistent default",
			},
		],
		questions: [],
		requirements: [],
	};
	runtime.save(run);
	vi.stubEnv("BOBS_FACTORY_FACTORY_PORT", "0");
	vi.stubEnv("CLOUDFLARE_TOKEN", "");
	vi.stubEnv("WEBHOOK_IP_VALIDATION", "false");
	provider.comments.length = 0;
	provider.activities.length = 0;
	const worker = new EdgeWorker({
		factoryHome: home,
		serverPort: await availablePort(),
		repositories: [
			{
				id: "repo",
				name: "Fixture",
				repositoryPath: home,
				workspaceBaseDir: home,
				baseBranch: "main",
				isActive: true,
				linearWorkspaceId: "workspace",
			},
		],
		linearWorkspaces: { workspace: { linearToken: "decision-docs-fixture" } },
		handlers: f1AgentHandlers("mock"),
	});
	try {
		await worker.start();
		await vi.waitFor(() =>
			expect(new WorkflowRuntime(home, {}).get(run.id).status).toBe(
				"completed",
			),
		);
		expect(provider.comments).toHaveLength(1);
		const expected = `## Factory decision records\n\n${JSON.stringify(run.outputs.clarify, null, 2)}\n\n### Questions and answers\n`;
		const saved = new WorkflowRuntime(home, {}).get(run.id);
		const receipt = saved.ticketSync!.receipts.find(
			(entry) => entry.key === `comment:${expected}`,
		)!;
		expect(
			provider.comments[0].body.replace(/\n\n<!-- factory:[^\n]+ -->$/, ""),
		).toBe(expected);
		expect(receipt.delivered).toBe(true);
		expect(provider.activities.map((entry) => entry.content.type)).toEqual([
			"thought",
			"thought",
		]);
	} finally {
		await worker.stop();
		vi.unstubAllEnvs();
		rmSync(home, { recursive: true, force: true });
	}
});
