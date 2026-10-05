import { expect, it, vi } from "vitest";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import {
	assessFeedback,
	inspectMergeReadiness,
} from "../src/factory/MergeReadiness.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";
import { providerReceipt } from "./fixtures/merge-readiness.js";

const url = "https://github.com/test/repo/pull/1";
const command = (extra = {}) =>
	vi.fn(async (_exe: string, args: string[]) =>
		args.includes("graphql") ? JSON.stringify(providerReceipt(extra)) : "[[]]",
	);
it("permits the guide while draft/reviewer approval wait, but never claims mergeability", async () => {
	const value = await inspectMergeReadiness(command(), url);
	expect(value).toMatchObject({
		approved: false,
		reviewReady: true,
		fix: false,
	});
	expect(value.blockers.map((b) => b.kind)).toEqual(["draft", "reviews"]);
});
it.each([
	[{ mergeable: "UNKNOWN" }, "wait"],
	[{ mergeable: "CONFLICTING" }, "fix"],
	[{ mergeStateStatus: "BEHIND" }, "fix"],
	[{ reviewDecision: "CHANGES_REQUESTED" }, "fix"],
	[
		{
			reviewThreads: {
				nodes: [
					{
						id: "thread",
						isResolved: false,
						comments: { nodes: [], pageInfo: {} },
					},
				],
				pageInfo: {},
			},
		},
		"fix",
	],
	[
		{
			statusCheckRollup: {
				contexts: {
					nodes: [{ name: "tests", conclusion: "FAILURE" }],
					pageInfo: {},
				},
			},
		},
		"fix",
	],
])("blocks uncertain/failed provider evidence %j", async (extra, action) => {
	const value = await inspectMergeReadiness(command(extra), url);
	expect(value.reviewReady).toBe(false);
	expect(value.approved).toBe(false);
	expect(value.blockers.some((b) => b.action === action)).toBe(true);
});
it("keeps all pages of discussion and waits for reapproval after recorded assessment", async () => {
	const cmd = command({
		reviewDecision: "CHANGES_REQUESTED",
		reviews: {
			nodes: [
				{
					id: "review1",
					state: "CHANGES_REQUESTED",
					author: { login: "human" },
				},
			],
		},
	});
	const snapshot = await inspectMergeReadiness(cmd, url);
	snapshot.comments = [{ id: 1, body: "Please clarify this" }];
	const context = { run: { history: [] } } as unknown as ExecutionContext;
	assessFeedback(context, snapshot);
	expect(snapshot.fix).toBe(true);
	context.run.history = [
		{
			step: "pipeline/ci-fix",
			at: "",
			output: { addressedReviewIds: ["review1"], addressedCommentIds: ["1"] },
		},
	];
	const revised = await inspectMergeReadiness(cmd, url);
	revised.comments = snapshot.comments;
	assessFeedback(context, revised);
	expect(revised).toMatchObject({
		fix: false,
		reviewReady: true,
		approved: false,
	});
	expect(
		revised.blockers.some((b) =>
			b.message.includes("waiting for the reviewer"),
		),
	).toBe(true);
});
it("invalidates approval for a clean unpushed local commit", async () => {
	const ctx = {
		run: {
			history: [],
			humanDecisions: [{ decision: "approve", headSha: "head" }],
			outputs: { "draft-pr": { url } },
		},
		step: { tool: "merge" },
		signal: new AbortController().signal,
		log: () => {},
	} as unknown as ExecutionContext;
	const cmd = vi.fn(
		async (_ctx: ExecutionContext, exe: string, args: string[]) =>
			exe === "git"
				? args[0] === "rev-parse"
					? "unpushed"
					: ""
				: args.includes("graphql")
					? JSON.stringify(
							providerReceipt({
								isDraft: false,
								mergeStateStatus: "CLEAN",
								reviewDecision: "APPROVED",
							}),
						)
					: "[[]]",
	);
	await expect(
		new FactoryTools({ command: cmd, postComment: async () => {} }).tool(ctx),
	).resolves.toMatchObject({ fix: true, rework: false });
	expect(
		cmd.mock.calls.some(
			([, exe, args]) => exe === "gh" && args.includes("merge"),
		),
	).toBe(false);
});
it("assesses new feedback during human review before any merge request", async () => {
	const ctx = {
		run: {
			history: [],
			humanDecisions: [{ decision: "approve", headSha: "head" }],
			outputs: { "draft-pr": { url } },
		},
		step: { tool: "merge" },
		signal: new AbortController().signal,
		log: () => {},
	} as unknown as ExecutionContext;
	const cmd = vi.fn(
		async (_ctx: ExecutionContext, exe: string, args: string[]) =>
			exe === "git"
				? args[0] === "rev-parse"
					? "head"
					: ""
				: args.includes("graphql")
					? JSON.stringify(
							providerReceipt({
								isDraft: false,
								mergeStateStatus: "CLEAN",
								reviewDecision: "APPROVED",
							}),
						)
					: JSON.stringify([[{ id: 9, body: "Fix this first" }]]),
	);
	await expect(
		new FactoryTools({ command: cmd, postComment: async () => {} }).tool(ctx),
	).resolves.toMatchObject({ fix: true });
	expect(
		cmd.mock.calls.some(
			([, exe, args]) => exe === "gh" && args.includes("merge"),
		),
	).toBe(false);
});
