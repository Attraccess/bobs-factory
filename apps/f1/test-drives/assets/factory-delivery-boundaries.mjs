// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/factory-delivery-boundaries.mjs
// Controlled comparison against the committed pre-change runtime. No live provider/runner calls.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultWorkflows } from "../../../../packages/edge-worker/src/factory/defaultWorkflows.ts";
import { FactoryTools } from "../../../../packages/edge-worker/src/factory/FactoryTools.ts";
import { TicketTracking } from "../../../../packages/edge-worker/src/factory/TicketTracking.ts";
import { validateWorkflows } from "../../../../packages/edge-worker/src/factory/Workflow.ts";
import { WorkflowRuntime } from "../../../../packages/edge-worker/src/factory/WorkflowRuntime.ts";
import { FactoryServer } from "../../../../packages/edge-worker/test/fixtures/authenticated-factory.ts";
import {
	githubApiReceipt,
	githubRequest,
} from "../../../../packages/edge-worker/test/fixtures/github-api.ts";
import { providerReceipt } from "../../../../packages/edge-worker/test/fixtures/merge-readiness.ts";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const repoRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../..",
);
const home = mkdtempSync(join(tmpdir(), "f1-delivery-boundaries-"));
process.stdout.write(`Fixture artifacts: ${home}\n`);
const baseline = process.env.F1_BASELINE_COMMIT ?? "be36eb34";
const baselineDir = join(home, "baseline");
mkdirSync(baselineDir);
symlinkSync(
	join(repoRoot, "packages/edge-worker/node_modules"),
	join(baselineDir, "node_modules"),
	"dir",
);
for (const name of ["WorkflowRuntime", "DeliveryCoordination"]) {
	const source = execFileSync(
		"git",
		["show", `${baseline}:packages/edge-worker/src/factory/${name}.ts`],
		{ cwd: repoRoot, encoding: "utf8" },
	);
	const rewritten = source.replace(/from "(\.[^"]+)"/g, (_match, path) => {
		const target =
			path === "./DeliveryCoordination.js"
				? join(baselineDir, "DeliveryCoordination.ts")
				: resolve(repoRoot, "packages/edge-worker/src/factory", path);
		return `from ${JSON.stringify(target)}`;
	});
	writeFileSync(join(baselineDir, `${name}.ts`), rewritten);
}
const { WorkflowRuntime: BaselineRuntime } = await import(
	join(baselineDir, "WorkflowRuntime.ts")
);
const pause = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (check) => {
	for (let attempt = 0; attempt < 500; attempt++) {
		if (check()) return;
		await pause();
	}
	throw new Error("Fixture condition timed out");
};
const git = (cwd, ...args) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
const workflow = validateWorkflows([
	...defaultWorkflows,
	{
		id: "boundary-fixture",
		name: "Delivery boundaries fixture",
		steps: [
			{
				id: "implement",
				name: "Implement",
				type: "agent",
				prompt: "Mock implementation",
			},
			{ id: "draft-pr", name: "Publish", type: "tool", tool: "draft-pr" },
			{
				id: "code-review",
				name: "Review",
				type: "agent",
				prompt: "Mock review",
			},
			{
				id: "ci",
				name: "CI",
				type: "tool",
				tool: "ci",
				branches: [{ when: { path: "fix", equals: true }, next: "ci-fix" }],
				next: "capture",
			},
			{
				id: "ci-fix",
				name: "Correction",
				type: "agent",
				prompt: "Mock correction",
				next: "after-ci-fix",
			},
			{
				id: "after-ci-fix",
				name: "Revalidate",
				type: "tool",
				tool: "review-after-fix",
				branches: [
					{
						when: { path: "reviewRequired", equals: true },
						next: "code-review",
					},
				],
				next: "ci",
			},
			{
				id: "capture",
				name: "Independent QA",
				type: "agent",
				prompt: "Mock independent QA",
			},
			{ id: "guide", name: "Guide", type: "agent", prompt: "Mock guide" },
			{
				id: "human-review",
				name: "Explicit approval",
				type: "tool",
				tool: "human-review",
				next: "merge",
			},
			{ id: "merge", name: "Merge", type: "tool", tool: "merge", next: "end" },
		],
	},
]).at(-1);

async function compare(Runtime, label) {
	const directory = join(home, label),
		seed = join(directory, "seed"),
		remote = join(directory, "origin.git");
	mkdirSync(seed, { recursive: true });
	git(seed, "init", "-qb", "main");
	git(seed, "config", "user.name", "F1");
	git(seed, "config", "user.email", "f1@example.test");
	git(seed, "config", "commit.gpgsign", "false");
	writeFileSync(join(seed, "base"), "Base\n");
	git(seed, "add", ".");
	git(seed, "commit", "-qm", "chore: base");
	git(directory, "init", "--bare", "-q", remote);
	git(seed, "remote", "add", "origin", remote);
	git(seed, "push", "-qu", "origin", "main");
	const visits = [],
		publications = [],
		tickets = new Map(),
		prs = new Map();
	let runtime,
		tracking,
		delayed = true,
		releaseTracking;
	const trackingWait = new Promise((resolve) => {
		releaseTracking = resolve;
	});
	let movingBase = git(seed, "rev-parse", "HEAD");
	const tools = new FactoryTools({
		postComment: async () => {},
		command: async (context, exe, args) => {
			if (exe === "git") return git(context.run.workspace, ...args);
			const request = githubRequest(args),
				pr = prs.get(context.run.id);
			if (request.path === "graphql")
				return JSON.stringify(
					providerReceipt({
						headRefOid: pr.head,
						baseRefOid: movingBase,
						url: pr.url,
					}),
				);
			if (request.path.includes("/pulls?") && request.method === "GET")
				return pr
					? JSON.stringify([
							{
								html_url: pr.url,
								draft: true,
								state: "open",
								head: { ref: pr.branch },
								base: { ref: "main" },
							},
						])
					: "[]";
			if (
				request.path === "repos/test/repo/pulls" &&
				request.method === "POST"
			) {
				const created = {
					url: `https://github.com/test/repo/pull/${prs.size + 1}`,
					head: git(context.run.workspace, "rev-parse", "HEAD"),
					branch: request.body.head,
				};
				prs.set(context.run.id, created);
				publications.push(context.run.input);
				return JSON.stringify({
					html_url: created.url,
					number: prs.size,
					title: request.body.title,
					draft: true,
					state: "open",
					head: {
						ref: created.branch,
						sha: created.head,
						repo: { full_name: "test/repo" },
					},
					base: {
						ref: "main",
						sha: movingBase,
						repo: { full_name: "test/repo" },
					},
				});
			}
			return JSON.stringify(
				githubApiReceipt(args, {
					headRefOid: pr?.head,
					baseRefOid: movingBase,
				}),
			);
		},
	});
	const hooks = {
		track: (run, milestone) => tracking.record(run, milestone),
		agent: async (context) => {
			visits.push(`${context.run.input}:${context.step.id}`);
			if (context.step.id === "implement")
				writeFileSync(
					join(context.run.workspace, "feature"),
					context.run.input,
				);
			return {};
		},
		script: async () => ({}),
		tool: async (context) => {
			if (context.step.tool === "human-review")
				return {
					url: prs.get(context.run.id).url,
					headSha: prs.get(context.run.id).head,
				};
			return tools.tool(context);
		},
	};
	runtime = new Runtime(directory, hooks);
	tracking = new TicketTracking(
		async (run) => {
			if (
				run.input === "first" &&
				delayed &&
				run.ticketSync.receipts.some((receipt) => receipt.pr)
			)
				await trackingWait;
			const ticket = tickets.get(run.id);
			return {
				read: async () => ticket,
				stage: async (stage) => {
					ticket.status = stage;
				},
				comment: async (body) => {
					ticket.comments.push({ body });
				},
				link: async (url) => {
					ticket.attachments.push({ url });
				},
			};
		},
		(run) => runtime.save(run),
		(run, message) => runtime.log(run, "ticket-sync", message),
	);
	runtime.updateWorkflows([...defaultWorkflows, workflow]);
	const server = new FactoryServer(runtime, {
		repositories: () => [{ id: "repo", name: "Fixture" }],
		sessions: () => [],
		entries: () => [],
		stop: (id) => runtime.stop(id),
		start: async (input) => {
			const branch = `feature-${input.prompt}`,
				workspace = join(directory, branch);
			git(seed, "worktree", "add", "-qb", branch, workspace, "main");
			const run = runtime.create({
				repositoryId: "repo",
				workflow,
				workspace,
				input: input.prompt,
				triggerOrigin: { type: "manual", workflowId: workflow.id, at: "" },
			});
			run.outputs.repository = {
				githubUrl: "https://github.com/test/repo",
				baseBranch: "main",
			};
			run.outputs["visual-scope"] = { environment: { isolation: "worktree" } };
			run.ticketReference = {
				provider: "taskbot",
				server: "fixture",
				instance: "https://fixture.test",
				project: "fixture",
				id: tickets.size + 1,
				url: `https://fixture.test/p/fixture/t/${tickets.size + 1}`,
			};
			tickets.set(run.id, { status: "todo", comments: [], attachments: [] });
			void runtime.launch(run);
			return run;
		},
	});
	const api = async (method, url, payload) => {
		const response = await server.app.inject({
			method,
			url,
			payload,
			headers: { "x-factory-request": "1" },
		});
		assert.ok(response.statusCode < 300, response.body);
		return response.json();
	};
	const first = await api("POST", "/api/runs", {
		repositoryId: "repo",
		workflow: workflow.id,
		prompt: "first",
	});
	await until(() =>
		runtime.get(first.id).ticketSync?.receipts.some((receipt) => receipt.pr),
	);
	const second = await api("POST", "/api/runs", {
		repositoryId: "repo",
		workflow: workflow.id,
		prompt: "second",
	});
	try {
		await until(() =>
			label === "before"
				? runtime.get(second.id).deliveryCoordination?.phase === "queued"
				: runtime.get(second.id).status === "waiting",
		);
		const firstView = await api("GET", `/api/runs/${first.id}`),
			secondView = await api("GET", `/api/runs/${second.id}`);
		const result = {
			label,
			publications: [...publications],
			secondQaInvocations: visits.filter((visit) => visit === "second:capture")
				.length,
			firstTrackingPending: firstView.ticketSync.receipts.some(
				(receipt) => receipt.pr && !receipt.delivered,
			),
			secondStatus: secondView.status,
			secondDelivery: secondView.deliveryCoordination?.phase,
		};
		assert.equal(result.secondQaInvocations, label === "before" ? 0 : 1);
		assert.equal(result.firstTrackingPending, true);
		if (label === "after") {
			assert.equal(secondView.reviewGate.status, "pending");
			assert.equal(secondView.humanDecisions, undefined);
		}
		// A moving base remains a real evidence invalidation, even with green checks.
		writeFileSync(
			join(seed, "external"),
			"Consequential external base change\n",
		);
		git(seed, "add", ".");
		git(seed, "commit", "-qm", "feat: external base change");
		git(seed, "push", "-q", "origin", "main");
		movingBase = git(seed, "rev-parse", "HEAD");
		const run = runtime.get(second.id),
			pr = prs.get(second.id);
		if (pr) {
			run.roleRevisions = {
				"code-review": {
					headSha: pr.head,
					dirty: false,
					at: "",
					historyLength: 0,
				},
			};
			run.outputs["review-gate"] = { approved: true };
			const assessment = await tools.tool({
				run,
				step: {
					id: "after-ci-fix",
					type: "tool",
					name: "Revalidate",
					tool: "review-after-fix",
					branches: [],
					maxVisits: 8,
				},
				input: {},
				signal: new AbortController().signal,
				evidenceDir: directory,
				log: () => {},
			});
			assert.equal(assessment.reviewRequired, true);
			assert.equal(assessment.invalidation.kind, "base-change");
			result.movingBaseRevalidated = true;
		}
		return result;
	} finally {
		delayed = false;
		releaseTracking();
		await tracking.flush(runtime.get(first.id));
		await until(() => runtime.get(first.id).status === "waiting");
		for (const run of runtime.runs.values()) runtime.stop(run.id);
		await runtime.shutdown();
		tracking.stop();
		await server.app.close();
		// Restart outbox reconciliation cannot repeat tracker side effects or PR publication.
		const restored = new Runtime(directory, hooks),
			retained = restored.get(first.id);
		const effects = JSON.stringify(tickets.get(first.id));
		await tracking.flush(retained);
		assert.equal(JSON.stringify(tickets.get(first.id)), effects);
		assert.equal(publications.filter((name) => name === "first").length, 1);
		await restored.shutdown();
	}
}

const results = [
	await compare(BaselineRuntime, "before"),
	await compare(WorkflowRuntime, "after"),
];
writeFileSync(
	join(home, "results.json"),
	JSON.stringify({ baseline, results }, null, 2),
);
process.stdout.write(
	`${JSON.stringify({ home, baseline, results }, null, 2)}\n`,
);
