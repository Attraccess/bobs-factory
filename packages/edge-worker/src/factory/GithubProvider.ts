import { GithubApi } from "./GithubApi.js";
import { inspectGithubReadiness } from "./GithubReadiness.js";
import { inspectGithubPullRequest } from "./GithubTakeover.js";
import type { GitProvider } from "./GitProvider.js";
import { PullRequestSchema } from "./GitProviderContracts.js";
import { pullRequestReference } from "./GitProviderReference.js";
import type { ProviderCommand } from "./MergeReadiness.js";

export function githubPullRequest(value: any) {
	return PullRequestSchema.parse({
		url: value.html_url,
		number: value.number,
		title: value.title,
		body: value.body ?? "",
		headRefName: value.head?.ref,
		headRefOid: value.head?.sha,
		baseRefName: value.base?.ref,
		state: value.merged ? "MERGED" : value.state === "open" ? "OPEN" : "CLOSED",
		isDraft: value.draft,
		isCrossRepository:
			!value.head?.repo?.full_name ||
			value.head.repo.full_name.toLowerCase() !==
				value.base?.repo?.full_name?.toLowerCase(),
	});
}

export function githubProvider(
	command: ProviderCommand,
	repositoryUrl: string,
): GitProvider {
	const api = new GithubApi(command, repositoryUrl);
	const path = (url: string) => {
		const reference = pullRequestReference(url);
		if (reference?.type !== "github" || reference.url !== api.repository.url)
			throw new Error("PR must belong to the selected repository");
		return `${api.pullRequestsPath}/${reference.number}`;
	};
	return {
		list: async (branch) =>
			(
				await api.pages<any>(
					`${api.pullRequestsPath}?state=open&head=${encodeURIComponent(`${api.repository.project.split("/")[0]}:${branch}`)}`,
				)
			).map((item) => ({ url: item.html_url, isDraft: item.draft })),
		create: async (input) => {
			const pr = githubPullRequest(
				await api.request("POST", api.pullRequestsPath, {
					head: input.branch,
					base: input.baseBranch,
					title: input.title,
					body: input.body,
					draft: true,
				}),
			);
			if (
				pr.state !== "OPEN" ||
				!pr.isDraft ||
				pr.isCrossRepository ||
				pr.headRefName !== input.branch ||
				pr.baseRefName !== input.baseBranch
			)
				throw new Error(
					"GitHub did not create the requested same-repository open draft",
				);
			return pr.url;
		},
		view: async (url) => githubPullRequest(await api.request("GET", path(url))),
		inspect: (url) =>
			inspectGithubPullRequest(command, url, api.repository.url),
		readiness: (url) => inspectGithubReadiness(command, url),
		draft: async (url, draft) => {
			const pr = await api.request<any>("GET", path(url));
			if (typeof pr.node_id !== "string")
				throw new Error("GitHub pull request identity is unavailable");
			const mutation = draft
				? "convertPullRequestToDraft"
				: "markPullRequestReadyForReview";
			const payload = await api.graphql(
				`mutation($id:ID!){${mutation}(input:{pullRequestId:$id}){pullRequest{id isDraft}}}`,
				{ id: pr.node_id },
			);
			const returned = payload.data?.[mutation]?.pullRequest;
			if (returned?.id !== pr.node_id || returned?.isDraft !== draft)
				throw new Error("GitHub did not confirm the requested draft state");
		},
		description: async (url, body) => {
			await api.request("PATCH", path(url), { body });
		},
		merge: async (url, sha, method) => {
			if (!sha)
				throw new Error(
					"GitHub merges require an explicitly approved head SHA",
				);
			path(url);
			const reference = pullRequestReference(url)!;
			const [owner, name] = api.repository.project.split("/");
			const payload = await api.graphql(
				`query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){id url headRefOid state isDraft isCrossRepository isMergeQueueEnabled isInMergeQueue mergeQueueEntry{id}}}}`,
				{ owner, name, number: reference.number },
			);
			const pr = payload.data?.repository?.pullRequest;
			if (
				!pr ||
				pr.url !== url ||
				pr.headRefOid !== sha ||
				pr.isCrossRepository !== false ||
				pr.isDraft !== false ||
				!pr.id ||
				typeof pr.isMergeQueueEnabled !== "boolean"
			)
				throw new Error(
					"GitHub merge identity, rules or approved head revision changed; inspect and approve the current revision again",
				);
			if (pr.state === "MERGED") return;
			if (pr.state !== "OPEN")
				throw new Error("GitHub pull request is no longer open");
			if (pr.isMergeQueueEnabled) {
				if (pr.isInMergeQueue || pr.mergeQueueEntry) return;
				const queued = await api.graphql(
					`mutation($id:ID!,$sha:GitObjectID!){enqueuePullRequest(input:{pullRequestId:$id,expectedHeadOid:$sha}){mergeQueueEntry{id pullRequest{id url headRefOid}}}}`,
					{ id: pr.id, sha },
				);
				const entry = queued.data?.enqueuePullRequest?.mergeQueueEntry;
				if (
					!entry?.id ||
					entry.pullRequest?.id !== pr.id ||
					entry.pullRequest?.url !== url ||
					entry.pullRequest?.headRefOid !== sha
				)
					throw new Error(
						"GitHub did not confirm enqueueing the approved revision; recheck merge queue evidence",
					);
				return;
			}
			const response = await api.request<any>("PUT", `${path(url)}/merge`, {
				sha,
				merge_method: method,
			});
			if (response.merged !== true)
				throw new Error(
					"GitHub did not confirm merge; recheck the approved revision and repository rules",
				);
		},
	};
}
