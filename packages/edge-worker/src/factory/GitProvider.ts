import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type GitProviderConfig,
	GitProviderConfigSchema,
	resolvePath,
} from "bobs-factory-core";
import { z } from "zod";
import { inspectGithubReadiness } from "./GithubReadiness.js";
import { inspectGithubPullRequest } from "./GithubTakeover.js";
import { gitlabProvider } from "./GitlabProvider.js";
import {
	PullRequestSchema,
	ReadinessSchema,
	type TakeoverPullRequest,
	TakeoverPullRequestSchema,
} from "./GitProviderContracts.js";
import {
	pullRequestReference,
	repositoryReference,
} from "./GitProviderReference.js";
import type {
	MergeReadiness,
	ProviderCheck,
	ProviderCommand,
} from "./MergeReadiness.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

export type GitProviderSnapshot = GitProviderConfig & { repositoryUrl: string };
export function normalizeGitProviderConfig(
	config: GitProviderConfig | undefined,
): GitProviderConfig | undefined {
	return config?.type === "custom"
		? {
				...config,
				command: config.command.includes("/")
					? resolvePath(config.command)
					: config.command,
			}
		: config;
}
export interface GitProvider {
	retryCheck?(
		url: string,
		retry: NonNullable<ProviderCheck["retry"]>,
	): Promise<void>;
	list(branch: string): Promise<{ url: string; isDraft: boolean }[]>;
	create(input: {
		branch: string;
		baseBranch: string;
		title: string;
		body: string;
	}): Promise<string>;
	view(
		url: string,
		fields?: string,
	): Promise<{ state: string; isDraft: boolean; headRefOid: string }>;
	inspect(url: string): Promise<TakeoverPullRequest>;
	readiness(url: string): Promise<MergeReadiness>;
	draft(url: string, draft: boolean): Promise<void>;
	description(url: string, body: string): Promise<void>;
	merge(
		url: string,
		headSha: string,
		method: MergeReadiness["mergeMethod"],
	): Promise<void>;
}

export function providerForUrl(
	command: ProviderCommand,
	url: string,
): GitProvider {
	const ref = pullRequestReference(url);
	if (!ref)
		throw new Error(
			"Select a Git provider adapter for this pull/merge request URL",
		);
	return gitProvider(command, { type: ref.type, repositoryUrl: ref.url });
}

/** Resolve once per run. A custom host must be explicitly identified; never guess GitHub. */
export async function resolveGitProvider(
	context: ExecutionContext,
	command: ProviderCommand,
	requestUrl?: string,
): Promise<GitProvider> {
	const { run } = context;
	if (!run.gitProvider) {
		const metadata = run.outputs.repository as
			| { gitProvider?: unknown; githubUrl?: unknown; gitlabUrl?: unknown }
			| undefined;
		const configured = metadata?.gitProvider;
		const config = configured
			? GitProviderConfigSchema.parse(configured)
			: undefined;
		const githubUrl = metadata?.githubUrl;
		const gitlabUrl = metadata?.gitlabUrl;
		if (!config && githubUrl && gitlabUrl)
			throw new Error(
				"Both githubUrl and gitlabUrl are configured; select repositories[].gitProvider explicitly",
			);
		const configuredUrl =
			config?.type === "github"
				? githubUrl
				: config?.type === "gitlab"
					? gitlabUrl
					: (gitlabUrl ?? githubUrl);
		const retainedUrl =
			(run.outputs.source as { url?: string } | undefined)?.url ??
			(run.outputs["draft-pr"] as { url?: string } | undefined)?.url;
		const existingUrl = retainedUrl ?? requestUrl;
		const existing =
			typeof existingUrl === "string"
				? pullRequestReference(existingUrl)
				: undefined;
		const reference = repositoryReference(
			config?.type === "custom"
				? config.repositoryUrl
				: typeof configuredUrl === "string"
					? configuredUrl
					: ((retainedUrl ? existing?.url : undefined) ??
						(await command("git", ["remote", "get-url", "origin"]))),
		);
		const type =
			config?.type ??
			(gitlabUrl
				? "gitlab"
				: githubUrl
					? "github"
					: (existing?.type ??
						(reference.host === "github.com"
							? "github"
							: reference.host === "gitlab.com"
								? "gitlab"
								: undefined)));
		if (!type)
			throw new Error(
				`No Git provider configured for ${reference.host}. Set repositories[].gitProvider to github, gitlab or a custom adapter; Git authentication alone does not select a review/CI provider.`,
			);
		run.gitProvider =
			config?.type === "custom"
				? {
						...config,
						command: config.command.startsWith("~")
							? resolvePath(config.command)
							: config.command,
						repositoryUrl: reference.url,
					}
				: ({ type, repositoryUrl: reference.url } as GitProviderSnapshot);
	}
	run.ciSupervision ??= { retries: [] };
	run.ciSupervision.checkReceipts ??= {};
	return gitProvider(command, run.gitProvider, run.ciSupervision.checkReceipts);
}

export function gitProvider(
	command: ProviderCommand,
	snapshot: GitProviderSnapshot,
	checkReceipts?: NonNullable<
		import("./CISupervision.js").CISupervision["checkReceipts"]
	>,
): GitProvider {
	const repository = repositoryReference(snapshot.repositoryUrl);
	const repositoryWebUrl = new URL(repository.url);
	const checkedUrl = (url: string) => {
		const parsed = new URL(url);
		const ref = pullRequestReference(url);
		if (
			parsed.protocol !== "https:" ||
			parsed.username ||
			parsed.password ||
			parsed.search ||
			parsed.hash ||
			(snapshot.type === "custom"
				? parsed.origin !== repositoryWebUrl.origin ||
					!parsed.pathname.startsWith(`${repositoryWebUrl.pathname}/`)
				: ref?.type !== snapshot.type || ref.url !== repository.url)
		)
			throw new Error(
				"Pull/merge request must belong to the selected repository and provider",
			);
		return url;
	};
	const sameRequest = (expected: string, returned: string) => {
		if (
			new URL(checkedUrl(expected)).href.replace(/\/$/, "") !==
			new URL(checkedUrl(returned)).href.replace(/\/$/, "")
		)
			throw new Error("Provider returned a different pull/merge request");
	};
	let provider: GitProvider;
	if (snapshot.type === "github") {
		const gh = (args: string[]) =>
			command(
				"gh",
				args[0] === "api" && repository.host !== "github.com"
					? [...args, "--hostname", repository.host]
					: args,
			);
		provider = {
			retryCheck: async (url, retry) => {
				if (retry.kind !== "github-run" || !/^\d+$/.test(retry.id))
					throw new Error("Invalid GitHub retry receipt");
				const pr = JSON.parse(
					await gh(["pr", "view", url, "--json", "headRefOid,state"]),
				);
				if (pr.headRefOid !== retry.headSha || pr.state !== "OPEN")
					throw new Error("CI retry revision changed");
				const path = `repos/${repository.project}/actions/runs/${retry.id}`;
				const receipt = JSON.parse(await gh(["api", path]));
				if (
					receipt.head_sha !== retry.headSha ||
					receipt.run_attempt !== retry.attempt ||
					receipt.status !== "completed"
				)
					return;
				await gh(["api", `${path}/rerun-failed-jobs`, "--method", "POST"]);
			},
			list: async (branch) =>
				JSON.parse(
					await gh([
						"pr",
						"list",
						"--head",
						branch,
						"--state",
						"open",
						"--json",
						"url,isDraft",
						"--repo",
						repository.url,
					]),
				),
			create: (input) =>
				gh([
					"pr",
					"create",
					"--draft",
					"--base",
					input.baseBranch,
					"--head",
					input.branch,
					"--title",
					input.title,
					"--body",
					input.body,
					"--repo",
					repository.url,
				]),
			view: async (url, fields = "headRefOid,isDraft,state") =>
				JSON.parse(await gh(["pr", "view", url, "--json", fields])),
			inspect: (url) => inspectGithubPullRequest(command, url),
			readiness: (url) => inspectGithubReadiness(command, url, checkReceipts),
			draft: async (url, draft) => {
				await gh(["pr", "ready", url, ...(draft ? ["--undo"] : [])]);
			},
			description: async (url, body) => {
				await gh(["pr", "edit", url, "--body", body]);
			},
			merge: async (url, sha, method) => {
				await gh([
					"pr",
					"merge",
					url,
					`--${method}`,
					"--match-head-commit",
					sha,
				]);
			},
		};
	} else if (snapshot.type === "gitlab")
		provider = gitlabProvider(command, repository);
	else if (snapshot.type === "custom") {
		const invoke = async (operation: string, input: unknown) => {
			const directory = mkdtempSync(join(tmpdir(), "factory-git-provider-"));
			const path = join(directory, "request.json");
			try {
				writeFileSync(
					path,
					JSON.stringify({ version: 1, repositoryUrl: repository.url, input }),
					{ mode: 0o600 },
				);
				return JSON.parse(
					await command(snapshot.command, [
						...snapshot.args,
						operation,
						"--request",
						path,
					]),
				);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		};
		provider = {
			list: async (branch) =>
				z
					.array(z.object({ url: z.string().url(), isDraft: z.boolean() }))
					.parse(await invoke("list", { branch })),
			create: async (input) => {
				const { url } = z
					.object({ url: z.string().url() })
					.parse(await invoke("create", input));
				checkedUrl(url);
				const pr = PullRequestSchema.parse(await invoke("view", { url }));
				sameRequest(url, pr.url);
				if (
					pr.state !== "OPEN" ||
					!pr.isDraft ||
					pr.isCrossRepository ||
					pr.headRefName !== input.branch ||
					pr.baseRefName !== input.baseBranch
				)
					throw new Error(
						"Custom provider did not create the requested same-repository open draft",
					);
				return url;
			},
			view: async (url) =>
				PullRequestSchema.parse(await invoke("view", { url })),
			inspect: async (url) =>
				TakeoverPullRequestSchema.parse(await invoke("inspect", { url })),
			readiness: async (url) =>
				ReadinessSchema.parse(await invoke("readiness", { url })),
			draft: async (url, draft) => {
				z.object({ ok: z.literal(true) }).parse(
					await invoke("draft", { url, draft }),
				);
			},
			description: async (url, body) => {
				z.object({ ok: z.literal(true) }).parse(
					await invoke("description", { url, body }),
				);
			},
			merge: async (url, headSha, method) => {
				z.object({ ok: z.literal(true) }).parse(
					await invoke("merge", { url, headSha, method }),
				);
			},
		};
	} else throw new Error("Unknown Git provider");
	// Provider output must not redirect subsequent mutations to another repository.
	return {
		...(provider.retryCheck
			? {
					retryCheck: (
						url: string,
						retry: NonNullable<ProviderCheck["retry"]>,
					) => provider.retryCheck!(checkedUrl(url), retry),
				}
			: {}),
		list: async (branch) =>
			(await provider.list(branch)).map((item) => ({
				...item,
				url: checkedUrl(item.url),
			})),
		create: async (input) => checkedUrl((await provider.create(input)).trim()),
		view: async (url, fields) => {
			const pr = await provider.view(checkedUrl(url), fields);
			if ("url" in pr && typeof pr.url === "string") sameRequest(url, pr.url);
			return pr;
		},
		inspect: async (url) => {
			const pr = await provider.inspect(checkedUrl(url));
			sameRequest(url, pr.url);
			return pr;
		},
		readiness: async (url) => {
			const receipt = await provider.readiness(checkedUrl(url));
			sameRequest(url, receipt.url);
			return receipt;
		},
		draft: async (url, draft) => provider.draft(checkedUrl(url), draft),
		description: async (url, body) =>
			provider.description(checkedUrl(url), body),
		merge: async (url, sha, method) =>
			provider.merge(checkedUrl(url), sha, method),
	};
}
