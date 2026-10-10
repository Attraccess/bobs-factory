import { expect, it } from "vitest";
import {
	defaultWorkflows,
	upgradeWorkflows,
} from "../src/factory/defaultWorkflows.js";
import { GuideSchema } from "../src/factory/FactoryResults.js";
import { reviewGuideMarkdown } from "../src/factory/FactoryTools.js";
import { validateGuideCoverage } from "../src/factory/Guide.js";
import { legacyGuidePrompt } from "../src/factory/legacyGuidePrompt.js";
import { inventoryGuideInstructions } from "../src/factory/specialistSteps.js";
import { videoPrompts } from "../src/factory/videoPrompts.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";

const stockBrief = defaultWorkflows
	.find((w) => w.id === "factory-pipeline")!
	.steps.find((s) => s.id === "guide")!;
const legacyGuideStep = {
	...stockBrief,
	guideContract: undefined,
	prompt: legacyGuidePrompt + videoPrompts.guide + inventoryGuideInstructions,
};
function fixture() {
	const context = {
		// Chapter-guide contract: a step still carrying the legacy stock prompt.
		step: { ...legacyGuideStep },
		run: {
			outputs: {
				capture: { screenshots: [{ area: "Feature", state: "mobile" }] },
			},
			humanDecisions: [],
		},
		progress: { reviewScope: { files: ["feature.ts", "last-fix.ts"] } },
	} as unknown as ExecutionContext;
	const guide = {
		goal: "Generic meters",
		summary: "Complete feature",
		decision: { status: "ready", summary: "Ready" },
		requirements: [
			{
				criterion: "Track consumption",
				status: "supported",
				evidence: ["Test"],
			},
			{ criterion: "Show it", status: "supported", evidence: ["Image"] },
		],
		behavior: [],
		checks: [],
		risks: [],
		reviewInstructions: ["Confirm scope"],
		chapters: [
			{
				id: "meters",
				title: "Meters",
				summary: "Named counters",
				before: "Energy",
				after: "Any counter",
				requirementIndexes: [0, 1],
				files: ["feature.ts", "last-fix.ts"],
				screenshots: [{ area: "Feature", state: "mobile", caption: "Counter" }],
				diagrams: [],
				reviewChecks: ["Check it"],
				risks: [],
				evidence: ["Test"],
			},
		],
	};
	return { context, guide };
}
it.each([
	true,
	false,
])("exports resolved specialist disputes with attribution in Markdown (chapters: %s)", (withChapters) => {
	const { guide } = fixture();
	const value = GuideSchema.parse({
		...guide,
		chapters: withChapters ? guide.chapters : undefined,
		requirementCoverage: {
			inventoryVersion: 1,
			inventoryDigest: "inventory-digest",
			headSha: "reviewed-head",
			baseSha: "reviewed-base",
			assessments: [],
			reviewers: [
				{
					reviewer: "business",
					summary: "Accepted caller contract verified",
					findings: [],
					disagreements: [],
					disputeResolutions: [
						{
							disagreement: "Strict validation conflicts with permissive input",
							reason: "Accepted caller contract requires strict validation",
							evidence: "Blank-input and return-value assertions passed",
						},
					],
				},
				{
					reviewer: "architecture",
					summary: "Legacy receipt without resolutions",
					findings: [],
					disagreements: ["Unresolved interface concern"],
				},
			],
		},
	});
	const markdown = reviewGuideMarkdown(value, "reviewed-head");
	expect(markdown).toContain(
		"**business:** Accepted caller contract verified\n\n\n- Resolved disagreement: Strict validation conflicts with permissive input; Reason: Accepted caller contract requires strict validation; Evidence: Blank-input and return-value assertions passed",
	);
	expect(markdown).toContain(
		"**architecture:** Legacy receipt without resolutions\n\nUnresolved interface concern",
	);
	expect(markdown).toContain("Revision: reviewed-head");
});
it("rejects a last-iteration-only guide, missing requirements and fabricated screenshot references", () => {
	const { context, guide } = fixture();
	expect(() => validateGuideCoverage(context, guide)).not.toThrow();
	guide.chapters[0]!.files = ["last-fix.ts"];
	expect(() => validateGuideCoverage(context, guide)).toThrow(
		"omit PR files: feature.ts",
	);
	guide.chapters[0]!.files = ["feature.ts", "last-fix.ts"];
	guide.chapters[0]!.requirementIndexes = [1];
	expect(() => validateGuideCoverage(context, guide)).toThrow(
		"omit acceptance criteria",
	);
	guide.chapters[0]!.requirementIndexes = [0, 1];
	guide.chapters[0]!.screenshots[0]!.state = "invented";
	expect(() => validateGuideCoverage(context, guide)).toThrow(
		"not in the accepted inventory",
	);
});
it("requires chapters for stock generation and prior human review for a revision summary, keeping custom legacy guides compatible", () => {
	const { context, guide } = fixture();
	const { chapters: _, ...old } = guide;
	expect(() => validateGuideCoverage(context, old)).toThrow(
		"needs feature chapters",
	);
	context.step = { ...context.step, prompt: "Custom legacy recap" };
	expect(() => validateGuideCoverage(context, old)).not.toThrow();
	expect(() =>
		validateGuideCoverage(context, {
			...guide,
			revisionSummary: true,
			previousHeadSha: "old",
		}),
	).toThrow("previous human-reviewed guide");
});

it("upgrades the original saved guide prompt while preserving its selected model and custom guides", () => {
	const stored = structuredClone(defaultWorkflows);
	const guide = stored
		.find((w) => w.id === "factory-pipeline")!
		.steps.find((s) => s.id === "guide")!;
	guide.prompt =
		'Write a Rocky-inspired review recap for the exact current PR revision, grounded in the supplied results/evidence. Return {"goal":"short user goal","summary":"short outcome","decision":{"status":"ready or needs-attention or blocked","summary":"..."},"requirements":[{"criterion":"...","status":"supported or gap or unverified","evidence":["..."]}],"behavior":[{"scenario":"...","before":"...","after":"..."}],"checks":["actual checks and CI results"],"risks":["actual limitations"],"reviewInstructions":["where to look and what to verify"]}. Include decisions, accepted/rejected review complaints, real screenshots where UI changed and remaining human actions. Never invent successful checks, screenshots or coverage. Use plain language. The PR stays draft for the human.';
	guide.model = "operator-model";
	guide.reasoningEffort = "high";
	const migrated = upgradeWorkflows(stored) as typeof stored;
	expect(
		migrated
			.find((w) => w.id === "factory-pipeline")!
			.steps.find((s) => s.id === "guide"),
	).toMatchObject({
		prompt: defaultWorkflows
			.find((w) => w.id === "factory-pipeline")!
			.steps.find((s) => s.id === "guide")!.prompt,
		model: "operator-model",
		reasoningEffort: "high",
	});
	guide.prompt = "My custom guide instructions";
	expect(
		(upgradeWorkflows(stored) as typeof stored)
			.find((w) => w.id === "factory-pipeline")!
			.steps.find((s) => s.id === "guide")!.prompt,
	).toBe(guide.prompt);
});

it("requires compact fields for every new guide regardless of version or frozen prompt, while reading legacy guides", async () => {
	const { GuideSchema, GeneratedGuideSchema } = await import(
		"../src/factory/FactoryResults.js"
	);
	const { guide } = fixture();
	expect(GuideSchema.parse(guide)).toEqual(guide);
	const old = GeneratedGuideSchema.safeParse(guide);
	expect(old.success).toBe(false);
	if (!old.success)
		expect(old.error.issues.map((i) => i.path)).toEqual(
			expect.arrayContaining([
				["tldr"],
				["decision", "summaryShort"],
				["chapters", 0, "tldr"],
				["chapters", 0, "risk"],
				["chapters", 0, "keyChecks"],
			]),
		);
	const compact = {
		...guide,
		scope: {
			kind: "purely-visual",
			rationale: "Only presentation in this schema fixture",
			files: ["feature.ts", "last-fix.ts"],
		},
		tldr: "Counters measure each resource",
		decision: { ...guide.decision, summaryShort: "Review the counters" },
		chapters: guide.chapters.map((c) => ({
			...c,
			tldr: "Each counter is named",
			beforeShort: "Energy only",
			afterShort: "Named counters",
			risk: { level: "medium", text: "Check saved counters" },
			keyChecks: [{ do: "Create a counter", expect: "It appears by name" }],
		})),
	};
	expect(GeneratedGuideSchema.safeParse(compact).success).toBe(true);
	expect(
		GeneratedGuideSchema.safeParse({
			...compact,
			tldr: " ",
			chapters: [{ ...compact.chapters[0], keyChecks: [] }],
		}).success,
	).toBe(false);
	const system = {
		lanes: [
			{ id: "app", name: "Application" },
			{ id: "input", name: "Input" },
			{ id: "store", name: "Storage" },
		],
		parts: [
			{ id: "counter", label: "Counter", laneId: "app", status: "new" },
			{ id: "input", label: "Input", laneId: "input", status: "unchanged" },
			{ id: "store", label: "Storage", laneId: "store", status: "changed" },
		],
		before: [],
		after: [],
	};
	const mapped = {
		...compact,
		scope: { ...compact.scope, kind: "nonvisual" },
		system,
		chapters: [{ ...compact.chapters[0], systemPartIds: ["counter"] }],
	};
	expect(GeneratedGuideSchema.safeParse(mapped).success).toBe(true);
	for (const bad of [
		{ ...system, lanes: [...system.lanes, ...system.lanes] },
		{ ...system, parts: [{ ...system.parts[0], laneId: "missing" }] },
		{ ...system, after: [{ source: "missing", target: "counter" }] },
		{
			...system,
			after: [
				{ source: "counter", target: "counter", label: "first" },
				{ source: "counter", target: "counter", label: "second" },
			],
		},
	])
		expect(
			GeneratedGuideSchema.safeParse({ ...mapped, system: bad }).success,
		).toBe(false);
	expect(
		GeneratedGuideSchema.safeParse({
			...mapped,
			chapters: [{ ...mapped.chapters[0], systemPartIds: ["missing"] }],
		}).success,
	).toBe(false);
});

it.each([
	[
		"current chapter guide",
		legacyGuidePrompt + videoPrompts.guide + inventoryGuideInstructions,
	],
	["chapter guide before specialists", legacyGuidePrompt + videoPrompts.guide],
	[
		"chapter guide before compact content",
		legacyGuidePrompt.split("\nEvery new guide MUST")[0]!,
	],
])("upgrades the saved %s to the review brief without changing operator settings", (_name, prompt) => {
	const stored = structuredClone(defaultWorkflows);
	const guide = stored
		.find((w) => w.id === "factory-pipeline")!
		.steps.find((s) => s.id === "guide")!;
	guide.prompt = prompt;
	delete guide.guideContract;
	guide.model = "operator-model";
	const migrated = upgradeWorkflows(stored) as typeof stored;
	expect(
		migrated
			.find((w) => w.id === "factory-pipeline")!
			.steps.find((s) => s.id === "guide"),
	).toMatchObject({
		prompt: stockBrief.prompt,
		guideContract: "brief-v1",
		model: "operator-model",
		qaContract: "qa-v1",
	});
	expect(upgradeWorkflows(migrated)).toEqual(migrated);
	guide.prompt = "My custom guide instructions";
	const custom = (upgradeWorkflows(stored) as typeof stored)
		.find((w) => w.id === "factory-pipeline")!
		.steps.find((s) => s.id === "guide")!;
	expect(custom.prompt).toBe("My custom guide instructions");
	expect(custom.guideContract).toBeUndefined();
});

it("rejects absent nonvisual maps and links with actionable paths, but reads historical maps", async () => {
	const { GeneratedGuideSchema, GuideSchema } = await import(
		"../src/factory/FactoryResults.js"
	);
	const { guide, context } = fixture();
	const authored = {
		...guide,
		scope: {
			kind: "nonvisual",
			rationale: "Counter storage and UI",
			files: context.progress!.reviewScope!.files,
		},
		tldr: "Named counters",
		decision: { ...guide.decision, summaryShort: "Review counters" },
		chapters: guide.chapters.map((c) => ({
			...c,
			tldr: "Store named counters",
			beforeShort: "Energy only",
			afterShort: "Any resource",
			risk: { level: "low", text: "Check storage" },
			keyChecks: [{ do: "Create one", expect: "It persists" }],
		})),
	};
	const absent = GeneratedGuideSchema.safeParse(authored);
	expect(absent.success).toBe(false);
	if (!absent.success)
		expect(absent.error.issues.map((i) => i.path)).toEqual(
			expect.arrayContaining([["system"], ["chapters", 0, "systemPartIds"]]),
		);
	expect(GuideSchema.safeParse(authored).success).toBe(true);
	expect(() =>
		validateGuideCoverage(context, {
			...authored,
			scope: { ...authored.scope, files: ["feature.ts"] },
		}),
	).toThrow("every whole-PR changed file");
	context.run.outputs["visual-scope"] = { nonVisualFiles: ["feature.ts"] };
	expect(() =>
		validateGuideCoverage(context, {
			...authored,
			scope: { ...authored.scope, kind: "purely-visual" },
		}),
	).toThrow("nonvisual changes");
	const historic = {
		...guide,
		system: {
			lanes: [{ id: "one", name: "Old layout" }],
			parts: [
				{ id: "one", label: "Old part", laneId: "one", status: "changed" },
			],
			before: [],
			after: [],
		},
	};
	expect(GuideSchema.safeParse(historic).success).toBe(true);
});
