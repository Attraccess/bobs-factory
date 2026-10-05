import { z } from "zod";

const ticketIdPattern = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const ticketUrlPattern =
	/^https:\/\/linear\.app\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9_]*-\d+)(?:\/.*)?$/;
const pullRequestUrlPattern =
	/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/;

export const TakeoverSourceSchema = z
	.string()
	.refine(
		(source) =>
			ticketIdPattern.test(source) ||
			ticketUrlPattern.test(source) ||
			pullRequestUrlPattern.test(source),
		"Use an existing Linear ticket ID (e.g. ATT-1127), Linear ticket URL or GitHub PR URL. Put task instructions in Additional instructions, or choose Software factory for a new task.",
	);

export type TakeoverCommand = (
	executable: string,
	args: string[],
) => Promise<string>;
const PullRequestSchema = z.object({
	url: z.string().url(),
	number: z.number().int().positive(),
	title: z.string(),
	body: z.string(),
	headRefName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9/_\-.]*$/),
	headRefOid: z.string().min(1),
	baseRefName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9/_\-.]*$/),
	state: z.literal("OPEN"),
	isDraft: z.boolean(),
	isCrossRepository: z.literal(false),
});
export type TakeoverPullRequest = z.infer<typeof PullRequestSchema> & {
	comments: unknown[];
	reviews: unknown[];
	reviewComments: unknown[];
};

/** Capture all discussion pages; only same-repository open PRs are supported in the MVP. */
export async function inspectPullRequest(
	command: TakeoverCommand,
	source: string,
): Promise<TakeoverPullRequest> {
	const match = source.match(pullRequestUrlPattern);
	if (!match)
		throw new Error(
			"Enter a GitHub PR URL (https://github.com/owner/repo/pull/123)",
		);
	const slug = `${match[1]}/${match[2]}`;
	const repo = JSON.parse(
		await command("gh", ["repo", "view", "--json", "nameWithOwner"]),
	);
	if (repo.nameWithOwner.toLowerCase() !== slug.toLowerCase())
		throw new Error("PR must belong to the selected repository");
	const pr = PullRequestSchema.parse(
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
export function ticketIdentifier(source: string): string {
	if (ticketIdPattern.test(source)) return source;
	const match = source.match(ticketUrlPattern);
	if (!match)
		throw new Error("Enter a Linear ticket identifier/URL or a GitHub PR URL");
	return match[1]!;
}
