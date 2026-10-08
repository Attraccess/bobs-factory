import { GithubApi } from "./GithubApi.js";
import { pullRequestReference } from "./GitProviderReference.js";
import type {
	MergeBlocker,
	MergeReadiness,
	ProviderCommand,
} from "./MergeReadiness.js";

export async function inspectGithubReadiness(
	command: ProviderCommand,
	url: string,
): Promise<MergeReadiness> {
	const reference = pullRequestReference(url);
	if (reference?.type !== "github") throw new Error("Enter a GitHub PR URL");
	const [owner, name] = reference.project.split("/");
	const number = reference.number;
	const api = new GithubApi(command, reference.url);
	const query = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed pullRequest(number:$number){url headRefOid baseRefOid state isDraft mergeable mergeStateStatus reviewDecision isMergeQueueEnabled isInMergeQueue mergeQueueEntry{id} autoMergeRequest{enabledAt} statusCheckRollup{contexts(first:100){pageInfo{hasNextPage endCursor} nodes{__typename ... on CheckRun{name status conclusion detailsUrl} ... on StatusContext{context state targetUrl}}}} reviewThreads(first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated comments(first:100){nodes{id body url author{login}} pageInfo{hasNextPage endCursor}}}}}}}`;
	const variables = { owner, name, number };
	let cursor: string | undefined;
	let method: MergeReadiness["mergeMethod"] = "squash";
	let pr: any;
	const threads: any[] = [];
	let methodsAvailable = true;
	const seen = new Set<string>();
	do {
		const payload = await api.graphql(query, {
			...variables,
			...(cursor ? { cursor } : {}),
		});
		const repository = payload.data?.repository;
		methodsAvailable = Boolean(
			repository?.squashMergeAllowed ||
				repository?.mergeCommitAllowed ||
				repository?.rebaseMergeAllowed,
		);
		method = repository?.squashMergeAllowed
			? "squash"
			: repository?.mergeCommitAllowed
				? "merge"
				: "rebase";
		const next = repository?.pullRequest;
		if (!next) throw new Error("Pull request unavailable");
		if (
			pr &&
			(pr.headRefOid !== next.headRefOid || pr.baseRefOid !== next.baseRefOid)
		)
			throw new Error(
				"PR changed during provider inspection; inspect the new revision again",
			);
		pr ??= next;
		threads.push(...next.reviewThreads.nodes);
		cursor = next.reviewThreads.pageInfo.hasNextPage
			? next.reviewThreads.pageInfo.endCursor
			: undefined;
		if (
			next.reviewThreads.pageInfo.hasNextPage &&
			(!cursor || seen.has(cursor))
		)
			throw new Error("GitHub review-thread pagination is incomplete");
		if (cursor) seen.add(cursor);
	} while (cursor);
	for (const thread of threads) {
		let page = thread.comments.pageInfo;
		const seenComments = new Set<string>();
		while (page.hasNextPage) {
			const after = page.endCursor;
			if (!after || seenComments.has(after))
				throw new Error("GitHub review-comment pagination is incomplete");
			seenComments.add(after);
			const payload = await api.graphql(
				`query($id:ID!,$cursor:String!){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$cursor){nodes{id body url author{login}} pageInfo{hasNextPage endCursor}}}}}`,
				{ id: thread.id, cursor: after },
			);
			const comments = payload.data?.node?.comments;
			if (!comments) throw new Error("Review thread discussion unavailable");
			thread.comments.nodes.push(...comments.nodes);
			page = comments.pageInfo;
		}
		thread.comments.pageInfo = page;
	}
	const contexts = pr.statusCheckRollup?.contexts;
	let checkPage = contexts?.pageInfo;
	const seenChecks = new Set<string>();
	while (checkPage?.hasNextPage) {
		const after = checkPage.endCursor;
		if (!after || seenChecks.has(after))
			throw new Error("GitHub check pagination is incomplete");
		seenChecks.add(after);
		const payload = await api.graphql(
			`query($owner:String!,$name:String!,$number:Int!,$cursor:String!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid baseRefOid statusCheckRollup{contexts(first:100,after:$cursor){nodes{__typename ... on CheckRun{name status conclusion detailsUrl} ... on StatusContext{context state targetUrl}} pageInfo{hasNextPage endCursor}}}}}}`,
			{ ...variables, cursor: after },
		);
		const next = payload.data?.repository?.pullRequest;
		if (
			!next ||
			next.headRefOid !== pr.headRefOid ||
			next.baseRefOid !== pr.baseRefOid
		)
			throw new Error(
				"PR changed during provider inspection; inspect the new revision again",
			);
		const nextContexts = next.statusCheckRollup?.contexts;
		if (!nextContexts) throw new Error("GitHub check evidence unavailable");
		contexts.nodes.push(...nextContexts.nodes);
		checkPage = nextContexts.pageInfo;
	}
	if (contexts) contexts.pageInfo = checkPage;
	const comments = await api.pages(
		`repos/${owner}/${name}/issues/${number}/comments`,
	);
	const reviews = (
		await api.pages<any>(`repos/${owner}/${name}/pulls/${number}/reviews`)
	).map((review) => ({
		...review,
		id: String(review.node_id ?? review.id),
		state: review.state,
		body: review.body ?? "",
		submittedAt: review.submitted_at,
		author: { login: review.user?.login },
	}));
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
	if (!methodsAvailable)
		add("rules", "No merge method is enabled for this repository", "human");
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
	if (pr.mergeStateStatus === "BEHIND" && !pr.isMergeQueueEnabled)
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
		!pr.isMergeQueueEnabled &&
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
			(["CLEAN", "UNSTABLE", "HAS_HOOKS"].includes(pr.mergeStateStatus) ||
				(pr.isMergeQueueEnabled &&
					["BLOCKED", "BEHIND"].includes(pr.mergeStateStatus))),
		reviewReady:
			pr.state === "OPEN" &&
			blockers.every((blocker) => blocker.action === "human"),
		fix: blockers.some((blocker) => blocker.action === "fix"),
		blockers,
		checks,
		threads: openThreads,
		comments,
		reviews,
		queued: Boolean(
			pr.isInMergeQueue || pr.mergeQueueEntry || pr.autoMergeRequest,
		),
		mergeMethod: method,
	};
}
