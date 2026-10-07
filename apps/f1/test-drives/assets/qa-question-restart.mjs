// Run with F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/qa-question-restart.mjs
// after building cyrus-edge-worker. No provider runner or background agent is used.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultWorkflows } from "../../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { FactoryServer } from "../../../../packages/edge-worker/dist/factory/FactoryServer.js";
import {
	captureEvidence,
	FactoryTools,
} from "../../../../packages/edge-worker/dist/factory/FactoryTools.js";
import { qaDigest } from "../../../../packages/edge-worker/dist/factory/Qa.js";
import {
	TicketTracking,
	taskbotAdapter,
	taskbotSource,
} from "../../../../packages/edge-worker/dist/factory/TicketTracking.js";
import { validateWorkflows } from "../../../../packages/edge-worker/dist/factory/Workflow.js";
import { WorkflowRuntime } from "../../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";
import {
	qaExecution,
	qaScope,
} from "../../../../packages/edge-worker/test/fixtures/qa.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const home = mkdtempSync(join(tmpdir(), "f1-qa-question-restart-"));
const workspace = join(home, "repo");
mkdirSync(workspace);
const git = (...args) =>
	execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
git("init", "-q", "-b", "main");
writeFileSync(join(workspace, "README.md"), "Isolated QA restart fixture\n");
git("add", ".");
git(
	"-c",
	"user.name=F1",
	"-c",
	"user.email=f1@example.test",
	"-c",
	"commit.gpgsign=false",
	"commit",
	"-qm",
	"Fixture",
);
const headSha = git("rev-parse", "HEAD");
const revision = {
	headSha,
	dirty: false,
	at: new Date().toISOString(),
	historyLength: 0,
};
const calls = [],
	records = [];
const ticketSource = "https://taskbot.example/p/f1-fixture/t/1";
const ticketReference = { ...taskbotSource(ticketSource), server: "taskbot" };
const ticket = { id: 1, status: "backlog", comments: [], attachments: [] };
const trackerCalls = [];
const adapter = taskbotAdapter(ticketReference, async (tool, args) => {
	trackerCalls.push({ tool, args });
	if (tool === "set_status") ticket.status = args.to;
	if (tool === "comment") ticket.comments.push({ body: args.body });
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(tool === "get_ticket" ? ticket : { ok: true }),
			},
		],
	};
});
let runtime;
const tracking = new TicketTracking(
	async () => adapter,
	(run) => runtime.save(run),
	(run, message) => runtime.log(run, "ticket-sync", message),
);
const assistance = () =>
	ticket.comments.filter((c) => c.body.startsWith("Factory needs assistance:"));
let guidance = "Restore the fixture account and retry the required check.";
const tools = new FactoryTools({ postComment: async () => {} });
const hooks = {
	track: (run, milestone) => tracking.record(run, milestone),
	// These canned receipts test gate orchestration, never actual record persistence.
	agent: async (ctx) => {
		calls.push(ctx.step.id);
		ctx.run.roleRevisions ??= {};
		ctx.run.roleRevisions[ctx.stepKey] = revision;
		if (ctx.step.id === "capture") {
			ctx.progress = { currentRevision: revision, changedFiles: [] };
			return captureEvidence(
				ctx,
				qaExecution(ctx.run.answers.length >= 2 ? "passed" : "blocked"),
			);
		}
		return {
			qaContract: "qa-v1",
			findings: [],
			summary: "Reviewed canned receipts",
			acceptedScreenshots: [],
			qaReviewStamp: {
				headSha,
				dirty: false,
				scopeHash: qaDigest(ctx.run.outputs["visual-scope"]),
				captureHash: qaDigest(ctx.run.outputs.capture),
			},
		};
	},
	script: async () => {
		throw new Error("No scripts in this fixture");
	},
	tool: async (ctx) => {
		calls.push(ctx.step.id);
		const output = await tools.tool(ctx);
		return output.qaBlocked
			? {
					...output,
					questionRecommendations: [
						{
							questionIndex: 0,
							answer: guidance,
							reason: "The fixture account is unavailable.",
						},
					],
				}
			: output;
	},
};
const workflow = validateWorkflows([
	...defaultWorkflows,
	{
		id: "qa-restart",
		name: "QA restart",
		allowedTriggers: ["manual"],
		steps: [
			{
				id: "capture",
				name: "Mock QA",
				type: "agent",
				prompt: "Fixture",
				qaContract: "qa-v1",
				next: "visual-review",
			},
			{
				id: "visual-review",
				name: "Mock review",
				type: "agent",
				prompt: "Fixture",
				qaContract: "qa-v1",
				next: "visual-gate",
			},
			{
				id: "visual-gate",
				name: "Real QA gate",
				type: "tool",
				tool: "visual-gate",
				qaContract: "qa-v1",
				next: "end",
			},
		],
	},
]).at(-1);
runtime = new WorkflowRuntime(home, hooks);
let server;
const until = async (check) => {
	const end = Date.now() + 10000;
	while (!check()) {
		assert.notEqual(
			runtime.get(run.id).status,
			"failed",
			runtime.get(run.id).error,
		);
		assert.ok(Date.now() < end, "Fixture wait timed out");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
};
const waiting = () =>
	runtime.get(run.id).status === "waiting" &&
	runtime.pendingAnswers.has(run.id) &&
	runtime.get(run.id).ticketSync?.receipts.every((r) => r.delivered);
const context = () => {
	const saved = runtime.get(run.id);
	return {
		questions: structuredClone(saved.questions),
		step: saved.step,
		questionBatchId: saved.questionBatchId,
	};
};
const restart = async () => {
	await runtime.shutdown();
	runtime = new WorkflowRuntime(home, hooks);
	runtime.resumeAll();
	await until(waiting);
};
const run = runtime.create({
	triggerOrigin: { type: "manual", workflowId: workflow.id, at: revision.at },
	title: "QA question restart",
	repositoryId: "fixture",
	workspace,
	input: "Fixture",
	workflow,
});
run.ticketReference = ticketReference;
run.outputs.clarify = { requirements: ["Persist a record"], decisions: [] };
run.outputs["visual-scope"] = qaScope("api");
try {
	void runtime.launch(run);
	await until(waiting);
	assert.equal(assistance().length, 1);
	const original = context();
	for (let i = 0; i < 2; i++) {
		await restart();
		assert.deepEqual(context(), original);
		assert.deepEqual(runtime.get(run.id).answers, []);
		assert.equal(calls.filter((id) => id === "capture").length, 1);
		assert.equal(assistance().length, 1);
		records.push({
			state: "unchanged restart",
			context: context(),
			calls: [...calls],
		});
	}
	// Preserve delivered legacy markers when an upgrade restores unchanged guidance.
	const saved = runtime.get(run.id);
	saved.ticketSync.receipts.find((r) =>
		r.key.startsWith("questions:"),
	).key = `questions:${saved.step}:${saved.answers.length}`;
	runtime.save(saved);
	await restart();
	assert.deepEqual(context(), original);
	assert.equal(assistance().length, 1);
	guidance = "Use the restored test account to execute QA.";
	await restart();
	assert.notEqual(context().questionBatchId, original.questionBatchId);
	assert.deepEqual(context().questions, original.questions);
	assert.equal(assistance().length, 2);
	assert.ok(assistance().at(-1).body.includes(guidance));
	server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("Unused");
		},
		stop: (id) => runtime.stop(id),
	});
	const answer = (context, text) =>
		server.app.inject({
			method: "POST",
			url: `/api/runs/${run.id}/answer`,
			headers: { host: "localhost", "x-factory-request": "1" },
			payload: { context, answer: text },
		});
	assert.equal((await answer(original, "Old draft")).statusCode, 409);
	assert.deepEqual(runtime.get(run.id).answers, []);
	const updated = context();
	await server.stop();
	server = undefined;
	await restart();
	assert.deepEqual(context(), updated);
	assert.equal(assistance().length, 2);
	server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("Unused");
		},
		stop: (id) => runtime.stop(id),
	});
	assert.equal(
		(await answer(updated, "Account still unavailable")).statusCode,
		200,
	);
	await until(() => waiting() && runtime.get(run.id).answers.length === 1);
	assert.equal(assistance().length, 3);
	assert.notEqual(context().questionBatchId, updated.questionBatchId);
	assert.equal((await answer(updated, "Duplicate old draft")).statusCode, 409);
	assert.equal(
		(await answer(context(), "Account restored; run QA")).statusCode,
		200,
	);
	await until(() => runtime.get(run.id).status === "completed");
	assert.equal(runtime.get(run.id).answers.length, 2);
	assert.equal(calls.filter((id) => id === "capture").length, 3);
	assert.equal(runtime.get(run.id).outputs["visual-gate"].approved, true);
	records.push({
		state: "completed after explicit answers",
		answers: runtime.get(run.id).answers,
		calls,
	});
	const evidence = process.env.F1_EVIDENCE_DIR ?? home;
	mkdirSync(evidence, { recursive: true });
	writeFileSync(
		join(evidence, "qa-question-restart.json"),
		JSON.stringify(
			{
				mode: "mock",
				home,
				productHead: execFileSync("git", ["rev-parse", "HEAD"], {
					encoding: "utf8",
				}).trim(),
				trackerCalls,
				assistance: assistance(),
				ticketSync: runtime.get(run.id).ticketSync,
				records,
			},
			null,
			2,
		),
	);
	console.log(
		"PASS: unchanged and legacy QA waits avoid duplicate ticket comments; replacement batches notify once, reject stale answers and require explicit submission.",
	);
} finally {
	await runtime.shutdown();
	await server?.stop();
	tracking.stop();
}
