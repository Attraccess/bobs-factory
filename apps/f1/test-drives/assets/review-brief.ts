// F1 driver for the review brief: real CLI-platform EdgeWorker, real Git worktrees,
// deterministic MockAgentRunner roles and scripted GitHub responses.
//   pnpm --filter bobs-factory-edge-worker build && pnpm --filter f1 build
//   F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/review-brief.ts
import assert from "node:assert/strict";
import { execFile as execFileCallback, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	executeCommand,
	FactoryTools,
} from "../../../../packages/edge-worker/dist/factory/FactoryTools.js";
import {
	EdgeWorker,
	requestFactoryTerminalSession,
} from "../../../../packages/edge-worker/dist/index.js";
import type { Workflow } from "../../../../packages/edge-worker/src/factory/Workflow.ts";
import type {
	FactoryRun,
	WorkflowRuntime,
} from "../../../../packages/edge-worker/src/factory/WorkflowRuntime.ts";
import {
	githubApiReceipt,
	githubRequest,
} from "../../../../packages/edge-worker/test/fixtures/github-api.ts";
import { MockAgentRunner } from "../../src/MockAgentRunner.ts";

const execFile = promisify(execFileCallback);
assert.equal(process.env.F1_AGENT_MODE, "mock");
const root = mkdtempSync("/tmp/bobs-review-brief-f1-"),
	home = join(root, "home"),
	repo = join(root, "repo");
mkdirSync(home);
mkdirSync(repo);
const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
git(repo, "init", "-q", "-b", "main");
git(repo, "config", "user.name", "F1 fixture");
git(repo, "config", "user.email", "f1@example.invalid");
git(repo, "config", "commit.gpgsign", "false");
writeFileSync(join(repo, "README.md"), "F1 review brief fixture\n");
writeFileSync(join(repo, ".gitignore"), ".claude/\n.codex/\n");
git(repo, "add", ".");
git(repo, "commit", "-qm", "Initial fixture");
git(repo, "remote", "add", "origin", repo);
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	root,
	"legacy-capacity",
);
process.env.BOBS_FACTORY_FACTORY_PORT = "3541";
delete process.env.BOBS_FACTORY_FACTORY_ORIGIN;
delete process.env.BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN;

const modes = ["brief", "gap", "legacy"] as const;
type Mode = (typeof modes)[number];
const counts: Record<string, number> = {};
const fixed = new Set<Mode>();
const descriptions: string[] = [];
const unhandled: unknown[] = [];
const onUnhandled = (error: unknown) => unhandled.push(error);
process.on("unhandledRejection", onUnhandled);
const receipts: Record<string, unknown> = { root, counts };

type Internals = {
	getFactoryRuntime(): WorkflowRuntime;
	startRunTitle: () => void;
};
const inside = (worker: EdgeWorker) => worker as unknown as Internals;

const workflow = (mode: Mode): Workflow => ({
	id: `brief-${mode}`,
	name: `Review brief ${mode}`,
	labels: [`workflow:brief-${mode}`],
	allowedTriggers: ["manual", "ticket-assignment"],
	steps: [
		{
			id: "seed",
			name: "Seed a delivered change",
			type: "tool",
			tool: "fixture-seed",
			next: "guide",
			branches: [],
			maxVisits: 8,
		},
		{
			id: "guide",
			name: "Fixture guide",
			type: "agent",
			runner: "codex",
			prompt: "Return the review for the whole PR",
			...(mode === "legacy" ? {} : { guideContract: "brief-v1" }),
			next: "handoff",
			branches: [],
			maxVisits: 8,
		},
		{
			id: "handoff",
			name: "Verify revision and hand off",
			type: "tool",
			tool: "handoff",
			branches: [{ when: { path: "fix", equals: true }, next: "ci-fix" }],
			next: "human-review",
			maxVisits: 100,
		},
		{
			id: "ci-fix",
			name: "Fixture ci-fix",
			type: "agent",
			runner: "codex",
			prompt: "Correct review gaps",
			next: "guide",
			branches: [],
			maxVisits: 8,
		},
		{
			id: "human-review",
			name: "Explicit human approval",
			type: "tool",
			tool: "human-review",
			next: "end",
			branches: [],
			maxVisits: 100,
		},
	],
});

function brief(mode: Mode, files: string[], attempt: number) {
	const gap = mode === "gap" && !fixed.has(mode);
	const invalid = mode === "brief" && attempt === 1;
	return {
		verdict: {
			headline: "The feature file ships with its greeting.",
			readiness: gap ? "not-ready" : "ready",
			why: invalid
				? "Receipt at /Users/f1/evidence/qa.json passed."
				: "The greeting is observed in the delivered file.",
		},
		ask: {
			source: "F1 issue",
			quote: "Ship the feature file with a greeting.",
		},
		interpretation: [
			{
				topic: "Greeting text",
				chosen: "Hello from F1",
				alternatives: ["Hello"],
				decidedBy: "bob",
			},
		],
		requirements: [
			{
				id: "greeting",
				text: "The feature file contains the greeting.",
				origin: "ask",
				status: gap ? "gap" : "shown",
				proof: {
					kind: "table",
					method: "Read the delivered file",
					columns: ["File", "Observed"],
					rows: [
						{
							cells: ["feature.txt", gap ? "missing" : "Hello from F1"],
							mark: gap ? "bad" : "good",
						},
					],
				},
				files: invalid ? [] : files,
			},
		],
		yourCall: [],
		beyondAsk: [],
		notVerified: [],
		hygiene: [{ text: "No generated files committed" }],
	};
}

function legacyGuide(files: string[]) {
	return {
		scope: { kind: "purely-visual", rationale: "One text file", files },
		tldr: "Feature file ships",
		goal: "Ship the feature file",
		summary: "The feature file ships",
		decision: {
			status: "ready",
			summary: "Ready",
			summaryShort: "Ready for review",
		},
		requirements: [
			{
				criterion: "Ship the file",
				status: "supported",
				evidence: ["Read it"],
			},
		],
		behavior: [],
		checks: ["Fixture check"],
		risks: [],
		reviewInstructions: ["Approve explicitly"],
		chapters: [
			{
				id: "feature",
				title: "Feature file",
				summary: "Adds the file",
				before: "Absent",
				after: "Present",
				tldr: "Adds the file",
				beforeShort: "Absent",
				afterShort: "Present",
				risk: { level: "low", text: "Text only" },
				keyChecks: [{ do: "Open the file", expect: "Greeting shown" }],
				requirementIndexes: [0],
				files,
				screenshots: [],
				diagrams: [],
				reviewChecks: ["Open it"],
				risks: [],
				evidence: ["Fixture"],
			},
		],
	};
}

function makeWorker() {
	const worker = new EdgeWorker({
		platform: "cli",
		factoryHome: home,
		serverHost: "127.0.0.1",
		serverPort: 3601,
		maxConcurrentSessions: 1,
		defaultRunner: "codex",
		repositories: [
			{
				id: "fixture",
				name: "Review brief fixture",
				repositoryPath: repo,
				workspaceBaseDir: join(home, "worktrees"),
				baseBranch: "main",
				linearWorkspaceId: "cli-workspace",
				isActive: true,
			},
		],
		handlers: {
			createAgentRunner: (_runner, config) => {
				const contextConfig = config.mcpConfig?.["factory-context"];
				assert(contextConfig && "args" in contextConfig);
				const context = JSON.parse(
					readFileSync(contextConfig.args![1]!, "utf8"),
				);
				const role = config.appendSystemPrompt?.match(
					/software-factory step: Fixture (guide|ci-fix)\./,
				)?.[1];
				assert(role);
				const mode = String(
					context.originalInput ?? context.feedback?.userInstructions.input,
				).match(/MODE:(\w+)/)?.[1] as Mode;
				assert(modes.includes(mode));
				const key = `${mode}:${role}`;
				counts[key] = (counts[key] ?? 0) + 1;
				if (role === "guide") {
					// Brief steps receive brief instructions; legacy steps keep chapter instructions.
					const briefText = "never author contract, reviewFiles";
					assert.equal(
						config.appendSystemPrompt?.includes(briefText),
						mode !== "legacy",
					);
				}
				let output: unknown;
				if (role === "ci-fix") {
					assert.equal(context.feedback.guide.contract, "brief-v1");
					assert(
						context.feedback.guide.requirements.some(
							(r: { status: string }) => r.status === "gap",
						),
					);
					fixed.add(mode);
					output = {
						summary: "Greeting restored",
						checks: ["Fixture check"],
						questions: [],
						reviewRequired: false,
					};
				} else {
					const files = context.progress.reviewScope.files as string[];
					assert.deepEqual(files, ["feature.txt"]);
					output =
						mode === "legacy"
							? legacyGuide(files)
							: brief(mode, files, counts[key]!);
				}
				return new MockAgentRunner(config, JSON.stringify(output));
			},
		},
	});
	inside(worker).startRunTitle = () => {};
	const runtime = inside(worker).getFactoryRuntime();
	const tools = new FactoryTools({
		postComment: async () => {},
		command: async (ctx, exe, args) => {
			if (exe === "git") return executeCommand(ctx, exe, args);
			const head = git(ctx.run.workspace, "rev-parse", "HEAD");
			const base = git(ctx.run.workspace, "rev-parse", "HEAD~1");
			const request = githubRequest(args);
			if (request.method === "PATCH")
				descriptions.push(String((request.body as { body?: string }).body));
			return JSON.stringify(
				githubApiReceipt(args, {
					headRefOid: head,
					baseRefOid: base,
					reviewDecision: "APPROVED",
				}),
			);
		},
	});
	const hooks = runtime as unknown as {
		hooks: {
			tool: (context: Parameters<FactoryTools["tool"]>[0]) => Promise<unknown>;
		};
	};
	hooks.hooks.tool = async (ctx) => {
		if (ctx.step.tool === "fixture-seed") {
			const base = git(ctx.run.workspace, "rev-parse", "HEAD");
			writeFileSync(join(ctx.run.workspace, "feature.txt"), "Hello from F1\n");
			git(ctx.run.workspace, "add", "feature.txt");
			git(ctx.run.workspace, "commit", "-qm", "Add feature file");
			const head = git(ctx.run.workspace, "rev-parse", "HEAD");
			ctx.run.outputs["draft-pr"] = {
				url: "https://github.com/test/repo/pull/1",
				headSha: head,
				baseSha: base,
			};
			ctx.run.outputs.ci = { headSha: head, baseSha: base, reviewReady: true };
			return { seeded: true };
		}
		return tools.tool(ctx);
	};
	if (!runtime.listWorkflows().some((w) => w.id === "brief-brief"))
		runtime.updateWorkflows(
			[...runtime.listWorkflows(), ...modes.map(workflow)],
			"brief-brief",
		);
	return worker;
}

const worker = makeWorker();
let token = "";
async function api(path: string, body?: unknown) {
	const response = await fetch(`http://localhost:3541${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers: {
			authorization: `Bearer ${token}`,
			origin: "http://localhost:3541",
			"content-type": "application/json",
			"x-factory-request": "1",
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const value = await response.json();
	assert(response.ok, JSON.stringify(value));
	return value;
}
async function until(id: string, predicate: (run: FactoryRun) => boolean) {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		const run = inside(worker).getFactoryRuntime().runs.get(id);
		if (run?.status === "failed") throw new Error(run.error);
		if (run && predicate(run)) return run;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`Timed out ${id}`);
}
const cli = async (...args: string[]) =>
	(
		await execFile(join(process.cwd(), "apps/f1/f1"), args, {
			env: { ...process.env, BOBS_FACTORY_PORT: "3601" },
		})
	).stdout;

try {
	await worker.start();
	token = requestFactoryTerminalSession(home);
	await cli("ping");
	for (const [index, mode] of modes.entries()) {
		await cli(
			"create-issue",
			"--title",
			`Review brief ${mode}`,
			"--description",
			`MODE:${mode}`,
			"--labels",
			`workflow:brief-${mode}`,
		);
		await cli("start-session", "--issue-id", `issue-${index + 1}`);
		const id = `session-${index + 1}`;
		const run = await until(
			id,
			(r) => r.status === "waiting" && r.reviewGate?.status === "pending",
		);
		const guide = run.outputs.guide as Record<string, any>;
		assert.equal(
			run.reviewGate?.headSha,
			git(run.workspace, "rev-parse", "HEAD"),
		);
		assert(guide.reviewFiles, "runtime binds the reviewed file snapshot");
		const published = descriptions.at(-1)!;
		assert.match(published, /Revision: [0-9a-f]{40}/);
		if (mode === "legacy") {
			assert.equal(guide.contract, undefined);
			assert.equal(guide.chapters.length, 1);
			assert.match(published, /### Feature file/);
		} else {
			assert.equal(guide.contract, "brief-v1");
			assert.equal(guide.requirements[0].files[0], "feature.txt");
			assert.match(published, /### Does it do that\?/);
			assert.match(published, /> Ship the feature file with a greeting\./);
			assert.doesNotMatch(published, /\/Users\//);
		}
		if (mode === "brief") {
			// First output carried a local path and left feature.txt unexplained:
			// both problems return in a single correction round.
			assert.equal(counts["brief:guide"], 2);
			const rejection = run.events.find((e) =>
				e.message.startsWith("Output validation rejected guide"),
			)?.message;
			assert.match(rejection ?? "", /Remove local absolute paths/);
			assert.match(rejection ?? "", /unexplained: feature\.txt/);
			assert.equal(counts["brief:ci-fix"], undefined);
			const detail = await api(`/api/runs/${id}`);
			assert.equal(detail.outputs.guide.contract, "brief-v1");
			await api(`/api/runs/${id}/review`, {
				reviewId: run.reviewGate!.id,
				headSha: run.reviewGate!.headSha,
				decision: "approve",
			});
			await until(id, (r) => r.status === "completed");
		}
		if (mode === "gap") {
			assert.equal(counts["gap:guide"], 2);
			assert.equal(counts["gap:ci-fix"], 1);
			assert(
				run.history.some(
					(h) => h.step === "handoff" && (h.output as { fix?: boolean }).fix,
				),
			);
			assert.equal(guide.verdict.readiness, "ready");
		}
		if (mode === "legacy") assert.equal(counts["legacy:guide"], 1);
		const activities = await cli("view-session", "--session-id", id);
		assert(activities.length > 100);
		const final = inside(worker).getFactoryRuntime().runs.get(id)!;
		writeFileSync(join(root, `${mode}.json`), JSON.stringify(final, null, 2));
		receipts[mode] = {
			id,
			status: final.status,
			steps: final.history.map((h) => h.step),
			guideContract:
				(final.outputs.guide as { contract?: string }).contract ?? "chapters",
			decisions: final.humanDecisions?.map((d) => d.decision) ?? [],
		};
	}
	assert.equal(descriptions.length, 3, "one publication per accepted guide");
	assert.equal(unhandled.length, 0);
	receipts.descriptions = descriptions.length;
	console.log("F1_REVIEW_BRIEF_PASS", JSON.stringify(receipts));
} finally {
	await worker.stop();
	process.off("unhandledRejection", onUnhandled);
	writeFileSync(join(root, "receipts.json"), JSON.stringify(receipts, null, 2));
	writeFileSync(
		join(root, "descriptions.md"),
		descriptions.join("\n\n---\n\n"),
	);
	console.log("EVIDENCE_ROOT", root);
}
