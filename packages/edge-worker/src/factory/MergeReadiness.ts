import { createHash } from "node:crypto";
import type { ExecutionContext } from "./WorkflowRuntime.js";

export type ProviderCommand = (
	exe: string,
	args: string[],
	timeout?: number,
) => Promise<string>;
export interface MergeBlocker {
	kind: string;
	message: string;
	action: "fix" | "wait" | "human";
}
export interface MergeReadiness {
	headSha: string;
	baseSha: string;
	url: string;
	state: string;
	isDraft: boolean;
	approved: boolean;
	reviewReady: boolean;
	fix: boolean;
	blockers: MergeBlocker[];
	checks: { name: string; state: string; bucket: string; link?: string }[];
	threads: unknown[];
	comments: unknown[];
	reviews: unknown[];
	queued: boolean;
	mergeMethod: "squash" | "merge" | "rebase";
}
export async function inspectMergeReadiness(
	command: ProviderCommand,
	url: string,
): Promise<MergeReadiness> {
	const match = url.match(
		/^https:\/\/github.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/,
	);
	if (!match) throw new Error("Merge readiness currently supports GitHub PRs");
	const [, owner, name, number] = match;
	const query = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed pullRequest(number:$number){url headRefOid baseRefOid state isDraft mergeable mergeStateStatus reviewDecision mergeQueueEntry{id} autoMergeRequest{enabledAt} statusCheckRollup{contexts(first:100){pageInfo{hasNextPage} nodes{__typename ... on CheckRun{name status conclusion detailsUrl} ... on StatusContext{context state targetUrl}}}} reviewThreads(first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated comments(first:100){nodes{id body url author{login}} pageInfo{hasNextPage}}}} comments(last:100){nodes{id body url createdAt author{login}} pageInfo{hasPreviousPage}} reviews(last:100){nodes{id state body submittedAt author{login}} pageInfo{hasPreviousPage}}}}}`;
	let cursor: string | undefined;
	let method: MergeReadiness["mergeMethod"] = "squash";
	let pr: any,
		threads: any[] = [];
	do {
		const args = [
			"api",
			"graphql",
			"-f",
			`query=${query}`,
			"-f",
			`owner=${owner}`,
			"-f",
			`name=${name}`,
			"-F",
			`number=${number}`,
		];
		if (cursor) args.push("-f", `cursor=${cursor}`);
		const payload = JSON.parse(await command("gh", args));
		if (payload.errors?.length)
			throw new Error(
				payload.errors.map((item: any) => item.message).join("; "),
			);
		const repository = payload.data?.repository;
		method = repository?.squashMergeAllowed
			? "squash"
			: repository?.mergeCommitAllowed
				? "merge"
				: "rebase";
		pr = repository?.pullRequest;
		if (!pr) throw new Error("Pull request unavailable");
		threads.push(...pr.reviewThreads.nodes);
		cursor = pr.reviewThreads.pageInfo.hasNextPage
			? pr.reviewThreads.pageInfo.endCursor
			: undefined;
	} while (cursor);
	const blockers: MergeBlocker[] = [];
	const add = (kind: string, message: string, action: MergeBlocker["action"]) =>
		blockers.push({ kind, message, action });
	const checks = (pr.statusCheckRollup?.contexts.nodes ?? []).map(
		(check: any) => {
			const state = check.conclusion ?? check.state ?? check.status;
			return {
				name: check.name ?? check.context,
				state,
				link: check.detailsUrl ?? check.targetUrl,
				bucket: ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(state)
					? "pass"
					: [
								"FAILURE",
								"ERROR",
								"CANCELLED",
								"TIMED_OUT",
								"ACTION_REQUIRED",
								"STARTUP_FAILURE",
								"STALE",
							].includes(state)
						? "fail"
						: "pending",
			};
		},
	);
	if (pr.state !== "OPEN" && pr.state !== "MERGED")
		add("closed", "PR is closed", "wait");
	if (pr.isDraft)
		add("draft", "Approve the review guide to mark the PR ready", "human");
	if (checks.some((check: any) => check.bucket === "fail"))
		add("checks", "Checks failed", "fix");
	if (checks.some((check: any) => check.bucket === "pending"))
		add("checks", "Checks are still running", "wait");
	if (pr.statusCheckRollup?.contexts.pageInfo.hasNextPage)
		add(
			"checks",
			"More than 100 check contexts; provider must confirm required checks",
			"wait",
		);
	if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY")
		add("conflicts", "Resolve merge conflicts", "fix");
	else if (pr.mergeable === "UNKNOWN" || pr.mergeStateStatus === "UNKNOWN")
		add("unknown", "GitHub is calculating mergeability", "wait");
	if (pr.mergeStateStatus === "BEHIND")
		add("stale", "Branch must be updated from the base", "fix");
	const openThreads = threads.filter((thread) => !thread.isResolved);
	if (openThreads.length)
		add("threads", `${openThreads.length} unresolved review thread(s)`, "fix");
	if (threads.some((thread) => thread.comments.pageInfo.hasNextPage))
		add(
			"discussion",
			"A review thread has more than 100 comments; inspect its full discussion before proceeding",
			"wait",
		);
	if (pr.reviewDecision === "CHANGES_REQUESTED")
		add(
			"reviews",
			"A reviewer requested changes; address feedback and ask them to review again",
			"fix",
		);
	if (pr.reviewDecision === "REVIEW_REQUIRED")
		add("reviews", "Required reviewer approval is missing", "human");
	if (
		!pr.isDraft &&
		["BLOCKED", "UNSTABLE", "HAS_HOOKS"].includes(pr.mergeStateStatus) &&
		!blockers.length
	)
		add("rules", `GitHub merge rules: ${pr.mergeStateStatus}`, "wait");
	// Draft PRs can report BLOCKED because of their draft status. This is a human action,
	// not evidence of mergeability; recheck after marking ready and never bypass GitHub rules.
	return {
		url: pr.url,
		headSha: pr.headRefOid,
		baseSha: pr.baseRefOid,
		state: pr.state,
		isDraft: pr.isDraft,
		approved:
			pr.state === "OPEN" &&
			!blockers.length &&
			["CLEAN", "UNSTABLE", "HAS_HOOKS"].includes(pr.mergeStateStatus),
		reviewReady:
			pr.state === "OPEN" &&
			blockers.every((blocker) => blocker.action === "human"),
		fix: blockers.some((blocker) => blocker.action === "fix"),
		blockers,
		checks,
		threads: openThreads,
		comments: JSON.parse(
			await command("gh", [
				"api",
				"--paginate",
				"--slurp",
				`repos/${owner}/${name}/issues/${number}/comments`,
			]),
		).flat(),
		reviews: pr.reviews.nodes,
		queued: Boolean(pr.mergeQueueEntry || pr.autoMergeRequest),
		mergeMethod: method,
	};
}
export function delay(signal: AbortSignal, ms = 10000): Promise<void> {
	return new Promise((resolve, reject) => {
		signal.throwIfAborted();
		const abort = () => {
			clearTimeout(timer);
			reject(new Error("Run terminated"));
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve();
		}, ms);
		signal.addEventListener("abort", abort, { once: true });
	});
}
export function reportReadiness(
	context: ExecutionContext,
	snapshot: MergeReadiness,
): void {
	const describe = (value: MergeReadiness) => {
		const passed = value.checks.filter(
			(check) => check.bucket === "pass",
		).length;
		return `Merge readiness: ${passed}/${value.checks.length} checks passed; ${value.blockers.map((item) => item.message).join("; ") || (value.state === "MERGED" ? "Merged" : value.queued ? "In merge queue" : "Ready")}`;
	};
	const previous = context.run.outputs["merge-readiness"] as
		| MergeReadiness
		| undefined;
	const message = describe(snapshot);
	const changed =
		!previous ||
		previous.headSha !== snapshot.headSha ||
		previous.baseSha !== snapshot.baseSha ||
		describe(previous) !== message;
	context.run.outputs["merge-readiness"] = snapshot;
	if (changed) context.log(message);
}

/** A provider transport error is not evidence that repository code needs fixing. */
export async function inspectReadinessWithRetry(
	context: ExecutionContext,
	command: ProviderCommand,
	url: string,
): Promise<MergeReadiness> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await inspectMergeReadiness(command, url);
		} catch (error) {
			context.signal.throwIfAborted();
			const message = error instanceof Error ? error.message : String(error);
			if (
				attempt >= 5 ||
				!/timed? out|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|TLS handshake|HTTP 50[0234]|HTTP 429|rate limit/i.test(
					message,
				)
			)
				throw error;
			context.log(
				`GitHub readiness temporarily unavailable; retrying transport (${attempt + 1}/5). ${message.slice(0, 300)}`,
			);
			await delay(context.signal, Math.min(10000 * 2 ** attempt, 60000));
		}
	}
}
const commentHash = (body: string) =>
	createHash("sha256").update(body).digest("hex");
interface FeedbackComment {
	id: string;
	body: string;
	updated_at?: string;
	user?: { login?: string; type?: string };
}
/** Only recognizable provider notices; unknown bot messages still need assessment. */
export function informationalComment(comment: FeedbackComment): boolean {
	if (comment.user?.type !== "Bot") return false;
	const body = comment.body.trim();
	if (comment.user.login === "linear-code[bot]")
		return /^<!-- linear-linkback -->\s*<p><a href="https:\/\/linear\.app\/[^"<>]+">[^<>]+<\/a><\/p>$/.test(
			body,
		);
	if (comment.user.login === "github-actions[bot]")
		return /^🐳 Docker images built and pushed:\s+GitHub Container Registry: `[^`]+`\s+Docker Hub: `[^`]+`\s+Image Digest: `sha256:[a-f0-9]+`$/.test(
			body,
		);
	return false;
}
/** Capture the actual assessed content, so edits under the same comment ID wake us again. */
export function recordFeedbackAssessment(
	context: ExecutionContext,
	output: unknown,
): unknown {
	if (!output || typeof output !== "object") return output;
	const value = output as { addressedCommentIds?: string[] };
	const ids = new Set((value.addressedCommentIds ?? []).map(String));
	const comments =
		readComments(context.run.outputs["merge-readiness"]) ??
		readComments(context.run.outputs.ci) ??
		[];
	return {
		...value,
		assessedComments: comments
			.filter((comment) => ids.has(String(comment.id)))
			.map((comment) => ({
				id: String(comment.id),
				bodySha256: commentHash(comment.body),
			})),
	};
}
function readComments(receipt: unknown): FeedbackComment[] | undefined {
	return receipt && typeof receipt === "object"
		? (receipt as { comments?: FeedbackComment[] }).comments
		: undefined;
}

/** Assess provider discussion once, while still respecting required human reviews. */
export function assessFeedback(
	context: ExecutionContext,
	snapshot: MergeReadiness,
): void {
	const addressedComments = new Map<string, { hash?: string; at: string }>(),
		addressedReviews = new Set<string>();
	for (const item of context.run.history) {
		if (!item.step.endsWith("ci-fix")) continue;
		const output = item.output as
			| {
					addressedCommentIds?: string[];
					addressedReviewIds?: string[];
					assessedComments?: { id: string; bodySha256: string }[];
			  }
			| undefined;
		for (const id of output?.addressedCommentIds ?? [])
			if (!addressedComments.get(String(id))?.hash)
				addressedComments.set(String(id), { at: item.at });
		for (const comment of output?.assessedComments ?? [])
			addressedComments.set(String(comment.id), {
				hash: comment.bodySha256,
				at: item.at,
			});
		for (const id of output?.addressedReviewIds ?? [])
			addressedReviews.add(String(id));
	}
	const comments = (snapshot.comments as FeedbackComment[]).filter(
		(comment) => {
			if (
				!comment.body?.trim() ||
				/<!-- generated-by-(?:cyrus|bobs-factory) -->/.test(comment.body) ||
				informationalComment(comment)
			)
				return false;
			const assessed = addressedComments.get(String(comment.id));
			if (!assessed) return true;
			if (assessed.hash) return assessed.hash !== commentHash(comment.body);
			return Boolean(
				comment.updated_at &&
					(!Number.isFinite(Date.parse(assessed.at)) ||
						Date.parse(comment.updated_at) > Date.parse(assessed.at)),
			);
		},
	);
	if (comments.length)
		snapshot.blockers.push({
			kind: "comments",
			message: `${comments.length} PR comment(s) need assessment`,
			action: "fix",
		});
	const latest = new Map<string, any>();
	for (const review of snapshot.reviews as any[])
		latest.set(review.author?.login ?? review.id, review);
	const requested = [...latest.values()].filter(
		(review) => review.state === "CHANGES_REQUESTED",
	);
	if (
		requested.length &&
		requested.every((review) => addressedReviews.has(String(review.id)))
	) {
		for (const blocker of snapshot.blockers)
			if (blocker.kind === "reviews" && blocker.action === "fix") {
				blocker.action = "human";
				blocker.message =
					"Feedback addressed; waiting for the reviewer to approve";
			}
	}
	snapshot.fix = snapshot.blockers.some((item) => item.action === "fix");
	snapshot.approved = snapshot.approved && !snapshot.blockers.length;
	snapshot.reviewReady =
		snapshot.state === "OPEN" &&
		snapshot.blockers.every((item) => item.action === "human");
}
