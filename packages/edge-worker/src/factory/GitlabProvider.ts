import type { GitProvider } from "./GitProvider.js";
import {
	PullRequestSchema,
	TakeoverPullRequestSchema,
} from "./GitProviderContracts.js";
import { pullRequestReference } from "./GitProviderReference.js";
import type {
	MergeBlocker,
	MergeReadiness,
	ProviderCommand,
} from "./MergeReadiness.js";

/** GitLab REST through the operator's glab credential store, including self-managed hosts. */
export function gitlabProvider(
	command: ProviderCommand,
	repository: { host: string; project: string; url: string },
): GitProvider {
	const root = `projects/${encodeURIComponent(repository.project)}`;
	const api = async (
		path: string,
		method = "GET",
		fields: Record<string, string> = {},
	): Promise<any> =>
		JSON.parse(
			await command("glab", [
				"api",
				`${root}${path}`,
				"--hostname",
				repository.host,
				"--method",
				method,
				...Object.entries(fields).flatMap(([key, value]) => [
					"--raw-field",
					`${key}=${value}`,
				]),
			]),
		);
	const pages = async (path: string): Promise<any[]> => {
		const values: any[] = [];
		for (let page = 1; page <= 1000; page++) {
			const result = await api(
				`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
			);
			if (!Array.isArray(result))
				throw new Error("GitLab returned invalid paginated data");
			values.push(...result);
			if (result.length < 100) return values;
		}
		throw new Error(
			"GitLab pagination exceeded the inspection limit; refusing incomplete evidence",
		);
	};
	const requestPath = (url: string) => {
		const ref = pullRequestReference(url);
		if (ref?.type !== "gitlab" || ref.url !== repository.url)
			throw new Error("MR must belong to the selected repository");
		return `/merge_requests/${ref.number}`;
	};
	const normalize = (mr: any) =>
		PullRequestSchema.parse({
			url: mr.web_url,
			number: mr.iid,
			title: mr.title,
			body: mr.description ?? "",
			headRefName: mr.source_branch,
			headRefOid: mr.sha ?? mr.diff_refs?.head_sha,
			baseRefName: mr.target_branch,
			state:
				mr.state === "opened"
					? "OPEN"
					: mr.state === "merged"
						? "MERGED"
						: "CLOSED",
			isDraft: mr.draft ?? mr.work_in_progress,
			isCrossRepository: mr.source_project_id !== mr.target_project_id,
		});
	const comment = (note: any) => ({
		...note,
		id: String(note.id),
		body: note.body ?? "",
		html_url: note.web_url,
		user: {
			login: note.author?.username ?? "unknown",
			type: note.author?.bot ? "Bot" : "User",
		},
	});
	return {
		list: async (branch) =>
			(
				await pages(
					`/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}`,
				)
			).map((mr) => ({ url: mr.web_url, isDraft: normalize(mr).isDraft })),
		create: async (input) => {
			const mr = await api("/merge_requests", "POST", {
				source_branch: input.branch,
				target_branch: input.baseBranch,
				title: `Draft: ${input.title.replace(/^(?:Draft:|WIP:)\s*/i, "")}`,
				description: input.body,
			});
			const pr = normalize(mr);
			if (pr.state !== "OPEN" || !pr.isDraft)
				throw new Error("GitLab did not create an open draft MR");
			return pr.url;
		},
		view: async (url) => normalize(await api(requestPath(url))),
		inspect: async (url) => {
			const path = requestPath(url);
			const mr = await api(path);
			const project = await api("");
			if (
				mr.target_project_id !== project.id ||
				mr.source_project_id !== project.id
			)
				throw new Error(
					"MR must belong to the selected repository; fork takeover is unsupported",
				);
			const discussions = await pages(`${path}/discussions`);
			return TakeoverPullRequestSchema.parse({
				...normalize(mr),
				comments: (await pages(`${path}/notes`))
					.filter((note) => !note.system)
					.map(comment),
				reviews: [],
				reviewComments: discussions,
			});
		},
		readiness: async (url) => {
			const path = requestPath(url);
			const mr = await api(`${path}?with_merge_status_recheck=true`);
			const pr = normalize(mr);
			const project = await api("");
			const base = await api(
				`/repository/branches/${encodeURIComponent(pr.baseRefName)}`,
			);
			const approvals = await api(`${path}/approvals`);
			if (
				!Number.isInteger(approvals.approvals_left) ||
				approvals.approvals_left < 0
			)
				throw new Error(
					"GitLab approval requirements unavailable; refusing incomplete merge evidence",
				);
			const discussions = await pages(`${path}/discussions`);
			const threads = discussions.filter((d) =>
				d.notes?.some((n: any) => n.resolvable && !n.resolved),
			);
			const comments = (await pages(`${path}/notes`))
				.filter((note) => !note.system)
				.map(comment);
			const checks: MergeReadiness["checks"] = [];
			const blockers: MergeBlocker[] = [];
			const add = (
				kind: string,
				message: string,
				action: MergeBlocker["action"],
			) => blockers.push({ kind, message, action });
			if (pr.state === "CLOSED") add("closed", "MR is closed", "wait");
			if (pr.isDraft)
				add("draft", "Approve the review guide to mark the MR ready", "human");
			if (approvals.approvals_left > 0)
				add("reviews", "Required reviewer approval is missing", "human");
			if (threads.length)
				add(
					"threads",
					`${threads.length} unresolved review discussion(s)`,
					"fix",
				);
			if (mr.has_conflicts || mr.detailed_merge_status === "conflict")
				add("conflicts", "Resolve merge conflicts", "fix");
			if (mr.detailed_merge_status === "need_rebase")
				add("stale", "Branch must be updated from the base", "fix");
			const pipeline = mr.head_pipeline;
			if (pipeline) {
				const jobs = await pages(
					`/pipelines/${pipeline.id}/jobs?include_retried=false`,
				);
				for (const job of jobs)
					checks.push({
						name: job.name,
						state: job.status,
						link: job.web_url,
						bucket:
							job.status === "success" ||
							job.status === "skipped" ||
							(job.allow_failure &&
								["failed", "canceled", "manual"].includes(job.status))
								? "pass"
								: ["failed", "canceled"].includes(job.status)
									? "fail"
									: "pending",
					});
				// Include aggregate/child-pipeline status; job success alone is insufficient.
				checks.push({
					name: "Pipeline",
					state: pipeline.status,
					link: pipeline.web_url,
					bucket:
						pipeline.sha !== pr.headRefOid
							? "pending"
							: pipeline.status === "success" ||
									(pipeline.status === "skipped" &&
										project.allow_merge_on_skipped_pipeline)
								? "pass"
								: ["failed", "canceled"].includes(pipeline.status)
									? "fail"
									: "pending",
				});
				if (checks.some((c) => c.bucket === "fail"))
					add("checks", "Checks failed", "fix");
				if (checks.some((c) => c.bucket === "pending"))
					add(
						"checks",
						pipeline.sha !== pr.headRefOid
							? "Waiting for checks on the current revision"
							: "Checks or manual pipeline jobs are still pending",
						"wait",
					);
			} else if (project.only_allow_merge_if_pipeline_succeeds)
				add(
					"checks",
					"A successful pipeline on the current revision is required",
					"wait",
				);
			const status = mr.detailed_merge_status;
			if (
				![
					"mergeable",
					"draft_status",
					"not_approved",
					"discussions_not_resolved",
					"conflict",
					"need_rebase",
					"ci_must_pass",
					"ci_still_running",
					"not_open",
				].includes(status)
			)
				add("rules", `GitLab merge rules: ${status ?? "unknown"}`, "wait");
			if (
				["ci_must_pass", "ci_still_running"].includes(status) &&
				!blockers.some((b) => b.kind === "checks")
			)
				add(
					"checks",
					"GitLab requires successful current revision checks",
					"wait",
				);
			if (status === "discussions_not_resolved" && !threads.length)
				add("threads", "GitLab requires discussion resolution", "fix");
			if (status === "not_approved" && approvals.approvals_left === 0)
				add("reviews", "GitLab requires reviewer approval", "human");
			if (!base.commit?.id)
				throw new Error("GitLab target revision unavailable");
			return {
				url: pr.url,
				headSha: pr.headRefOid,
				baseSha: base.commit.id,
				state: pr.state,
				isDraft: pr.isDraft,
				approved:
					pr.state === "OPEN" && !blockers.length && status === "mergeable",
				reviewReady:
					pr.state === "OPEN" && blockers.every((b) => b.action === "human"),
				fix: blockers.some((b) => b.action === "fix"),
				blockers,
				checks,
				threads,
				comments,
				reviews: [],
				queued: Boolean(
					mr.merge_when_pipeline_succeeds || mr.auto_merge_enabled,
				),
				mergeMethod:
					project.squash_option === "always" || mr.squash ? "squash" : "merge",
			};
		},
		draft: async (url, draft) => {
			const path = requestPath(url),
				mr = await api(path);
			const title = mr.title.replace(/^(?:Draft:|WIP:)\s*/i, "");
			await api(path, "PUT", { title: draft ? `Draft: ${title}` : title });
		},
		description: async (url, body) => {
			await api(requestPath(url), "PUT", { description: body });
		},
		merge: async (url, sha, method) => {
			// GitLab atomically checks the approved SHA and enforces project rules.
			await api(`${requestPath(url)}/merge`, "PUT", {
				sha,
				squash: String(method === "squash"),
			});
		},
	};
}
