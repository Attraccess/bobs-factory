import type { GithubApiRequest } from "../../src/factory/GithubApi.js";
import { providerReceipt } from "./merge-readiness.js";

export const githubRequest = (args: string[]) =>
	JSON.parse(args[0]!) as GithubApiRequest;
export function githubApiReceipt(
	args: string[],
	extra: Record<string, any> = {},
) {
	const request = githubRequest(args);
	const receipt = providerReceipt(extra);
	const pr = receipt.data.repository.pullRequest;
	if (request.path === "graphql") {
		const query = (request.body as { query: string }).query;
		const mutation = query.includes("convertPullRequestToDraft")
			? "convertPullRequestToDraft"
			: query.includes("markPullRequestReadyForReview")
				? "markPullRequestReadyForReview"
				: undefined;
		if (mutation)
			return {
				data: {
					[mutation]: {
						pullRequest: {
							id: "PR_node",
							isDraft: mutation === "convertPullRequestToDraft",
						},
					},
				},
			};
		return receipt;
	}
	if (request.path.endsWith("/merge")) return { merged: true };
	if (/\/pulls\/\d+$/.test(request.path))
		return {
			html_url: pr.url,
			number: 1,
			node_id: "PR_node",
			title: "Change",
			body: "Description",
			draft: pr.isDraft,
			state: pr.state === "OPEN" ? "open" : "closed",
			merged: pr.state === "MERGED",
			head: {
				ref: "feature",
				sha: pr.headRefOid,
				repo: { full_name: request.project },
			},
			base: {
				ref: "main",
				sha: pr.baseRefOid,
				repo: { full_name: request.project },
			},
		};
	if (request.path.includes("/reviews"))
		return (pr.reviews?.nodes ?? []).map((review: any) => ({
			id: review.id,
			body: review.body,
			state: review.state,
			submitted_at: review.submittedAt,
			user: review.author,
		}));
	return [];
}
