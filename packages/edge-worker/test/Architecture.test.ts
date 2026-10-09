import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type Architecture,
	ArchitectureSchema,
	snapshotProposal,
	verifyProposal,
} from "../src/factory/Architecture.js";
import {
	defaultWorkflows,
	upgradeWorkflows,
} from "../src/factory/defaultWorkflows.js";
import { validateFactoryResult } from "../src/factory/FactoryResults.js";
import {
	StepSchema,
	validateWorkflows,
	type Workflow,
} from "../src/factory/Workflow.js";
import {
	type FactoryRun,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { proposal } from "./fixtures/architecture.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

function setup(
	classification: Architecture["classification"] = "meaningful",
	extra: Partial<RuntimeHooks> = {},
) {
	const home = mkdtempSync(join(tmpdir(), "architecture-test-"));
	homes.push(home);
	const implemented: unknown[] = [];
	const hooks: RuntimeHooks = {
		agent: async (c) => {
			if (c.step.architectureContract === "architecture-v1")
				return proposal(classification);
			if (c.step.architectureContract === "architecture-review-v1")
				return { approved: true, feedback: [] };
			if (c.step.id === "question-explanation")
				return {
					questions: [
						"This keeps design approval separate from PR approval. Accept the displayed version or request changes; an explanation is not acceptance.",
					],
				};
			implemented.push(c.input);
			return {
				status: "completed",
				summary: "done",
				checks: [],
				questions: [],
			};
		},
		script: async () => ({}),
		tool: async () => ({}),
		...extra,
	};
	const runtime = new WorkflowRuntime(home, hooks);
	const steps = [
		{
			id: "design",
			name: "Design",
			type: "agent",
			prompt: "Design",
			architectureContract: "architecture-v1",
		},
		{
			id: "candidate-review",
			name: "Review",
			type: "agent",
			prompt: "Review",
			architectureContract: "architecture-review-v1",
			architectureSource: "design",
			branches: [{ when: { path: "approved", equals: false }, next: "design" }],
		},
		{
			id: "decision",
			name: "Decision",
			type: "tool",
			tool: "architecture-decision",
			arguments: {
				proposal: "design",
				review: "candidate-review",
				planOutput: "plan",
				revise: "design",
				approval: "meaningful",
			},
		},
		{
			id: "implement",
			name: "Implement",
			type: "agent",
			prompt: "Implement",
			inputs: ["plan"],
			askQuestions: true,
		},
	];
	const definition = validateWorkflows([
		...defaultWorkflows,
		{ id: "test", name: "Test", steps },
	]).at(-1)!;
	const run = runtime.create({
		title: "Architecture",
		repositoryId: "repo",
		workspace: home,
		workflow: definition,
		input: "PRIVATE TICKET",
		triggerOrigin: {
			type: "manual",
			workflowId: "test",
			at: new Date().toISOString(),
		},
	});
	const running = runtime.launch(run);
	return { runtime, run, home, hooks, implemented, running };
}
async function waiting(run: FactoryRun) {
	await vi.waitFor(() => expect(run.status).toBe("waiting"));
}
function decide(
	runtime: WorkflowRuntime,
	run: FactoryRun,
	decision = "accept",
	feedback?: string,
) {
	const p = run.architectureProposals!.at(-1)!;
	runtime.decideArchitecture(run.id, {
		proposalId: p.id,
		version: p.version,
		digest: p.digest,
		decision,
		feedback,
	});
}
async function finished(runtime: WorkflowRuntime, run: FactoryRun) {
	await vi.waitFor(() => expect(run.status).toBe("completed"));
	await runtime.shutdown();
}

describe("architecture authorization boundary", () => {
	it("rejects absent and empty HTTP assets before approval or implementation", async () => {
		const server = createServer((request, response) => {
			response.statusCode = request.url === "/absent" ? 204 : 200;
			response.end(request.url === "/success" ? "remote specification" : "");
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("No HTTP port");
		try {
			for (const path of ["absent", "empty", "success"]) {
				const value = proposal();
				value.candidate.assets = [
					{
						path: `http://127.0.0.1:${address.port}/${path}`,
						purpose: "specification",
					},
				];
				const { runtime, run, running, implemented } = setup("meaningful", {
					agent: async (context) =>
						context.step.architectureContract === "architecture-v1"
							? value
							: { approved: true, feedback: [] },
				});
				try {
					if (path === "success") {
						await waiting(run);
						expect(
							readFileSync(
								run.architectureProposals![0]!.content.candidate.assets[0]!
									.path,
								"utf8",
							),
						).toBe("remote specification");
					} else {
						await running;
						expect(run.status).toBe("failed");
						expect(run.error).toMatch(/no body/);
						expect(run.architectureProposals).toEqual([]);
						expect(run.architectureGate).toBeUndefined();
					}
					expect(implemented).toEqual([]);
				} finally {
					await runtime.shutdown();
				}
			}
		} finally {
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	});
	it("deduplicates architecture explanation ticket notifications through restart and notifies a revised proposal", async () => {
		const notifications: string[] = [];
		const { runtime, run, home, hooks, implemented } = setup("meaningful", {
			track: async (tracked, milestone) => {
				const receipt = tracked.ticketSync?.receipts.find(
					(item) => item.key === milestone.key,
				);
				if (receipt && !receipt.delivered) {
					receipt.delivered = true;
					if (milestone.key.startsWith("questions:"))
						notifications.push(milestone.key);
				}
			},
		});
		run.ticketReference = {
			provider: "taskbot",
			instance: "https://taskbot.test",
			project: "test",
			id: 1,
			url: "https://taskbot.test/p/test/t/1",
			server: "taskbot",
		};
		await waiting(run);
		const first = run.architectureProposals![0]!;
		const batch = run.questionBatchId;
		expect(notifications).toHaveLength(1);
		for (let count = 1; count <= 2; count++) {
			decide(runtime, run, "explain", "Why separate approval?");
			await vi.waitFor(() =>
				expect(
					first.feedback.filter((item) => item.kind === "explanation"),
				).toHaveLength(count),
			);
			await waiting(run);
			expect(run.questionBatchId).toBe(batch);
			expect(notifications).toHaveLength(1);
		}
		await runtime.shutdown();
		const restored = new WorkflowRuntime(home, hooks);
		const resumed = restored.get(run.id);
		try {
			restored.resumeAll();
			await waiting(resumed);
			expect(resumed.questionBatchId).toBe(batch);
			expect(notifications).toHaveLength(1);
			expect(implemented).toEqual([]);
			decide(restored, resumed, "revise", "Retain the existing interface");
			await vi.waitFor(() =>
				expect(resumed.architectureProposals).toHaveLength(2),
			);
			await waiting(resumed);
			expect(resumed.questionBatchId).not.toBe(batch);
			expect(notifications).toHaveLength(2);
			expect(implemented).toEqual([]);
			decide(restored, resumed);
			await finished(restored, resumed);
			expect(implemented).toHaveLength(1);
		} finally {
			await restored.shutdown();
		}
	});
	it("rejects malformed diagrams, missing rationale, meaningful proposals without visuals, and model-authored approval", () => {
		const value = proposal();
		expect(
			ArchitectureSchema.safeParse({ ...value, accepted: true }).success,
		).toBe(false);
		expect(
			ArchitectureSchema.safeParse({ ...value, rationale: "" }).success,
		).toBe(false);
		expect(
			ArchitectureSchema.safeParse({ ...value, visual: undefined }).success,
		).toBe(false);
		value.visual!.system.after[0]!.target = "missing";
		expect(ArchitectureSchema.safeParse(value).success).toBe(false);
		expect(
			validateFactoryResult(
				"renamed",
				proposal(),
				undefined,
				undefined,
				"architecture-v1",
			),
		).toEqual(proposal());
	});
	it("waits, rejects stale and duplicate acceptance, then hands off the exact candidate without ticket/history", async () => {
		const { runtime, run, implemented } = setup();
		await waiting(run);
		expect(implemented).toEqual([]);
		const p = run.architectureProposals![0]!;
		expect(() =>
			runtime.decideArchitecture(run.id, {
				proposalId: p.id,
				version: 999,
				digest: p.digest,
				decision: "accept",
			}),
		).toThrow("changed");
		decide(runtime, run);
		expect(() => decide(runtime, run)).toThrow("not waiting");
		await finished(runtime, run);
		expect(implemented).toEqual([{ plan: p.content.candidate, answers: [] }]);
		expect(run.humanDecisions).toBeUndefined();
	});
	it("regenerates after rejection/discussion; explanation retains pending identity without implementing", async () => {
		const { runtime, run, implemented } = setup();
		await waiting(run);
		const first = run.architectureProposals![0]!;
		decide(runtime, run, "explain", "Why separate approval?");
		await vi.waitFor(() =>
			expect(run.questions[0]).toMatch(/keeps design approval/),
		);
		await waiting(run);
		expect(run.architectureGate?.proposalId).toBe(first.id);
		expect(first.status).toBe("pending");
		expect(implemented).toEqual([]);
		decide(runtime, run, "revise", "Use the existing checkpoint");
		await waiting(run);
		await vi.waitFor(() => expect(run.architectureProposals).toHaveLength(2));
		await waiting(run);
		expect(first.status).toBe("rejected");
		expect(() =>
			runtime.decideArchitecture(run.id, {
				proposalId: first.id,
				version: first.version,
				digest: first.digest,
				decision: "accept",
			}),
		).toThrow("changed");
		runtime.answer(
			run.id,
			"Explain the alternatives in a revised proposal",
			"answer",
		);
		await vi.waitFor(() => expect(run.architectureProposals).toHaveLength(3));
		await waiting(run);
		decide(runtime, run);
		await finished(runtime, run);
		expect(implemented).toHaveLength(1);
	});
	it("records routine bypass and never fabricates human acceptance", async () => {
		const { runtime, run, implemented } = setup("routine");
		await finished(runtime, run);
		expect(implemented).toHaveLength(1);
		expect(run.architectureProposals![0]!.status).toBe("routine");
		expect(run.architectureDecisions ?? []).toEqual([]);
		expect(run.outputs.decision).toMatchObject({
			decision: "routine",
			reason: proposal().rationale,
		});
	});
	it("retains waiting identity and accepted handoff through restart", async () => {
		const { runtime, run, home, hooks, implemented } = setup();
		await waiting(run);
		const identity = run.architectureProposals![0]!.id;
		await runtime.shutdown();
		const restored = new WorkflowRuntime(home, hooks);
		restored.resumeAll();
		const resumed = restored.get(run.id);
		await waiting(resumed);
		expect(resumed.architectureProposals![0]!.id).toBe(identity);
		decide(restored, resumed);
		await finished(restored, resumed);
		const again = new WorkflowRuntime(home, hooks);
		again.resumeAll();
		expect(again.get(run.id).outputs.plan).toEqual(
			resumed.architectureProposals![0]!.content.candidate,
		);
		expect(implemented).toHaveLength(1);
		await again.shutdown();
	});
	it("stop prevents acceptance; explicit resume restores the same proposal", async () => {
		const { runtime, run, implemented, running } = setup();
		await waiting(run);
		const identity = run.architectureProposals![0]!.id;
		runtime.stop(run.id);
		expect(() => decide(runtime, run)).toThrow("not waiting");
		await vi.waitFor(() => expect(run.status).toBe("stopped"));
		await running;
		runtime.retry(run.id);
		await waiting(run);
		expect(run.architectureProposals![0]!.id).toBe(identity);
		decide(runtime, run);
		await finished(runtime, run);
		expect(implemented).toHaveLength(1);
	});
	it("snapshots assets and refuses changed snapshot bytes", async () => {
		const { home, runtime } = setup("routine");
		await runtime.shutdown();
		const path = join(home, "input.txt");
		writeFileSync(path, "original");
		const value = proposal();
		value.candidate.assets = [{ path, purpose: "spec" }];
		value.candidate.plan = `Implement the specification at ${path}`;
		const p = await snapshotProposal(
			value,
			"design",
			1,
			home,
			new AbortController().signal,
		);
		writeFileSync(path, "changed original");
		verifyProposal(p);
		expect(
			p.content.candidate.plan.split("## Accepted asset snapshots")[0],
		).toContain(
			`Implement the specification at ${p.content.candidate.assets[0]!.path}`,
		);
		expect(readFileSync(p.content.candidate.assets[0]!.path, "utf8")).toBe(
			"original",
		);
		writeFileSync(p.content.candidate.assets[0]!.path, "changed snapshot");
		expect(() => verifyProposal(p)).toThrow("asset changed");
	});
	it("rejects outside files, sibling-prefix paths, traversal and symlink escapes", async () => {
		const home = mkdtempSync(join(tmpdir(), "architecture-scope-"));
		homes.push(home);
		const allowed = join(home, "allowed");
		const sibling = join(home, "allowed-other");
		mkdirSync(allowed);
		mkdirSync(sibling);
		const secret = join(sibling, "secret.txt");
		writeFileSync(secret, "restricted");
		symlinkSync(sibling, join(allowed, "escape"));
		for (const path of [
			secret,
			`${allowed}/../allowed-other/secret.txt`,
			join(allowed, "escape", "secret.txt"),
		]) {
			const value = proposal();
			value.candidate.assets = [{ path, purpose: "spec" }];
			await expect(
				snapshotProposal(
					value,
					"design",
					1,
					allowed,
					new AbortController().signal,
				),
			).rejects.toThrow("outside authorized directories");
		}
		const spec = join(allowed, "spec.txt");
		writeFileSync(spec, "authorized");
		symlinkSync(spec, join(allowed, "linked.txt"));
		const value = proposal();
		value.candidate.assets = [
			{ path: join(allowed, "linked.txt"), purpose: "spec" },
		];
		const frozen = await snapshotProposal(
			value,
			"design",
			1,
			allowed,
			new AbortController().signal,
		);
		expect(readFileSync(frozen.content.candidate.assets[0]!.path, "utf8")).toBe(
			"authorized",
		);
	});
	it("uses the shared stock path and preserves operator-customized planning", () => {
		const pipeline = defaultWorkflows.find((w) => w.id === "factory-pipeline")!;
		expect(
			pipeline.steps.find((s) => s.id === "architecture")?.architectureContract,
		).toBe("architecture-v1");
		const custom = structuredClone(defaultWorkflows);
		custom
			.find((w) => w.id === "factory-pipeline")!
			.steps.find((s) => s.id === "architecture")!.prompt = "Custom design";
		expect(
			(upgradeWorkflows(custom) as Workflow[])
				.find((w) => w.id === "factory-pipeline")!
				.steps.find((s) => s.id === "architecture")!.prompt,
		).toBe("Custom design");
	});
	it("stops the workflow when the proposal tries to snapshot a restricted file", async () => {
		const outside = mkdtempSync(join(tmpdir(), "architecture-restricted-"));
		homes.push(outside);
		const path = join(outside, "secret.txt");
		writeFileSync(path, "restricted");
		const value = proposal();
		value.candidate.assets = [{ path, purpose: "spec" }];
		const { runtime, run, running, implemented } = setup("meaningful", {
			agent: async () => value,
		});
		await running;
		expect(run.status).toBe("failed");
		expect(run.architectureProposals).toEqual([]);
		expect(implemented).toEqual([]);
		await runtime.shutdown();
	});
});

it("protects architecture decisions, rejects stale tabs, and routes chat feedback through regeneration", async () => {
	const { runtime, run, implemented } = setup();
	await waiting(run);
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("unused");
		},
		stop: (id) => runtime.stop(id),
	});
	const p = run.architectureProposals![0]!;
	const body = {
		proposalId: p.id,
		version: p.version,
		digest: p.digest,
		decision: "accept",
	};
	try {
		const denied = await server.app.inject({
			method: "POST",
			url: `/api/runs/${run.id}/architecture-decision`,
			headers: { cookie: "", "x-factory-request": "1" },
			payload: body,
		});
		expect(denied.statusCode).toBe(401);
		const stale = await server.app.inject({
			method: "POST",
			url: `/api/runs/${run.id}/architecture-decision`,
			headers: { "x-factory-request": "1" },
			payload: { ...body, digest: "stale" },
		});
		expect(stale.statusCode).toBe(409);
		expect(implemented).toHaveLength(0);
		const chat = await server.app.inject({
			method: "POST",
			url: `/api/runs/${run.id}/messages`,
			headers: { "x-factory-request": "1" },
			payload: { text: "Keep inherited Takeover work in the revised plan" },
		});
		expect(chat.statusCode).toBe(202);
		await vi.waitFor(() => expect(run.architectureProposals).toHaveLength(2));
		await waiting(run);
		const next = run.architectureProposals!.at(-1)!;
		const accepted = await server.app.inject({
			method: "POST",
			url: `/api/runs/${run.id}/architecture-decision`,
			headers: { "x-factory-request": "1" },
			payload: {
				...body,
				proposalId: next.id,
				version: next.version,
				digest: next.digest,
			},
		});
		expect(accepted.statusCode).toBe(202);
		const duplicate = await server.app.inject({
			method: "POST",
			url: `/api/runs/${run.id}/architecture-decision`,
			headers: { "x-factory-request": "1" },
			payload: body,
		});
		expect(duplicate.statusCode).toBe(409);
		await finished(runtime, run);
		expect(implemented).toHaveLength(1);
	} finally {
		await runtime.shutdown();
		await server.stop();
	}
});
it("never advances an exhausted failed candidate-review loop", async () => {
	const { runtime, run, implemented } = setup("meaningful", {
		agent: async (c) =>
			c.step.architectureContract === "architecture-v1"
				? proposal()
				: { approved: false, feedback: ["Resolve the boundary"] },
	});
	await vi.waitFor(() => expect(run.status).toBe("failed"), { timeout: 15000 });
	expect(run.error).toMatch(/Iteration limit/);
	expect(implemented).toEqual([]);
	expect(run.architectureDecisions ?? []).toEqual([]);
	await runtime.shutdown();
});

it("requires fresh acceptance when later requirements change the accepted architecture", async () => {
	let implementations = 0;
	const { runtime, run } = setup("meaningful", {
		agent: async (c) => {
			if (c.step.architectureContract === "architecture-v1") return proposal();
			if (c.step.architectureContract === "architecture-review-v1")
				return { approved: true, feedback: [] };
			implementations++;
			return implementations === 1
				? {
						status: "blocked",
						architectureRevision: true,
						summary:
							"A new requirement changes the boundary; completed work is preserved.",
						checks: [],
						questions: [],
					}
				: {
						status: "completed",
						summary: "Implemented after new acceptance",
						checks: [],
						questions: [],
					};
		},
	});
	await waiting(run);
	const first = run.architectureProposals![0]!;
	decide(runtime, run);
	await vi.waitFor(() => expect(run.architectureProposals).toHaveLength(2));
	await waiting(run);
	expect(implementations).toBe(1);
	expect(first.status).toBe("superseded");
	expect(run.architectureDecisions).toHaveLength(1);
	decide(runtime, run);
	await finished(runtime, run);
	expect(implementations).toBe(2);
});
it("upgrades untouched stock planning, preserving customized model settings and frozen active runs", async () => {
	const { legacyReviewSteps } = await import(
		"../src/factory/defaultWorkflows.js"
	);
	const old = structuredClone(defaultWorkflows);
	old.find((w) => w.id === "factory-pipeline")!.steps = legacyReviewSteps.map(
		(s) => StepSchema.parse(s),
	);
	const upgraded = upgradeWorkflows(old) as Workflow[];
	expect(
		upgraded
			.find((w) => w.id === "factory-pipeline")!
			.steps.some((s) => s.architectureContract === "architecture-v1"),
	).toBe(true);
	const customized = structuredClone(defaultWorkflows);
	customized.find((w) => w.id === "factory-pipeline")!.steps =
		legacyReviewSteps.map((s) => StepSchema.parse(s));
	customized
		.find((w) => w.id === "factory-pipeline")!
		.steps.find((s) => s.id === "plan-review")!.model = "operator-selected";
	expect(
		(upgradeWorkflows(customized) as Workflow[])
			.find((w) => w.id === "factory-pipeline")!
			.steps.some((s) => s.architectureContract),
	).toBe(false);
	const { runtime, run, home, hooks } = setup();
	await waiting(run);
	const frozen = structuredClone(run.workflowDefinitions);
	runtime.updateWorkflows(customized);
	await runtime.shutdown();
	const restored = new WorkflowRuntime(home, hooks);
	expect(restored.get(run.id).workflowDefinitions).toEqual(frozen);
	await restored.shutdown();
});

it("recovers acceptance saved immediately before shutdown without asking again or advancing twice", async () => {
	const { runtime, run, home, hooks, implemented } = setup();
	await waiting(run);
	const candidate = structuredClone(
		run.architectureProposals![0]!.content.candidate,
	);
	decide(runtime, run);
	// Abort in the same call stack, before the resolved wait can advance the graph.
	await runtime.shutdown();
	expect(implemented).toHaveLength(0);
	const restored = new WorkflowRuntime(home, hooks);
	const resumed = restored.get(run.id);
	restored.resumeAll();
	await finished(restored, resumed);
	expect(implemented).toEqual([{ plan: candidate, answers: [] }]);
	expect(resumed.architectureDecisions).toHaveLength(1);
	expect(resumed.architectureProposals![0]!.status).toBe("accepted");
});
