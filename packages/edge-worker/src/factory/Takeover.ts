import { type GitProvider, providerForUrl } from "./GitProvider.js";
import { isPullRequestSource } from "./GitProviderReference.js";

export type { TakeoverPullRequest } from "./GitProviderContracts.js";

import { z } from "zod";
import { taskbotSource } from "./TicketTracking.js";

const ticketIdPattern = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const ticketUrlPattern =
	/^https:\/\/linear\.app\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9_]*-\d+)(?:\/.*)?$/;

export const TakeoverSourceSchema = z
	.string()
	.refine(
		(source) =>
			Boolean(taskbotSource(source)) ||
			ticketIdPattern.test(source) ||
			ticketUrlPattern.test(source) ||
			isPullRequestSource(source),
		"Use an existing Linear ticket ID (e.g. ATT-1127), Linear or Taskbot ticket URL or a pull/merge request URL. Put task instructions in Additional instructions, or choose Software factory for a new task.",
	);

export type TakeoverCommand = (
	executable: string,
	args: string[],
) => Promise<string>;
export function ticketIdentifier(source: string): string {
	if (ticketIdPattern.test(source)) return source;
	const match = source.match(ticketUrlPattern);
	if (!match)
		throw new Error(
			"Enter a Linear ticket identifier/URL or a pull/merge request URL",
		);
	return match[1]!;
}

export async function inspectPullRequest(
	command: TakeoverCommand,
	source: string,
	provider?: GitProvider,
) {
	return (provider ?? providerForUrl(command, source)).inspect(source);
}
