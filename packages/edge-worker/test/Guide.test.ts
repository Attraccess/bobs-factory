import { expect, it } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
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
