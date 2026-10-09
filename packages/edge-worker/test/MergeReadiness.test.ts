import { expect, it, vi } from "vitest";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import { GITHUB_API_COMMAND } from "../src/factory/GithubApi.js";
import {
	assessFeedback,
	informationalComment,
	inspectMergeReadiness,
	inspectReadinessWithRetry,
	recordFeedbackAssessment,
	reportReadiness,
} from "../src/factory/MergeReadiness.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";
import { githubApiReceipt, githubRequest } from "./fixtures/github-api.js";
import { providerReceipt } from "./fixtures/merge-readiness.js";

const url = "https://github.com/test/repo/pull/1";
const command = (extra = {}) =>
	vi.fn(async (_exe: string, args: string[]) =>
		JSON.stringify(githubApiReceipt(args, extra)),
	);
it("reports readiness progress once while retaining fresh complete polling receipts", async () => {
	const ctx = {
		run: { outputs: {} },
		log: vi.fn(),
	} as unknown as ExecutionContext;
	const snapshot = await inspectMergeReadiness(command(), url);
	reportReadiness(ctx, snapshot);
	const updated = structuredClone(snapshot);
	updated.comments = [{ id: 1, body: "Changed informational metadata" }];
	reportReadiness(ctx, updated);
	expect(ctx.log).toHaveBeenCalledTimes(1);
	expect(ctx.run.outputs["merge-readiness"]).toEqual(updated);
	const progress = structuredClone(updated);
	progress.checks.push({
		name: "build",
		bucket: "pending",
		state: "IN_PROGRESS",
	});
	reportReadiness(ctx, progress);
	expect(ctx.log).toHaveBeenCalledTimes(2);
});
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
it.each([
	"head",
	"different-head",
])("confirms a completed merge without using a deleted worktree (provider head %s)", async (headRefOid) => {
	const ctx = {
		run: {
			workspace: "/deleted-worktree",
			history: [],
			humanDecisions: [{ decision: "approve", headSha: "head" }],
			outputs: { "draft-pr": { url } },
		},
		step: { tool: "merge" },
		evidenceDir: "/retained-evidence",
		signal: new AbortController().signal,
		log: () => {},
	} as unknown as ExecutionContext;
	const cmd = vi.fn(
		async (input: ExecutionContext, exe: string, args: string[]) => {
			expect(exe).toBe(GITHUB_API_COMMAND);
			expect(input.run.workspace).toBe(ctx.evidenceDir);
			return JSON.stringify(
				githubApiReceipt(args, { state: "MERGED", headRefOid }),
			);
		},
	);
	const result = new FactoryTools({ command: cmd, postComment: vi.fn() }).tool(
		ctx,
	);
	if (headRefOid === "head")
		await expect(result).resolves.toEqual({
			merged: true,
			url,
			headSha: "head",
		});
	else await expect(result).rejects.toThrow("explicitly approved revision");
	expect(
		cmd.mock.calls.every(([, , args]) => githubRequest(args).method !== "PUT"),
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
				: githubRequest(args).path === "graphql"
					? JSON.stringify(
							providerReceipt({
								isDraft: false,
								mergeStateStatus: "CLEAN",
								reviewDecision: "APPROVED",
							}),
						)
					: "[]",
	);
	await expect(
		new FactoryTools({ command: cmd, postComment: async () => {} }).tool(ctx),
	).resolves.toMatchObject({ fix: true, rework: false });
	expect(
		cmd.mock.calls.some(
			([, exe, args]) =>
				exe === GITHUB_API_COMMAND && githubRequest(args).method === "PUT",
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
				: githubRequest(args).path === "graphql"
					? JSON.stringify(
							providerReceipt({
								isDraft: false,
								mergeStateStatus: "CLEAN",
								reviewDecision: "APPROVED",
							}),
						)
					: JSON.stringify([{ id: 9, body: "Fix this first" }]),
	);
	await expect(
		new FactoryTools({ command: cmd, postComment: async () => {} }).tool(ctx),
	).resolves.toMatchObject({ fix: true });
	expect(
		cmd.mock.calls.some(
			([, exe, args]) =>
				exe === GITHUB_API_COMMAND && githubRequest(args).method === "PUT",
		),
	).toBe(false);
});

it("ignores only recognized bot notices and re-assesses edited comment content", async () => {
	const snapshot = await inspectMergeReadiness(command(), url);
	const context = {
		run: { history: [], outputs: { ci: snapshot } },
	} as unknown as ExecutionContext;
	const comment = {
		id: "12",
		body: "Fix the actual billing calculation",
		updated_at: "2026-10-05T01:00:00Z",
	};
	snapshot.comments = [comment];
	const output = recordFeedbackAssessment(context, {
		addressedCommentIds: ["12"],
	});
	context.run.history.push({
		step: "pipeline/ci-fix",
		at: "2026-10-05T02:00:00Z",
		output,
	});
	const unchanged = await inspectMergeReadiness(command(), url);
	unchanged.comments = [comment];
	assessFeedback(context, unchanged);
	expect(unchanged.fix).toBe(false);
	const changed = await inspectMergeReadiness(command(), url);
	changed.comments = [{ ...comment, body: "Another must fix" }];
	assessFeedback(context, changed);
	expect(changed.fix).toBe(true);
	expect(
		informationalComment({
			id: "1",
			user: { login: "linear-code[bot]", type: "Bot" },
			body: '<!-- linear-linkback -->\n<p><a href="https://linear.app/x/issue/Y-1">Y-1</a></p>',
		}),
	).toBe(true);
	expect(
		informationalComment({
			id: "2",
			user: { login: "github-actions[bot]", type: "Bot" },
			body: "🐳 Docker images built and pushed:\n\nGitHub Container Registry: `image:sha`\nDocker Hub: `image:sha`\n\nImage Digest: `sha256:123abc`",
		}),
	).toBe(true);
	expect(
		informationalComment({
			id: "3",
			user: { login: "agent-rocky-bot[bot]", type: "Bot" },
			body: "## Business Rules Validation\nFix billing",
		}),
	).toBe(false);
	expect(
		informationalComment({
			id: "4",
			user: { login: "human", type: "User" },
			body: "🐳 Docker images built and pushed: Fix billing",
		}),
	).toBe(false);
});
it("retries transient readiness errors without a fixer and cancels waiting promptly", async () => {
	vi.useFakeTimers();
	try {
		const cmd = command();
		cmd.mockRejectedValueOnce(new Error("Command timed out: gh"));
		const ctx = {
			run: { outputs: { "draft-pr": { url } } },
			signal: new AbortController().signal,
			log: vi.fn(),
		} as unknown as ExecutionContext;
		const pending = inspectReadinessWithRetry(ctx, cmd, url);
		await vi.advanceTimersByTimeAsync(10000);
		await expect(pending).resolves.toMatchObject({ reviewReady: true });
		const abort = new AbortController();
		const blocked = inspectReadinessWithRetry(
			{ ...ctx, signal: abort.signal },
			vi.fn(async () => {
				throw new Error("HTTP 503");
			}),
			url,
		);
		const assertion = expect(blocked).rejects.toThrow("Run terminated");
		await vi.advanceTimersByTimeAsync(1);
		abort.abort();
		await assertion;
		await expect(
			inspectReadinessWithRetry(
				ctx,
				vi.fn(async () => {
					throw new Error("Bad credentials HTTP 401");
				}),
				url,
			),
		).rejects.toThrow("401");
	} finally {
		vi.useRealTimers();
	}
});
it.each([
	["head", "base", false, true, false],
	["new-head", "base", false, true, true],
	["head", "new-base", false, true, true],
	["head", "base", true, true, true],
	["head", "base", false, false, true],
])("routes CI assessments using actual revision provenance (%s,%s,%s,%s)", async (head, base, dirty, provenance, required) => {
	const ctx = {
		run: {
			step: "pipeline/after-ci-fix",
			roleRevisions: provenance
				? { "pipeline/code-review": { headSha: "head", dirty: false } }
				: {},
			outputs: {
				"draft-pr": { url },
				ci: { baseSha: "base" },
				"review-gate": { approved: true },
			},
		},
		step: { tool: "review-after-fix" },
		signal: new AbortController().signal,
		log: vi.fn(),
	} as unknown as ExecutionContext;
	const cmd = async (_ctx: ExecutionContext, exe: string, args: string[]) =>
		exe === "git"
			? args[0] === "rev-parse"
				? head
				: dirty
					? " M file"
					: ""
			: githubRequest(args).path === "graphql"
				? JSON.stringify(
						providerReceipt({ headRefOid: head, baseRefOid: base }),
					)
				: "[]";
	await expect(
		new FactoryTools({ command: cmd, postComment: async () => {} }).tool(ctx),
	).resolves.toMatchObject({ reviewRequired: required });
});

it.each([
	[undefined, true, "comments", undefined],
	[true, true, "comments", undefined],
	[false, false, "comments", undefined],
	[false, false, "revision", "fix"],
	[false, false, "reviews", "fix"],
	[false, false, "reviews", "human"],
])("requires review for substantive fixes rather than pending human approval (%s, %s, %s, %s)", async (flag, required, kind, action) => {
	const ctx = {
		run: {
			step: "pipeline/after-ci-fix",
			roleRevisions: {
				"pipeline/code-review": { headSha: "head", dirty: false },
			},
			outputs: {
				"draft-pr": { url },
				ci: { baseSha: "base", blockers: [{ kind, action }] },
				"ci-fix": { reviewRequired: flag },
				"review-gate": { approved: true },
			},
		},
		step: { tool: "review-after-fix" },
		signal: new AbortController().signal,
		log: vi.fn(),
	} as unknown as ExecutionContext;
	const cmd = async (_ctx: ExecutionContext, exe: string, args: string[]) =>
		exe === "git"
			? args[0] === "rev-parse"
				? "head"
				: ""
			: githubRequest(args).path === "graphql"
				? JSON.stringify(
						providerReceipt({ headRefOid: "head", baseRefOid: "base" }),
					)
				: "[]";
	await expect(
		new FactoryTools({ command: cmd, postComment: async () => {} }).tool(ctx),
	).resolves.toMatchObject({ reviewRequired: required });
});

it.each([
	"same-job",
	"new-job",
])("parks an unchanged failed CI check only when no new execution occurred (%s)", async (link) => {
	const ctx = {
		run: {
			step: "pipeline/after-ci-fix",
			history: [],
			roleRevisions: {
				"pipeline/code-review": { headSha: "head", dirty: false },
			},
			outputs: {
				"draft-pr": { url },
				ci: {
					headSha: "head",
					baseSha: "base",
					blockers: [{ kind: "reviews", action: "human" }],
					checks: [
						{
							name: "CodeQL",
							state: "FAILURE",
							bucket: "fail",
							link: "same-job",
						},
					],
				},
				"ci-fix": { reviewRequired: false },
				"review-gate": { approved: true },
			},
		},
		step: { tool: "review-after-fix" },
		signal: new AbortController().signal,
		log: vi.fn(),
	} as unknown as ExecutionContext;
	const cmd = async (_ctx: ExecutionContext, exe: string, args: string[]) =>
		exe === "git"
			? args[0] === "rev-parse"
				? "head"
				: ""
			: githubRequest(args).path === "graphql"
				? JSON.stringify(
						providerReceipt({
							headRefOid: "head",
							baseRefOid: "base",
							statusCheckRollup: {
								contexts: {
									nodes: [
										{
											name: "CodeQL",
											status: "COMPLETED",
											conclusion: "FAILURE",
											detailsUrl: link,
										},
									],
									pageInfo: {},
								},
							},
						}),
					)
				: "[]";
	const result = await new FactoryTools({
		command: cmd,
		postComment: async () => {},
	}).tool(ctx);
	if (link === "same-job")
		expect(result).toMatchObject({
			reviewRequired: false,
			questions: [expect.stringContaining("CodeQL: same-job")],
		});
	else expect(result).not.toHaveProperty("questions");
});

it.each([
	false,
	true,
])("parks repeated actionable feedback without revision progress (review=%s)", async (reviewRequired) => {
	const ctx = {
		run: {
			step: "pipeline/after-ci-fix",
			history: [],
			roleRevisions: {
				"pipeline/code-review": { headSha: "head", dirty: false },
			},
			outputs: {
				"draft-pr": { url },
				"review-gate": { approved: true },
				"ci-fix": { reviewRequired },
			},
		},
		step: { tool: "review-after-fix" },
		signal: new AbortController().signal,
		log: vi.fn(),
	} as unknown as ExecutionContext;
	const extra = {
		headRefOid: "head",
		baseRefOid: "base",
		mergeable: "CONFLICTING",
	};
	const before = await inspectMergeReadiness(command(extra), url);
	assessFeedback(ctx, before);
	ctx.run.outputs.ci = before;
	const assessment = recordFeedbackAssessment(ctx, { reviewRequired });
	if (reviewRequired)
		ctx.run.history.push({
			step: "pipeline/ci-fix",
			at: "earlier",
			output: assessment,
		});
	ctx.run.history.push({
		step: "pipeline/ci-fix",
		at: "latest",
		output: assessment,
	});
	const cmd = async (_ctx: ExecutionContext, exe: string, args: string[]) =>
		exe === "git"
			? args[0] === "rev-parse"
				? "head"
				: ""
			: command(extra)(exe, args);
	const result = await new FactoryTools({
		command: cmd,
		postComment: async () => {},
	}).tool(ctx);
	expect(result).toMatchObject({
		reviewRequired,
		questions: [expect.stringContaining("same actionable blockers")],
	});
});

it("allows a review of substantive rejection and resets repetition after new human direction", async () => {
	const ctx = {
		run: {
			step: "pipeline/after-ci-fix",
			history: [],
			roleRevisions: {
				"pipeline/code-review": { headSha: "head", dirty: false },
			},
			outputs: {
				"draft-pr": { url },
				"review-gate": { approved: true },
				"ci-fix": { reviewRequired: true },
			},
		},
		step: { tool: "review-after-fix" },
		signal: new AbortController().signal,
		log: vi.fn(),
	} as unknown as ExecutionContext;
	const extra = {
		headRefOid: "head",
		baseRefOid: "base",
		mergeable: "CONFLICTING",
	};
	const before = await inspectMergeReadiness(command(extra), url);
	assessFeedback(ctx, before);
	ctx.run.outputs.ci = before;
	ctx.run.history.push({
		step: "pipeline/ci-fix",
		at: "first",
		output: recordFeedbackAssessment(ctx, { reviewRequired: true }),
	});
	const cmd = async (_ctx: ExecutionContext, exe: string, args: string[]) =>
		exe === "git"
			? args[0] === "rev-parse"
				? "head"
				: ""
			: command(extra)(exe, args);
	const result = await new FactoryTools({
		command: cmd,
		postComment: async () => {},
	}).tool(ctx);
	expect(result).toMatchObject({ reviewRequired: true });
	expect(result).not.toHaveProperty("questions");
	ctx.run.history.push({ ...ctx.run.history[0]!, at: "second" });
	ctx.run.answers = [
		{
			questions: [],
			answer: "Assess the revised acceptance requirement",
			at: "2026-10-07T04:00:00Z",
		},
	];
	const redirected = await new FactoryTools({
		command: cmd,
		postComment: async () => {},
	}).tool(ctx);
	expect(redirected).toMatchObject({ reviewRequired: true });
	expect(redirected).not.toHaveProperty("questions");
});
