import { GithubApi } from "./GithubApi.js";
import { githubPullRequest } from "./GithubProvider.js";
import {
	type TakeoverPullRequest,
	TakeoverPullRequestSchema,
} from "./GitProviderContracts.js";
import {
	pullRequestReference,
	repositoryReference,
	sameRepositoryReference,
} from "./GitProviderReference.js";
import type { ProviderCommand } from "./MergeReadiness.js";

/** Capture all discussion pages; only selected same-repository open PRs are supported. */
export async function inspectGithubPullRequest(
	command: ProviderCommand,
	source: string,
	selectedRepository?: string,
): Promise<TakeoverPullRequest> {
	const reference = pullRequestReference(source);
	if (reference?.type !== "github")
		throw new Error(
			"Enter a GitHub PR URL (https://github.com/owner/repo/pull/123)",
		);
	const selected = repositoryReference(
		selectedRepository ??
			(await command("git", ["remote", "get-url", "origin"])),
	);
	if (!sameRepositoryReference("github", selected, reference))
		throw new Error("PR must belong to the selected repository");
	const api = new GithubApi(command, selected.url);
	const pr = githubPullRequest(
		await api.request("GET", `${api.pullRequestsPath}/${reference.number}`),
	);
	return TakeoverPullRequestSchema.parse({
		...pr,
		comments: await api.pages(
			`repos/${reference.project}/issues/${pr.number}/comments`,
		),
		reviews: await api.pages(
			`repos/${reference.project}/pulls/${pr.number}/reviews`,
		),
		reviewComments: await api.pages(
			`repos/${reference.project}/pulls/${pr.number}/comments`,
		),
	});
}
