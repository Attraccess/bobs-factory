import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { githubApiReceipt, githubRequest } from "./fixtures/github-api.js";
import { providerReceipt } from "./fixtures/merge-readiness.js";

const homes: string[] = [];
afterEach(() => {
	vi.useRealTimers();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
const delivery = validateWorkflows([
	...defaultWorkflows,
	{
		id: "delivery",
		name: "Delivery",
		steps: [
			{
				id: "implement",
				name: "Implement",
				type: "agent",
				prompt: "Implement",
			},
			{ id: "draft-pr", name: "Integrate", type: "tool", tool: "draft-pr" },
			{ id: "capture", name: "Capture", type: "agent", prompt: "Capture" },
			{ id: "guide", name: "Guide", type: "agent", prompt: "Guide" },
			{ id: "merge", name: "Merge", type: "tool", tool: "merge", next: "end" },
		],
	},
]).at(-1)!;
function home() {
	const value = mkdtempSync(join(tmpdir(), "delivery-coordination-"));
	homes.push(value);
	return value;
}
function createRun(
	runtime: WorkflowRuntime,
	title: string,
	branch = "main",
	repositoryId = "repo",
) {
	const run = runtime.create({
		title,
		repositoryId,
		workflow: delivery,
		workspace: "/tmp",
		input: title,
		triggerOrigin: {
			type: "manual",
			workflowId: delivery.id,
			at: new Date().toISOString(),
		},
	});
	run.outputs.repository = {
		githubUrl: "https://github.com/test/repo",
		baseBranch: branch,
	};
	return run;
}

it("allows an overlapping delivery to review and finish while another prepares its guide", async () => {
	let release!: () => void;
	const firstGuide = new Promise<void>((resolve) => {
		release = resolve;
	});
	const roles: string[] = [];
	let base = "base-1";
	const observedBases: Record<string, string[]> = {};
	const runtime = new WorkflowRuntime(home(), {
		agent: async ({ run, step }) => {
			roles.push(`${run.input}:${step.id}`);
			if (run.input === "first" && step.id === "guide") await firstGuide;
			return {};
		},
		script: async () => ({}),
		tool: async ({ run, step }) => {
			if (step.tool === "draft-pr") {
				observedBases[run.input] ??= [];
				observedBases[run.input]!.push(base);
				return { url: "https://github.com/test/repo/pull/1" };
			}
			if (step.tool === "merge") {
				base = "base-2";
				return { merged: true };
			}
			return {};
		},
	});
	const first = createRun(runtime, "first"),
		second = createRun(runtime, "second", "main", "alias-repo-id");
	const a = runtime.launch(first);
	await vi.waitFor(() => expect(roles).toContain("first:guide"));
	const b = runtime.launch(second);
	await vi.waitFor(() => expect(roles).toContain("second:implement"));
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(roles).toContain("second:capture");
	expect(second.status).toBe("completed");
	expect(observedBases.second).toEqual(["base-1"]);
	release();
	await Promise.all([a, b]);
	expect(observedBases).toEqual({ first: ["base-1"], second: ["base-1"] });
	expect(roles.filter((value) => value.endsWith(":capture"))).toEqual([
		"first:capture",
		"second:capture",
	]);
	expect(roles.filter((value) => value.endsWith(":guide"))).toEqual([
		"first:guide",
		"second:guide",
	]);
	expect([first.status, second.status]).toEqual(["completed", "completed"]);
});

it.each([
	"direct",
	"called",
])("admits a %s provider fanout before its parallel children, while implementation fanouts remain concurrent", async (boundary) => {
	const definitions = validateWorkflows([
		...defaultWorkflows,
		{
			id: "publish-child",
			name: "Publish child",
			steps: [
				{ id: "publish", name: "Publish", type: "tool", tool: "draft-pr" },
			],
		},
		{
			id: "parallel-delivery",
			name: "Parallel delivery",
			steps: [
				{
					id: "implementation",
					name: "Implementation",
					type: "fanout",
					groups: [
						[{ id: "code", name: "Code", type: "agent", prompt: "Code" }],
						[{ id: "test", name: "Test", type: "agent", prompt: "Test" }],
					],
				},
				{
					id: "publication",
					name: "Publication",
					type: "fanout",
					groups: [
						[
							boundary === "direct"
								? {
										id: "publish",
										name: "Publish",
										type: "tool",
										tool: "draft-pr",
									}
								: {
										id: "publish",
										name: "Publish",
										type: "workflow",
										workflow: "publish-child",
									},
						],
					],
				},
				{ id: "finish", name: "Finish", type: "tool", tool: "handoff" },
			],
		},
	]);
	const workflow = definitions.at(-1)!;
	let release!: () => void;
	const firstPublication = new Promise<void>((resolve) => {
		release = resolve;
	});
	const roles: string[] = [];
	const providers: string[] = [];
	const runtime = new WorkflowRuntime(home(), {
		agent: async ({ run, step }) => {
			roles.push(`${run.input}:${step.id}`);
			return {};
		},
		script: async () => ({}),
		tool: async ({ run, step }) => {
			providers.push(`${run.input}:${step.tool}`);
			if (run.input === "first" && step.tool === "draft-pr")
				await firstPublication;
			return {};
		},
	});
	const first = createRun(runtime, "first"),
		second = createRun(runtime, "second");
	for (const run of [first, second]) {
		run.workflow = workflow;
		run.workflowDefinitions = definitions;
	}
	const a = runtime.launch(first);
	let b: Promise<void> | undefined;
	try {
		await vi.waitFor(() => expect(providers).toEqual(["first:draft-pr"]));
		b = runtime.launch(second);
		await vi.waitFor(() =>
			expect(roles).toEqual([
				"first:code",
				"first:test",
				"second:code",
				"second:test",
			]),
		);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(providers).toEqual(["first:draft-pr"]);
		expect(second.deliveryCoordination?.phase).toBe("queued");
	} finally {
		release();
		await Promise.all([a, b]);
	}
	expect(providers).toEqual([
		"first:draft-pr",
		"first:handoff",
		"second:draft-pr",
		"second:handoff",
	]);
	expect([first.status, second.status]).toEqual(["completed", "completed"]);
});

it("releases an overlapping target while a human is absent and retains its pending approval", async () => {
	const reviewedDelivery = validateWorkflows([
		...defaultWorkflows,
		{
			...delivery,
			id: "human-delivery",
			steps: [
				...delivery.steps.slice(0, -1),
				{
					id: "human-review",
					name: "Approve",
					type: "tool",
					tool: "human-review",
					next: "merge",
				},
				delivery.steps.at(-1)!,
			],
		},
	]).at(-1)!;
	const runtime = new WorkflowRuntime(home(), {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async ({ step }) =>
			step.tool === "human-review"
				? { headSha: "head", url: "https://github.com/test/repo/pull/1" }
				: { merged: true },
	});
	const first = createRun(runtime, "absent-human");
	first.workflow = reviewedDelivery;
	const a = runtime.launch(first);
	await vi.waitFor(() => expect(first.status).toBe("waiting"));
	expect(first.deliveryCoordination?.phase).toBe("released");
	const second = createRun(runtime, "eligible");
	const b = runtime.launch(second);
	await vi.waitFor(() => expect(second.status).toBe("completed"));
	expect(first.reviewGate?.status).toBe("pending");
	expect(first.humanDecisions).toBeUndefined();
	runtime.stop(first.id);
	await Promise.all([a, b]);
});

it("restores the finalizing owner ahead of queued deliveries after shutdown, and cancellation does not starve the next oldest run", async () => {
	const directory = home();
	const firstRuntime = new WorkflowRuntime(directory, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async ({ step, signal }) => {
			if (step.tool === "draft-pr")
				await new Promise<void>((_resolve, reject) =>
					signal.addEventListener(
						"abort",
						() => reject(new Error("shutdown")),
						{ once: true },
					),
				);
			return {};
		},
	});
	const owner = createRun(firstRuntime, "owner"),
		cancelled = createRun(firstRuntime, "cancelled"),
		next = createRun(firstRuntime, "next");
	void firstRuntime.launch(owner);
	await vi.waitFor(() => expect(owner.step).toBe("draft-pr"));
	void firstRuntime.launch(cancelled);
	void firstRuntime.launch(next);
	await vi.waitFor(() =>
		expect(next.deliveryCoordination?.phase).toBe("queued"),
	);
	firstRuntime.stop(cancelled.id);
	await firstRuntime.shutdown();
	const visits: string[] = [];
	const runtime = new WorkflowRuntime(directory, {
		agent: async ({ run, step }) => {
			visits.push(`${run.input}:${step.id}`);
			return {};
		},
		script: async () => ({}),
		tool: async ({ run, step }) => {
			visits.push(`${run.input}:${step.id}`);
			return {};
		},
	});
	runtime.resumeAll();
	await vi.waitFor(() => expect(runtime.get(next.id).status).toBe("completed"));
	expect(runtime.get(cancelled.id).status).toBe("stopped");
	expect(visits.filter((visit) => visit.endsWith(":draft-pr"))).toEqual([
		"owner:draft-pr",
		"next:draft-pr",
	]);
	expect(visits).toEqual(
		expect.arrayContaining([
			"owner:draft-pr",
			"owner:capture",
			"owner:guide",
			"owner:merge",
			"next:draft-pr",
			"next:capture",
			"next:guide",
			"next:merge",
		]),
	);
	expect(
		runtime.get(owner.id).history.filter((entry) => entry.step === "capture"),
	).toHaveLength(1);
	await runtime.shutdown();
});

it("uses a stable run identity to order equally old queued deliveries", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
	const admitted: string[] = [];
	const runtime = new WorkflowRuntime(home(), {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async ({ run, step, signal }) => {
			if (step.tool === "draft-pr") {
				admitted.push(run.input);
				if (run.input === "owner")
					await new Promise<void>((_resolve, reject) =>
						signal.addEventListener(
							"abort",
							() => reject(new Error("stopped")),
							{ once: true },
						),
					);
			}
			return {};
		},
	});
	const owner = createRun(runtime, "owner");
	void runtime.launch(owner);
	await vi.waitFor(() => expect(owner.step).toBe("draft-pr"));
	const queued = (id: string) => {
		const run = runtime.create({
			id,
			repositoryId: "repo",
			workflow: delivery,
			workspace: "/tmp",
			input: id,
			triggerOrigin: { type: "manual", workflowId: delivery.id, at: "" },
		});
		run.outputs.repository = owner.outputs.repository;
		void runtime.launch(run);
		return run;
	};
	const last = queued("zz"),
		first = queued("aa");
	await vi.waitFor(() =>
		expect(first.deliveryCoordination?.phase).toBe("queued"),
	);
	runtime.stop(owner.id);
	await vi.advanceTimersByTimeAsync(1000);
	await vi.waitFor(() => expect(last.status).toBe("completed"));
	expect(admitted).toEqual(["owner", "aa", "zz"]);
	await runtime.shutdown();
});

it("allows renamed correction alongside independent review after rejection", async () => {
	const custom = validateWorkflows([
		...defaultWorkflows,
		{
			...delivery,
			id: "renamed",
			steps: [
				{ ...delivery.steps[1]!, next: "human-review" },
				{
					id: "human-review",
					name: "Approve",
					type: "tool",
					tool: "human-review",
					next: "merge",
					branches: [
						{
							when: { path: "decision", equals: "reject" },
							next: "repair-feature",
						},
					],
				},
				{
					id: "repair-feature",
					name: "Correct",
					type: "agent",
					prompt: "Correct",
					next: "walkthrough",
				},
				{
					id: "walkthrough",
					name: "Review",
					type: "agent",
					prompt: "Review",
					next: "merge",
				},
				delivery.steps.at(-1)!,
			],
		},
	]).at(-1)!;
	const roles: string[] = [];
	const runtime = new WorkflowRuntime(home(), {
		agent: async ({ run, step, signal }) => {
			roles.push(`${run.input}:${step.id}`);
			if (run.input === "other" && step.id === "guide")
				await new Promise<void>((_resolve, reject) =>
					signal.addEventListener("abort", () => reject(new Error("stopped")), {
						once: true,
					}),
				);
			return {};
		},
		script: async () => ({}),
		tool: async ({ step }) =>
			step.tool === "human-review"
				? { headSha: "head", url: "https://github.com/test/repo/pull/1" }
				: {},
	});
	const first = createRun(runtime, "custom");
	first.workflow = custom;
	const a = runtime.launch(first);
	await vi.waitFor(() => expect(first.status).toBe("waiting"));
	const other = createRun(runtime, "other");
	const b = runtime.launch(other);
	await vi.waitFor(() => expect(roles).toContain("other:guide"));
	runtime.decide(first.id, {
		reviewId: first.reviewGate!.id,
		headSha: "head",
		decision: "reject",
		feedback: "Correct the feature",
	});
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(roles).toContain("custom:repair-feature");
	runtime.stop(other.id);
	await Promise.all([a, b]);
	expect(roles.slice(-2)).toEqual([
		"custom:repair-feature",
		"custom:walkthrough",
	]);
});

it("restores passive guide work without reacquiring legacy broad ownership", async () => {
	const directory = home();
	const runtime = new WorkflowRuntime(directory, {
		agent: async ({ step, signal }) => {
			if (step.id === "guide")
				await new Promise<void>((_resolve, reject) =>
					signal.addEventListener(
						"abort",
						() => reject(new Error("shutdown")),
						{ once: true },
					),
				);
			return {};
		},
		script: async () => ({}),
		tool: async () => ({}),
	});
	const old = createRun(runtime, "old");
	void runtime.launch(old);
	await vi.waitFor(() => expect(old.step).toBe("guide"));
	await runtime.shutdown();
	// Replay an interrupted checkpoint written by a previous runtime, retaining its old lock receipt.
	old.status = "interrupted";
	runtime.log(old, "run", "Interrupted recovery fixture");
	const visits: string[] = [];
	const recovered = new WorkflowRuntime(directory, {
		agent: async ({ run, step, signal }) => {
			visits.push(`${run.input}:${step.id}`);
			if (run.input === "new" && step.id === "guide")
				await new Promise<void>((_resolve, reject) =>
					signal.addEventListener("abort", () => reject(new Error("stop")), {
						once: true,
					}),
				);
			return {};
		},
		script: async () => ({}),
		tool: async () => ({}),
	});
	const current = createRun(recovered, "new");
	const b = recovered.launch(current);
	await vi.waitFor(() => expect(visits).toContain("new:guide"));
	const restored = recovered.get(old.id);
	restored.status = "running";
	const a = recovered.launch(restored);
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(visits).toContain("old:guide");
	recovered.stop(current.id);
	await Promise.all([a, b]);
	expect(restored.status).toBe("completed");
});

it("keeps consequential base integration on the review path and explains it separately from a source defect", async () => {
	const runtime = new WorkflowRuntime(home(), {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const run = createRun(runtime, "base-impact");
	run.roleRevisions = {
		"code-review": { headSha: "head", dirty: false, at: "", historyLength: 0 },
	};
	run.outputs["draft-pr"] = { url: "https://github.com/test/repo/pull/1" };
	run.outputs.ci = { baseSha: "approved-base" };
	run.outputs["review-gate"] = { approved: true };
	const tools = new FactoryTools({
		postComment: vi.fn(),
		command: async (_context, exe, args) =>
			exe === "git"
				? args[0] === "rev-parse"
					? "head"
					: ""
				: JSON.stringify(
						githubApiReceipt(args, { baseRefOid: "consequential-new-base" }),
					),
	});
	const result = await tools.tool({
		run,
		step: {
			id: "after-ci-fix",
			name: "Assess",
			type: "tool",
			tool: "review-after-fix",
			branches: [],
			maxVisits: 8,
		},
		input: {},
		signal: new AbortController().signal,
		evidenceDir: "/tmp",
		log: vi.fn(),
	});
	expect(result).toMatchObject({
		reviewRequired: true,
		invalidation: {
			kind: "base-change",
			previousBaseSha: "approved-base",
			baseSha: "consequential-new-base",
		},
	});
});

it("does not freeze an eligible overlapping delivery behind a long provider queue outage", async () => {
	vi.useFakeTimers();
	const queuedWorkflow = validateWorkflows([
		...defaultWorkflows,
		{
			...delivery,
			id: "queued-provider",
			steps: [
				...delivery.steps.slice(0, 2),
				{ id: "ci", name: "CI", type: "tool", tool: "ci", next: "capture" },
				...delivery.steps.slice(2),
			],
		},
	]).at(-1)!;
	const roles: string[] = [];
	const tools = new FactoryTools({
		postComment: vi.fn(),
		command: async ({ run }, exe, args) => {
			if (exe === "git") return args[0] === "rev-parse" ? "head" : "";
			if (githubRequest(args).path === "graphql")
				return JSON.stringify(
					providerReceipt(
						run.input === "outage"
							? {
									statusCheckRollup: {
										contexts: {
											pageInfo: {},
											nodes: [{ name: "macOS", status: "QUEUED" }],
										},
									},
								}
							: {},
					),
				);
			return "[]";
		},
	});
	const runtime = new WorkflowRuntime(home(), {
		agent: async ({ run, step }) => {
			roles.push(`${run.input}:${step.id}`);
			return {};
		},
		script: async () => ({}),
		tool: (context) =>
			context.step.tool === "ci"
				? tools.tool(context)
				: Promise.resolve({ url: "https://github.com/test/repo/pull/1" }),
	});
	const first = createRun(runtime, "outage");
	first.workflow = queuedWorkflow;
	const a = runtime.launch(first);
	await vi.waitFor(() =>
		expect(first.capacityLeaves?.ci?.phase).toBe("waiting-ci"),
	);
	const second = createRun(runtime, "eligible");
	second.workflow = queuedWorkflow;
	const b = runtime.launch(second);
	await vi.waitFor(() => expect(roles).toContain("eligible:implement"));
	await vi.advanceTimersByTimeAsync(130000);
	expect(second.status).toBe("completed");
	expect(roles).not.toContain("outage:capture");
	expect(first.status).toBe("running");
	runtime.stop(first.id);
	await Promise.all([a, b]);
});

it("recognizes two native worktrees of the same repository without configured forge URLs", async () => {
	const directory = home(),
		repo = join(directory, "repo"),
		one = join(directory, "one"),
		two = join(directory, "two");
	mkdirSync(repo);
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: repo,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	git("init", "-q", "-b", "main");
	writeFileSync(join(repo, "README.md"), "Fixture\n");
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
		"fixture",
	);
	git("worktree", "add", "-qb", "one", one);
	git("worktree", "add", "-qb", "two", two);
	writeFileSync(join(one, "feature"), "one");
	writeFileSync(join(two, "feature"), "two");
	let release!: () => void;
	const hold = new Promise<void>((resolve) => {
		release = resolve;
	});
	const roles: string[] = [];
	const runtime = new WorkflowRuntime(directory, {
		agent: async ({ run, step }) => {
			roles.push(`${run.input}:${step.id}`);

			return {};
		},
		script: async () => ({}),
		tool: async ({ run, step }) => {
			if (run.input === "first" && step.tool === "draft-pr") await hold;
			return {};
		},
	});
	const first = createRun(runtime, "first"),
		second = createRun(runtime, "second");
	first.workspace = one;
	second.workspace = two;
	first.outputs.repository = { baseBranch: "main" };
	second.outputs.repository = { baseBranch: "main" };
	const a = runtime.launch(first);
	await vi.waitFor(() => expect(first.step).toBe("draft-pr"));
	const b = runtime.launch(second);
	await vi.waitFor(() => expect(roles).toContain("second:implement"));
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(second.deliveryCoordination?.phase).toBe("queued");
	expect(roles).not.toContain("second:guide");
	release();
	await Promise.all([a, b]);
});

it("reserves three affected repositories out of seven and atomically adds newly changed targets", async () => {
	const { acquireDelivery, deliveryScopes, releaseDelivery } = await import(
		"../src/factory/DeliveryCoordination.js"
	);
	const root = home();
	const runtime = new WorkflowRuntime(root, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const group = createRun(runtime, "group");
	group.repositories = Array.from({ length: 7 }, (_, index) => {
		const workspace = join(root, `repo-${index}`);
		mkdirSync(workspace);
		const git = (...args: string[]) =>
			execFileSync("git", args, { cwd: workspace, stdio: "ignore" });
		git("init", "-qb", "main");
		writeFileSync(join(workspace, "base"), "base");
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
			"base",
		);
		git("checkout", "-qb", "feature");
		if (index === 0) writeFileSync(join(workspace, "new"), "dirty");
		if (index === 1) {
			// Inherited commits, without any new agent edit.
			writeFileSync(join(workspace, "inherited"), "inherited");
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
				"inherited",
			);
		}
		return {
			id: `repo-${index}`,
			name: `Repo ${index}`,
			repositoryPath: workspace,
			workspace,
			baseBranch: "main",
			githubUrl: `https://github.com/test/repo-${index}`,
		};
	});
	group.repositoryOutputs = {
		"repo-2": {
			"draft-pr": {
				url: "https://github.com/test/repo-2/pull/1",
				headSha: "receipt",
			},
		},
	};
	const signal = new AbortController();
	const all = () => runtime.runs.values();
	const save = () => runtime.save(group);
	const log = vi.fn();
	await acquireDelivery(group, all, signal.signal, save, log);
	expect(group.deliveryCoordination?.scopes).toEqual(
		[0, 1, 2].map((index) =>
			JSON.stringify([`https://github.com/test/repo-${index}`, "main"]),
		),
	);
	const context = createRun(runtime, "context");
	context.repositories = [group.repositories[3]!];
	// An inherited PR still reserves its target even with a now-clean worktree.
	context.repositoryOutputs = {
		"repo-3": { source: { url: "https://github.com/test/repo-3/pull/3" } },
	};
	await acquireDelivery(
		context,
		all,
		signal.signal,
		() => runtime.save(context),
		log,
	);
	expect(context.deliveryCoordination?.phase).toBe("active");
	writeFileSync(join(group.repositories[3]!.workspace, "new"), "new target");
	expect(deliveryScopes(group)).toHaveLength(4);
	const expansion = acquireDelivery(group, all, signal.signal, save, log);
	await vi.waitFor(() =>
		expect(group.deliveryCoordination?.phase).toBe("queued"),
	);
	expect(group.deliveryCoordination?.blockers).toEqual([
		{
			runId: context.id,
			operation: "delivery",
			targets: [JSON.stringify(["https://github.com/test/repo-3", "main"])],
		},
	]);
	releaseDelivery(context, "Context publication settled");
	await expansion;
	expect(group.deliveryCoordination?.scopes).toHaveLength(4);
	releaseDelivery(group, "Finished");
	await runtime.shutdown();
});

it.each([
	"worktree",
	"shared",
	"legacy",
])("keeps QA %s isolation separate from repository integration", async (isolation) => {
	let release!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const visits: string[] = [];
	const runtime = new WorkflowRuntime(home(), {
		agent: async ({ run, step }) => {
			visits.push(`${run.input}:${step.id}`);
			if (run.input === "first" && step.id === "capture") await held;
			return {};
		},
		script: async () => ({}),
		tool: async () => ({}),
	});
	const first = createRun(runtime, "first"),
		second = createRun(runtime, "second");
	for (const run of [first, second])
		run.outputs["visual-scope"] =
			isolation === "legacy"
				? {}
				: {
						environment: {
							isolation,
							resources: ["cluster:qa/database:fixture"],
						},
					};
	const a = runtime.launch(first);
	await vi.waitFor(() => expect(visits).toContain("first:capture"));
	const b = runtime.launch(second);
	try {
		await vi.waitFor(() =>
			expect(second.step).toBe(isolation === "worktree" ? "merge" : "capture"),
		);
		if (isolation === "worktree") expect(visits).toContain("second:capture");
		else {
			expect(visits).not.toContain("second:capture");
			expect(second.deliveryCoordination?.reason).toBe(
				"Shared QA/environment resource",
			);
			expect(second.deliveryCoordination?.blockers?.[0]?.runId).toBe(first.id);
		}
		// A third run can integrate on the same repository throughout the shared QA wait.
		const integrator = createRun(runtime, "integrator");
		integrator.workflow = { ...delivery, steps: [delivery.steps[1]!] };
		await runtime.launch(integrator);
		expect(integrator.status).toBe("completed");
	} finally {
		release();
		await Promise.all([a, b]);
		await runtime.shutdown();
	}
});

it("expands nested publication admission atomically and retains it until the outer operation settles", async () => {
	let releaseOwner!: () => void, releaseGroup!: () => void;
	const ownerHeld = new Promise<void>((resolve) => {
		releaseOwner = resolve;
	});
	const groupHeld = new Promise<void>((resolve) => {
		releaseGroup = resolve;
	});
	let published = false;
	const runtime = new WorkflowRuntime(home(), {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async (context) => {
			if (context.run.input === "owner") await ownerHeld;
			else {
				context.run.repositoryOutputs!.b = {
					source: { url: "https://github.com/test/b/pull/2" },
				};
				await context.coordinateDelivery!(async () => {
					published = true;
				});
				await groupHeld;
			}
			return {};
		},
	});
	const repositories = ["a", "b"].map((id) => {
		const workspace = join(home(), id);
		mkdirSync(workspace);
		const git = (...args: string[]) =>
			execFileSync("git", args, { cwd: workspace, stdio: "ignore" });
		git("init", "-qb", "main");
		writeFileSync(join(workspace, "base"), "base");
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
			"base",
		);
		return {
			id,
			name: id,
			workspace,
			repositoryPath: workspace,
			baseBranch: "main",
			githubUrl: `https://github.com/test/${id}`,
		};
	});
	const owner = createRun(runtime, "owner"),
		group = createRun(runtime, "group");
	for (const run of [owner, group])
		run.workflow = { ...delivery, steps: [delivery.steps[1]!] };
	owner.repositories = [repositories[1]!];
	owner.repositoryOutputs = {
		b: { source: { url: "https://github.com/test/b/pull/1" } },
	};
	group.repositories = repositories;
	group.repositoryOutputs = {
		a: { source: { url: "https://github.com/test/a/pull/1" } },
	};
	const a = runtime.launch(owner);
	await vi.waitFor(() =>
		expect(owner.deliveryCoordination?.phase).toBe("active"),
	);
	const b = runtime.launch(group);
	try {
		await vi.waitFor(() =>
			expect(group.deliveryCoordination?.phase).toBe("queued"),
		);
		expect(published).toBe(false);
		expect(group.deliveryCoordination?.scopes).toHaveLength(2);
		expect(group.deliveryCoordination?.blockers?.[0]?.runId).toBe(owner.id);
		releaseOwner();
		await vi.waitFor(() => expect(published).toBe(true));
		expect(group.deliveryCoordination?.phase).toBe("active");
		expect(group.deliveryCoordination?.scopes).toHaveLength(2);
	} finally {
		releaseOwner();
		releaseGroup();
		await Promise.all([a, b]);
		await runtime.shutdown();
	}
	expect(group.deliveryCoordination?.phase).toBe("released");
});

it.each([
	"green",
	"base",
	"failed",
	"dirty",
	"comment",
	"scope",
	"qa-gap",
])("refreshes a queued CI fixer before invoking it (%s)", async (condition) => {
	let release!: () => void;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let green = false;
	const agents: string[] = [];
	const tools = new FactoryTools({
		postComment: vi.fn(),
		command: async (_context, exe, args) => {
			if (exe === "git")
				return args[0] === "rev-parse"
					? "head"
					: condition === "dirty" && green
						? " M source.ts"
						: "";
			const request = githubRequest(args);
			if (
				condition === "comment" &&
				green &&
				request.path.includes("/issues/1/comments")
			)
				return JSON.stringify([
					{
						id: "comment",
						body: "Please correct the implementation",
						user: { login: "reviewer" },
					},
				]);
			if (request.path === "graphql")
				return JSON.stringify(
					providerReceipt({
						baseRefOid: green && condition === "base" ? "new-base" : "base",
						statusCheckRollup: {
							contexts: {
								pageInfo: {},
								nodes: [
									{
										name: "tests",
										status: "COMPLETED",
										conclusion:
											green && condition !== "failed" ? "SUCCESS" : "FAILURE",
									},
								],
							},
						},
						comments: {
							pageInfo: {},
							nodes:
								condition === "comment" && green
									? [
											{
												id: "comment",
												body: "Please correct the implementation",
												author: { login: "reviewer" },
											},
										]
									: [],
						},
					}),
				);
			return JSON.stringify(githubApiReceipt(args));
		},
	});
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "refresh",
			name: "Refresh",
			steps: [
				{
					id: "ci",
					name: "CI",
					type: "tool",
					tool: "ci",
					branches: [{ when: { path: "fix", equals: true }, next: "repair" }],
					next: "end",
				},
				{
					id: "repair",
					name: "Repair",
					type: "agent",
					prompt: "Repair",
					next: "after",
				},
				{
					id: "after",
					name: "Route unchanged",
					type: "tool",
					tool: "review-after-fix",
					next: "end",
				},
			],
		},
	]).at(-1)!;
	const runtime = new WorkflowRuntime(home(), {
		agent: async ({ step }) => {
			agents.push(step.id);
			return {};
		},
		script: async () => ({}),
		tool: async (context) => {
			if (context.run.input === "owner" && context.step.tool === "draft-pr") {
				await held;
				return {};
			}
			return context.step.tool === "review-after-fix" && condition !== "base"
				? {}
				: tools.tool(context);
		},
	});
	const owner = createRun(runtime, "owner");
	owner.workflow = { ...delivery, steps: [delivery.steps[1]!] };
	const a = runtime.launch(owner);
	await vi.waitFor(() =>
		expect(owner.deliveryCoordination?.phase).toBe("active"),
	);
	const fixer = createRun(runtime, "fixer");
	fixer.workflow = workflow;
	fixer.outputs["draft-pr"] = {
		url: "https://github.com/test/repo/pull/1",
		headSha: "head",
	};
	fixer.roleRevisions = {
		"code-review": { headSha: "head", dirty: false, at: "", historyLength: 0 },
	};
	fixer.outputs["review-gate"] = { approved: true };
	const b = runtime.launch(fixer);
	try {
		await vi.waitFor(() =>
			expect(fixer.deliveryCoordination?.phase).toBe("queued"),
		);
		green = true;
		if (condition === "scope")
			fixer.outputs.plan = { plan: "Authorized new requirement" };
		if (condition === "qa-gap")
			fixer.outputs["visual-gate"] = { approved: false, qaBlocked: true };
	} finally {
		release();
		await Promise.all([a, b]);
	}
	expect(fixer.status).toBe("completed");
	const resolved = ["green", "base"].includes(condition);
	expect(agents).toEqual(resolved ? [] : ["repair"]);
	expect(
		fixer.history.find((entry) => entry.step === "repair")?.output,
	).toMatchObject(resolved ? { skipped: true } : {});
	if (condition === "base")
		expect(
			fixer.history.find((entry) => entry.step === "after")?.output,
		).toMatchObject({
			reviewRequired: true,
			invalidation: {
				kind: "base-change",
				previousBaseSha: "base",
				baseSha: "new-base",
			},
		});
	await runtime.shutdown();
});

it("keeps passive CI polling and green QA runnable behind an overlapping fixer after restart", async () => {
	const directory = home();
	let green = false;
	let polls = 0;
	const visits: string[] = [];
	const tools = new FactoryTools({
		postComment: vi.fn(),
		command: async (_context, exe, args) => {
			if (exe === "git") return args[0] === "rev-parse" ? "head" : "";
			if (githubRequest(args).path === "graphql") {
				polls++;
				return JSON.stringify(
					providerReceipt(
						green
							? {}
							: {
									statusCheckRollup: {
										contexts: {
											pageInfo: {},
											nodes: [{ name: "test", status: "QUEUED" }],
										},
									},
								},
					),
				);
			}
			return JSON.stringify(githubApiReceipt(args));
		},
	});
	const hooks = {
		agent: async ({
			run,
			step,
			signal,
		}: import("../src/factory/WorkflowRuntime.js").ExecutionContext) => {
			visits.push(`${run.input}:${step.id}`);
			if (run.input === "fixer")
				await new Promise<void>((_resolve, reject) =>
					signal.addEventListener(
						"abort",
						() => reject(new Error("Stopped fixture")),
						{ once: true },
					),
				);
			return {};
		},
		script: async () => ({}),
		tool: (
			context: import("../src/factory/WorkflowRuntime.js").ExecutionContext,
		) => tools.tool(context),
	};
	let runtime = new WorkflowRuntime(directory, hooks);
	const fixer = createRun(runtime, "fixer");
	fixer.workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "active-fixer",
			name: "Fixer",
			steps: [
				{
					id: "ci-fix",
					name: "Fix",
					type: "agent",
					prompt: "Mock integration",
					next: "end",
				},
			],
		},
	]).at(-1)!;
	const watcher = createRun(runtime, "watcher");
	watcher.workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "passive-watcher",
			name: "Watcher",
			steps: [
				{ id: "ci", name: "CI", type: "tool", tool: "ci" },
				{
					id: "capture",
					name: "QA",
					type: "agent",
					prompt: "Mock QA",
					next: "end",
				},
			],
		},
	]).at(-1)!;
	watcher.outputs["draft-pr"] = {
		url: "https://github.com/test/repo/pull/1",
		headSha: "head",
	};
	watcher.outputs["visual-scope"] = { environment: { isolation: "worktree" } };
	void runtime.launch(fixer);
	await vi.waitFor(() =>
		expect(fixer.deliveryCoordination?.phase).toBe("active"),
	);
	void runtime.launch(watcher);
	await vi.waitFor(() => expect(polls).toBe(1));
	expect(watcher.deliveryCoordination).toBeUndefined();
	await runtime.shutdown();
	green = true;
	runtime = new WorkflowRuntime(directory, hooks);
	runtime.resumeAll();
	await vi.waitFor(() =>
		expect(runtime.get(watcher.id).status).toBe("completed"),
	);
	expect(polls).toBe(2);
	expect(visits.filter((visit) => visit === "watcher:capture")).toHaveLength(1);
	expect(runtime.get(fixer.id).deliveryCoordination?.phase).toBe("active");
	expect(
		runtime.get(watcher.id).history.filter((entry) => entry.step === "ci"),
	).toHaveLength(1);
	runtime.stop(fixer.id);
	await runtime.shutdown();
});

it("releases merge ownership between provider polls and revalidates approval before the next request", async () => {
	vi.useFakeTimers();
	let submitted = 0;
	let currentHead = "head";
	const tools = new FactoryTools({
		postComment: vi.fn(),
		command: async (_context, exe, args) => {
			if (exe === "git") return args[0] === "rev-parse" ? "head" : "";
			const request = githubRequest(args);
			if (request.path.endsWith("/merge")) submitted++;
			return JSON.stringify(
				githubApiReceipt(args, {
					headRefOid: currentHead,
					isDraft: false,
					reviewDecision: "APPROVED",
					mergeStateStatus: "CLEAN",
					isInMergeQueue: submitted > 0,
				}),
			);
		},
	});
	const runtime = new WorkflowRuntime(home(), {
		agent: async () => ({}),
		script: async () => ({}),
		tool: (context) =>
			context.step.tool === "merge" ? tools.tool(context) : Promise.resolve({}),
	});
	const merging = createRun(runtime, "merging");
	merging.workflow = { ...delivery, steps: [delivery.steps.at(-1)!] };
	merging.outputs["draft-pr"] = {
		url: "https://github.com/test/repo/pull/1",
		headSha: "head",
	};
	merging.humanDecisions = [
		{ decision: "approve", headSha: "head", reviewId: "review", at: "" },
	];
	const a = runtime.launch(merging);
	await vi.waitFor(() => expect(submitted).toBe(1));
	await vi.waitFor(() =>
		expect(merging.deliveryCoordination?.phase).toBe("released"),
	);
	const independent = createRun(runtime, "independent");
	independent.workflow = { ...delivery, steps: [delivery.steps[1]!] };
	await runtime.launch(independent);
	expect(independent.status).toBe("completed");
	currentHead = "unapproved-head";
	await vi.advanceTimersByTimeAsync(10000);
	await a;
	expect(submitted).toBe(1);
	expect(merging.outputs.merge).toMatchObject({ fix: true, rework: false });
	expect(merging.humanDecisions[0]?.headSha).toBe("head");
	await runtime.shutdown();
});
