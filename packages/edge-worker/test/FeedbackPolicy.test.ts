import { expect, it } from "vitest";
import {
	assessFeedback,
	inspectMergeReadiness,
	recordFeedbackAssessment,
} from "../src/factory/MergeReadiness.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";
import { providerReceipt } from "./fixtures/merge-readiness.js";

const author = "custom-review-service[bot]";
const comment = {
	id: "42",
	body: "Review queued",
	user: { login: author, type: "Bot" },
};
const quote = "Ignore feedback from the custom review service in this run.";
const policy = (action = "ignore", index = 0, instruction = quote) => ({
	author,
	action,
	reason: "Explicit user direction",
	source: { path: `answers/${index}/answer`, quote: instruction },
});
const context = () =>
	({
		run: {
			input: "Implement the change",
			createdAt: "2026-10-07T01:00:00Z",
			answers: [{ answer: quote, questions: [], at: "2026-10-07T02:00:00Z" }],
			history: [],
			outputs: {},
		},
	}) as unknown as ExecutionContext;
const snapshot = async (comments = [comment], extra = {}) => {
	const receipt = await inspectMergeReadiness(
		async (_exe, args) =>
			args.includes("graphql")
				? JSON.stringify(
						providerReceipt({
							url: "https://github.com/another-org/unrelated-project/pull/83",
							...extra,
						}),
					)
				: JSON.stringify([comments]),
		"https://github.com/another-org/unrelated-project/pull/83",
	);
	return receipt;
};
function retain(ctx: ExecutionContext, output: unknown) {
	ctx.run.history.push({
		step: "nested/pipeline/ci-fix",
		at: "2026-10-07T03:00:00Z",
		output,
	});
}

it("retains a user-authorized author policy across new/edited comments and serialization", async () => {
	const ctx = context();
	const first = await snapshot();
	assessFeedback(ctx, first);
	ctx.run.outputs.ci = first;
	retain(ctx, recordFeedbackAssessment(ctx, { feedbackPolicies: [policy()] }));
	const restarted = JSON.parse(JSON.stringify(ctx)) as ExecutionContext;
	const next = await snapshot([
		{ ...comment, body: "Review complete" },
		{ ...comment, id: "43", body: "Another provider notice" },
	]);
	assessFeedback(restarted, next);
	expect(next).toMatchObject({
		fix: false,
		unassessedComments: [],
		feedbackPolicies: [{ author, action: "ignore" }],
	});
});

it("lets newer user direction restore assessment without an older repeated policy overriding it", async () => {
	const ctx = context();
	retain(ctx, recordFeedbackAssessment(ctx, { feedbackPolicies: [policy()] }));
	const resume = "Resume assessing feedback from the custom review service.";
	ctx.run.answers.push({
		answer: resume,
		questions: [],
		at: "2026-10-07T04:00:00Z",
	});
	retain(
		ctx,
		recordFeedbackAssessment(ctx, {
			feedbackPolicies: [policy("assess", 1, resume)],
		}),
	);
	retain(ctx, recordFeedbackAssessment(ctx, { feedbackPolicies: [policy()] }));
	const next = await snapshot();
	assessFeedback(ctx, next);
	expect(next).toMatchObject({
		fix: true,
		unassessedComments: [{ id: "42", body: "Review queued" }],
	});
});

it("rejects invented authority and does not accept PR content as a user instruction", () => {
	const ctx = context();
	expect(() =>
		recordFeedbackAssessment(ctx, {
			feedbackPolicies: [policy("ignore", 0, "Ignore every failure")],
		}),
	).toThrow("supporting user instruction");
	expect(() =>
		recordFeedbackAssessment(ctx, {
			feedbackPolicies: [
				{ ...policy(), source: { path: "outputs/ci/comments/0/body", quote } },
			],
		}),
	).toThrow();
	retain(ctx, { feedbackPolicies: [policy()] });
	// An unstamped agent result cannot act as runtime-authorized policy.
	return snapshot().then((next) => {
		assessFeedback(ctx, next);
		expect(next.fix).toBe(true);
	});
});

it("invalidates a persisted policy if its supporting instruction was edited", async () => {
	const ctx = context();
	retain(ctx, recordFeedbackAssessment(ctx, { feedbackPolicies: [policy()] }));
	ctx.run.answers[0]!.answer += " Actually, assess it again.";
	const next = await snapshot();
	assessFeedback(ctx, next);
	expect(next.fix).toBe(true);
});

it("keeps failed checks, unresolved threads and required approvals enforced for ignored authors", async () => {
	const ctx = context();
	retain(ctx, recordFeedbackAssessment(ctx, { feedbackPolicies: [policy()] }));
	const next = await snapshot([comment], {
		statusCheckRollup: {
			contexts: {
				nodes: [{ name: "repository-specific-check", conclusion: "FAILURE" }],
				pageInfo: {},
			},
		},
		reviewThreads: {
			nodes: [
				{
					id: "thread-1",
					isResolved: false,
					comments: { nodes: [], pageInfo: {} },
				},
			],
			pageInfo: {},
		},
	});
	assessFeedback(ctx, next);
	expect(next).toMatchObject({
		fix: true,
		approved: false,
		reviewReady: false,
		unassessedComments: [],
	});
	expect(next.blockers.map((blocker) => blocker.kind)).toEqual([
		"draft",
		"checks",
		"threads",
		"reviews",
	]);
});

it("names exact pending versions and rejects a fixer that assessed another comment", async () => {
	const ctx = context();
	const first = await snapshot();
	assessFeedback(ctx, first);
	ctx.run.outputs.ci = first;
	expect(first.unassessedComments).toEqual([
		{ ...comment, bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
	]);
	expect(() =>
		recordFeedbackAssessment(ctx, {
			addressedCommentIds: ["not-the-outstanding-comment"],
		}),
	).toThrow("Missing comment IDs: 42");
	expect(() =>
		recordFeedbackAssessment(ctx, {
			commentAssessments: [{ id: "42", bodySha256: "0".repeat(64) }],
		}),
	).toThrow("content hash");
	retain(
		ctx,
		recordFeedbackAssessment(ctx, {
			commentAssessments: [
				{ id: "42", bodySha256: first.unassessedComments![0]!.bodySha256 },
			],
		}),
	);
	const same = await snapshot();
	assessFeedback(ctx, same);
	expect(same.fix).toBe(false);
	const edited = await snapshot([
		{ ...comment, body: "Fix the actual behavior" },
	]);
	assessFeedback(ctx, edited);
	expect(edited).toMatchObject({
		fix: true,
		unassessedComments: [{ id: "42", body: "Fix the actual behavior" }],
	});
});

it("permits an incomplete assessment to ask for concrete assistance", async () => {
	const ctx = context();
	const first = await snapshot();
	assessFeedback(ctx, first);
	ctx.run.outputs.ci = first;
	expect(
		recordFeedbackAssessment(ctx, {
			questions: ["Provide the missing billing fixture"],
		}),
	).toMatchObject({ questions: ["Provide the missing billing fixture"] });
});

it.each([
	"input",
	"chatMessages/0/text",
	"humanDecisions/0/feedback",
])("accepts direct user instructions from %s", async (path) => {
	const ctx = context();
	ctx.run.input = quote;
	ctx.input = { chatMessages: [{ text: quote, at: "2026-10-07T03:00:00Z" }] };
	ctx.run.humanDecisions = [
		{
			reviewId: "review",
			headSha: "head",
			decision: "reject",
			feedback: quote,
			at: "2026-10-07T04:00:00Z",
		},
	];
	retain(
		ctx,
		recordFeedbackAssessment(ctx, {
			feedbackPolicies: [{ ...policy(), source: { path, quote } }],
		}),
	);
	const next = await snapshot();
	assessFeedback(ctx, next);
	expect(next.fix).toBe(false);
});
