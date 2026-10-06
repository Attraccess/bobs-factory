import { expect, it } from "vitest";
import {
	defaultWorkflows,
	upgradeWorkflows,
} from "../src/factory/defaultWorkflows.js";
import { validateGuideCoverage } from "../src/factory/Guide.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";

function fixture() {
	const context = {
		step: defaultWorkflows
			.find((w) => w.id === "factory-pipeline")!
			.steps.find((s) => s.id === "guide")!,
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
		lanes: [{ id: "app", name: "Application" }],
		parts: [{ id: "counter", label: "Counter", laneId: "app", status: "new" }],
		before: [],
		after: [],
	};
	const mapped = {
		...compact,
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
