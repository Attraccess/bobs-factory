import { pullRequestReference } from "../GitProviderReference.js";

type RecordValue = Record<string, unknown>;
export type ReviewLink = { url: string; label: string };
export type CheckoutCommand = { label: string; command: string; help: string };

function record(value: unknown): RecordValue {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as RecordValue)
		: {};
}

function hasControlCharacters(value: string): boolean {
	return Array.from(value).some(
		(char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
	);
}

function webUrl(value: unknown): string | undefined {
	if (
		typeof value !== "string" ||
		!value.trim() ||
		/\s/.test(value.trim()) ||
		hasControlCharacters(value)
	)
		return;
	const text = value.trim();
	try {
		const url = new URL(text);
		if (
			/^https?:\/\//.test(text) &&
			!url.username &&
			!url.password &&
			![".", ".."].includes(url.hostname)
		)
			return text;
	} catch {
		// Older or partial run metadata may not contain a usable URL.
	}
	return undefined;
}

function githubPr(url: string | undefined) {
	const match = url?.match(
		/^https:\/\/github\.com\/([\w-]+)\/([\w.-]+)\/pull\/([1-9]\d*)\/?$/,
	);
	return match && ![".", ".."].includes(match[2]!) ? match : undefined;
}

function branchName(value: unknown): string | undefined {
	if (
		typeof value !== "string" ||
		!value ||
		value === "@" ||
		value.startsWith("-") ||
		/[\s~^:?*[\\]/.test(value) ||
		hasControlCharacters(value) ||
		value.includes("..") ||
		value.includes("@{") ||
		value.endsWith(".") ||
		value
			.split("/")
			.some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))
	)
		return;
	return value;
}

/** Quote exactly one POSIX shell argument, including literal single quotes. */
export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function ticketLink(value: unknown): ReviewLink | undefined {
	const ref = record(value),
		url = webUrl(ref.url);
	if (!url) return;
	if (
		ref.provider === "native" &&
		typeof ref.platform === "string" &&
		ref.platform &&
		typeof ref.workspaceId === "string" &&
		ref.workspaceId &&
		typeof ref.id === "string" &&
		ref.id
	) {
		const identifier = new URL(url).pathname.match(
			/\/issue\/([A-Za-z][\w]*-\d+)(?:\/|$)/,
		)?.[1];
		return { url, label: identifier ?? "Ticket" };
	}
	if (
		ref.provider === "taskbot" &&
		typeof ref.server === "string" &&
		ref.server &&
		typeof ref.project === "string" &&
		/^[a-z0-9-]+$/.test(ref.project) &&
		Number.isSafeInteger(ref.id) &&
		Number(ref.id) > 0 &&
		webUrl(ref.instance) &&
		url === `${ref.instance}/p/${ref.project}/t/${ref.id}`
	)
		return { url, label: `${ref.project} #${ref.id}` };
	return undefined;
}

/** Resolve only published metadata; never discover ticket links in run content. */
export function reviewContext(value: unknown) {
	const run = record(value),
		outputs = record(run.outputs),
		gate = record(run.reviewGate),
		draft = record(outputs["draft-pr"]),
		source = record(outputs.source),
		existing = record(outputs["existing-work"]);
	const prUrl = [gate.url, draft.url, source.url].map(webUrl).find((url) => {
		if (!url) return false;
		return new URL(url).hostname !== "github.com" || Boolean(githubPr(url));
	});
	const github = githubPr(prUrl);
	const forge = pullRequestReference(prUrl);
	const branch = [draft.branch, source.headRefName, existing.branch]
		.map(branchName)
		.find(Boolean);
	const repositoryUrl = forge?.url;
	const branchUrl =
		repositoryUrl &&
		branch &&
		source.isCrossRepository !== true &&
		draft.isCrossRepository !== true
			? `${repositoryUrl}${forge?.type === "gitlab" ? "/-/tree/" : "/tree/"}${encodeURIComponent(branch)}`
			: undefined;
	const commands: CheckoutCommand[] = [];
	if (github && prUrl)
		commands.push({
			label: "GitHub CLI",
			command: `gh pr checkout ${github[3]}`,
			help: "Run in a local clone with GitHub CLI installed.",
		});
	if (forge?.type === "gitlab")
		commands.push({
			label: "GitLab CLI",
			command: `glab mr checkout ${forge.number} --repo ${shellQuote(forge.url)}`,
			help: "Run in a local clone with GitLab CLI installed.",
		});
	if (forge?.type === "github" && !github)
		commands.push({
			label: "GitHub CLI",
			command: `gh pr checkout ${forge.number} --repo ${shellQuote(forge.url)}`,
			help: "Run in a local clone with GitHub CLI installed.",
		});
	if (branch)
		commands.push({
			label: "Git only",
			command: `git checkout ${/^[\w./-]+$/.test(branch) ? branch : shellQuote(branch)}`,
			help: "Run in a local clone where the branch is available.",
		});
	return {
		pr: prUrl
			? {
					url: prUrl,
					label: forge
						? `${forge.type === "gitlab" ? "MR !" : "PR #"}${forge.number}`
						: "Pull request",
				}
			: undefined,
		branch,
		branchUrl,
		ticket: ticketLink(run.ticketReference),
		commands,
	};
}
