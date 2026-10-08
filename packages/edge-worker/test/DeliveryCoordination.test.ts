import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
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

it("finishes one overlapping delivery before another integrates, while both implementations run in parallel", async () => {
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
	expect(roles).not.toContain("second:capture");
	expect(observedBases.second).toBeUndefined();
	release();
	await Promise.all([a, b]);
	expect(observedBases).toEqual({ first: ["base-1"], second: ["base-2"] });
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
	const owner = createRun(firstRuntime, "owner"),
		cancelled = createRun(firstRuntime, "cancelled"),
		next = createRun(firstRuntime, "next");
	void firstRuntime.launch(owner);
	await vi.waitFor(() => expect(owner.step).toBe("guide"));
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
	expect(visits).toEqual([
		"owner:guide",
		"owner:merge",
		"next:draft-pr",
		"next:capture",
		"next:guide",
		"next:merge",
	]);
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
		agent: async ({ run, step, signal }) => {
			if (run.input === "owner" && step.id === "guide")
				await new Promise<void>((_resolve, reject) =>
					signal.addEventListener("abort", () => reject(new Error("stopped")), {
						once: true,
					}),
				);
			return {};
		},
		script: async () => ({}),
		tool: async ({ run, step }) => {
			if (step.tool === "draft-pr") admitted.push(run.input);
			return {};
		},
	});
	const owner = createRun(runtime, "owner");
	void runtime.launch(owner);
	await vi.waitFor(() => expect(owner.step).toBe("guide"));
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

it("coordinates renamed corrective and review roles after a human rejection", async () => {
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
	expect(roles).not.toContain("custom:repair-feature");
	runtime.stop(other.id);
	await Promise.all([a, b]);
	expect(roles.slice(-2)).toEqual([
		"custom:repair-feature",
		"custom:walkthrough",
	]);
});

it("re-admits a restored inactive owner behind a new active delivery even when resume launches directly", async () => {
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
	expect(visits).not.toContain("old:guide");
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
				: args[1] === "graphql"
					? JSON.stringify(
							providerReceipt({ baseRefOid: "consequential-new-base" }),
						)
					: "[]",
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
			if (args[1] === "graphql")
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
	let release!: () => void;
	const hold = new Promise<void>((resolve) => {
		release = resolve;
	});
	const roles: string[] = [];
	const runtime = new WorkflowRuntime(directory, {
		agent: async ({ run, step }) => {
			roles.push(`${run.input}:${step.id}`);
			if (run.input === "first" && step.id === "guide") await hold;
			return {};
		},
		script: async () => ({}),
		tool: async () => ({}),
	});
	const first = createRun(runtime, "first"),
		second = createRun(runtime, "second");
	first.workspace = one;
	second.workspace = two;
	first.outputs.repository = { baseBranch: "main" };
	second.outputs.repository = { baseBranch: "main" };
	const a = runtime.launch(first);
	await vi.waitFor(() => expect(roles).toContain("first:guide"));
	const b = runtime.launch(second);
	await vi.waitFor(() => expect(roles).toContain("second:implement"));
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(roles).not.toContain("second:guide");
	release();
	await Promise.all([a, b]);
});
