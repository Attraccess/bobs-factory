import { expect, it, vi } from "vitest";
import { validateFactoryResult } from "../src/factory/FactoryResults.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import {
	factoryReviewFixContext,
	recordReviewFix,
	reviewRecoveryQuestions,
	validateReviewFix,
} from "../src/factory/ReviewRecovery.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";

const finding = {
	id: "external-validation",
	rating: 3,
	status: "open",
	summary: "Protected environment validation is blocked",
	evidence:
		"The protected deployment returns 404; required checks remain unexecuted",
};
const revision = {
	headSha: "unchanged",
	dirty: false,
	historyLength: 1,
	at: "",
};
function fixture(visual = false) {
	const gate = visual ? "visual-gate" : "review-gate";
	const fix = visual ? "visual-fix" : "code-fix";
	return {
		step: { id: fix },
		input: { "draft-pr": { url: "fixture" } },
		run: {
			step: `pipeline/${fix}`,
			input: "Validate the feature",
			answers: [],
			outputs: { [gate]: { approved: false, findings: [finding] } },
			history: [],
			roleRevisions: {
				[`pipeline/${visual ? "visual-review" : "code-review"}`]: {
					...revision,
				},
			},
		},
	} as unknown as ExecutionContext;
}
const rejection = {
	summary: "The feature has no source defect; deployment access is needed",
	dispositions: [
		{ id: finding.id, status: "rejected", reason: "Missing external access" },
	],
};
function gateContext(context: ExecutionContext, visual = false) {
	const output = recordReviewFix(context, rejection, revision);
	context.run.history.push({ step: context.run.step!, output, at: "" });
	context.run.step = `pipeline/${visual ? "visual-gate" : "review-gate"}`;
	context.step = {
		id: "gate",
		tool: visual ? "visual-gate" : "review-gate",
	} as ExecutionContext["step"];
	return context;
}

it.each([
	false,
	true,
])("corrects a summary-only assistance request instead of replaying review (visual=%s)", (visual) => {
	const context = fixture(visual);
	const output = validateFactoryResult(context.step.id, {
		summary: "Please provide the protected deployment",
		dispositions: [],
	});
	expect(() => validateReviewFix(context, output)).toThrow(
		"Missing finding IDs: external-validation",
	);
	const corrected = validateFactoryResult(context.step.id, {
		summary: "Blocked on access",
		dispositions: [],
		questions: ["Provide the protected deployment"],
	});
	expect(() => validateReviewFix(context, corrected)).not.toThrow();
	expect(corrected).toMatchObject({
		questions: ["Provide the protected deployment"],
	});
});

it.each([
	false,
	true,
])("pauses a rejected unchanged fix even when the blocker wording and probe change (visual=%s)", (visual) => {
	const context = gateContext(fixture(visual), visual);
	const gate = {
		approved: false,
		findings: [
			{
				...finding,
				summary: "Access still unavailable",
				evidence: "A newer probe returned 502",
			},
		],
	};
	expect(reviewRecoveryQuestions(context, gate, revision)).toEqual([
		expect.stringContaining("external-validation"),
	]);
	expect(gate.approved).toBe(false);
});

it("retains reviewer reassessment for the first evidence-backed rejection", () => {
	const context = fixture();
	expect(() =>
		validateReviewFix(context, validateFactoryResult("code-fix", rejection)),
	).not.toThrow();
	context.step.tool = "review-gate";
	expect(
		reviewRecoveryQuestions(context, { findings: [finding] }, revision),
	).toEqual([]);
});

it.each([
	"changed-fix",
	"changed-after-fix",
	"dirty",
	"finding-progress",
	"new-finding",
	"new-answer",
	"new-chat",
	"unknown-revision",
])("does not park work when progress or new direction is available: %s", (mode) => {
	const context = fixture();
	if (mode === "changed-fix")
		context.run.roleRevisions!["pipeline/code-review"]!.headSha = "previous";
	if (mode === "unknown-revision") context.run.roleRevisions = {};
	gateContext(context);
	const current = { ...revision };
	let findings = [finding];
	if (mode === "changed-after-fix") current.headSha = "new";
	if (mode === "dirty") current.dirty = true;
	if (mode === "finding-progress") findings = [];
	if (mode === "new-finding") findings = [{ ...finding, id: "another" }];
	if (mode === "new-answer")
		context.run.answers.push({
			questions: ["Help"],
			answer: "Use the restored deployment",
			at: "2026-10-07T01:00:00Z",
		});
	if (mode === "new-chat")
		context.chatMessages = [
			{
				id: "chat",
				text: "Use the new environment",
				at: "2026-10-07T01:00:00Z",
				step: "gate",
			},
		];
	expect(reviewRecoveryQuestions(context, { findings }, current)).toEqual([]);
});

it("uses runtime findings and answers independently of restricted recipe inputs", () => {
	const context = fixture();
	context.run.answers.push({
		questions: ["Access?"],
		answer: "Restored",
		at: "",
	});
	expect(factoryReviewFixContext(context)).toEqual({
		findings: [finding],
		answers: context.run.answers,
	});
	expect(context.input).toEqual({ "draft-pr": { url: "fixture" } });
});

it("the real review gate parks a clean rejected attempt without approving it", async () => {
	const context = gateContext(fixture());
	context.log = vi.fn();
	context.run.outputs["code-review"] = {
		summary: "Blocked",
		findings: [finding],
	};
	const tools = new FactoryTools({
		command: async (_ctx, _exe, args) =>
			args[0] === "rev-parse" ? "unchanged" : "",
	});
	expect(await tools.tool(context)).toEqual({
		approved: false,
		findings: [finding],
		reviewBlocked: true,
		questions: [expect.stringContaining("required validation remain blocking")],
	});
});
