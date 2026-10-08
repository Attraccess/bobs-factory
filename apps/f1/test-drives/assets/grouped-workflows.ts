import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EdgeWorker } from "../../../../packages/edge-worker/src/EdgeWorker.js";
import { FactoryTools } from "../../../../packages/edge-worker/src/factory/FactoryTools.js";
import { WorkflowSchema } from "../../../../packages/edge-worker/src/factory/Workflow.js";
import { deliveryFixture } from "../../../../packages/edge-worker/test/fixtures/grouped-delivery.js";
import { f1AgentHandlers } from "../../src/MockAgentRunner.js";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const directory = mkdtempSync(join(tmpdir(), "f1-grouped-workflows-")),
	home = join(directory, "home");
mkdirSync(home);
const forge = deliveryFixture(directory);
for (const repo of forge.repositories)
	forge.git(repo, "checkout", "--", "shared.txt");
process.env.BOBS_FACTORY_FACTORY_PORT = "3635";
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	directory,
	"legacy-capacity",
);
delete process.env.BOBS_FACTORY_FACTORY_ORIGIN;
delete process.env.BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN;
const mock = f1AgentHandlers(
	"mock",
	JSON.stringify({ findings: [], summary: "Scripted review of app and api" }),
)!;
const roles: string[] = [];
const worker = new EdgeWorker({
	platform: "cli",
	factoryHome: home,
	serverPort: 3636,
	serverHost: "127.0.0.1",
	defaultRunner: "codex",
	handlers: {
		...mock,
		createAgentRunner: (type, config) => {
			if (
				config.appendSystemPrompt?.includes(
					"executing one software-factory step",
				)
			) {
				assert.match(config.appendSystemPrompt, /Repository scope/);
				for (const name of ["niotix", "api", "context"])
					assert(config.appendSystemPrompt.includes(`"name":"${name}"`));
				roles.push(config.workingDirectory!);
			}
			return mock.createAgentRunner!(type, config);
		},
	},
	repositories: forge.repositories.map((repo) => ({
		id: repo.id,
		name: repo.id === "app" ? "niotix" : repo.name,
		repositoryPath: repo.repositoryPath,
		baseBranch: repo.baseBranch,
		githubUrl: repo.githubUrl,
		workspaceBaseDir: join(directory, "worktrees"),
		linearWorkspaceId: "cli-workspace",
		isActive: true,
		routingLabels: ["niotix", "api", "context"],
	})),
});
// Embedded fixture access changes only the provider boundary, never production state.
const internal = worker as unknown as {
	getFactoryRuntime(): import("../../../../packages/edge-worker/src/factory/WorkflowRuntime.js").WorkflowRuntime;
	factoryServer: {
		auth: { store: { update(fn: (state: any) => void): void } };
	};
};
const runtime = internal.getFactoryRuntime();
const hooks = runtime as unknown as {
	hooks: {
		tool(
			context: import("../../../../packages/edge-worker/src/factory/WorkflowRuntime.js").ExecutionContext,
		): Promise<unknown>;
	};
};
const tools = new FactoryTools({
	command: forge.command,
	postComment: async () => {},
});
hooks.hooks.tool = (context) => tools.tool(context);
const script = (source: string) => `node -e '${source.replace(/'/g, "'\\''")}'`;
const guide = {
	goal: "Grouped delivery",
	summary: "App and API changed; context retained",
	decision: { status: "ready", summary: "Both repositories reviewed" },
	behavior: [],
	requirements: [],
	checks: ["Scripted fixture"],
	risks: [],
	reviewInstructions: ["Review both PRs before approval"],
};
const factory = WorkflowSchema.parse({
	id: "factory",
	name: "Factory scope drive",
	labels: ["factory"],
	allowedTriggers: ["manual", "ticket-assignment"],
	steps: [
		{
			id: "implement",
			name: "Implement two repositories",
			type: "script",
			script: script(
				`const fs=require("node:fs");const repos=JSON.parse(process.env.FACTORY_REPOSITORIES);for(const repo of repos){if(repo.id!=="context")fs.writeFileSync(repo.workspace+"/shared.txt",repo.name+" changed\\n")}process.stdout.write(JSON.stringify({status:"completed",summary:"Scripted group implementation",checks:[],questions:[]}))`,
			),
		},
		{
			id: "draft-pr",
			name: "Publish all changed repositories",
			type: "tool",
			tool: "draft-pr",
		},
		{
			id: "code-review",
			name: "Review the complete scope",
			type: "agent",
			prompt:
				"Inspect every changed repository and return findings and summary as JSON",
		},
		{
			id: "review-gate",
			name: "Code review gate",
			type: "tool",
			tool: "review-gate",
		},
		{ id: "ci", name: "CI for all PRs", type: "tool", tool: "ci" },
		{
			id: "guide",
			name: "Scripted combined guide",
			type: "script",
			script: script(
				`process.stdout.write(${JSON.stringify(JSON.stringify(guide))})`,
			),
		},
		{ id: "handoff", name: "Per-PR handoff", type: "tool", tool: "handoff" },
		{
			id: "human-review",
			name: "Approve all revisions",
			type: "tool",
			tool: "human-review",
		},
		{ id: "merge", name: "Confirm all merges", type: "tool", tool: "merge" },
	],
});
const snapshotStep = {
	id: "scope",
	name: "Inspect inherited scope",
	type: "script",
	script: script("process.stdout.write(process.env.FACTORY_REPOSITORIES)"),
};
const takeover = WorkflowSchema.parse({
	id: "takeover",
	name: "Takeover scope drive",
	labels: ["takeover"],
	allowedTriggers: ["manual", "ticket-assignment"],
	steps: [snapshotStep],
});
const nested = WorkflowSchema.parse({
	id: "nested-scope",
	name: "Nested scope",
	internal: true,
	allowedTriggers: ["workflow"],
	steps: [snapshotStep],
});
const custom = WorkflowSchema.parse({
	id: "custom-scope",
	name: "Custom scope",
	allowedTriggers: ["manual"],
	steps: [
		{
			id: "nested",
			name: "Nested call",
			type: "workflow",
			workflow: nested.id,
		},
	],
});
runtime.updateWorkflows(
	[
		...runtime
			.listWorkflows()
			.filter((workflow) => !["factory", "takeover"].includes(workflow.id)),
		factory,
		takeover,
		nested,
		custom,
	],
	"factory",
);
const wait = async (id: string, status: string) => {
	const deadline = Date.now() + 45000;
	while (Date.now() < deadline) {
		const run = runtime.runs.get(id);
		if (run?.status === status) return run;
		if (run?.status === "failed") throw new Error(run.error);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`Timed out waiting for ${id}: ${status}`);
};
let started = false;
try {
	await worker.start();
	started = true;
	internal.factoryServer.auth.store.update((state) => {
		state.credentials.push({
			id: "drive",
			origin: "http://localhost:3635",
			publicKey: "fixture",
			counter: 0,
			label: "F1",
			deviceType: "singleDevice",
			backedUp: false,
			createdAt: Date.now(),
			lastUsedAt: Date.now(),
		});
		state.sessions.push({
			hash: createHash("sha256").update("f1-group-session").digest("hex"),
			credential: "drive",
			origin: "http://localhost:3635",
			expires: Date.now() + 3600000,
			verifiedAt: Date.now(),
		});
	});
	const api = async (path: string, method = "GET", body?: unknown) => {
		const response = await fetch(`http://localhost:3635${path}`, {
			method,
			headers: {
				origin: "http://localhost:3635",
				cookie: "factory-local-session=f1-group-session",
				"content-type": "application/json",
				"x-factory-request": "1",
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const value = (await response.json()) as any;
		assert(response.ok, JSON.stringify(value));
		return value;
	};
	const rpc = async (method: string, params: unknown) => {
		const response = await fetch("http://localhost:3636/cli/rpc", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
		});
		const value = (await response.json()) as any;
		assert(!value.error, JSON.stringify(value));
		return value.result;
	};
	const config = await api("/api/config");
	assert.equal(config.repositories.length, 1);
	assert.equal(config.repositories[0].name, "niotix");
	assert.deepEqual(config.repositories[0].repositoryIds, [
		"app",
		"api",
		"context",
	]);
	const created = await rpc("createIssue", {
		teamId: "team-default",
		title: "Change grouped repositories",
		description: "[workflow=factory]\nChange the niotix scope",
		labels: ["api"],
	});
	const assigned = await rpc("startSession", { issueId: created.issue.id });
	const run = await wait(assigned.session.sessionId, "waiting");
	assert.equal(run.repositories?.length, 3);
	assert.deepEqual(forge.publications, ["app", "api"]);
	assert.equal(roles.length, 1);
	assert.equal(run.reviewGate?.repositories?.length, 2);
	assert.equal(
		run.reviewGate?.repositories?.[0]?.headSha,
		forge.requests.get("app")!.headSha,
	);
	assert.equal(
		run.reviewGate?.repositories?.[1]?.headSha,
		forge.requests.get("api")!.headSha,
	);
	const ticket = await (
		worker as unknown as {
			issueTrackers: Map<string, { fetchIssue(id: string): Promise<any> }>;
		}
	).issueTrackers
		.get("cli-workspace")!
		.fetchIssue(created.issue.id);
	assert.notEqual(ticket.state?.type, "completed");
	const gate = run.reviewGate!;
	await api(`/api/runs/${run.id}/review`, "POST", {
		reviewId: gate.id,
		headSha: gate.headSha,
		decision: "approve",
		repositories: [{ repositoryId: "forged" }],
	});
	await wait(run.id, "completed");
	assert.deepEqual(forge.merges, ["app", "api"]);
	assert.equal(run.humanDecisions?.at(-1)?.repositories?.length, 2);
	const timeline = await rpc("viewSession", {
		sessionId: run.id,
		limit: 100,
		offset: 0,
	});
	assert(
		JSON.stringify(timeline).includes("routing") || timeline.totalCount > 0,
	);
	const activities = await api(`/api/runs/${run.id}/activity`);
	assert(
		JSON.stringify(activities).includes("Publish all changed repositories"),
	);
	console.log(
		"PASS shared label → grouped Factory → two PRs/CI/handoffs → revision-bound human approval → all merges; real worktrees, ticket and activities",
	);
	const manual = await api("/api/runs", "POST", {
		repositoryId: "app",
		workflow: "custom-scope",
		prompt: "Inspect scope",
	});
	const customRun = await wait(manual.id, "completed");
	assert.equal(customRun.repositories?.length, 3);
	assert.equal((customRun.outputs.scope as unknown[])?.length, 3);
	console.log(
		"PASS one dashboard project and manual/custom/nested workflow scope inheritance",
	);
	const second = await rpc("createIssue", {
		teamId: "team-default",
		title: "Takeover grouped context",
		description: "[workflow=takeover]",
		labels: ["context"],
	});
	const takeSession = await rpc("startSession", { issueId: second.issue.id });
	const takeRun = await wait(takeSession.session.sessionId, "completed");
	assert.equal(takeRun.repositories?.length, 3);
	assert.equal((takeRun.outputs.scope as unknown[])?.length, 3);
	console.log("PASS Takeover assignment uses every grouped repository");
	const simple = await api("/api/runs", "POST", {
		repositoryId: "app",
		workflow: "simple",
		prompt: "Inspect all repositories",
	});
	const simpleRun = await wait(simple.id, "completed");
	assert.equal(simpleRun.repositories?.length, 3);
	assert(
		Object.values(simpleRun.sessionSnapshot?.workspace.repoPaths ?? {})
			.length === 3,
	);
	console.log("PASS Simple manual launch retains the same grouped worktrees");
	const receipt = {
		result: "passed",
		mode: "mock",
		factoryRun: run.id,
		workflows: [
			"factory",
			"takeover",
			"simple",
			"custom-scope",
			"nested-scope",
		],
		publications: forge.publications,
		merges: forge.merges,
		repositories: run.repositories,
		decisions: run.humanDecisions,
		activityEvents: activities.length ?? Object.keys(activities).length,
	};
	writeFileSync(
		process.env.F1_RECEIPT_PATH ??
			"node_modules/.cache/f1-grouped-workflows.json",
		JSON.stringify(receipt, null, 2),
	);
} finally {
	if (started) await worker.stop();
	else await runtime.shutdown();
	rmSync(directory, { recursive: true, force: true });
}
