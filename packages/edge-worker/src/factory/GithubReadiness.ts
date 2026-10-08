import { pullRequestReference } from "./GitProviderReference.js";
import type {
	MergeBlocker,
	MergeReadiness,
	ProviderCommand,
} from "./MergeReadiness.js";

export async function inspectGithubReadiness(
	command: ProviderCommand,
	url: string,
	checkReceipts?: NonNullable<
		import("./CISupervision.js").CISupervision["checkReceipts"]
	>,
): Promise<MergeReadiness> {
	const reference = pullRequestReference(url);
	if (reference?.type !== "github") throw new Error("Enter a GitHub PR URL");
	const [owner, name] = reference.project.split("/");
	const number = reference.number;
	const originalCommand = command;
	command = (exe, args, timeout) =>
		originalCommand(
			exe,
			exe !== "gh" || reference.host === "github.com"
				? args
				: [...args, "--hostname", reference.host],
			timeout,
		);
	const query = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed pullRequest(number:$number){url title headRefOid baseRefOid state isDraft mergeable mergeStateStatus reviewDecision mergeQueueEntry{id} autoMergeRequest{enabledAt} statusCheckRollup{contexts(first:100){pageInfo{hasNextPage} nodes{__typename ... on CheckRun{databaseId name status conclusion detailsUrl} ... on StatusContext{context state targetUrl}}}} reviewThreads(first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated comments(first:100){nodes{id body url author{login}} pageInfo{hasNextPage}}}} comments(last:100){nodes{id body url createdAt author{login}} pageInfo{hasPreviousPage}} reviews(last:100){nodes{id state body submittedAt author{login}} pageInfo{hasPreviousPage}}}}}`;
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
				...(state === "STARTUP_FAILURE"
					? {
							failure: {
								kind: "infrastructure",
								evidence: "GitHub check conclusion: STARTUP_FAILURE",
							},
						}
					: {}),
			};
		},
	);
	// Classify only provider evidence, never a check name or a fixer's guess.
	const runs = new Map<string, any>();
	for (const [index, source] of (
		pr.statusCheckRollup?.contexts.nodes ?? []
	).entries()) {
		const check = checks[index];
		if (check.bucket !== "fail" || !Number.isSafeInteger(source.databaseId))
			continue;
		let id: string | undefined;
		try {
			const link = new URL(check.link);
			const prefix = `/${owner}/${name}/actions/runs/`;
			const match: RegExpMatchArray | null =
				link.hostname === reference.host && link.pathname.startsWith(prefix)
					? link.pathname.slice(prefix.length).match(/^(\d+)(?:\/|$)/)
					: null;
			id = match?.[1];
		} catch {
			/* Non-Actions checks still retain failure evidence without a retry identity. */
		}
		if (id && !runs.has(id))
			runs.set(
				id,
				JSON.parse(
					await command("gh", [
						"api",
						`repos/${owner}/${name}/actions/runs/${id}`,
					]),
				),
			);
		const run: any = id ? runs.get(id) : undefined;
		const key = JSON.stringify([
			reference.url,
			pr.headRefOid,
			source.databaseId,
			check.state,
			run?.run_attempt ?? null,
			run?.status ?? null,
		]);
		if (checkReceipts?.[key]) check.failure = checkReceipts[key].failure;
		else {
			const detail = JSON.parse(
				await command("gh", [
					"api",
					`repos/${owner}/${name}/check-runs/${source.databaseId}`,
				]),
			);
			if (detail.head_sha !== pr.headRefOid) continue;
			const evidence = [
				detail.output?.title,
				detail.output?.summary,
				detail.output?.text,
			]
				.filter((value) => typeof value === "string")
				.join("\n");
			check.failure = {
				kind:
					check.state === "STARTUP_FAILURE" ||
					/^\s*The job was not acquired by Runner of type hosted even after multiple attempts\.?\s*$/im.test(
						evidence,
					)
						? "infrastructure"
						: /pull request title.*(?:does not match|invalid|must|format|validation)/i.test(
									evidence,
								)
							? "metadata"
							: "unknown",
				evidence,
			};
			if (checkReceipts) {
				checkReceipts[key] = { failure: check.failure };
				while (Object.keys(checkReceipts).length > 200)
					delete checkReceipts[Object.keys(checkReceipts)[0]!];
			}
		}
		if (
			id &&
			run &&
			String(run.id) === id &&
			run.head_sha === pr.headRefOid &&
			Number.isSafeInteger(run.run_attempt) &&
			[
				"queued",
				"in_progress",
				"completed",
				"waiting",
				"pending",
				"requested",
			].includes(run.status)
		) {
			let metadataRecheck = checkReceipts?.[key]?.metadataRecheck;
			if (check.failure.kind === "metadata" && metadataRecheck === undefined) {
				metadataRecheck = false;
				const path = typeof run.path === "string" ? run.path.split("@")[0] : "";
				if (/^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(path)) {
					try {
						const workflow = await command("git", [
							"show",
							`${pr.headRefOid}:${path}`,
						]);
						metadataRecheck =
							/^\s*(?:run:\s*)?gh\s+pr\s+view\b[^\n]*--json\s+title\b/m.test(
								workflow,
							) && !workflow.includes("github.event.pull_request.title");
					} catch {
						/* Unavailable workflow source cannot establish support. */
					}
				}
				if (checkReceipts?.[key])
					checkReceipts[key].metadataRecheck = metadataRecheck;
			}
			check.retry = {
				status: run.status,
				id,
				attempt: run.run_attempt,
				headSha: run.head_sha,
				kind: "github-run",
				...(metadataRecheck ? { metadataRecheck: true } : {}),
			};
		}
	}
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
		...(typeof pr.title === "string" ? { metadata: { title: pr.title } } : {}),
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
