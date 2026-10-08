import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import { gitProvider } from "../src/factory/GitProvider.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { providerReceipt } from "./fixtures/merge-readiness.js";

const url = "https://github.com/test/repo/pull/1";
const homes: string[] = [];
it.each([
	"metadata",
	"retry",
])("pins enterprise GitHub API calls while preserving native Git metadata inspection (%s)", async (operation) => {
	const enterpriseUrl = "https://github.enterprise.test/test/repo/pull/1";
	const command = vi.fn(async (exe: string, args: string[]) => {
		if (exe === "git") {
			expect(args).toEqual(["show", "head:.github/workflows/title.yml"]);
			return "name: Title\njobs:\n  title:\n    steps:\n      - name: Title\n        run: gh pr view --json title\n";
		}
		if (args[0] === "pr")
			return JSON.stringify({ headRefOid: "head", state: "OPEN" });
		expect(args.slice(-2)).toEqual(["--hostname", "github.enterprise.test"]);
		if (args[1] === "graphql")
			return JSON.stringify(
				providerReceipt({
					url: enterpriseUrl,
					statusCheckRollup: {
						contexts: {
							pageInfo: {},
							nodes: [
								{
									databaseId: 501,
									name: "title",
									status: "COMPLETED",
									conclusion: "FAILURE",
									detailsUrl:
										"https://github.enterprise.test/test/repo/actions/runs/42/job/501",
								},
							],
						},
					},
				}),
			);
		if (args[1] === "repos/test/repo/check-runs/501")
			return JSON.stringify({
				id: 501,
				head_sha: "head",
				output: {
					summary: "Pull request title must follow the required format",
				},
			});
		if (args[1] === "repos/test/repo/actions/runs/42")
			return JSON.stringify({
				id: 42,
				head_sha: "head",
				run_attempt: 1,
				status: "completed",
				path: ".github/workflows/title.yml",
			});
		if (args[1]?.endsWith("rerun-failed-jobs")) return "";
		return "[]";
	});
	const provider = gitProvider(command, {
		type: "github",
		repositoryUrl: "https://github.enterprise.test/test/repo",
	});
	if (operation === "metadata") {
		const snapshot = await provider.readiness(enterpriseUrl);
		expect(snapshot.checks[0]?.retry).toMatchObject({ metadataRecheck: true });
	} else {
		await provider.retryCheck!(enterpriseUrl, {
			kind: "github-run",
			id: "42",
			attempt: 1,
			headSha: "head",
		});
		expect(
			command.mock.calls.filter(
				([exe, args]) => exe === "gh" && args.includes("POST"),
			),
		).toHaveLength(1);
	}
});
afterEach(() => {
	vi.useRealTimers();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});

it("waits for a provider-confirmed running retry and refreshes failed-check evidence when the attempt completes", async () => {
	vi.useFakeTimers();
	let attempt = 1,
		status = "completed",
		retries = 0,
		detailReads = 0;
	let evidence =
		"The job was not acquired by Runner of type hosted even after multiple attempts";
	const agent = vi.fn(async () => ({}));
	const command = vi.fn(async (_context, exe: string, args: string[]) => {
		if (exe === "git") return args[0] === "rev-parse" ? "head" : "";
		if (args[0] === "pr")
			return JSON.stringify({ headRefOid: "head", state: "OPEN" });
		if (args[1] === "graphql")
			return JSON.stringify(
				providerReceipt({
					statusCheckRollup: {
						contexts: {
							pageInfo: {},
							nodes: [
								{
									databaseId: 501,
									name: "test",
									status: "COMPLETED",
									conclusion: "FAILURE",
									detailsUrl:
										"https://github.com/test/repo/actions/runs/42/job/501",
								},
							],
						},
					},
				}),
			);
		if (args[1] === "repos/test/repo/check-runs/501") {
			detailReads++;
			return JSON.stringify({
				id: 501,
				head_sha: "head",
				output: { summary: evidence },
			});
		}
		if (args[1] === "repos/test/repo/actions/runs/42")
			return JSON.stringify({
				id: 42,
				head_sha: "head",
				run_attempt: attempt,
				status,
			});
		if (args[1] === "repos/test/repo/actions/runs/42/rerun-failed-jobs") {
			retries++;
			attempt++;
			status = "in_progress";
			return "";
		}
		return "[]";
	});
	const directory = mkdtempSync(join(tmpdir(), "ci-running-attempt-"));
	homes.push(directory);
	const tools = new FactoryTools({ postComment: vi.fn(), command });
	const runtime = new WorkflowRuntime(directory, {
		agent,
		script: async () => ({}),
		tool: (context) => tools.tool(context),
	});
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "running-ci",
			name: "Running CI",
			steps: [
				{
					id: "ci",
					name: "CI",
					type: "tool",
					tool: "ci",
					next: "end",
					branches: [{ when: { path: "fix", equals: true }, next: "ci-fix" }],
				},
				{
					id: "ci-fix",
					name: "Diagnose",
					type: "agent",
					prompt: "Diagnose",
					next: "end",
				},
			],
		},
	]).at(-1)!;
	const run = runtime.create({
		repositoryId: "repo",
		workflow,
		workspace: "/tmp",
		input: "check",
		triggerOrigin: { type: "manual", workflowId: workflow.id, at: "" },
	});
	run.outputs.repository = {
		githubUrl: "https://github.com/test/repo",
		baseBranch: "main",
	};
	run.outputs["draft-pr"] = { url };
	try {
		const execution = runtime.launch(run);
		await vi.waitFor(() => expect(retries).toBe(1));
		await vi.advanceTimersByTimeAsync(30000);
		expect(run.status).toBe("running");
		expect(agent).not.toHaveBeenCalled();
		expect(retries).toBe(1);
		expect(run.outputs["merge-readiness"]).toMatchObject({
			checks: [
				{ bucket: "fail", retry: { attempt: 2, status: "in_progress" } },
			],
			fix: false,
			approved: false,
			reviewReady: false,
		});
		expect(detailReads).toBe(2);
		status = "completed";
		evidence = "Assertion failed: checkout must reject unauthorized users";
		await vi.advanceTimersByTimeAsync(10000);
		await execution;
		expect(agent).toHaveBeenCalledTimes(1);
		expect(retries).toBe(1);
		expect(detailReads).toBe(3);
		expect(run.outputs.ci).toMatchObject({
			checks: [{ failure: { kind: "unknown", evidence } }],
		});
	} finally {
		await runtime.shutdown();
	}
});
function failingCI(
	options: {
		infrastructure?: boolean;
		ambiguousRetry?: boolean;
		unsupportedRetry?: boolean;
		conflict?: boolean;
		initialAttempt?: number;
	} = {},
) {
	let retries = 0,
		attempt = options.initialAttempt ?? 1;
	const agent = vi.fn(async () => ({}));
	const command = vi.fn(async (_context, exe: string, args: string[]) => {
		if (exe === "git") return args[0] === "rev-parse" ? "head" : "";
		if (args[0] === "pr")
			return JSON.stringify({ headRefOid: "head", state: "OPEN" });
		if (args[1] === "graphql")
			return JSON.stringify(
				providerReceipt({
					...(options.conflict
						? { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }
						: {}),
					statusCheckRollup: {
						contexts: {
							pageInfo: {},
							nodes: [
								{
									...(options.unsupportedRetry ? {} : { databaseId: 501 }),
									name: "test",
									status: "COMPLETED",
									conclusion: options.infrastructure
										? "STARTUP_FAILURE"
										: "FAILURE",
									detailsUrl:
										"https://github.com/test/repo/actions/runs/42/job/501",
								},
							],
						},
					},
				}),
			);
		if (args[1] === "repos/test/repo/check-runs/501")
			return JSON.stringify({
				id: 501,
				head_sha: "head",
				output: {
					summary: options.infrastructure
						? "Runner allocation failed"
						: "Assertion failed: checkout must reject unauthorized users",
				},
			});
		if (args[1] === "repos/test/repo/actions/runs/42")
			return JSON.stringify({
				id: 42,
				head_sha: "head",
				run_attempt: attempt,
				status: "completed",
			});
		if (args[1] === "repos/test/repo/actions/runs/42/rerun-failed-jobs") {
			retries++;
			if (options.ambiguousRetry)
				throw new Error("connection reset after request");
			attempt++;
			return "";
		}
		return "[]";
	});
	const tools = new FactoryTools({ postComment: vi.fn(), command });
	const directory = mkdtempSync(join(tmpdir(), "ci-supervision-"));
	homes.push(directory);
	const hooks = {
		agent,
		script: async () => ({}),
		tool: (context) => tools.tool(context),
	};
	const runtime = new WorkflowRuntime(directory, hooks);
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "ci-check",
			name: "CI check",
			steps: [
				{
					id: "ci",
					name: "CI",
					type: "tool",
					tool: "ci",
					next: "end",
					branches: [{ when: { path: "fix", equals: true }, next: "ci-fix" }],
				},
				{
					id: "ci-fix",
					name: "Diagnose",
					type: "agent",
					prompt: "Diagnose",
					next: "end",
				},
			],
		},
	]).at(-1)!;
	const run = runtime.create({
		repositoryId: "repo",
		workflow,
		workspace: "/tmp",
		input: "check",
		triggerOrigin: { type: "manual", workflowId: workflow.id, at: "" },
	});
	run.outputs.repository = {
		githubUrl: "https://github.com/test/repo",
		baseBranch: "main",
	};
	run.outputs["draft-pr"] = { url };
	return {
		runtime,
		run,
		agent,
		command,
		directory,
		hooks,
		retries: () => retries,
	};
}

it.each([
	"unsupported",
	"exhausted",
])("fixes an actionable conflict before waiting for separate CI infrastructure assistance (%s)", async (mode) => {
	const fixture = failingCI({
		infrastructure: true,
		unsupportedRetry: mode === "unsupported",
		conflict: true,
		initialAttempt: mode === "exhausted" ? 3 : 1,
	});
	if (mode === "exhausted")
		fixture.run.ciSupervision = {
			retries: [1, 2].map((attempt) => ({
				key: JSON.stringify([url, "head", "github-run", "42", attempt]),
				url,
				headSha: "head",
				check: "test",
				provider: { kind: "github-run", id: "42", attempt, headSha: "head" },
				failure: {
					kind: "infrastructure",
					evidence: "Runner allocation failed",
				},
				requestedAt: new Date().toISOString(),
				state: "accepted",
			})),
		};
	const retained = structuredClone(fixture.run.ciSupervision?.retries ?? []);
	const execution = fixture.runtime.launch(fixture.run);
	try {
		await vi.waitFor(() => expect(fixture.agent).toHaveBeenCalledTimes(1));
		await execution;
		expect(fixture.run.outputs.ci).toMatchObject({
			fix: true,
			approved: false,
			reviewReady: false,
			checks: [{ bucket: "fail", failure: { kind: "infrastructure" } }],
		});
		expect(fixture.retries()).toBe(0);
		expect(fixture.run.ciSupervision?.retries).toEqual(retained);
	} finally {
		await fixture.runtime.shutdown();
		await execution;
	}
});
it("retains concrete GitHub runner allocation failure and current attempt receipts for runtime retries", async () => {
	const command = vi.fn(async (_exe: string, args: string[]) => {
		if (args[1] === "graphql")
			return JSON.stringify(
				providerReceipt({
					statusCheckRollup: {
						contexts: {
							pageInfo: {},
							nodes: [
								{
									databaseId: 501,
									name: "macOS",
									status: "COMPLETED",
									conclusion: "STARTUP_FAILURE",
									detailsUrl:
										"https://github.com/test/repo/actions/runs/42/job/501",
								},
							],
						},
					},
				}),
			);
		if (args[1] === "repos/test/repo/check-runs/501")
			return JSON.stringify({
				id: 501,
				head_sha: "head",
				output: {
					title: "Runner allocation failed",
					summary: "No hosted runner could be allocated",
				},
			});
		if (args[1] === "repos/test/repo/actions/runs/42")
			return JSON.stringify({
				id: 42,
				head_sha: "head",
				run_attempt: 2,
				status: "completed",
				conclusion: "startup_failure",
			});
		return "[]";
	});
	const receipt = await gitProvider(command, {
		type: "github",
		repositoryUrl: "https://github.com/test/repo",
	}).readiness(url);
	expect(receipt.checks[0]).toMatchObject({
		retry: { id: "42", attempt: 2, headSha: "head" },
		failure: {
			kind: "infrastructure",
			evidence: "Runner allocation failed\nNo hosted runner could be allocated",
		},
	});
});

it("retries a provider-proven runner failure in runtime without launching an agent just to poll CI", async () => {
	vi.useFakeTimers();
	let retries = 0;
	const command = vi.fn(async (_context, exe: string, args: string[]) => {
		if (exe === "git") return args[0] === "rev-parse" ? "head" : "";
		if (args[0] === "pr")
			return JSON.stringify({ headRefOid: "head", state: "OPEN" });
		if (args[1] === "graphql")
			return JSON.stringify(
				providerReceipt(
					retries
						? {}
						: {
								statusCheckRollup: {
									contexts: {
										pageInfo: {},
										nodes: [
											{
												databaseId: 501,
												name: "macOS",
												status: "COMPLETED",
												conclusion: "STARTUP_FAILURE",
												detailsUrl:
													"https://github.com/test/repo/actions/runs/42/job/501",
											},
										],
									},
								},
							},
				),
			);
		if (args[1] === "repos/test/repo/check-runs/501")
			return JSON.stringify({
				id: 501,
				head_sha: "head",
				output: { summary: "Runner allocation failed" },
			});
		if (args[1] === "repos/test/repo/actions/runs/42")
			return JSON.stringify({
				id: 42,
				head_sha: "head",
				run_attempt: 1,
				status: "completed",
			});
		if (args[1] === "repos/test/repo/actions/runs/42/rerun-failed-jobs") {
			retries++;
			return "";
		}
		return "[]";
	});
	const tools = new FactoryTools({ postComment: vi.fn(), command });
	const agent = vi.fn(async () => ({}));
	const directory = mkdtempSync(join(tmpdir(), "ci-supervision-"));
	homes.push(directory);
	const runtime = new WorkflowRuntime(directory, {
		agent,
		script: async () => ({}),
		tool: (context) => tools.tool(context),
	});
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "ci-check",
			name: "CI check",
			steps: [
				{
					id: "ci",
					name: "CI",
					type: "tool",
					tool: "ci",
					next: "end",
					branches: [{ when: { path: "fix", equals: true }, next: "ci-fix" }],
				},
				{
					id: "ci-fix",
					name: "Diagnose",
					type: "agent",
					prompt: "Diagnose actual source failures",
					next: "end",
				},
			],
		},
	]).at(-1)!;
	const run = runtime.create({
		repositoryId: "repo",
		workflow,
		workspace: "/tmp",
		input: "check",
		triggerOrigin: { type: "manual", workflowId: workflow.id, at: "" },
	});
	run.outputs.repository = {
		githubUrl: "https://github.com/test/repo",
		baseBranch: "main",
	};
	run.outputs["draft-pr"] = { url };
	const finished = runtime.launch(run);
	await vi.waitFor(() => expect(retries).toBe(1));
	expect(agent).not.toHaveBeenCalled();
	expect(run.capacityLeaves?.ci?.phase).toBe("waiting-ci");
	await vi.advanceTimersByTimeAsync(10000);
	await finished;
	expect(agent).not.toHaveBeenCalled();
	expect(run.status).toBe("completed");
	expect(run.history.map((item) => item.step)).toEqual(["ci"]);
});

it("asks for visible assistance when two provider-proven infrastructure retries fail", async () => {
	vi.useFakeTimers();
	const scenario = failingCI({ infrastructure: true });
	const finished = scenario.runtime.launch(scenario.run);
	await vi.waitFor(() => expect(scenario.retries()).toBe(1));
	await vi.advanceTimersByTimeAsync(20000);
	expect(scenario.retries()).toBe(2);
	expect(scenario.agent).not.toHaveBeenCalled();
	expect(scenario.run.status).toBe("waiting");
	expect(scenario.run.questions.join(" ")).toContain(
		"Two runtime retries are exhausted",
	);
	expect(scenario.run.ciSupervision?.retries).toHaveLength(2);
	scenario.runtime.stop(scenario.run.id);
	await finished;
});

it("keeps an ambiguous retry durable across restart instead of sending it twice", async () => {
	const scenario = failingCI({ infrastructure: true, ambiguousRetry: true });
	void scenario.runtime.launch(scenario.run);
	await vi.waitFor(() => expect(scenario.run.status).toBe("waiting"));
	expect(scenario.retries()).toBe(1);
	expect(scenario.run.questions.join(" ")).toContain("outcome is uncertain");
	await scenario.runtime.shutdown();
	const restored = new WorkflowRuntime(scenario.directory, scenario.hooks);
	restored.resumeAll();
	await vi.waitFor(() =>
		expect(restored.get(scenario.run.id).status).toBe("waiting"),
	);
	restored.answer(
		scenario.run.id,
		"I inspected the provider; continue checking the existing request",
	);
	await vi.waitFor(() =>
		expect(restored.get(scenario.run.id).questions.join(" ")).toContain(
			"has not confirmed a new attempt",
		),
	);
	expect(scenario.retries()).toBe(1);
	expect(scenario.agent).not.toHaveBeenCalled();
	await restored.shutdown();
});

it("starts diagnosis for a consequential failed test and does not classify it as infrastructure", async () => {
	const scenario = failingCI();
	await scenario.runtime.launch(scenario.run);
	expect(scenario.agent).toHaveBeenCalledOnce();
	expect(scenario.agent.mock.calls[0]![0].step.id).toBe("ci-fix");
	expect(scenario.retries()).toBe(0);
	expect(scenario.run.outputs.ci).toMatchObject({
		fix: true,
		checks: [
			{
				failure: {
					kind: "unknown",
					evidence: "Assertion failed: checkout must reject unauthorized users",
				},
			},
		],
	});
});

it("rechecks corrected PR metadata at the same SHA when its workflow reads the live PR title", async () => {
	vi.useFakeTimers();
	let title = "Incorrect title",
		retries = 0;
	const command = vi.fn(async (_context, exe: string, args: string[]) => {
		if (exe === "git")
			return args[0] === "rev-parse"
				? "head"
				: args[0] === "show"
					? "run: gh pr view $PR --json title --jq .title\n"
					: "";
		if (args[0] === "pr")
			return JSON.stringify({ headRefOid: "head", state: "OPEN" });
		if (args[1] === "graphql")
			return JSON.stringify(
				providerReceipt(
					retries
						? { title }
						: {
								title,
								statusCheckRollup: {
									contexts: {
										pageInfo: {},
										nodes: [
											{
												databaseId: 501,
												name: "Title",
												status: "COMPLETED",
												conclusion: "FAILURE",
												detailsUrl:
													"https://github.com/test/repo/actions/runs/42/job/501",
											},
										],
									},
								},
							},
				),
			);
		if (args[1] === "repos/test/repo/check-runs/501")
			return JSON.stringify({
				id: 501,
				head_sha: "head",
				output: {
					summary: "Pull request title does not match the required format",
				},
			});
		if (args[1] === "repos/test/repo/actions/runs/42")
			return JSON.stringify({
				id: 42,
				head_sha: "head",
				run_attempt: 1,
				status: "completed",
				path: ".github/workflows/title.yml",
			});
		if (args[1] === "repos/test/repo/actions/runs/42/rerun-failed-jobs") {
			retries++;
			return "";
		}
		return "[]";
	});
	const tools = new FactoryTools({ postComment: vi.fn(), command });
	const agent = vi.fn(async () => {
		title = "feat: corrected title";
		return { summary: "Updated PR metadata only", checks: [] };
	});
	const directory = mkdtempSync(join(tmpdir(), "ci-metadata-"));
	homes.push(directory);
	const runtime = new WorkflowRuntime(directory, {
		agent,
		script: async () => ({}),
		tool: (context) => tools.tool(context),
	});
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "metadata",
			name: "Metadata",
			steps: [
				{
					id: "ci",
					name: "CI",
					type: "tool",
					tool: "ci",
					next: "end",
					branches: [{ when: { path: "fix", equals: true }, next: "ci-fix" }],
				},
				{
					id: "ci-fix",
					name: "Fix title",
					type: "agent",
					prompt: "Correct metadata",
					next: "ci",
				},
			],
		},
	]).at(-1)!;
	const run = runtime.create({
		repositoryId: "repo",
		workflow,
		workspace: "/tmp",
		input: "check",
		triggerOrigin: { type: "manual", workflowId: workflow.id, at: "" },
	});
	run.outputs.repository = {
		githubUrl: "https://github.com/test/repo",
		baseBranch: "main",
	};
	run.outputs["draft-pr"] = { url };
	const finished = runtime.launch(run);
	await vi.waitFor(() => expect(retries).toBe(1));
	await vi.advanceTimersByTimeAsync(10000);
	await finished;
	expect(agent).toHaveBeenCalledOnce();
	expect(run.status).toBe("completed");
	expect(run.outputs.ci).toMatchObject({
		headSha: "head",
		metadata: { title: "feat: corrected title" },
	});
	expect(
		command.mock.calls.some(
			([, exe, args]) => exe === "git" && ["commit", "push"].includes(args[0]!),
		),
	).toBe(false);
});

it("retains GitLab runner-system receipts and retries only the bound failed job at the current source SHA", async () => {
	const repositoryUrl = "https://gitlab.example/team/repo",
		mrUrl = `${repositoryUrl}/-/merge_requests/1`;
	const job = {
		id: 501,
		name: "test",
		status: "failed",
		failure_reason: "runner_system_failure",
		commit: { id: "head" },
		pipeline: { id: 22, sha: "head" },
		web_url: `${repositoryUrl}/-/jobs/501`,
	};
	const command = vi.fn(async (_exe: string, args: string[]) => {
		const path = args[1]!;
		if (path.endsWith("/jobs/501/retry"))
			return JSON.stringify({ ...job, id: 502, status: "pending" });
		if (path.endsWith("/jobs/501")) return JSON.stringify(job);
		if (path.includes("/jobs?")) return JSON.stringify([job]);
		if (path.includes("/approvals"))
			return JSON.stringify({ approvals_left: 0 });
		if (path.includes("/repository/branches/"))
			return JSON.stringify({ commit: { id: "base" } });
		if (path.includes("/notes?") || path.includes("/discussions?")) return "[]";
		if (path === "projects/team%2Frepo")
			return JSON.stringify({
				id: 1,
				only_allow_merge_if_pipeline_succeeds: true,
			});
		return JSON.stringify({
			web_url: mrUrl,
			iid: 1,
			title: "Draft: Change",
			description: "",
			source_branch: "feature",
			target_branch: "main",
			sha: "head",
			state: "opened",
			draft: true,
			source_project_id: 1,
			target_project_id: 1,
			detailed_merge_status: "ci_must_pass",
			head_pipeline: {
				id: 22,
				sha: "head",
				status: "failed",
				web_url: `${repositoryUrl}/-/pipelines/22`,
			},
		});
	});
	const provider = gitProvider(command, { type: "gitlab", repositoryUrl });
	const receipt = await provider.readiness(mrUrl);
	expect(receipt.checks[0]).toMatchObject({
		failure: {
			kind: "infrastructure",
			evidence: "GitLab failure_reason: runner_system_failure",
		},
		retry: { id: "501", headSha: "head", lineage: "22:test" },
	});
	await provider.retryCheck!(mrUrl, receipt.checks[0]!.retry!);
	expect(
		command.mock.calls.filter(([, args]) =>
			args[1]?.endsWith("/jobs/501/retry"),
		),
	).toHaveLength(1);
});

it("keeps a proven infrastructure failure visible when the provider cannot produce a safe retry identity", async () => {
	const scenario = failingCI({ infrastructure: true, unsupportedRetry: true });
	const finished = scenario.runtime.launch(scenario.run);
	await vi.waitFor(() => expect(scenario.run.status).toBe("waiting"));
	expect(scenario.agent).not.toHaveBeenCalled();
	expect(scenario.retries()).toBe(0);
	expect(scenario.run.questions.join(" ")).toContain("cannot safely retry");
	scenario.runtime.stop(scenario.run.id);
	await finished;
});
