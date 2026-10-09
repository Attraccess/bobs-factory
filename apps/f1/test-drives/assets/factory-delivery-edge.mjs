// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/factory-delivery-edge.mjs
// Built EdgeWorker + CLI tracker + MockAgentRunner; forge publication is scripted.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const root = process.cwd(),
	home = mkdtempSync(join(tmpdir(), "f1-delivery-edge-")),
	repo = join(home, "repo");
mkdirSync(repo);
const git = (cwd, ...args) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
git(repo, "init", "-qb", "main");
git(repo, "config", "user.name", "F1");
git(repo, "config", "user.email", "f1@example.test");
git(repo, "config", "commit.gpgsign", "false");
writeFileSync(
	join(repo, ".gitignore"),
	".claude/\n.codex/\n.cursor/\n.opencode/\n",
);
git(repo, "add", ".");
git(repo, "commit", "-qm", "chore: isolated fixture");
git(repo, "remote", "add", "origin", repo);
git(repo, "fetch", "origin");
process.env.BOBS_FACTORY_FACTORY_PORT = "0";
process.env.BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE = "1";
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	home,
	"empty-legacy-capacity",
);
delete process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE;
await import(
	join(root, "packages/edge-worker/node_modules/reflect-metadata/Reflect.js")
);
const { EdgeWorker } = await import(
	join(root, "packages/edge-worker/dist/index.js")
);
const { TicketTracking } = await import(
	join(root, "packages/edge-worker/dist/factory/TicketTracking.js")
);
const { f1AgentHandlers } = await import(
	join(root, "apps/f1/dist/src/MockAgentRunner.js")
);
const worker = new EdgeWorker({
	platform: "cli",
	factoryHome: home,
	serverPort: 3600,
	serverHost: "127.0.0.1",
	defaultRunner: "claude",
	handlers: f1AgentHandlers("mock", "{}"),
	repositories: [
		{
			id: "fixture",
			name: "Delivery F1",
			repositoryPath: repo,
			workspaceBaseDir: join(home, "worktrees"),
			baseBranch: "main",
			linearWorkspaceId: "cli-workspace",
			isActive: true,
		},
	],
	linearWorkspaces: {
		"cli-workspace": { linearToken: "cli-mode-no-token-needed" },
	},
});
const runtime = worker.getFactoryRuntime(),
	visits = [],
	publications = [];
runtime.updateWorkflows([
	...runtime.workflows,
	{
		id: "delivery-edge",
		name: "Delivery boundary",
		labels: ["workflow:delivery-edge"],
		allowedTriggers: ["ticket-assignment"],
		steps: [
			{
				id: "implement",
				name: "Implement fixture",
				type: "script",
				script:
					'node --input-type=module -e \'import {writeFileSync} from "node:fs";writeFileSync("feature","Fixture feature");console.log(JSON.stringify({summary:"Implemented fixture"}));\'',
			},
			{
				id: "draft-pr",
				name: "Publish fixture",
				type: "tool",
				tool: "draft-pr",
			},
			{
				id: "independent-qa",
				name: "Independent QA",
				type: "agent",
				prompt: "Return {} for the controlled F1 QA visit.",
			},
			{
				id: "human-review",
				name: "Explicit approval",
				type: "tool",
				tool: "human-review",
				next: "end",
			},
		],
	},
]);
let firstId, release;
const wait = new Promise((resolve) => (release = resolve));
const tracking = new TicketTracking(
	async (run) => {
		if (run.id === firstId && run.ticketSync?.receipts.some((r) => r.pr))
			await wait;
		return worker.factoryTicketAdapter(run);
	},
	(run) => runtime.save(run),
	(run, message) => runtime.log(run, "ticket-sync", message),
);
worker.getTicketTracking = () => tracking;
const originalAgent = runtime.hooks.agent;
runtime.hooks.agent = async (ctx) => {
	visits.push({ runId: ctx.run.id, step: ctx.step.id });
	return originalAgent(ctx);
};
runtime.hooks.tool = async (ctx) => {
	if (ctx.step.tool === "draft-pr") {
		firstId ??= ctx.run.id;
		assert.equal(ctx.run.deliveryCoordination.phase, "active");
		git(ctx.run.workspace, "add", "feature");
		git(
			ctx.run.workspace,
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-qm",
			"feat: fixture",
		);
		const output = {
			url: `https://github.com/f1/fixture/pull/${publications.length + 1}`,
			headSha: git(ctx.run.workspace, "rev-parse", "HEAD"),
		};
		publications.push({ runId: ctx.run.id, ...output });
		return output;
	}
	if (ctx.step.tool === "human-review")
		return publications.find((p) => p.runId === ctx.run.id);
	throw new Error(`Unexpected tool ${ctx.step.tool}`);
};
const exec = promisify(execFile),
	sessions = [];
const f1 = async (...args) =>
	(
		await exec(join(root, "apps/f1/f1"), args, {
			cwd: root,
			env: { ...process.env, BOBS_FACTORY_PORT: "3600" },
			timeout: 20000,
		})
	).stdout.replace(
		new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
		"",
	);
async function until(check) {
	for (let i = 0; i < 600; i++) {
		const value = await check();
		if (value) return value;
		for (const run of runtime.runs.values())
			assert.notEqual(run.status, "failed", run.error);
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error("Timed out");
}
async function start(title) {
	const created = await f1(
		"create-issue",
		"--title",
		title,
		"--description",
		"Validate delayed publication tracking.",
		"--labels",
		"workflow:delivery-edge,claude",
	);
	const issue = created.match(/ID: (issue-\d+)/)?.[1];
	assert.ok(issue, created);
	const response = await f1("start-session", "--issue-id", issue);
	const id = response.match(/Session ID: (session-\d+)/)?.[1];
	assert.ok(id, response);
	sessions.push(id);
	return id;
}
try {
	await worker.start();
	await f1("ping");
	const first = await start("First delayed delivery");
	await until(() =>
		runtime.runs.get(first)?.ticketSync?.receipts.some((r) => r.pr),
	);
	const second = await start("Second independent delivery");
	await until(() => runtime.runs.get(second)?.status === "waiting");
	const a = runtime.get(first),
		b = runtime.get(second);
	assert.equal(
		a.ticketSync.receipts.some((r) => r.pr && !r.delivered),
		true,
	);
	assert.equal(b.reviewGate.status, "pending");
	assert.equal(b.humanDecisions, undefined);
	assert.equal(publications.length, 2);
	assert.equal(
		visits.filter((v) => v.runId === second && v.step === "independent-qa")
			.length,
		1,
	);
	assert.equal(b.deliveryCoordination.phase, "released");
	const activity = await f1("view-session", "--session-id", second);
	assert.ok(activity.includes("Total Activities: 4"), activity);
	assert.ok(activity.includes("claude/f1-mock"), activity);
	assert.ok(b.events.some((e) => e.step === "independent-qa"));
	writeFileSync(join(home, "activities.txt"), activity);
	writeFileSync(
		join(home, "results.json"),
		JSON.stringify(
			{
				mode: "mock",
				first,
				second,
				publications,
				visits,
				firstTrackingPending: true,
				secondHumanGate: b.reviewGate,
				paidCalls: 0,
			},
			null,
			2,
		),
	);
	console.log(
		JSON.stringify({
			result: "PASS",
			home,
			sessions,
			publications: publications.length,
			independentQaVisits: visits.length,
			paidCalls: 0,
		}),
	);
} finally {
	release();
	if (firstId && runtime.runs.has(firstId))
		await tracking.flush(runtime.get(firstId));
	for (const id of sessions) {
		try {
			await f1("stop-session", "--session-id", id);
		} catch {
			runtime.stop(id);
		}
	}
	tracking.stop();
	await worker.stop();
}
