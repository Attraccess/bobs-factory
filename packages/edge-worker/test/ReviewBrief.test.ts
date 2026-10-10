import { expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { validateFactoryResult } from "../src/factory/FactoryResults.js";
import {
	attachRequirementCoverage,
	stampGuideContract,
	validateGuide,
	validateGuideCoverage,
	validateGuideGeneration,
} from "../src/factory/Guide.js";
import { guideGapRecovery } from "../src/factory/GuideRecovery.js";
import type { MergeReadiness } from "../src/factory/MergeReadiness.js";
import { resolveRoleResult } from "../src/factory/ResultArtifacts.js";
import {
	BRIEF_CONTRACT,
	briefMarkdown,
	GeneratedBriefSchema,
	guideGaps,
	guideHeadline,
	guideReady,
	type ReviewBrief,
} from "../src/factory/ReviewBrief.js";
import {
	aggregateReview,
	type ReviewBaseline,
	validateInventory,
	validateSpecialist,
} from "../src/factory/SpecialistReview.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";

const stockBrief = defaultWorkflows
	.find((w) => w.id === "factory-pipeline")!
	.steps.find((s) => s.id === "guide")!;
const source = { source: "originalInput", reference: "/0" };

function baseline(): ReviewBaseline {
	const inventory = validateInventory({
		schemaVersion: 1,
		requirements: [
			"Group pages say group",
			"Resources keep resource",
			"Ship a migration",
			"No generated code",
		].map((criterion, i) => ({
			id: `R${i + 1}`,
			criterion,
			classification: "active",
			sources: [source],
		})),
		decisions: [
			{
				id: "D1",
				acceptedBy: "Jan",
				rationale: "No schema change needed",
				source,
				kind: "skip",
				requirementIds: ["R3"],
			},
		],
		conflicts: [],
		sourceReceipt: { considered: [source], unavailable: [] },
		questions: [],
	});
	return {
		schemaVersion: 1,
		round: 1,
		key: "specialist-review",
		inventory,
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

function context(): ExecutionContext {
	const b = baseline();
	const coverage = ["R1", "R2", "R4"].map((requirementId) => ({
		requirementId,
		status: "met",
		evidence: ["Executed browser check"],
		reason: "Observed",
	}));
	const review = {
		status: "completed",
		blockers: [],
		summary: "Reviewed",
		findings: [],
		coverage: [
			...coverage,
			{
				requirementId: "R3",
				status: "deliberately_skipped",
				evidence: ["Accepted decision"],
				reason: "Skipped by decision",
				decisionId: "D1",
			},
		],
	};
	const aggregate = aggregateReview(b, [
		{
			business: {
				...validateSpecialist(review, b, true),
				stamp: {
					reviewer: "business",
					stepKey: b.reviewers[0]!.key,
					round: b.round,
					inventoryDigest: b.inventory.digest,
					inventoryVersion: b.inventory.version,
					headSha: b.headSha,
					baseSha: b.baseSha,
				},
			},
		},
	]);
	return {
		step: stockBrief,
		stepKey: "guide",
		run: {
			reviewRounds: [b],
			history: [{ step: "review-gate", output: aggregate, at: "today" }],
			outputs: {
				capture: {
					screenshots: [{ area: "Group page", state: "German mobile" }],
				},
			},
			humanDecisions: [],
		},
		progress: {
			currentRevision: { headSha: "head", dirty: false },
			reviewScope: {
				files: ["src/en.json", "src/Header.tsx", "src/Header.test.tsx"],
			},
		},
		log: () => {},
	} as unknown as ExecutionContext;
}

function brief() {
	return {
		contract: BRIEF_CONTRACT,
		verdict: {
			headline: "Group pages now say “this group”.",
			readiness: "ready",
			why: "A wording fix seen on the real group page in both languages.",
		},
		ask: {
			source: "Linear ATT-764",
			quote: "On a group page it should say group.",
		},
		interpretation: [
			{
				topic: "Languages",
				chosen: "English and German",
				alternatives: ["English only"],
				decidedBy: "bob",
			},
		],
		requirements: [
			{
				id: "group-wording",
				text: "Group pages say group.",
				origin: "ask",
				covers: ["R1"],
				status: "shown",
				proof: {
					kind: "screens",
					shots: [
						{
							area: "Group page",
							state: "German mobile",
							label: "German subtitle",
							focus: { x: 0, y: 40, w: 100, h: 20 },
						},
					],
				},
				files: ["src/en.json", "src/Header.tsx"],
			},
			{
				id: "resource-wording",
				text: "Resources keep resource.",
				origin: "bob",
				covers: ["R2"],
				status: "tested",
				proof: {
					kind: "test",
					file: "src/Header.test.tsx",
					excerpt: "it.each(cases)('renders %s')",
					result: "16 cases pass",
				},
				more: [
					{
						kind: "flowRef",
						flow: "render",
						steps: [1],
						note: "Target type decides the sentence.",
					},
				],
				files: ["src/Header.test.tsx"],
			},
			{
				id: "migration",
				text: "No migration is shipped.",
				origin: "your-answer",
				covers: ["R3"],
				status: "waived",
				proof: {
					kind: "table",
					columns: ["Decision", "By"],
					rows: [{ cells: ["No schema change", "Jan"] }],
				},
				files: [],
			},
		],
		yourCall: [],
		system: {
			summary: "The header picks wording by target type.",
			flows: [
				{
					id: "render",
					title: "Header renders",
					trigger: "Page load",
					implements: ["group-wording", "resource-wording"],
					participants: [
						{ id: "page", label: "Group page" },
						{ id: "header", label: "PeopleHeader" },
					],
					steps: [
						{
							from: "page",
							to: "header",
							label: "targetType = group",
							change: "new",
						},
					],
				},
			],
			interfaces: [],
		},
		beyondAsk: [],
		notVerified: [],
		hygiene: [{ text: "No generated code committed", covers: ["R4"] }],
	};
}

it("accepts a complete brief bound to inventory, files and accepted evidence", () => {
	const value = brief();
	expect(() => validateGuideGeneration(value)).not.toThrow();
	expect(() => validateGuideCoverage(context(), value)).not.toThrow();
	expect(guideReady(value)).toBe(true);
	expect(guideGaps(value)).toEqual([]);
	expect(guideHeadline(value)).toBe("Group pages now say “this group”.");
});

it("stamps the contract only for brief guide steps", () => {
	const { contract: _contract, ...authored } = brief();
	expect(stampGuideContract(stockBrief, authored)).toMatchObject({
		contract: BRIEF_CONTRACT,
	});
	const legacy = { ...stockBrief, guideContract: undefined };
	expect(stampGuideContract(legacy, authored)).toBe(authored);
	expect(
		stampGuideContract(
			{ id: "capture", guideContract: BRIEF_CONTRACT },
			authored,
		),
	).toBe(authored);
});

it("rejects broken internal references, receipts in prose and legacy keys", () => {
	const issues = (value: unknown) => {
		const result = GeneratedBriefSchema.safeParse(value);
		return result.success ? [] : result.error.issues.map((i) => i.message);
	};
	const flowRef = brief();
	flowRef.requirements[1]!.more![0]!.steps = [3];
	expect(issues(flowRef)).toContain('Flow "render" has 1 steps');
	const actor = brief();
	actor.system.flows[0]!.steps[0]!.to = "database";
	expect(issues(actor)).toContain('Unknown participant "database"');
	const table = brief();
	table.requirements[2]!.proof = {
		kind: "table",
		columns: ["Decision", "By", "When"],
		rows: [{ cells: ["No schema change", "Jan"] }],
	};
	expect(issues(table)).toContain("Each row needs exactly one cell per column");
	const receipts = brief();
	receipts.verdict.why =
		"Receipt at /Users/jappy/.cyrus/factory/evidence/run/qa.json passed.";
	receipts.requirements[0]!.text = `Verified at ${"a".repeat(40)}.`;
	expect(issues(receipts)).toEqual(
		expect.arrayContaining([
			expect.stringContaining("Remove local absolute paths"),
			expect.stringContaining("Remove commit SHAs"),
		]),
	);
	const gap = brief();
	gap.requirements[0]!.status = "gap";
	expect(issues(gap)).toContain(
		"A requirement with status gap makes the brief not-ready",
	);
	expect(issues({ ...brief(), chapters: [] })).not.toEqual([]);
	// Code and command excerpts may quote real diff content, including SHAs.
	const excerpt = brief();
	excerpt.requirements[1]!.proof = {
		kind: "test",
		file: "src/Header.test.tsx",
		excerpt: `expect(head).toBe("${"b".repeat(40)}")`,
		result: "Passes",
	};
	expect(issues(excerpt)).toEqual([]);
});

it("binds every line to review coverage and every changed file to an explanation", () => {
	const fail = (value: unknown) => {
		try {
			validateGuideCoverage(context(), value);
			return "";
		} catch (error) {
			return JSON.stringify(
				(error as { issues?: unknown }).issues ?? String(error),
			);
		}
	};
	const uncovered = brief();
	uncovered.hygiene = [];
	expect(fail(uncovered)).toContain("missing: R4");
	const unknown = brief();
	unknown.requirements[0]!.covers = ["R9"];
	expect(fail(unknown)).toContain(
		'Unknown or inactive inventory requirement \\"R9\\"',
	);
	const wrongWaiver = brief();
	wrongWaiver.requirements[2]!.status = "shown";
	expect(fail(wrongWaiver)).toContain(
		"Deliberately skipped requirements use status waived",
	);
	const inventedGap = brief();
	inventedGap.requirements[0]!.status = "gap";
	inventedGap.verdict.readiness = "not-ready";
	expect(fail(inventedGap)).toContain("Status gap needs a covered requirement");
	const unexplained = brief();
	unexplained.requirements[1]!.files = [];
	expect(fail(unexplained)).toContain("unexplained: src/Header.test.tsx");
	const foreign = brief();
	foreign.requirements[0]!.files.push("src/unrelated.ts");
	expect(fail(foreign)).toContain("is not a changed file in this PR");
	const shot = brief();
	(shot.requirements[0]!.proof as { shots: { state: string }[] })
		.shots[0]!.state = "invented";
	expect(fail(shot)).toContain("not in the accepted capture inventory");
	const since = {
		...brief(),
		sinceLastReview: {
			previousHeadSha: "abcdef1",
			summary: "Wording adjusted",
			changes: [{ what: "German text", files: ["src/en.json"] }],
		},
	};
	expect(fail(since)).toContain("requires a revision you actually reviewed");
	const reviewed = context();
	reviewed.run.humanDecisions = [
		{ headSha: "abcdef1234", decision: "reject" } as never,
	];
	expect(() => validateGuideCoverage(reviewed, since)).not.toThrow();
});

it("attaches runtime coverage and resolves file indexes for brief steps", async () => {
	const ctx = context();
	const withCoverage = attachRequirementCoverage(ctx, brief()) as ReviewBrief;
	expect(withCoverage.contract).toBe(BRIEF_CONTRACT);
	expect(
		withCoverage.requirementCoverage?.assessments.map((a) => a.requirementId),
	).toEqual(["R1", "R2", "R3", "R4"]);
	const indexed = brief() as Record<string, any>;
	indexed.requirements[0].fileIndexes = [0, 1];
	delete indexed.requirements[0].files;
	const resolved = (await resolveRoleResult(ctx, indexed)) as ReviewBrief;
	expect(resolved.requirements[0]!.files).toEqual([
		"src/en.json",
		"src/Header.tsx",
	]);
	indexed.requirements[0].fileIndexes = [7];
	await expect(resolveRoleResult(ctx, indexed)).rejects.toThrow();
	expect(validateFactoryResult("guide", brief())).toMatchObject({
		contract: BRIEF_CONTRACT,
	});
});

it("routes not-ready briefs back to correction and publishes Markdown without receipts", () => {
	const value = brief();
	value.verdict.readiness = "not-ready";
	value.requirements[0]!.status = "gap";
	value.requirements[0]!.covers = ["R1"];
	expect(guideReady(value)).toBe(false);
	expect(guideGaps(value)).toEqual([
		{ id: "R1", status: "gap", line: "Group pages say group. (gap)" },
	]);
	const ctx = context();
	ctx.run.outputs.guide = value;
	(ctx.step as { branches: unknown[] }).branches = [
		{ when: { path: "fix", equals: true }, next: "ci-fix" },
	];
	const readiness = {
		url: "https://github.com/o/r/pull/1",
		headSha: "head",
		baseSha: "base",
		blockers: [],
	} as unknown as MergeReadiness;
	expect(guideGapRecovery(ctx, readiness)).toMatchObject({
		fix: true,
		blockers: [{ kind: "guide", action: "fix" }],
	});
	const markdown = briefMarkdown(brief() as ReviewBrief, "head-sha");
	expect(markdown).toContain("> On a group page it should say group.");
	expect(markdown).toContain("**2. Resources keep resource.** — 🧪 tests only");
	expect(markdown).toContain("Revision: head-sha");
	expect(markdown).not.toContain("/Users/");
});

it("reports authoring and evidence problems in one correction round", () => {
	const value = brief();
	value.verdict.why = "Receipt at /Users/jappy/evidence/qa.json passed.";
	value.requirements[1]!.files = [];
	let messages = "";
	try {
		validateGuide(context(), value);
	} catch (error) {
		messages = String((error as Error).message);
	}
	expect(messages).toContain("Remove local absolute paths");
	expect(messages).toContain("unexplained: src/Header.test.tsx");
});
