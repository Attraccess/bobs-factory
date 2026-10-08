import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CursorRunner } from "bobs-factory-cursor-runner";
import { afterEach, expect, it, vi } from "vitest";
import {
	defaultWorkflows,
	legacyReviewSteps,
	upgradeWorkflows,
} from "../src/factory/defaultWorkflows.js";
import { GuideSchema } from "../src/factory/FactoryResults.js";
import { captureEvidence, FactoryTools } from "../src/factory/FactoryTools.js";
import {
	attachRequirementCoverage,
	validateGuideCoverage,
} from "../src/factory/Guide.js";
import { roleProgress } from "../src/factory/Incremental.js";
import { qaDigest, qaRequirementIssues } from "../src/factory/Qa.js";
import {
	factoryReviewFixContext,
	recordReviewFix,
} from "../src/factory/ReviewRecovery.js";
import {
	type AggregateReview,
	aggregateForContext,
	aggregateReview,
	assertAggregateRevision,
	type ReviewBaseline,
	validateContractOutput,
	validateInventory,
	validateSpecialist,
} from "../src/factory/SpecialistReview.js";
import { StepSchema, validateWorkflows } from "../src/factory/Workflow.js";
import {
	type ExecutionContext,
	type RuntimeHooks,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { providerReceipt } from "./fixtures/merge-readiness.js";
import { qaExecution, qaScope } from "./fixtures/qa.js";

const dirs: string[] = [];
afterEach(() =>
	dirs.splice(0).forEach((d) => {
		rmSync(d, { recursive: true, force: true });
	}),
);
const source = { source: "originalInput", reference: "/acceptance/0" };
function inventory() {
	return validateInventory({
		schemaVersion: 1,
		requirements: [
			{
				id: "R1",
				criterion: "Reject invalid input",
				classification: "active",
				sources: [source],
			},
		],
		decisions: [],
		conflicts: [],
		sourceReceipt: { considered: [source], unavailable: [] },
		questions: [],
	});
}
it("retains and validates extraction recommendations without treating them as scope decisions", () => {
	const value = {
		...inventory(),
		questions: ["Should input validation reject blank strings?"],
		questionRecommendations: [
			{
				questionIndex: 0,
				answer: "Reject blank strings",
				reason: "The caller contract requires a nonblank string",
			},
		],
	};
	const result = validateInventory(value);
	expect(result.questionRecommendations).toEqual(value.questionRecommendations);
	expect(result.decisions).toEqual([]);
	expect(() =>
		validateInventory({
			...value,
			questionRecommendations: [
				{ ...value.questionRecommendations[0], questionIndex: 1 },
			],
		}),
	).toThrow("unique index within this questions array");
});
function baseline(): ReviewBaseline {
	return {
		schemaVersion: 1,
		round: 1,
		key: "specialist-review",
		inventory: inventory(),
		headSha: "head",
		baseSha: "base",
		historyLength: 0,
		reviewers: [
			{
				id: "business",
				key: "specialist-review/0/business",
				group: 0,
				contract: "coverage-v1",
			},
		],
		context: {},
		at: "today",
	};
}
function review() {
	return {
		summary: "Reviewed input validation",
		findings: [],
		coverage: [
			{
				requirementId: "R1",
				status: "met",
				evidence: [
					"validator.ts:4 rejects empty input; validation test passed",
				],
				reason: "Implemented and tested",
			},
		],
	};
}
function receipt(b = baseline(), value: unknown = review()) {
	return {
		...validateSpecialist(value, b, true),
		stamp: {
			reviewer: "business",
			stepKey: b.reviewers[0]!.key,
			round: b.round,
			inventoryDigest: b.inventory.digest,
			inventoryVersion: b.inventory.version,
			headSha: b.headSha,
			baseSha: b.baseSha,
		},
	};
}
it.each([
	"resolved",
	"accepted-rejection",
])("blocks unsupported reopening after an intervening omission of a %s finding", (status) => {
	const b = baseline();
	const finding = {
		id: "invalid",
		rating: 2,
		summary: "Invalid input",
		evidence: "validator.ts:4",
		status,
		reason: "Prior evidence settled this complaint",
		requirementIds: ["R1"],
	};
	const first = aggregateReview(b, [
		{ business: receipt(b, { ...review(), findings: [finding] }) },
	]);
	const secondBaseline = { ...b, round: 2 };
	const second = aggregateReview(
		secondBaseline,
		[{ business: receipt(secondBaseline) }],
		first,
	);
	expect(second.rawFindings[0]!.status).toBe(status);
	expect(second.reviewers[0]!.findings).toEqual([]);
	const thirdBaseline = { ...b, round: 3 };
	const context = {
		step: { id: "business", reviewContract: "coverage-v1" },
		stepKey: b.reviewers[0]!.key,
		run: {
			reviewRounds: [b, secondBaseline, thirdBaseline],
			history: [{ output: first }, { output: second }],
		},
	} as unknown as ExecutionContext;
	const reopened = { ...review(), findings: [{ ...finding, status: "open" }] };
	expect(() => validateContractOutput(context, reopened)).toThrow(
		"fresh evidence",
	);
	expect(() =>
		aggregateReview(
			thirdBaseline,
			[{ business: receipt(thirdBaseline, reopened) }],
			second,
		),
	).toThrow("fresh evidence");
	const supported = {
		...reopened,
		findings: [
			{
				...reopened.findings[0],
				freshEvidence: "New caller crashes at validator.ts:9 on revised head",
			},
		],
	};
	expect(() => validateContractOutput(context, supported)).not.toThrow();
	expect(
		aggregateReview(
			thirdBaseline,
			[{ business: receipt(thirdBaseline, supported) }],
			second,
		).approved,
	).toBe(false);
});

it.each([
	false,
	true,
])("retains a nested review association for guides, called QA, and restored approval steps (fanout=%s)", async (fanout) => {
	const tools = new FactoryTools({
		postComment: vi.fn(),
		command: async (_context, exe, args) =>
			exe === "git"
				? args[0] === "status"
					? ""
					: "changed-head"
				: args.includes("graphql")
					? JSON.stringify(providerReceipt({ headRefOid: "changed-head" }))
					: "[[]]",
	});
	let accepted: AggregateReview | undefined;
	const fixture = setup({
		agent: async (context) => {
			if (context.step.id !== "guide")
				return context.step.reviewContract === "inventory-v1"
					? inventory()
					: context.step.reviewContract === "coverage-v1"
						? review()
						: { summary: "Reviewed", findings: [] };
			accepted = aggregateForContext(context);
			expect(accepted?.approved).toBe(true);
			const guide = {
				goal: "Validation",
				summary: "Reviewed",
				decision: { status: "ready", summary: "Ready" },
				requirements: [
					{
						requirementId: "R1",
						criterion: "Reject invalid input",
						status: "supported",
						evidence: ["validator.ts:4"],
					},
				],
				behavior: [],
				checks: [],
				risks: [],
				reviewInstructions: ["Check input"],
			};
			context.progress = await roleProgress(context);
			validateGuideCoverage(context, guide);
			expect(() =>
				validateGuideCoverage(context, {
					...guide,
					requirements: [
						{ ...guide.requirements[0], requirementId: "unrelated" },
					],
				}),
			).toThrow("every active frozen inventory");
			return attachRequirementCoverage(context, guide);
		},
		tool: async (context) => {
			if (context.step.id === "qa") {
				const scope = qaScope();
				scope.stories.forEach((s) => {
					s.requirementRefs = ["R1"];
				});
				expect(aggregateForContext(context)).toEqual(accepted);
				expect(
					qaRequirementIssues(
						scope,
						context.outputs!,
						[],
						aggregateForContext(context)?.baseline.inventory,
					),
				).toEqual([]);
				const gate: ExecutionContext = {
					...context,
					step: { ...context.step, tool: "visual-gate", qaContract: "qa-v1" },
				};
				gate.progress = await roleProgress(gate);
				gate.run.outputs["visual-scope"] = scope;
				const capture = captureEvidence(gate, qaExecution());
				Object.assign(gate.run.outputs, {
					"visual-scope": scope,
					capture,
					"visual-review": {
						qaContract: "qa-v1",
						summary: "Inspected executed QA receipts",
						findings: [],
						qaReviewStamp: {
							headSha: accepted!.baseline.headSha,
							dirty: false,
							scopeHash: qaDigest(scope),
							captureHash: qaDigest(capture),
						},
					},
				});
				gate.outputs!["visual-scope"] = scope;
				const prefix = gate.stepKey!.replace(/[^/]+$/, "");
				gate.run.roleRevisions ??= {};
				for (const id of ["capture", "visual-review"])
					gate.run.roleRevisions[`${prefix}${id}`] =
						gate.progress.currentRevision!;
				const qaTools = new FactoryTools({
					postComment: vi.fn(),
					command: async (_ctx, _exe, args) =>
						args[0] === "status" ? "" : accepted!.baseline.headSha,
				});
				await expect(qaTools.tool(gate)).resolves.toMatchObject({
					approved: true,
				});
				// Missing specialist requirements need evidence correction, not an access wait.
				scope.stories[0]!.requirementRefs = ["unrelated"];
				await expect(qaTools.tool(gate)).resolves.toMatchObject({
					approved: false,
					qaRetry: true,
					evidenceIssues: expect.arrayContaining([
						expect.stringContaining("unknown active requirement ID unrelated"),
					]),
				});
				return {};
			}
			// The parent human-review step must detect the changed revision.
			return tools.tool(context);
		},
	});
	const child = structuredClone(fixture.workflow);
	child.allowedTriggers = ["workflow"];
	child.steps.at(-1)!.id = "aggregate-review";
	const qa = {
		id: "qa-child",
		name: "Called QA",
		allowedTriggers: ["workflow"],
		steps: [{ id: "qa", name: "QA", type: "tool", tool: "qa-fixture" }],
	};
	const parent = {
		id: "parent",
		name: "Parent",
		steps: [
			{ id: "child", name: "Review", type: "workflow", workflow: child.id },
			...(fanout
				? [
						{
							id: "post-review",
							name: "Post-review fanout",
							type: "fanout",
							groups: [
								[
									{
										id: "guide",
										name: "Guide",
										type: "agent",
										prompt: "Build guide",
									},
									{
										id: "qa-call",
										name: "QA",
										type: "workflow",
										workflow: qa.id,
									},
								],
							],
						},
					]
				: [
						{
							id: "guide",
							name: "Guide",
							type: "agent",
							prompt: "Build guide",
						},
						{ id: "qa-call", name: "QA", type: "workflow", workflow: qa.id },
					]),
			{
				id: "human-review",
				name: "Approve",
				type: "tool",
				tool: "human-review",
			},
		],
	};
	const definitions = validateWorkflows([
		...defaultWorkflows,
		child,
		qa,
		parent,
	]);
	fixture.runtime.updateWorkflows(definitions);
	fixture.run.workflow = definitions.at(-1)!;
	fixture.run.workflowDefinitions = definitions;
	fixture.run.outputs["draft-pr"] = {
		url: "https://github.com/test/repo/pull/1",
	};
	await fixture.runtime.launch(fixture.run);
	expect(fixture.run.status).toBe("failed");
	expect(fixture.run.error).toContain(
		"Revision or accepted scope changed after review",
	);
	expect(fixture.run.outputs["review-gate"]).toBeUndefined();
	expect(
		(
			(fanout
				? (fixture.run.outputs["post-review"] as Record<string, unknown>[])[0]!
						.guide
				: fixture.run.outputs.guide) as { requirementCoverage: unknown }
		).requirementCoverage,
	).toBeDefined();
	expect(fixture.run.checkpoint?.reviewKey).toBe("child/specialist-review");
	const restored = new WorkflowRuntime(fixture.state, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const run = restored.get(fixture.run.id);
	expect(run.checkpoint?.reviewKey).toBe("child/specialist-review");
	const context = {
		run,
		step: { id: "handoff" },
		stepKey: "handoff",
		reviewKey: run.checkpoint?.reviewKey,
	} as unknown as ExecutionContext;
	expect(aggregateForContext(context)).toEqual(accepted);
	// Old accepted runs also retain safeguards without the newly persisted key.
	delete context.reviewKey;
	expect(aggregateForContext(context)).toEqual(accepted);
	context.stepKey = "unrelated/guide";
	expect(aggregateForContext(context)).toBeUndefined();
	context.stepKey = "guide";
	run.reviewRounds!.push({ ...run.reviewRounds!.at(-1)!, round: 2 });
	expect(() => aggregateForContext(context)).toThrow("no complete aggregate");
});

it.each([
	"missing",
	"branch-owned",
])("restores post-review fanout associations without replaying completed review (%s)", async (association) => {
	const fixture = setup({
		tool: async () => {
			throw new Error("Interrupted branch");
		},
	});
	const child = structuredClone(fixture.workflow);
	child.allowedTriggers = ["workflow"];
	const definitions = validateWorkflows([
		...defaultWorkflows,
		child,
		{
			id: "parent",
			name: "Parent",
			steps: [
				{ id: "child", name: "Review", type: "workflow", workflow: child.id },
				{
					id: "post-review",
					name: "Fanout",
					type: "fanout",
					groups: [
						[
							{
								id: "check",
								name: "Check",
								type: "tool",
								tool: "fixture-check",
							},
						],
					],
				},
			],
		},
	]);
	fixture.runtime.updateWorkflows(definitions);
	fixture.run.workflow = definitions.at(-1)!;
	fixture.run.workflowDefinitions = definitions;
	await fixture.runtime.launch(fixture.run);
	expect(fixture.run.status).toBe("failed");
	expect(fixture.run.error).toContain("Interrupted branch");
	const branch = fixture.run.checkpoint!.active!.children![0]!;
	let expectedKey = "child/specialist-review";
	if (association === "missing") {
		// Model a branch persisted before association inheritance was implemented.
		delete branch.reviewKey;
	} else {
		// A branch may have completed its own review before interruption.
		const ownBaseline = baseline();
		expectedKey = ownBaseline.key = "post-review/0/own-review";
		ownBaseline.reviewers[0]!.key = `${expectedKey}/0/business`;
		fixture.run.reviewRounds!.push(ownBaseline);
		fixture.run.history.push({
			step: "post-review/0/own-aggregate",
			output: aggregateReview(ownBaseline, [
				{ business: receipt(ownBaseline) },
			]),
			at: new Date().toISOString(),
		});
		branch.reviewKey = expectedKey;
	}
	fixture.runtime.save(fixture.run);
	const historyLength = fixture.run.history.length;
	const resumed = new WorkflowRuntime(fixture.state, {
		agent: async () => {
			throw new Error("Completed reviewers must not replay");
		},
		script: async () => ({}),
		tool: async (context) => {
			expect(context.reviewKey).toBe(expectedKey);
			expect(aggregateForContext(context)?.baseline.key).toBe(expectedKey);
			return { summary: "Review association preserved" };
		},
	});
	resumed.retry(fixture.run.id);
	await vi.waitFor(
		() => expect(resumed.get(fixture.run.id).status).toBe("completed"),
		{ timeout: 3000 },
	);
	expect(resumed.get(fixture.run.id).history).toHaveLength(historyLength + 2);
});

it("uses a renamed aggregate for unchanged-revision readiness after a fix", async () => {
	const b = baseline();
	b.key = "child/specialist-review";
	b.reviewers[0]!.key = `${b.key}/0/business`;
	const aggregate = aggregateReview(b, [{ business: receipt(b) }]);
	const context = {
		step: { id: "review-after-fix", tool: "review-after-fix" },
		stepKey: "review-after-fix",
		reviewKey: b.key,
		currentScope: () => ({}),
		run: {
			answers: [],
			reviewRounds: [b],
			history: [{ step: "child/aggregate-review", output: aggregate }],
			outputs: {
				"draft-pr": { url: "https://github.com/test/repo/pull/1" },
				"aggregate-review": aggregate,
			},
		},
		signal: new AbortController().signal,
		log: vi.fn(),
	} as unknown as ExecutionContext;
	const tools = new FactoryTools({
		postComment: vi.fn(),
		command: async (_context, exe, args) =>
			exe === "git"
				? args[0] === "status"
					? ""
					: "head"
				: args.includes("graphql")
					? JSON.stringify(providerReceipt())
					: "[[]]",
	});
	await expect(tools.tool(context)).resolves.toMatchObject({
		reviewRequired: false,
		headSha: "head",
		baseSha: "base",
	});
});
it("retains stable IDs and historical scope, requires amendments and explicit accepted skips", () => {
	const original = inventory();
	expect(validateInventory(original, original).version).toBe(1);
	expect(() =>
		validateInventory({ ...original, requirements: [] }, original),
	).toThrow();
	expect(() =>
		validateInventory(
			{
				...original,
				requirements: [
					{ ...original.requirements[0], criterion: "Other behavior" },
				],
			},
			original,
		),
	).toThrow("changeReason");
	const amended = validateInventory(
		{
			...original,
			requirements: [
				{
					...original.requirements[0],
					classification: "superseded",
					changeReason: "Alice replaced criterion in answers/1",
				},
				{
					id: "R2",
					criterion: "Reject only null",
					classification: "active",
					supersedes: ["R1"],
					sources: [source],
				},
			],
		},
		original,
	);
	expect(amended.version).toBe(2);
	expect(amended.requirements.map((r) => r.id)).toEqual(["R1", "R2"]);
	const b = baseline();
	const skipped = {
		...review(),
		coverage: [
			{
				...review().coverage[0],
				status: "deliberately_skipped",
				decisionId: "D1",
			},
		],
	};
	expect(() => validateSpecialist(skipped, b, true)).toThrow(
		"accepted scope decision",
	);
	b.inventory.decisions.push({
		id: "D1",
		acceptedBy: "Alice",
		rationale: "Outside this release",
		source,
		kind: "skip",
		requirementIds: ["R1"],
	});
	expect(validateSpecialist(skipped, b, true).coverage[0]!.status).toBe(
		"deliberately_skipped",
	);
	b.inventory.decisions[0]!.kind = "scope";
	expect(() => validateSpecialist(skipped, b, true)).toThrow(
		"accepted scope decision",
	);
});
it.each([
	[],
	[review().coverage[0], review().coverage[0]],
	[{ ...review().coverage[0], requirementId: "R9" }],
])("rejects missing, duplicate and unknown coverage (%j)", (coverage) => {
	expect(() =>
		validateSpecialist({ ...review(), coverage }, baseline(), true),
	).toThrow();
});
it("requires evidence, actionable unmet findings, preserved complaints and fresh reopening evidence", () => {
	const b = baseline();
	expect(() =>
		validateSpecialist(
			{ ...review(), coverage: [{ ...review().coverage[0], evidence: [] }] },
			b,
			true,
		),
	).toThrow();
	expect(() =>
		validateSpecialist(
			{
				...review(),
				coverage: [{ ...review().coverage[0], status: "not_met" }],
			},
			b,
			true,
		),
	).toThrow("actionable");
	const finding = {
		id: "invalid",
		rating: 3,
		summary: "Invalid input crashes",
		evidence: "validator.ts:4 dereferences null",
		requirementIds: ["R1"],
		status: "open",
	};
	const old = receipt(b, { ...review(), findings: [finding] });
	expect(() => validateSpecialist(review(), b, true, old)).toThrow("omission");
	old.findings[0]!.status = "resolved";
	expect(() =>
		validateSpecialist({ ...review(), findings: [finding] }, b, true, old),
	).toThrow("fresh evidence");
});
it("namespaces collisions, preserves observations and removed-role complaints, rejects stale receipts", () => {
	const b = baseline();
	b.reviewers.push({
		id: "security",
		key: "specialist-review/1/security",
		group: 1,
		contract: "specialist-v1",
	});
	const finding = {
		id: "same",
		rating: 1,
		summary: "Observation",
		evidence: "validator.ts:4",
		status: "open",
		requirementIds: [],
	};
	const business = receipt(b, { ...review(), findings: [finding] });
	const security = {
		...business,
		findings: [{ ...finding, rating: 3 }],
		coverage: [],
		stamp: {
			...business.stamp,
			reviewer: "security",
			stepKey: b.reviewers[1]!.key,
		},
	};
	const aggregate = aggregateReview(b, [{ business }, { security }]);
	expect(aggregate.rawFindings.map((f) => f.id)).toEqual([
		"business:same",
		"security:same",
	]);
	expect(aggregate.findings.map((f) => f.id)).toEqual(["security:same"]);
	b.reviewers.pop();
	expect(aggregateReview(b, [{ business }], aggregate).approved).toBe(false);
	security.stamp.round = 2;
	b.reviewers.push({
		id: "security",
		key: "specialist-review/1/security",
		group: 1,
		contract: "specialist-v1",
	});
	expect(() => aggregateReview(b, [{ business }, { security }])).toThrow(
		"stale",
	);
	expect(() => aggregateReview(b, [{ business }])).toThrow("missing");
});
it("requires coverage replacements and JSON contracts, migrates only untouched stock for new launches", () => {
	const saved = structuredClone(defaultWorkflows);
	const pipeline = saved.find((w) => w.id === "factory-pipeline")!;
	const fanout = pipeline.steps.find((s) => s.type === "fanout")!;
	fanout.groups!.pop();
	expect(() => validateWorkflows(saved)).toThrow("coverage-v1");
	fanout.groups!.push([
		StepSchema.parse({
			id: "replacement",
			name: "Replacement",
			type: "agent",
			prompt: "Review business scope",
			reviewContract: "coverage-v1",
		}),
	]);
	expect(validateWorkflows(saved)).toHaveLength(4);
	fanout.groups!.at(-1)![0]!.json = false;
	expect(() => validateWorkflows(saved)).toThrow("structured JSON");
	const old = structuredClone(defaultWorkflows);
	old.find((w) => w.id === "factory-pipeline")!.steps = legacyReviewSteps.map(
		(s) => StepSchema.parse(s),
	);
	const migrated = validateWorkflows(upgradeWorkflows(old));
	expect(
		migrated
			.find((w) => w.id === "factory-pipeline")!
			.steps.find((s) => s.type === "fanout")!.groups,
	).toHaveLength(6);
	expect(upgradeWorkflows(migrated)).toEqual(migrated);

	expect(
		migrated
			.find((w) => w.id === "factory-pipeline")!
			.steps.find((s) => s.id === "guide")!.prompt,
	).toBe(
		defaultWorkflows
			.find((w) => w.id === "factory-pipeline")!
			.steps.find((s) => s.id === "guide")!.prompt,
	);
	for (const change of ["custom-guide", "review-input", "gate-args"]) {
		const customized = structuredClone(old);
		const steps = customized.find((w) => w.id === "factory-pipeline")!.steps;
		if (change === "custom-guide")
			steps.find((s) => s.id === "guide")!.prompt =
				"Keep my custom walkthrough";
		if (change === "review-input")
			steps.find((s) => s.id === "guide")!.inputs = ["outputs.code-review"];
		if (change === "gate-args")
			steps.find((s) => s.id === "review-gate")!.args = ["--custom-policy"];
		const retained = validateWorkflows(upgradeWorkflows(customized)).find(
			(w) => w.id === "factory-pipeline",
		)!.steps;
		expect(
			retained.some((s) => s.id === "code-review"),
			change,
		).toBe(true);
	}
	old
		.find((w) => w.id === "factory-pipeline")!
		.steps.find((s) => s.id === "code-review")!.model = "custom-model";
	expect(
		validateWorkflows(upgradeWorkflows(old))
			.find((w) => w.id === "factory-pipeline")!
			.steps.some((s) => s.id === "code-review"),
	).toBe(true);
});
function setup(hooks: Partial<RuntimeHooks> = {}) {
	const home = mkdtempSync(join(tmpdir(), "specialist-review-"));
	dirs.push(home);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: home, encoding: "utf8" }).trim();
	git("init", "-b", "main");
	git("config", "user.email", "fixture@example.test");
	git("config", "user.name", "Fixture");
	writeFileSync(
		join(home, "validator.ts"),
		"export const validate = (value: unknown) => value != null;\n",
	);
	git("add", ".");
	git("commit", "-m", "initial");
	git("update-ref", "refs/remotes/origin/main", "HEAD");
	// State outside worktree keeps the reviewed revision clean.
	const state = mkdtempSync(join(tmpdir(), "specialist-state-"));
	dirs.push(state);
	const runtime = new WorkflowRuntime(state, {
		agent: async (ctx) =>
			ctx.step.reviewContract === "inventory-v1"
				? inventory()
				: ctx.step.reviewContract === "coverage-v1"
					? review()
					: { summary: "Reviewed", findings: [] },
		tool: async () => ({}),
		script: async () => ({}),
		...hooks,
	});
	const stock = defaultWorkflows.find((w) => w.id === "factory-pipeline")!;
	const steps = stock.steps
		.filter((s) =>
			["extract-requirements", "specialist-review", "review-gate"].includes(
				s.id,
			),
		)
		.map((s) => ({ ...s, branches: [], next: undefined }));
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{ id: "review-fixture", name: "Review fixture", steps },
	]).at(-1)!;
	runtime.updateWorkflows([...defaultWorkflows, workflow]);
	const run = runtime.create({
		title: "Input validation",
		input: "Reject invalid input",
		repositoryId: "fixture",
		workspace: home,
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	return { runtime, run, home, state, git, workflow };
}
it("pauses unchanged specialist rejections and resumes the fixer after assistance", async () => {
	let fixes = 0;
	const fixture = setup({
		agent: async (ctx) => {
			if (ctx.step.id === "code-fix") {
				fixes++;
				expect(factoryReviewFixContext(ctx).findings.map((f) => f.id)).toEqual([
					"security-review:external",
				]);
				return recordReviewFix(
					ctx,
					{
						summary: "Protected deployment needs access",
						dispositions: [
							{
								id: "security-review:external",
								status: "rejected",
								reason: "External access is required",
							},
						],
					},
					(await roleProgress(ctx)).currentRevision,
				);
			}
			if (ctx.step.reviewContract === "inventory-v1") return inventory();
			if (ctx.step.reviewContract === "coverage-v1") return review();
			return {
				summary: "Reviewed",
				findings:
					ctx.step.id === "security-review"
						? [
								{
									id: "external",
									rating: 3,
									summary: "Protected validation is blocked",
									evidence: "Protected deployment requires access",
									status: ctx.run.answers.length ? "resolved" : "open",
									...(ctx.run.answers.length
										? { reason: "Access restored and validation completed" }
										: {}),
								},
							]
						: [],
			};
		},
	});
	const definition = structuredClone(fixture.workflow);
	definition.steps.find((s) => s.id === "review-gate")!.branches = [
		{ when: { path: "approved", equals: false }, next: "code-fix" },
	];
	definition.steps.find((s) => s.id === "review-gate")!.next = "end";
	definition.steps.push(
		StepSchema.parse({
			id: "code-fix",
			name: "Fix",
			type: "agent",
			prompt: "Fix findings",
			next: "extract-requirements",
		}),
	);
	fixture.run.workflow = validateWorkflows([
		...defaultWorkflows,
		definition,
	]).at(-1)!;
	const launched = fixture.runtime.launch(fixture.run);
	try {
		await vi.waitFor(
			() => expect(fixture.run.status, fixture.run.error).toBe("waiting"),
			{ timeout: 10000 },
		);
		expect(fixes).toBe(1);
		expect(fixture.run.outputs["code-fix"]).toMatchObject({
			reviewAssessment: { unchangedCode: true },
		});
		expect(fixture.run.outputs["review-gate"]).toMatchObject({
			approved: false,
			reviewBlocked: true,
		});
		fixture.runtime.answer(fixture.run.id, "Deployment access restored");
		await launched;
	} finally {
		fixture.runtime.stop(fixture.run.id);
		await launched;
	}
	expect(fixture.run.status, fixture.run.error).toBe("completed");
	expect(fixes).toBe(2);
	expect(fixture.run.outputs["review-gate"]).toMatchObject({ approved: true });
});
it("shares immutable revision/context across six branches and preserves each branch progress identity", async () => {
	const contexts: ExecutionContext[] = [];
	const fixture = setup({
		agent: async (ctx) => {
			if (ctx.step.reviewContract === "inventory-v1") return inventory();
			contexts.push(ctx);
			await new Promise((resolve) =>
				setTimeout(resolve, ctx.step.id === "security-review" ? 20 : 0),
			);
			const progress = await roleProgress(ctx);
			expect(progress.visit).toBe(1);
			expect(progress.previousOutput).toBeUndefined();
			return ctx.step.reviewContract === "coverage-v1"
				? review()
				: { summary: "Reviewed", findings: [] };
		},
	});
	await fixture.runtime.launch(fixture.run);
	expect(fixture.run.status, fixture.run.error).toBe("completed");
	expect(contexts).toHaveLength(6);
	expect(new Set(contexts.map((c) => JSON.stringify(c.input))).size).toBe(1);
	expect(new Set(contexts.map((c) => c.stepKey)).size).toBe(6);
	const aggregate = fixture.run.outputs["review-gate"] as AggregateReview;
	expect(aggregate.approved).toBe(true);
	expect(aggregate.reviewers.map((r) => r.stamp.stepKey)).toEqual(
		contexts.map((c) => c.stepKey),
	);
	assertAggregateRevision(aggregate, fixture.git("rev-parse", "HEAD"));
	expect(() => assertAggregateRevision(aggregate, "other-head")).toThrow(
		"different revision",
	);
});
it("waits for mixed-runner cleanup before checking the review worktree", async () => {
	let installed!: () => void;
	const ready = new Promise<void>((resolve) => {
		installed = resolve;
	});
	let dirtyDuringReview = "";
	const fixture = setup({
		agent: async (ctx) => {
			if (ctx.step.reviewContract === "inventory-v1") return inventory();
			if (ctx.step.id === "security-review") {
				// Simulate the provider call, but use production Cursor config setup
				// and cleanup. No native runner or provider credits are used.
				const runner = new CursorRunner({
					workingDirectory: ctx.run.workspace,
					factoryHome: fixture.state,
					runnerArtifactLeaseDirectory: join(fixture.state, "leases"),
				}) as unknown as {
					installPermissionsArtifacts(workspace: string): Promise<void>;
					uninstallPermissionsArtifacts(): void;
				};
				await runner.installPermissionsArtifacts(ctx.run.workspace);
				try {
					dirtyDuringReview = fixture.git("status", "--porcelain");
					installed();
					await vi.waitFor(() => {
						expect(
							ctx.run.history.some((h) =>
								h.step.endsWith("/requirements-review"),
							),
						).toBe(true);
					});
				} finally {
					runner.uninstallPermissionsArtifacts();
				}
			} else await ready;
			return ctx.step.reviewContract === "coverage-v1"
				? review()
				: { summary: "Reviewed", findings: [] };
		},
	});
	await fixture.runtime.launch(fixture.run);
	expect(dirtyDuringReview).toContain(".cursor/");
	expect(fixture.git("status", "--porcelain")).toBe("");
	expect(fixture.run.status, fixture.run.error).toBe("completed");
	expect(fixture.run.outputs["review-gate"]).toMatchObject({ approved: true });
});

it.each([
	"validator.ts",
	"untracked.txt",
	".cursor/hooks.json",
	"commit",
])("invalidates a specialist round with remaining product changes (%s)", async (change) => {
	const fixture = setup({
		agent: async (ctx) => {
			if (ctx.step.reviewContract === "inventory-v1") return inventory();
			if (ctx.step.id === "security-review") {
				if (change === "commit")
					fixture.git("commit", "--allow-empty", "-m", "changed head");
				else {
					if (change.startsWith(".cursor/"))
						mkdirSync(join(fixture.home, ".cursor"));
					writeFileSync(join(fixture.home, change), "product edit");
				}
			}
			return ctx.step.reviewContract === "coverage-v1"
				? review()
				: { summary: "Reviewed", findings: [] };
		},
	});
	await fixture.runtime.launch(fixture.run);
	expect(fixture.run.status).toBe("failed");
	expect(fixture.run.error).toContain(
		change === "commit" ? "reviewed revision" : "clean worktree",
	);
	expect(fixture.run.outputs["specialist-review"]).toBeUndefined();
	expect(fixture.run.outputs["review-gate"]).toBeUndefined();
});

it("cancels incomplete reviewers without approving; retry restores the same baseline and completed branches", async () => {
	let fail = true;
	const calls: string[] = [];
	const fixture = setup({
		agent: async (ctx) => {
			calls.push(ctx.step.id);
			if (ctx.step.reviewContract === "inventory-v1") return inventory();
			if (ctx.step.id === "requirements-review" && fail) {
				await vi.waitFor(
					() =>
						expect(
							ctx.run.history.some((h) => h.step.endsWith("/security-review")),
						).toBe(true),
					{ timeout: 10000 },
				);
				throw new Error("Reviewer unavailable");
			}
			return ctx.step.reviewContract === "coverage-v1"
				? review()
				: { summary: "Reviewed", findings: [] };
		},
	});
	await fixture.runtime.launch(fixture.run);
	expect(fixture.run.status).toBe("failed");
	expect(fixture.run.outputs["review-gate"]).toBeUndefined();
	const baseline = structuredClone(fixture.run.reviewRounds![0]);
	fail = false;
	const restored = new WorkflowRuntime(fixture.state, {
		agent: async (ctx) => {
			calls.push(ctx.step.id);
			return review();
		},
		script: async () => ({}),
		tool: async () => ({}),
	});
	restored.retry(fixture.run.id);
	await vi.waitFor(
		() => expect(restored.get(fixture.run.id).status).toBe("completed"),
		{ timeout: 10000 },
	);
	expect(restored.get(fixture.run.id).reviewRounds).toEqual([baseline]);
	expect(calls.filter((id) => id === "security-review")).toHaveLength(1);
});
it("requires stable inventory QA references and explicit exclusions, even with zero stories", () => {
	const scope = qaScope();
	const inv = inventory();
	const outputs = {};
	expect(qaRequirementIssues(scope, outputs, [], inv)).not.toEqual([]);
	scope.stories.forEach((s) => {
		s.requirementRefs = ["R1"];
	});
	expect(qaRequirementIssues(scope, outputs, [], inv)).toEqual([]);
	scope.stories = [];
	scope.exclusions = [];
	expect(qaRequirementIssues(scope, outputs, [], inv)).toEqual([
		"R1: no QA story or explicit justified exclusion",
	]);
	scope.exclusions = [
		{
			requirementRef: "R1",
			reason: "Verified with static type check; no executable behavior",
		},
	];
	expect(qaRequirementIssues(scope, outputs, [], inv)).toEqual([]);
});

it("re-extracts refined requirements after a real fix, preserves settled findings and accepted skip evidence", async () => {
	let fixed = false;
	const fixture = setup({
		agent: async (ctx) => {
			if (ctx.step.id === "code-fix") {
				writeFileSync(
					join(ctx.run.workspace, "validator.ts"),
					"export const validate = (value: unknown) => typeof value === 'string' && Boolean(value.trim());\n",
				);
				execFileSync("git", ["add", "validator.ts"], {
					cwd: ctx.run.workspace,
				});
				execFileSync("git", ["commit", "-m", "fix: reject blank input"], {
					cwd: ctx.run.workspace,
				});
				fixed = true;
				ctx.run.answers.push({
					questions: ["Include remote audit logging?"],
					answer: "Alice: deliberately skip remote audit logging this release",
					at: new Date().toISOString(),
				});
				return {
					summary: "Fixed invalid input",
					dispositions: [
						{
							id: "requirements-review:blank",
							status: "fixed",
							reason: "Blank strings now rejected",
						},
					],
				};
			}
			if (ctx.step.reviewContract === "inventory-v1") {
				const inv = inventory();
				if (fixed) {
					inv.requirements.push({
						id: "R2",
						criterion: "Remote audit logging",
						classification: "active",
						sources: [{ source: "answers", reference: "/0" }],
						supersedes: [],
					});
					inv.decisions.push({
						id: "D1",
						kind: "skip",
						requirementIds: ["R2"],
						acceptedBy: "Alice",
						rationale: "Deferred from this release",
						source: { source: "answers", reference: "/0" },
					});
				}
				return inv;
			}
			if (ctx.step.reviewContract === "coverage-v1")
				return {
					...review(),
					findings: [
						{
							id: "blank",
							rating: 3,
							summary: "Blank input passes",
							evidence: fixed
								? "validator.ts now rejects blanks; verified"
								: "validator.ts lacks type/string validation",
							requirementIds: ["R1"],
							status: fixed ? "resolved" : "open",
							...(fixed
								? {
										reason:
											"Confirmed the corrective revision rejects blank strings",
									}
								: {}),
						},
					],
					coverage: fixed
						? [
								...review().coverage,
								{
									requirementId: "R2",
									status: "deliberately_skipped",
									evidence: ["Alice accepted answers/0"],
									reason: "Deferred from this release",
									decisionId: "D1",
								},
							]
						: [{ ...review().coverage[0], status: "not_met" }],
				};
			return { summary: "Reviewed", findings: [] };
		},
	});
	const definition = structuredClone(fixture.workflow);
	definition.steps.find((s) => s.id === "review-gate")!.branches = [
		{ when: { path: "approved", equals: false }, next: "code-fix" },
	];
	definition.steps.find((s) => s.id === "review-gate")!.next = "end";
	definition.steps.push(
		StepSchema.parse({
			id: "code-fix",
			name: "Fix",
			type: "agent",
			prompt: "Fix consequential findings",
			next: "extract-requirements",
		}),
	);
	fixture.run.workflow = validateWorkflows([
		...defaultWorkflows,
		definition,
	]).at(-1)!;
	await fixture.runtime.launch(fixture.run);
	expect(fixture.run.status, fixture.run.error).toBe("completed");
	expect(fixture.run.reviewRounds).toHaveLength(2);
	const [before, after] = fixture.run.reviewRounds!;
	expect(after!.headSha).not.toBe(before!.headSha);
	expect(after!.inventory.version).toBe(2);
	expect(after!.inventory.requirements.map((r) => r.id)).toEqual(["R1", "R2"]);
	expect(
		(fixture.run.outputs["review-gate"] as AggregateReview).rawFindings[0],
	).toMatchObject({ id: "requirements-review:blank", status: "resolved" });
});

it("holds late steering for a fresh extraction before fanout and rejects dirty review", async () => {
	let extra = false;
	const fixture = setup({
		agent: async (ctx) => {
			if (ctx.step.reviewContract === "inventory-v1") {
				if (!extra) {
					extra = true;
					ctx.run.answers.push({
						questions: ["Refinement"],
						answer: "Accepted boundary case",
						at: new Date().toISOString(),
					});
				}
				return inventory();
			}
			return ctx.step.reviewContract === "coverage-v1"
				? review()
				: { summary: "Reviewed", findings: [] };
		},
	});
	await fixture.runtime.launch(fixture.run);
	expect(fixture.run.status, fixture.run.error).toBe("completed");
	expect(
		fixture.run.history.filter((h) => h.step === "extract-requirements"),
	).toHaveLength(2);
	expect(fixture.run.reviewRounds).toHaveLength(1);
	const dirty = setup();
	writeFileSync(join(dirty.home, "uncommitted.txt"), "pending work");
	await dirty.runtime.launch(dirty.run);
	expect(dirty.run.status).toBe("failed");
	expect(dirty.run.error).toContain("clean worktree");
});

it("attaches authoritative guide coverage with accepted skips and rejects relabeling", () => {
	const b = baseline();
	b.inventory = validateInventory(
		{
			...b.inventory,
			decisions: [
				{
					id: "D1",
					kind: "skip",
					requirementIds: ["R1"],
					acceptedBy: "Alice",
					rationale: "Deferred explicitly",
					source,
				},
			],
		},
		b.inventory,
	);
	const value = review();
	const output = receipt(b, {
		...value,
		coverage: [
			{
				...value.coverage[0],
				status: "deliberately_skipped",
				decisionId: "D1",
				reason: "Alice accepted the deferral",
			},
		],
	});
	const aggregate = aggregateReview(b, [{ business: output }]);
	const context = {
		step: { id: "guide", prompt: "Custom guide" },
		stepKey: "guide",
		run: {
			reviewRounds: [b],
			history: [{ step: "review-gate", output: aggregate }],
		},
		progress: { currentRevision: { headSha: "head" } },
	} as unknown as ExecutionContext;
	const guide = {
		goal: "Validation",
		summary: "Review accepted scope",
		decision: { status: "ready", summary: "Scope accounted for" },
		requirements: [
			{
				requirementId: "R1",
				criterion: "Reject invalid input",
				status: "waived",
				evidence: ["agent recap"],
			},
		],
		behavior: [],
		checks: [],
		risks: [],
		reviewInstructions: ["Confirm accepted scope"],
	};
	expect(() => validateGuideCoverage(context, guide)).not.toThrow();
	const attached = GuideSchema.parse(attachRequirementCoverage(context, guide));
	expect(attached.requirementCoverage?.assessments).toEqual([
		{
			requirementId: "R1",
			criterion: "Reject invalid input",
			status: "deliberately_skipped",
			evidence: value.coverage[0]!.evidence,
			reason: "Alice accepted the deferral",
			decision: {
				id: "D1",
				acceptedBy: "Alice",
				rationale: "Deferred explicitly",
				source,
			},
		},
	]);
	expect(attached.requirementCoverage?.reviewers[0]?.reviewer).toBe("business");
	expect(() =>
		validateGuideCoverage(context, {
			...guide,
			requirements: [{ ...guide.requirements[0], status: "supported" }],
		}),
	).toThrow("cannot differ");
	expect(() =>
		validateGuideCoverage(context, {
			...guide,
			requirements: [{ ...guide.requirements[0], requirementId: "R2" }],
		}),
	).toThrow("every active frozen inventory");
});

it("retains removed-reviewer disputes across multiple rounds and their observations in guides", () => {
	const b = baseline();
	b.reviewers.push({
		id: "security",
		key: "specialist-review/1/security",
		group: 1,
		contract: "specialist-v1",
	});
	const business = receipt(b);
	const security = {
		...business,
		stamp: {
			...business.stamp,
			reviewer: "security",
			stepKey: b.reviewers[1]!.key,
		},
		coverage: [],
		findings: [
			{
				id: "note",
				rating: 1,
				summary: "Retained observation",
				evidence: "validator.ts:4 inspected",
				status: "open" as const,
				requirementIds: [],
			},
		],
		disagreements: ["Interface recommendation conflicts with architecture"],
	};
	const first = aggregateReview(b, [{ business }, { security }]);
	b.reviewers.pop();
	const second = aggregateReview(b, [{ business }], first);
	const third = aggregateReview(b, [{ business }], second);
	expect(third.approved).toBe(false);
	expect(third.disagreements).toEqual([
		"security: Interface recommendation conflicts with architecture",
	]);
	const resolution = {
		disagreement: third.disagreements[0]!,
		reason: "Existing interface serves the accepted callers",
		evidence: "All existing caller assertions passed at current head",
	};
	const fourth = aggregateReview(
		b,
		[{ business: { ...business, disputeResolutions: [resolution] } }],
		third,
	);
	expect(fourth.approved).toBe(true);
	expect(() => assertAggregateRevision(fourth, "head", "base")).not.toThrow();
	const context = {
		step: { id: "guide" },
		stepKey: "guide",
		run: {
			reviewRounds: [b],
			history: [{ step: "review-gate", output: fourth }],
		},
	} as unknown as ExecutionContext;
	const guide = {
		goal: "Validation",
		summary: "Review",
		decision: { status: "ready", summary: "Ready" },
		requirements: [
			{
				requirementId: "R1",
				criterion: "Reject invalid input",
				status: "supported",
				evidence: ["Code and assertions"],
			},
		],
		behavior: [],
		checks: [],
		risks: [],
		reviewInstructions: ["Review observations"],
	};
	const attached = GuideSchema.parse(attachRequirementCoverage(context, guide));
	expect(
		attached.requirementCoverage?.reviewers.find(
			(r) => r.reviewer === "security",
		)?.findings[0],
	).toMatchObject({ id: "note", rating: 1, summary: "Retained observation" });
	expect(
		attached.requirementCoverage?.reviewers.find(
			(r) => r.reviewer === "business",
		)?.disputeResolutions,
	).toEqual([resolution]);
});
