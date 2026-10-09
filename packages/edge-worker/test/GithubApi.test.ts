import {
	chmodSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ResolvedExecutionEnvironment } from "../src/factory/ExecutionEnvironment.js";
import { executeCommand } from "../src/factory/FactoryTools.js";
import {
	executeGithubApi,
	GITHUB_API_COMMAND,
	githubRuntimeCredentials,
	readGithubAuth,
} from "../src/factory/GithubApi.js";
import { inspectGithubReadiness } from "../src/factory/GithubReadiness.js";
import { gitProvider } from "../src/factory/GitProvider.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";
import { githubApiReceipt, githubRequest } from "./fixtures/github-api.js";
import { providerReceipt } from "./fixtures/merge-readiness.js";

const repositoryUrl = "https://github.com/test/repo";
const url = `${repositoryUrl}/pull/1`;
const homes: string[] = [];
const home = () => {
	const directory = mkdtempSync(join(tmpdir(), "factory-github-api-"));
	homes.push(directory);
	return directory;
};
afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	for (const directory of homes.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
const request = (extra = {}) =>
	JSON.stringify({
		host: "github.com",
		project: "test/repo",
		method: "GET",
		path: "repos/test/repo/pulls/1",
		...extra,
	});
const context = (factoryHome?: string): ExecutionContext =>
	({
		factoryHome,
		run: { workspace: "/unused", outputs: {} },
		signal: new AbortController().signal,
		log: vi.fn(),
	}) as unknown as ExecutionContext;
const response = (payload: unknown, status = 200) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});

it("confirms a guarded CI retry with GitHub's empty HTTP 201 acknowledgement", async () => {
	vi.stubEnv("GH_TOKEN", "private-token");
	vi.stubEnv("PATH", "");
	const fetch = vi.fn(async (endpoint: URL, init: RequestInit) => {
		if (endpoint.pathname === "/repos/test/repo/pulls/1")
			return response(githubApiReceipt([request()]));
		if (endpoint.pathname === "/repos/test/repo/actions/runs/42")
			return response({
				id: 42,
				head_sha: "head",
				run_attempt: 1,
				status: "completed",
			});
		expect(endpoint.pathname).toBe(
			"/repos/test/repo/actions/runs/42/rerun-failed-jobs",
		);
		expect(init.method).toBe("POST");
		return new Response(null, { status: 201 });
	});
	vi.stubGlobal("fetch", fetch);
	const ctx = context();
	const command = vi.fn(async (exe: string, args: string[]) => {
		expect(exe).toBe(GITHUB_API_COMMAND);
		return executeCommand(ctx, exe, args);
	});
	await expect(
		gitProvider(command, { type: "github", repositoryUrl }).retryCheck!(url, {
			kind: "github-run",
			id: "42",
			attempt: 1,
			headSha: "head",
		}),
	).resolves.toBeUndefined();
	expect(fetch).toHaveBeenCalledTimes(3);
});

it.each([
	{ path: "repos/test/repo/pulls", body: null },
	{ path: "repos/test/repo/actions/runs/42/rerun-failed-jobs", body: "broken" },
])("rejects missing PR creation evidence and malformed retry receipts ($path)", async ({
	path,
	body,
}) => {
	vi.stubEnv("GH_TOKEN", "private-token");
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(body, { status: 201 })),
	);
	await expect(
		executeGithubApi(context(), [request({ method: "POST", path })]),
	).rejects.toThrow("invalid API response");
});

it("runs GitHub requests in process with no gh or Node executable and no token in receipts/logs", async () => {
	vi.stubEnv("PATH", "");
	vi.stubEnv("GH_TOKEN", "private-token");
	const fetch = vi.fn(async (_url, init) => {
		expect(init.headers.Authorization).toBe("Bearer private-token");
		expect(init.redirect).toBe("error");
		return response({ head: { sha: "head" } });
	});
	vi.stubGlobal("fetch", fetch);
	const ctx = context();
	await expect(
		executeCommand(ctx, GITHUB_API_COMMAND, [request()]),
	).resolves.toBe('{"head":{"sha":"head"}}');
	expect(fetch).toHaveBeenCalledOnce();
	expect(ctx.log).not.toHaveBeenCalled();
});

it("uses only accepted per-host API credentials and never ambient or browser credentials for explicit profiles", async () => {
	vi.stubEnv("GH_TOKEN", "ambient-secret");
	const directory = home();
	writeFileSync(
		join(directory, "github-auth.json"),
		JSON.stringify({
			version: 1,
			hosts: { "github.com": { token: "browser-secret", account: "browser" } },
		}),
		{ mode: 0o600 },
	);
	const ctx = context(directory);
	ctx.execution = {
		environment: {},
		githubBindings: {
			"github.example": {
				token: "selected-secret",
				apiUrl: "https://api.github.example/api/v3",
				projects: ["test/repo"],
			},
		},
	} as unknown as ResolvedExecutionEnvironment;
	const fetch = vi.fn(async (_url, init) => {
		expect(init.headers.Authorization).toBe("Bearer selected-secret");
		return response({ ok: true });
	});
	vi.stubGlobal("fetch", fetch);
	await expect(executeGithubApi(ctx, [request()])).rejects.toThrow(
		"Host fallback is disabled",
	);
	expect(fetch).not.toHaveBeenCalled();
	await executeGithubApi(ctx, [request({ host: "github.example" })]);
	expect(String(fetch.mock.calls[0]?.[0])).toBe(
		"https://api.github.example/api/v3/repos/test/repo/pulls/1",
	);
	await expect(
		executeGithubApi(ctx, [
			request({
				host: "github.example",
				project: "other/repo",
				path: "repos/other/repo/pulls/1",
			}),
		]),
	).rejects.toThrow("accepted execution repository scope");
});

it("uses the intentionally connected browser account before ambient tokens while explicit bindings still win", async () => {
	vi.stubEnv("GH_TOKEN", "ambient-account-token");
	const directory = home();
	writeFileSync(
		join(directory, "github-auth.json"),
		JSON.stringify({
			version: 1,
			hosts: {
				"github.com": { token: "browser-account-token", account: "chosen" },
			},
		}),
		{ mode: 0o600 },
	);
	await expect(
		githubRuntimeCredentials(
			{ factoryHome: directory },
			"github.com",
			"test/repo",
		),
	).resolves.toMatchObject({ token: "browser-account-token" });
	const execution = {
		environment: { GH_TOKEN: "explicit-account-token" },
		githubBindings: {
			"github.com": {
				token: "accepted-account-token",
				apiUrl: "https://api.github.com",
				projects: ["test/repo"],
			},
		},
	} as unknown as ResolvedExecutionEnvironment;
	await expect(
		githubRuntimeCredentials(
			{ factoryHome: directory, execution },
			"github.com",
			"test/repo",
		),
	).resolves.toMatchObject({ token: "accepted-account-token" });
});

it("rejects generic helper requests outside explicit repository scope and refuses host fallback", async () => {
	vi.stubEnv("GH_TOKEN", "selected-token");
	vi.stubEnv("BOBS_FACTORY_GITHUB_EXPLICIT_CREDENTIALS", "1");
	vi.stubEnv(
		"BOBS_FACTORY_GITHUB_REPOSITORIES",
		JSON.stringify([{ host: "github.com", project: "test/repo" }]),
	);
	const fetch = vi.fn(async () => response({ ok: true }));
	vi.stubGlobal("fetch", fetch);
	await executeGithubApi(context(), [request()]);
	await expect(
		executeGithubApi(context(), [
			request({ project: "other/repo", path: "repos/other/repo/pulls/1" }),
		]),
	).rejects.toThrow("accepted execution repository scope");
	vi.stubEnv("GH_TOKEN", "");
	vi.stubEnv("GITHUB_TOKEN", "");
	await expect(executeGithubApi(context(home()), [request()])).rejects.toThrow(
		"Host fallback is disabled",
	);
	expect(fetch).toHaveBeenCalledOnce();
});

it("reads owner-only browser credentials while rejecting symlinked, public or malformed files", () => {
	const directory = home(),
		file = join(directory, "github-auth.json");
	writeFileSync(
		file,
		JSON.stringify({
			version: 1,
			hosts: { "github.com": { token: "stored-token", account: "owner" } },
		}),
		{ mode: 0o600 },
	);
	expect(readGithubAuth(directory)).toMatchObject({
		token: "stored-token",
		account: "owner",
	});
	expect(readGithubAuth(directory, "another.example")).toBeUndefined();
	chmodSync(file, 0o644);
	expect(() => readGithubAuth(directory)).toThrow("private");
	chmodSync(file, 0o600);
	const linked = home();
	symlinkSync(file, join(linked, "github-auth.json"));
	expect(() => readGithubAuth(linked)).toThrow("private");
	writeFileSync(file, "{}");
	expect(() => readGithubAuth(directory)).toThrow("invalid");
});

it("does not leak credentials through HTTP, network or GraphQL errors", async () => {
	vi.stubEnv("GH_TOKEN", "super-secret");
	const fetch = vi.fn(async () => response({ message: "super-secret" }, 401));
	vi.stubGlobal("fetch", fetch);
	await expect(executeGithubApi(context(), [request()])).rejects.toThrow(
		"HTTP 401",
	);
	fetch.mockImplementation(async () =>
		response({ errors: [{ message: "denied super-secret" }] }),
	);
	await expect(
		executeGithubApi(context(), [
			request({
				method: "POST",
				path: "graphql",
				body: { query: "query { viewer { login } }" },
			}),
		]),
	).rejects.toThrow("denied [redacted]");
	fetch.mockRejectedValue(new Error("network super-secret"));
	await expect(executeGithubApi(context(), [request()])).rejects.toThrow(
		"network request failed",
	);
});

it("refuses redirects, alternate repository endpoints and credential-bearing API origins", async () => {
	vi.stubEnv("GH_TOKEN", "secret");
	const fetch = vi.fn(async () => response({}));
	vi.stubGlobal("fetch", fetch);
	for (const path of [
		"https://untrusted.test/repos/test/repo",
		"//untrusted.test",
		"repos/other/repo/pulls/1",
		"repos/test/repo/../other",
		"repos/test/repo/%2e%2e/%2e%2e/other/repo/pulls/1",
	])
		await expect(
			executeGithubApi(context(), [request({ path })]),
		).rejects.toThrow();
	expect(fetch).not.toHaveBeenCalled();
	const ctx = context();
	ctx.execution = {
		environment: {},
		githubBindings: {
			"github.com": {
				token: "private",
				apiUrl: "https://user:password@api.github.com",
				projects: ["test/repo"],
			},
		},
	} as unknown as ResolvedExecutionEnvironment;
	await expect(executeGithubApi(ctx, [request()])).rejects.toThrow(
		"credential-free HTTPS URL",
	);
	expect(fetch).not.toHaveBeenCalled();
});

it("lists, creates, reads, transitions and edits PRs using native APIs without gh", async () => {
	const pr = {
		html_url: url,
		number: 1,
		node_id: "PR_node",
		title: "Change",
		body: "Description",
		draft: true,
		state: "open",
		merged: false,
		head: { ref: "feature", sha: "head", repo: { full_name: "test/repo" } },
		base: { ref: "main", repo: { full_name: "test/repo" } },
	};
	const commands: ReturnType<typeof githubRequest>[] = [];
	const command = vi.fn(async (exe: string, args: string[]) => {
		expect(exe).toBe(GITHUB_API_COMMAND);
		const req = githubRequest(args);
		commands.push(req);
		if (req.path === "graphql") {
			const mutation = (req.body as any).query.includes(
				"convertPullRequestToDraft",
			)
				? "convertPullRequestToDraft"
				: "markPullRequestReadyForReview";
			return JSON.stringify({
				data: {
					[mutation]: {
						pullRequest: {
							id: "PR_node",
							isDraft: mutation === "convertPullRequestToDraft",
						},
					},
				},
			});
		}
		if (req.path.includes("?state=open")) return JSON.stringify([pr]);
		return JSON.stringify(pr);
	});
	const provider = gitProvider(command, { type: "github", repositoryUrl });
	await expect(provider.list("feature")).resolves.toEqual([
		{ url, isDraft: true },
	]);
	await expect(
		provider.create({
			branch: "feature",
			baseBranch: "main",
			title: "Change",
			body: "Description",
		}),
	).resolves.toBe(url);
	await expect(provider.view(url)).resolves.toMatchObject({
		state: "OPEN",
		isDraft: true,
		headRefOid: "head",
	});
	await provider.draft(url, false);
	await provider.draft(url, true);
	await provider.description(url, "Updated");
	expect(commands).toContainEqual({
		host: "github.com",
		project: "test/repo",
		method: "POST",
		path: "repos/test/repo/pulls",
		body: {
			head: "feature",
			base: "main",
			title: "Change",
			body: "Description",
			draft: true,
		},
	});
	expect(commands).toContainEqual({
		host: "github.com",
		project: "test/repo",
		method: "PATCH",
		path: "repos/test/repo/pulls/1",
		body: { body: "Updated" },
	});
	command.mockResolvedValue(
		JSON.stringify({
			...pr,
			head: { ...pr.head, repo: { full_name: "fork/repo" } },
		}),
	);
	await expect(
		provider.create({
			branch: "feature",
			baseBranch: "main",
			title: "Change",
			body: "Description",
		}),
	).rejects.toThrow("same-repository open draft");
});

it("retains every check and nested discussion page instead of approving a truncated receipt", async () => {
	const command = vi.fn(async (exe: string, args: string[]) => {
		expect(exe).toBe(GITHUB_API_COMMAND);
		const req = githubRequest(args),
			variables = (req.body as any)?.variables;
		if (req.path !== "graphql") return "[]";
		if (variables.id)
			return JSON.stringify({
				data: {
					node: {
						comments: {
							nodes: [{ id: "late-comment", body: "Fix this" }],
							pageInfo: { hasNextPage: false },
						},
					},
				},
			});
		if (variables.cursor === "checks-page-2")
			return JSON.stringify(
				providerReceipt({
					statusCheckRollup: {
						contexts: {
							nodes: [{ name: "last-check", conclusion: "FAILURE" }],
							pageInfo: { hasNextPage: false },
						},
					},
				}),
			);
		return JSON.stringify(
			providerReceipt({
				isDraft: false,
				reviewDecision: "APPROVED",
				mergeStateStatus: "CLEAN",
				reviewThreads: {
					nodes: [
						{
							id: "thread",
							isResolved: false,
							comments: {
								nodes: [{ id: "first-comment" }],
								pageInfo: { hasNextPage: true, endCursor: "comments-page-2" },
							},
						},
					],
					pageInfo: { hasNextPage: false },
				},
				statusCheckRollup: {
					contexts: {
						nodes: [{ name: "first-check", conclusion: "SUCCESS" }],
						pageInfo: { hasNextPage: true, endCursor: "checks-page-2" },
					},
				},
			}),
		);
	});
	const receipt = await inspectGithubReadiness(command, url);
	expect(receipt.checks.map((c) => c.name)).toEqual([
		"first-check",
		"last-check",
	]);
	expect(
		(receipt.threads[0] as any).comments.nodes.map((c: any) => c.id),
	).toEqual(["first-comment", "late-comment"]);
	expect(receipt.approved).toBe(false);
	expect(receipt.blockers.map((b) => b.kind)).toEqual(["checks", "threads"]);
});

it("rejects incomplete pagination and revision changes during check inspection", async () => {
	const first = providerReceipt({
		statusCheckRollup: {
			contexts: {
				nodes: [],
				pageInfo: { hasNextPage: true, endCursor: "next" },
			},
		},
	});
	await expect(
		inspectGithubReadiness(
			async () =>
				JSON.stringify(
					providerReceipt({
						reviewThreads: { nodes: [], pageInfo: { hasNextPage: true } },
					}),
				),
			url,
		),
	).rejects.toThrow("pagination is incomplete");
	let call = 0;
	await expect(
		inspectGithubReadiness(
			async () =>
				JSON.stringify(
					++call === 1
						? first
						: providerReceipt({ headRefOid: "changed-head" }),
				),
			url,
		),
	).rejects.toThrow("PR changed during provider inspection");
});

it("sends the human-approved SHA for merge and refuses unconfirmed or cross-repository mutations", async () => {
	const command = vi.fn(async (_exe: string, args: string[]) =>
		githubRequest(args).path === "graphql"
			? JSON.stringify(
					providerReceipt({ headRefOid: "approved-head", isDraft: false }),
				)
			: '{"merged":true}',
	);
	const provider = gitProvider(command, { type: "github", repositoryUrl });
	await provider.merge(url, "approved-head", "squash");
	expect(githubRequest(command.mock.calls[1]?.[1] ?? [])).toEqual({
		host: "github.com",
		project: "test/repo",
		method: "PUT",
		path: "repos/test/repo/pulls/1/merge",
		body: { sha: "approved-head", merge_method: "squash" },
	});
	await expect(
		provider.merge(
			"https://github.com/other/repo/pull/1",
			"approved-head",
			"squash",
		),
	).rejects.toThrow("selected repository");
	expect(command).toHaveBeenCalledTimes(2);
	command.mockImplementation(async (_exe: string, args: string[]) =>
		githubRequest(args).path === "graphql"
			? JSON.stringify(
					providerReceipt({ headRefOid: "approved-head", isDraft: false }),
				)
			: '{"merged":false}',
	);
	await expect(provider.merge(url, "approved-head", "squash")).rejects.toThrow(
		"did not confirm merge",
	);
});

it("enqueues the approved head even before queue build commits exist, without bypassing branch queues or their configured merge method", async () => {
	const calls: ReturnType<typeof githubRequest>[] = [];
	const command = vi.fn(async (_exe: string, args: string[]) => {
		const request = githubRequest(args);
		calls.push(request);
		const query = (request.body as any)?.query;
		if (query?.includes("enqueuePullRequest"))
			return JSON.stringify({
				data: {
					enqueuePullRequest: {
						mergeQueueEntry: {
							id: "queue-entry",
							headCommit: null,
							pullRequest: { id: "PR_node", url, headRefOid: "head" },
						},
					},
				},
			});
		return JSON.stringify(
			providerReceipt({ isDraft: false, isMergeQueueEnabled: true }),
		);
	});
	const provider = gitProvider(command, { type: "github", repositoryUrl });
	await provider.merge(url, "head", "squash");
	expect(calls).toHaveLength(2);
	expect(calls.every((call) => call.path === "graphql")).toBe(true);
	expect((calls[1]!.body as any).variables).toEqual({
		id: "PR_node",
		sha: "head",
	});
	expect((calls[1]!.body as any).query).toContain("expectedHeadOid:$sha");
	expect((calls[1]!.body as any).query).not.toContain("jump");
	command.mockImplementation(async () =>
		JSON.stringify(
			providerReceipt({
				isDraft: false,
				isMergeQueueEnabled: true,
				headRefOid: "changed-head",
			}),
		),
	);
	await expect(provider.merge(url, "head", "squash")).rejects.toThrow(
		"approved head revision changed",
	);
	expect(command).toHaveBeenCalledTimes(3);
});

it("requires the merge queue to confirm the same PR and approved head without falling back to a direct merge", async () => {
	const command = vi.fn(async (_exe: string, args: string[]) => {
		const query = (githubRequest(args).body as any)?.query;
		return JSON.stringify(
			query?.includes("enqueuePullRequest")
				? {
						data: {
							enqueuePullRequest: {
								mergeQueueEntry: {
									id: "queue-entry",
									headCommit: { oid: "changed-head" },
									pullRequest: {
										id: "PR_node",
										url,
										headRefOid: "changed-head",
									},
								},
							},
						},
					}
				: providerReceipt({ isDraft: false, isMergeQueueEnabled: true }),
		);
	});
	await expect(
		gitProvider(command, { type: "github", repositoryUrl }).merge(
			url,
			"head",
			"squash",
		),
	).rejects.toThrow("did not confirm enqueueing the approved revision");
	expect(
		command.mock.calls.every(
			(call) => githubRequest(call[1]).path === "graphql",
		),
	).toBe(true);
});

it.each([
	"BLOCKED",
	"BEHIND",
])("permits guarded queue admission for %s after checks and reviews pass", async (mergeStateStatus) => {
	const receipt = await inspectGithubReadiness(
		async (_exe, args) =>
			githubRequest(args).path === "graphql"
				? JSON.stringify(
						providerReceipt({
							isDraft: false,
							reviewDecision: "APPROVED",
							isMergeQueueEnabled: true,
							mergeStateStatus,
						}),
					)
				: "[]",
		url,
	);
	expect(receipt.approved).toBe(true);
	expect(receipt.queued).toBe(false);
	expect(receipt.blockers).toEqual([]);
});

it("still blocks queued branch admission for missing approval and pending checks", async () => {
	const receipt = await inspectGithubReadiness(
		async (_exe, args) =>
			githubRequest(args).path === "graphql"
				? JSON.stringify(
						providerReceipt({
							isDraft: false,
							isMergeQueueEnabled: true,
							mergeQueueEntry: {
								id: "entry",
								headCommit: { oid: "earlier-head" },
							},
							statusCheckRollup: {
								contexts: {
									nodes: [{ name: "test", status: "IN_PROGRESS" }],
									pageInfo: {},
								},
							},
						}),
					)
				: "[]",
		url,
	);
	expect(receipt.approved).toBe(false);
	expect(receipt.fix).toBe(false);
	expect(receipt.blockers.map((b) => b.kind)).toEqual(["checks", "reviews"]);
});

it("supplies sandboxed helpers only their selected token without reading Factory credentials or leaking errors", async () => {
	const directory = home();
	writeFileSync(
		join(directory, "github-auth.json"),
		"unreadable malformed fixture",
		{ mode: 0o644 },
	);
	vi.stubEnv("GH_TOKEN", "ambient-token");
	vi.stubEnv("BOBS_FACTORY_GITHUB_MANAGED_CREDENTIALS", "1");
	vi.stubEnv(
		"BOBS_FACTORY_GITHUB_REPOSITORIES",
		JSON.stringify([{ host: "github.com", project: "test/repo" }]),
	);
	vi.stubEnv(
		"BOBS_FACTORY_GITHUB_TOKENS",
		JSON.stringify([
			{
				host: "github.com",
				project: "test/repo",
				token: "scoped-native-secret",
			},
		]),
	);
	const fetch = vi.fn(async (_url, init) => {
		expect(init.headers.Authorization).toBe("Bearer scoped-native-secret");
		return response({ ok: true });
	});
	vi.stubGlobal("fetch", fetch);
	await expect(executeGithubApi(context(directory), [request()])).resolves.toBe(
		'{"ok":true}',
	);
	await expect(
		executeGithubApi(context(directory), [
			request({ project: "other/repo", path: "repos/other/repo/pulls" }),
		]),
	).rejects.toThrow("repository scope");
	const explicit = context(directory);
	explicit.execution = {
		environment: {},
		githubBindings: {},
	} as ResolvedExecutionEnvironment;
	await expect(executeGithubApi(explicit, [request()])).rejects.toThrow(
		"Host fallback is disabled",
	);
	vi.stubEnv("BOBS_FACTORY_GITHUB_TOKENS", "invalid scoped-native-secret");
	await expect(
		executeGithubApi(context(directory), [request()]),
	).rejects.toThrow("Invalid managed GitHub credential bindings");
	expect(fetch).toHaveBeenCalledOnce();
});
