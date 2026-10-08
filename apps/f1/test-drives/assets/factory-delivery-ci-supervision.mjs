// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/factory-delivery-ci-supervision.mjs
// Native isolated Git, authenticated Factory API and real FactoryTools; only agent/forge boundaries are scripted.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultWorkflows } from "../../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { FactoryTools } from "../../../../packages/edge-worker/dist/factory/FactoryTools.js";
import { validateWorkflows } from "../../../../packages/edge-worker/dist/factory/Workflow.js";
import { WorkflowRuntime } from "../../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";
import { FactoryServer } from "../../../../packages/edge-worker/test/fixtures/authenticated-factory.ts";

assert.equal(
	process.env.F1_AGENT_MODE,
	"mock",
	"This fixture never invokes a paid runner",
);
const home = mkdtempSync(join(tmpdir(), "f1-delivery-ci-supervision-"));
const seed = join(home, "seed"),
	remote = join(home, "origin.git");
mkdirSync(seed);
const git = (cwd, ...args) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
git(seed, "init", "-q", "-b", "main");
git(seed, "config", "user.name", "F1");
git(seed, "config", "user.email", "f1@example.test");
git(seed, "config", "commit.gpgsign", "false");
writeFileSync(join(seed, "README.md"), "Isolated delivery fixture\n");
mkdirSync(join(seed, ".github", "workflows"), { recursive: true });
writeFileSync(
	join(seed, ".github", "workflows", "title.yml"),
	"name: Title\non: [pull_request]\njobs:\n  title:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Read current title\n        run: gh pr view --json title\n",
);
git(seed, "add", ".");
git(seed, "commit", "-qm", "chore: fixture");
git(home, "init", "--bare", "-q", remote);
git(seed, "remote", "add", "origin", remote);
git(seed, "push", "-q", "-u", "origin", "main");
const originalBase = git(seed, "rev-parse", "HEAD");
const prs = new Map(),
	byNumber = new Map(),
	records = [],
	visits = [],
	commands = [];
let number = 0,
	firstGuideRelease,
	changedBase,
	runtime,
	server;
const flag = (args, name) => args[args.indexOf(name) + 1];
const prFor = (ctx) =>
	prs.get(git(ctx.run.workspace, "branch", "--show-current"));
const headFor = (pr) => git(seed, "rev-parse", `refs/heads/${pr.branch}`);
const baseFor = () => git(seed, "rev-parse", "refs/heads/main");
const newPr = (branch, scenario, title = "Bad title") => {
	const pr = {
		number: ++number,
		branch,
		scenario,
		title,
		attempt: 1,
		retries: 0,
		checks:
			scenario === "pending"
				? "pending"
				: [
							"infra",
							"exhausted",
							"ambiguous",
							"metadata",
							"code",
							"mixed",
						].includes(scenario)
					? "failed"
					: "passed",
	};
	pr.url = `https://github.com/f1/fixture/pull/${pr.number}`;
	prs.set(branch, pr);
	byNumber.set(pr.number, pr);
	return pr;
};
const command = async (ctx, exe, args) => {
	commands.push({ run: ctx.run.input, exe, args });
	if (exe === "git") return git(ctx.run.workspace, ...args);
	assert.equal(exe, "gh", "Only the external GitHub CLI boundary is scripted");
	if (args[0] === "pr") {
		if (args[1] === "list") {
			const pr = prs.get(flag(args, "--head"));
			return JSON.stringify(pr ? [{ url: pr.url, isDraft: true }] : []);
		}
		if (args[1] === "create")
			return newPr(flag(args, "--head"), "delivery", flag(args, "--title")).url;
		const pr = byNumber.get(
			Number(new URL(args[2]).pathname.split("/").at(-1)),
		);
		assert.ok(pr, `Unknown fixture PR ${args[2]}`);
		if (args[1] === "view")
			return JSON.stringify({
				state: "OPEN",
				isDraft: true,
				headRefOid: headFor(pr),
			});
		if (args[1] === "edit" && args.includes("--title")) {
			pr.title = flag(args, "--title");
			return "";
		}
		if (args[1] === "edit" && args.includes("--body")) {
			pr.guidePublished = true;
			// The scripted external forge advances the base after the first handoff.
			// This is a concurrent repository event, not a factory approval or merge.
			if (ctx.run.input === "first" && !changedBase) {
				writeFileSync(join(seed, "external.txt"), "External base change\n");
				git(seed, "add", ".");
				git(seed, "commit", "-qm", "feat: external base change");
				git(seed, "push", "-q", "origin", "main");
				changedBase = baseFor();
			}
			return "";
		}
		throw new Error(`Unscripted fixture provider mutation ${args.join(" ")}`);
	}
	if (args[1] === "graphql") {
		const numberArg = args.find((arg) => /^number=\d+$/.test(arg));
		const selected = byNumber.get(Number(numberArg?.split("=")[1]));
		assert.ok(selected, "Readiness must address a concrete PR");
		const head = headFor(selected),
			base = baseFor();
		let behind = false;
		try {
			git(seed, "merge-base", "--is-ancestor", base, head);
		} catch {
			behind = true;
		}
		const check = {
			name: "fixture-check",
			status: selected.checks === "pending" ? "IN_PROGRESS" : "COMPLETED",
			conclusion:
				selected.checks === "pending"
					? null
					: selected.checks === "passed"
						? "SUCCESS"
						: ["infra", "exhausted", "ambiguous", "mixed"].includes(
									selected.scenario,
								)
							? "STARTUP_FAILURE"
							: "FAILURE",
			...(selected.scenario === "mixed"
				? {}
				: { databaseId: 500 + selected.number * 10 + selected.attempt }),
			detailsUrl: `https://github.com/f1/fixture/actions/runs/${selected.number}/job/${500 + selected.number * 10 + selected.attempt}`,
		};
		return JSON.stringify({
			data: {
				repository: {
					squashMergeAllowed: true,
					pullRequest: {
						url: selected.url,
						title: selected.title,
						headRefOid: head,
						baseRefOid: base,
						state: "OPEN",
						isDraft: true,
						mergeable:
							selected.scenario === "mixed" && !selected.conflictResolved
								? "CONFLICTING"
								: "MERGEABLE",
						mergeStateStatus:
							selected.scenario === "mixed" && !selected.conflictResolved
								? "DIRTY"
								: behind
									? "BEHIND"
									: "BLOCKED",
						reviewDecision: "REVIEW_REQUIRED",
						reviewThreads: { nodes: [], pageInfo: {} },
						comments: { nodes: [], pageInfo: {} },
						reviews: { nodes: [], pageInfo: {} },
						statusCheckRollup: { contexts: { nodes: [check], pageInfo: {} } },
					},
				},
			},
		});
	}
	const path = args[1];
	if (path?.includes("/check-runs/")) {
		const pr = prFor(ctx);
		return JSON.stringify({
			id: Number(path.split("/").at(-1)),
			head_sha: headFor(pr),
			output: {
				summary:
					pr.scenario === "metadata"
						? "Pull request title must follow the required format"
						: pr.scenario === "code"
							? "Assertion failed: checkout must reject unauthorized users"
							: "The job was not acquired by Runner of type hosted even after multiple attempts",
			},
		});
	}
	if (path?.includes("/actions/runs/")) {
		const pr = byNumber.get(Number(path.split("/")[5]));
		assert.ok(pr, `Unknown fixture workflow run ${path}`);
		if (path.endsWith("/rerun-failed-jobs")) {
			assert.equal(flag(args, "--method"), "POST");
			pr.retries++;
			if (pr.scenario === "ambiguous")
				throw new Error("Connection reset after accepted retry request");
			pr.attempt++;
			if (pr.scenario === "infra") {
				pr.status = "in_progress";
				setTimeout(() => {
					pr.status = "completed";
					pr.checks = "passed";
				}, 15000);
			} else if (pr.scenario !== "exhausted") pr.checks = "passed";
			return "";
		}
		return JSON.stringify({
			id: pr.number,
			head_sha: headFor(pr),
			run_attempt: pr.attempt,
			status: pr.status ?? "completed",
			path: ".github/workflows/title.yml",
		});
	}
	if (
		args.includes("--paginate") &&
		args.some((arg) => arg.endsWith("/comments"))
	)
		return "[[]]";
	throw new Error(`Unscripted fixture provider read ${args.join(" ")}`);
};
const tools = new FactoryTools({ postComment: async () => {}, command });
const deliveryWorkflow = {
	id: "f1-delivery",
	name: "F1 delivery",
	allowedTriggers: ["manual"],
	steps: [
		{
			id: "implement",
			name: "Implement",
			type: "agent",
			prompt: "Scripted implementation",
		},
		{ id: "draft-pr", name: "Publish", type: "tool", tool: "draft-pr" },
		{
			id: "code-review",
			name: "Review",
			type: "agent",
			prompt: "Scripted reviewer",
		},
		{ id: "review-gate", name: "Gate", type: "tool", tool: "review-gate" },
		{
			id: "ci",
			name: "Provider readiness",
			type: "tool",
			tool: "ci",
			next: "capture",
			branches: [{ when: { path: "fix", equals: true }, next: "ci-fix" }],
		},
		{
			id: "ci-fix",
			name: "Integrate",
			type: "agent",
			prompt: "Scripted integration",
			next: "review-after-fix",
		},
		{
			id: "review-after-fix",
			name: "Revalidate",
			type: "tool",
			tool: "review-after-fix",
			next: "ci",
			branches: [
				{ when: { path: "reviewRequired", equals: true }, next: "code-review" },
			],
		},
		{
			id: "capture",
			name: "Mock capture receipt",
			type: "agent",
			prompt: "No actual UI screenshots are claimed",
		},
		{
			id: "guide",
			name: "Mock guide receipt",
			type: "agent",
			prompt: "Scripted guide",
			next: "handoff",
		},
		{
			id: "handoff",
			name: "Publish actual guide",
			type: "tool",
			tool: "handoff",
			next: "end",
			branches: [{ when: { path: "fix", equals: true }, next: "ci-fix" }],
		},
	],
};
const ciWorkflow = {
	id: "f1-ci",
	name: "F1 CI",
	allowedTriggers: ["manual"],
	steps: [
		{
			id: "ci",
			name: "Provider readiness",
			type: "tool",
			tool: "ci",
			next: "end",
			branches: [{ when: { path: "fix", equals: true }, next: "ci-fix" }],
		},
		{
			id: "ci-fix",
			name: "Diagnose",
			type: "agent",
			prompt: "Scripted diagnosis",
			next: "ci",
		},
	],
};
const workflows = validateWorkflows([
	...defaultWorkflows,
	deliveryWorkflow,
	ciWorkflow,
]);
const hooks = {
	agent: async (ctx) => {
		visits.push({
			run: ctx.run.input,
			step: ctx.step.id,
			head: git(ctx.run.workspace, "rev-parse", "HEAD"),
			base: baseFor(),
		});
		const name = ctx.run.input;
		if (ctx.step.id === "implement") {
			writeFileSync(join(ctx.run.workspace, `${name}.txt`), `${name}\n`);
			git(ctx.run.workspace, "add", ".");
			git(ctx.run.workspace, "commit", "-qm", `feat: ${name}`);
			return {
				status: "completed",
				summary: "Isolated scripted source change",
			};
		}
		if (ctx.step.id === "code-review") {
			ctx.run.roleRevisions ??= {};
			ctx.run.roleRevisions[ctx.stepKey] = {
				headSha: git(ctx.run.workspace, "rev-parse", "HEAD"),
				dirty: false,
				at: new Date().toISOString(),
				historyLength: ctx.run.history.length,
			};
			return {
				status: "completed",
				blockers: [],
				findings: [],
				summary: "Scripted reviewer completed",
			};
		}
		if (ctx.step.id === "ci-fix") {
			const pr = prFor(ctx);
			assert.match(ctx.step.prompt, /Do not create an empty commit solely/);
			if (pr.scenario === "metadata") {
				await command(ctx, "gh", [
					"pr",
					"edit",
					pr.url,
					"--title",
					"feat: valid title",
				]);
			} else if (pr.scenario === "code") {
				// A concrete diagnosis is returned after the external fixture reports a resolved test environment.
				pr.checks = "passed";
			} else if (pr.scenario === "mixed") {
				writeFileSync(
					join(ctx.run.workspace, "mixed-source-correction.txt"),
					"Actual isolated source correction\n",
				);
				git(ctx.run.workspace, "add", ".");
				git(
					ctx.run.workspace,
					"commit",
					"-qm",
					"fix: actionable source correction",
				);
				git(ctx.run.workspace, "push", "-q", "origin", "HEAD");
				pr.conflictResolved = true;
			} else {
				git(ctx.run.workspace, "fetch", "-q", "origin", "main");
				git(ctx.run.workspace, "merge", "--no-edit", "origin/main");
				git(ctx.run.workspace, "push", "-q", "origin", "HEAD");
			}
			return {
				status: "completed",
				summary: "Scripted bounded correction returned to runtime",
			};
		}
		if (ctx.step.id === "guide" && name === "first")
			await new Promise((resolve, reject) => {
				firstGuideRelease = resolve;
				ctx.signal.addEventListener(
					"abort",
					() => reject(new Error("Fixture shutdown")),
					{ once: true },
				);
			});
		if (ctx.step.id === "guide")
			return {
				goal: "Isolated delivery orchestration",
				summary:
					"Scripted reviewer/capture/guide receipts validate orchestration only.",
				decision: {
					status: "ready",
					summary:
						"Custom fixture ready for inspection; production approval is still required.",
				},
				behavior: [],
				requirements: [],
				checks: ["Actual native Git and provider readiness gates exercised"],
				risks: ["No real model review or screenshots in this fixture"],
				reviewInstructions: [
					"Inspect the fixture evidence; this does not authorize a production merge.",
				],
			};
		return {
			status: "completed",
			summary: "Scripted role receipt; no real model or screenshot evidence",
		};
	},
	script: (ctx) => tools.script(ctx),
	tool: (ctx) => tools.tool(ctx),
};
const boot = () => {
	runtime = new WorkflowRuntime(join(home, "factory"), hooks);
	runtime.updateWorkflows(workflows);
	server = new FactoryServer(runtime, {
		repositories: () => [{ id: "fixture", name: "Isolated fixture" }],
		sessions: () => [],
		entries: () => [],
		stop: (id) => runtime.stop(id),
		start: async (input) => {
			const workflow = runtime.selectWorkflow([], "manual", input.workflow),
				name = input.prompt;
			const branch = `f1-${name}-${number + 1}`,
				workspace = join(home, branch);
			git(seed, "worktree", "add", "-qb", branch, workspace, "main");
			const run = runtime.create({
				title: name,
				repositoryId: input.repositoryId,
				workflow,
				workspace,
				input: name,
				triggerOrigin: {
					type: "manual",
					workflowId: workflow.id,
					at: new Date().toISOString(),
				},
			});
			run.outputs.repository = {
				githubUrl: "https://github.com/f1/fixture",
				baseBranch: "main",
			};
			if (workflow.id === "f1-ci") {
				git(workspace, "push", "-q", "origin", "HEAD");
				const pr = newPr(branch, name);
				run.outputs["draft-pr"] = { url: pr.url };
			}
			void runtime.launch(run);
			return run;
		},
	});
};
const api = async (method, url, payload) => {
	const response = await server.app.inject({
		method,
		url,
		payload,
		headers: { "x-factory-request": "1" },
	});
	assert.ok(
		response.statusCode < 300,
		`${method} ${url}: ${response.statusCode} ${response.body}`,
	);
	return response.json();
};
const start = (prompt, workflow = "f1-ci") =>
	api("POST", "/api/runs", { repositoryId: "fixture", workflow, prompt });
const get = (run) => api("GET", `/api/runs/${run.id}`);
const until = async (run, check, timeout = 40000) => {
	const deadline = Date.now() + timeout;
	for (;;) {
		const state = await get(run);
		assert.notEqual(state.status, "failed", state.error);
		if (check(state)) return state;
		assert.ok(
			Date.now() < deadline,
			`Timed out: ${run.id} ${state.step} ${state.status}`,
		);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
};
const answer = async (run) => {
	const state = await get(run);
	return api("POST", `/api/runs/${run.id}/answer`, {
		answer:
			"Fixture provider restored; recheck actual current receipts without waiving checks.",
		context: {
			step: state.step,
			questions: state.questions,
			questionBatchId: state.questionBatchId,
		},
	});
};
const restart = async () => {
	await runtime.shutdown();
	await server.stop();
	boot();
	runtime.resumeAll();
};
const count = (name, step) =>
	visits.filter((visit) => visit.run === name && visit.step === step).length;
const snapshot = async (scenario, run) => {
	const state = await get(run);
	records.push({
		scenario,
		runId: run.id,
		status: state.status,
		step: state.step,
		outputs: state.outputs,
		coordination: state.deliveryCoordination,
		ciSupervision: state.ciSupervision,
		roleVisits: visits.filter((visit) => visit.run === state.input),
		attempts: (await api("GET", `/api/runs/${run.id}/provenance`)).attempts,
	});
};

boot();
try {
	console.log(
		"Delivery: parallel implementation and one finalization per current base",
	);
	const first = await start("first", "f1-delivery");
	await until(first, (state) => state.step === "guide" && firstGuideRelease);
	const second = await start("second", "f1-delivery");
	await until(
		second,
		(state) => state.deliveryCoordination?.phase === "queued",
	);
	assert.equal(count("second", "implement"), 1);
	assert.equal(count("second", "capture"), 0);
	assert.equal(count("second", "guide"), 0);
	firstGuideRelease();
	await until(first, (state) => state.status === "completed");
	assert.notEqual(changedBase, originalBase);
	const secondDone = await until(
		second,
		(state) => state.status === "completed",
	);
	assert.equal(count("first", "capture"), 1);
	assert.equal(count("first", "guide"), 1);
	assert.equal(count("second", "capture"), 1);
	assert.equal(count("second", "guide"), 1);
	assert.equal(count("second", "ci-fix"), 1);
	assert.equal(
		count("second", "code-review"),
		2,
		"Consequential base integration still requires review",
	);
	assert.equal(secondDone.outputs["review-after-fix"].reviewRequired, true);
	assert.equal(secondDone.outputs["review-after-fix"].baseSha, changedBase);
	assert.equal(
		visits.find((visit) => visit.run === "second" && visit.step === "capture")
			.base,
		changedBase,
	);
	await snapshot("overlapping current-base delivery", first);
	await snapshot("overlapping current-base delivery", second);

	console.log("CI: provider-proven infrastructure retries outside agents");
	const infra = await start("infra");
	await until(infra, (state) =>
		state.outputs["merge-readiness"]?.checks.some(
			(check) => check.retry?.status === "in_progress",
		),
	);
	assert.equal(count("infra", "ci-fix"), 0);
	await snapshot("running retry retains previous failed checks", infra);
	await until(infra, (state) => state.status === "completed");
	assert.equal(count("infra", "ci-fix"), 0);
	assert.equal(prFor({ run: runtime.get(infra.id) }).retries, 1);
	await snapshot("infrastructure retry", infra);

	console.log("CI: unknown code failure is diagnosed");
	const code = await start("code");
	await until(code, (state) => state.status === "completed");
	assert.equal(count("code", "ci-fix"), 1);
	assert.equal(prFor({ run: runtime.get(code.id) }).retries, 0);
	await snapshot("unknown code diagnosis", code);

	console.log(
		"CI: actionable source correction precedes separate infrastructure assistance",
	);
	const mixed = await start("mixed");
	const mixedWait = await until(
		mixed,
		(state) => state.status === "waiting" && state.questions.length > 0,
	);
	assert.equal(count("mixed", "ci-fix"), 1);
	assert.equal(prFor({ run: runtime.get(mixed.id) }).retries, 0);
	assert.notEqual(
		git(mixed.workspace, "rev-parse", "HEAD"),
		visits.find((visit) => visit.run === "mixed" && visit.step === "ci-fix")
			.head,
	);
	assert.equal(mixedWait.outputs["merge-readiness"].approved, false);
	assert.equal(mixedWait.outputs["merge-readiness"].checks[0].bucket, "fail");
	await snapshot("source corrected while CI remains blocking", mixed);
	prFor({ run: runtime.get(mixed.id) }).checks = "passed";
	await answer(mixed);
	await until(mixed, (state) => state.status === "completed");

	console.log("CI: metadata correction rechecks unchanged SHA");
	const metadata = await start("metadata"),
		metadataHead = git(metadata.workspace, "rev-parse", "HEAD");
	await until(metadata, (state) => state.status === "completed");
	assert.equal(count("metadata", "ci-fix"), 1);
	assert.equal(prFor({ run: runtime.get(metadata.id) }).retries, 1);
	assert.equal(git(metadata.workspace, "rev-parse", "HEAD"), metadataHead);
	assert.equal(
		commands.filter(
			(call) =>
				call.run === "metadata" &&
				call.exe === "git" &&
				["commit", "push"].includes(call.args[0]),
		).length,
		0,
	);
	await snapshot("metadata recheck unchanged SHA", metadata);

	console.log("CI: bounded exhaustion and restart deduplication");
	const exhausted = await start("exhausted");
	await until(
		exhausted,
		(state) => state.status === "waiting" && state.questions.length > 0,
	);
	assert.equal(prFor({ run: runtime.get(exhausted.id) }).retries, 2);
	assert.equal(count("exhausted", "ci-fix"), 0);
	await snapshot("exhausted before restart", exhausted);
	await restart();
	await until(exhausted, (state) => state.status === "waiting");
	assert.equal(prFor({ run: runtime.get(exhausted.id) }).retries, 2);
	await snapshot("exhausted restored without duplicate", exhausted);
	prFor({ run: runtime.get(exhausted.id) }).checks = "passed";
	await answer(exhausted);
	await until(exhausted, (state) => state.status === "completed");

	console.log(
		"CI: uncertain side effect is never blindly resent across restart",
	);
	const ambiguous = await start("ambiguous");
	await until(ambiguous, (state) => state.status === "waiting");
	assert.equal(prFor({ run: runtime.get(ambiguous.id) }).retries, 1);
	await snapshot("uncertain retry persisted", ambiguous);
	await restart();
	await until(ambiguous, (state) => state.status === "waiting");
	await answer(ambiguous);
	await until(
		ambiguous,
		(state) => state.status === "waiting" && state.answers.length === 1,
	);
	assert.equal(prFor({ run: runtime.get(ambiguous.id) }).retries, 1);
	assert.equal(count("ambiguous", "ci-fix"), 0);
	await snapshot("uncertain retry restored without duplicate", ambiguous);
	prFor({ run: runtime.get(ambiguous.id) }).checks = "passed";
	await answer(ambiguous);
	await until(ambiguous, (state) => state.status === "completed");

	console.log(
		"CI: pending provider wait releases agent capacity and cancellation finishes",
	);
	const pending = await start("pending");
	await until(
		pending,
		(state) => state.capacityLeaves?.ci?.phase === "waiting-ci",
	);
	assert.equal(count("pending", "ci-fix"), 0);
	assert.ok(
		Object.values((await get(pending)).capacityLeaves).every(
			(leaf) => leaf.phase === "waiting-ci" && !leaf.request,
		),
	);
	await snapshot("pending without agent lease", pending);
	await api("POST", `/api/runs/${pending.id}/stop`);
	assert.equal((await get(pending)).status, "stopped");

	const evidence = {
		mode: "mock",
		home,
		originalBase,
		testedCommit: git(process.cwd(), "rev-parse", "HEAD"),
		dirtyWorktree: Boolean(git(process.cwd(), "status", "--porcelain")),
		limitations: [
			"Custom deterministic workflows; capture/guide/reviewer outputs are scripted",
			"GitHub CLI external boundary is scripted; no real forge mutation, tracker notification, UI screenshot or paid model call",
			"Delivery fixture ends after real handoff publication; production human approval and merge are protected by targeted public-runtime/provider tests",
		],
		records,
		visits,
		providerCalls: commands.filter((call) => call.exe === "gh"),
		nativeGitCalls: commands.filter((call) => call.exe === "git"),
	};
	const destination = process.env.F1_EVIDENCE_DIR ?? home;
	mkdirSync(destination, { recursive: true });
	const artifact = join(destination, "factory-delivery-ci-supervision.json");
	writeFileSync(artifact, `${JSON.stringify(evidence, null, 2)}\n`);
	console.log(
		JSON.stringify({
			result: "passed",
			home,
			artifact,
			roleVisits: visits.length,
			scenarios: records.length,
			paidCalls: 0,
		}),
	);
} finally {
	await runtime.shutdown();
	await server.stop();
}
