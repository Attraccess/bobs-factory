import { z } from "zod";
import {
	PullRequestSchema,
	type TakeoverPullRequest,
} from "./GitProviderContracts.js";
import { pullRequestReference } from "./GitProviderReference.js";
import type { ProviderCommand as TakeoverCommand } from "./MergeReadiness.js";
/** Capture all discussion pages; only same-repository open PRs are supported in the MVP. */
export async function inspectGithubPullRequest(
	command: TakeoverCommand,
	source: string,
): Promise<TakeoverPullRequest> {
	const match = pullRequestReference(source);
	if (match?.type !== "github")
		throw new Error(
			"Enter a GitHub PR URL (https://github.com/owner/repo/pull/123)",
		);
	const slug = match.project;
	const originalCommand = command;
	command = (exe, args) =>
		originalCommand(
			exe,
			match.host === "github.com" || args[0] !== "api"
				? args
				: [...args, "--hostname", match.host],
		);
	const repo = JSON.parse(
		await command("gh", ["repo", "view", "--json", "nameWithOwner"]),
	);
	if (repo.nameWithOwner.toLowerCase() !== slug.toLowerCase())
		throw new Error("PR must belong to the selected repository");
	const pr = PullRequestSchema.extend({
		state: z.literal("OPEN"),
		isCrossRepository: z.literal(false),
	}).parse(
		JSON.parse(
			await command("gh", [
				"pr",
				"view",
				source,
				"--json",
				"url,number,title,body,headRefName,headRefOid,baseRefName,state,isDraft,isCrossRepository",
			]),
		),
	);
	const pages = async (endpoint: string): Promise<unknown[]> =>
		JSON.parse(
			await command("gh", [
				"api",
				"--paginate",
				"--slurp",
				`repos/${slug}/${endpoint}`,
			]),
		).flat();
	// Keep endpoints sequential: logs and receipts follow the same order on every run.
	return {
		...pr,
		comments: await pages(`issues/${pr.number}/comments`),
		reviews: await pages(`pulls/${pr.number}/reviews`),
		reviewComments: await pages(`pulls/${pr.number}/comments`),
	};
}
