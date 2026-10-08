import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { f1AgentHandlers } from "../../../apps/f1/src/MockAgentRunner.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";

const boundary = vi.hoisted(() => ({ requests: [] as any[] }));
vi.mock("@linear/sdk", async (original) => {
	const actual = await original<typeof import("@linear/sdk")>();
	return {
		...actual,
		LinearClient: class extends actual.LinearClient {
			constructor(options: any) {
				super(options);
				this.client.request = (async (_doc: unknown, variables: any) => {
					boundary.requests.push(variables);
					return {
						agentActivityCreate: {
							success: true,
							agentActivity: { id: variables?.input?.id ?? randomUUID() },
							lastSyncId: 1,
						},
					};
				}) as any;
			}
		},
	};
});

afterEach(() => vi.unstubAllEnvs());

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

it.each([
	"bound",
	"unknown-link",
	"wrong-issue",
	"wrong-workspace",
])("routes a signed transcript webhook by exact persisted binding (%s)", async (scenario) => {
	const home = mkdtempSync(join(tmpdir(), "factory-transcript-ingress-"));
	const workflow = defaultWorkflows.find((item) => item.id === "factory")!;
	const runtime = new WorkflowRuntime(home, {});
	const run = runtime.create({
		repositoryId: "repo",
		workflow,
		workspace: home,
		input: "Existing work",
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	const link = `https://factory.example/#/runs/${run.id}`;
	run.status = "completed";
	run.ticketReference = {
		provider: "native",
		platform: "linear",
		workspaceId: "workspace",
		id: "issue",
		url: "https://linear.app/example/issue/EX-1/example",
	};
	run.ticketSync = {
		receipts: [],
		transcript: { externalLink: link, createAttempted: true },
	};
	runtime.save(run);
	vi.stubEnv("LINEAR_DIRECT_WEBHOOKS", "true");
	vi.stubEnv("LINEAR_WEBHOOK_SECRET", "fixture-secret");
	vi.stubEnv("WEBHOOK_IP_VALIDATION", "false");
	vi.stubEnv("BOBS_FACTORY_FACTORY_PORT", "0");
	vi.stubEnv("CLOUDFLARE_TOKEN", "");
	boundary.requests.length = 0;
	const worker = new EdgeWorker({
		factoryHome: home,
		serverPort: await availablePort(),
		repositories: [],
		linearWorkspaces: {
			workspace: { linearToken: `fixture-token-${scenario}` },
			other: { linearToken: `other-fixture-token-${scenario}` },
		},
		handlers: f1AgentHandlers("mock"),
	});
	try {
		await worker.start();
		const payload = {
			type: "AgentSessionEvent",
			action: "created",
			organizationId: scenario === "wrong-workspace" ? "other" : "workspace",
			appUserId: "agent",
			agentSession: {
				id: "transcript-session",
				externalLink:
					scenario === "unknown-link"
						? "https://factory.example/#/runs/other"
						: link,
				issue: {
					id: scenario === "wrong-issue" ? "other-issue" : "issue",
					identifier: "EX-1",
					title: "Existing work",
				},
			},
		};
		const signature = createHmac("sha256", "fixture-secret")
			.update(JSON.stringify(payload))
			.digest("hex");
		const response = await worker
			.getSharedApplicationServer()
			.getFastifyInstance()
			.inject({
				method: "POST",
				url: "/linear-webhook",
				headers: { "linear-signature": signature },
				payload,
			});
		expect(response.statusCode).toBe(200);
		await new Promise((resolve) => setTimeout(resolve, 50));
		if (scenario === "bound") {
			const repeated = await worker
				.getSharedApplicationServer()
				.getFastifyInstance()
				.inject({
					method: "POST",
					url: "/linear-webhook",
					headers: { "linear-signature": signature },
					payload,
				});
			expect(repeated.statusCode).toBe(200);
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(boundary.requests).toEqual([]);
			expect(
				new WorkflowRuntime(home, {}).get(run.id).ticketSync?.transcript
					?.sessionId,
			).toBe("transcript-session");
		} else {
			expect(boundary.requests.length).toBeGreaterThan(0);
			expect(
				new WorkflowRuntime(home, {}).get(run.id).ticketSync?.transcript
					?.sessionId,
			).toBeUndefined();
		}
		expect(worker.getAgentSessionsForIssue("issue", "repo")).toEqual([]);
	} finally {
		await worker.stop();
		rmSync(home, { recursive: true, force: true });
	}
});
