import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	LocalOnboarding,
	loadLocalConfig,
} from "../../../../apps/cli/src/onboarding.js";
import { EdgeWorker } from "../../../../packages/edge-worker/src/EdgeWorker.js";
import {
	executeCommand,
	FactoryTools,
} from "../../../../packages/edge-worker/src/factory/FactoryTools.js";
import { gitProvider } from "../../../../packages/edge-worker/src/factory/GitProvider.js";
import { WorkflowSchema } from "../../../../packages/edge-worker/src/factory/Workflow.js";
import type {
	ExecutionContext,
	WorkflowRuntime,
} from "../../../../packages/edge-worker/src/factory/WorkflowRuntime.js";
import { providerReceipt } from "../../../../packages/edge-worker/test/fixtures/merge-readiness.js";
import { authenticator } from "../../../../packages/edge-worker/test/fixtures/webauthn.js";
import { f1AgentHandlers } from "../../src/MockAgentRunner.js";

assert.equal(
	process.env.F1_AGENT_MODE,
	"mock",
	"This drive never authorizes live inference",
);
const sourceRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../..",
);
const files = [
	"apps/cli/src/onboarding.ts",
	"apps/cli/src/local.ts",
	"apps/cli/src/github.ts",
	"apps/cli/src/app.ts",
	"apps/cli/src/cli.ts",
	"packages/core/src/agent-runner-types.ts",
	"packages/codex-runner/src/config/CodexConfigBuilder.ts",
	"packages/cursor-runner/src/CursorRunner.ts",
	"packages/cursor-runner/src/CursorWorkerRunner.ts",
	"packages/cursor-runner/src/cursor-worker.ts",
	"packages/gemini-runner/src/GeminiRunner.ts",
	"packages/opencode-runner/src/OpenCodeRunner.ts",
	"packages/edge-worker/src/EdgeWorker.ts",
	"packages/edge-worker/src/GitService.ts",
	"packages/edge-worker/src/RunnerConfigBuilder.ts",
	"packages/edge-worker/src/ChatSessionHandler.ts",
	"packages/edge-worker/src/ChatRepositoryProvider.ts",
	"packages/edge-worker/src/factory/ExecutionEnvironment.ts",
	"packages/edge-worker/src/factory/FactoryServer.ts",
	"packages/edge-worker/src/factory/FactoryTools.ts",
	"packages/edge-worker/src/factory/FactoryOnboarding.ts",
	"packages/edge-worker/src/factory/GithubApi.ts",
	"packages/edge-worker/src/factory/GithubProvider.ts",
	"packages/edge-worker/src/factory/GitProvider.ts",
	"packages/edge-worker/src/factory/GithubReadiness.ts",
	"packages/edge-worker/src/factory/GithubTakeover.ts",
	"packages/edge-worker/src/factory/WorkflowRuntime.ts",
	"packages/edge-worker/src/factory/Workflow.ts",
	"packages/edge-worker/src/factory/defaultWorkflows.ts",
	"packages/edge-worker/src/factory/Takeover.ts",
].sort();
const hash = (value: Buffer | string) =>
	createHash("sha256").update(value).digest("hex");
const fingerprint = () =>
	hash(
		files
			.map((file) => `${file}\0${hash(readFileSync(join(sourceRoot, file)))}\n`)
			.join(""),
	);
const before = fingerprint();
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
	cwd: sourceRoot,
	encoding: "utf8",
}).trim();
const directory = realpathSync(
	mkdtempSync(join(tmpdir(), "f1-simple-install-onboarding-")),
);
const home = join(directory, "home");
const repository = join(directory, "project");
const remote = join(directory, "remote.git");
const stubPath = join(directory, "stubs");
mkdirSync(home);
mkdirSync(repository);
mkdirSync(stubPath);
const attempted = join(directory, "forbidden-processes.log");
for (const command of ["gh", "codex"]) {
	writeFileSync(
		join(stubPath, command),
		`#!/bin/sh\nprintf '${command}\\n' >> '${attempted}'\nexit 99\n`,
		{ mode: 0o755 },
	);
}
const git = (...args: string[]) =>
	execFileSync("git", args, {
		cwd: repository,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
git("init", "-q", "-b", "main");
git("config", "user.name", "F1 fixture");
git("config", "user.email", "f1@example.invalid");
writeFileSync(join(repository, "README.md"), "# F1 onboarding fixture\n");
git("add", "README.md");
git("commit", "-q", "-m", "Initial fixture");
execFileSync("git", ["clone", "-q", "--bare", repository, remote]);
git("remote", "add", "origin", "https://github.com/f1-test/onboarding");
const repositoryUrl = "https://github.com/f1-test/onboarding";
const prUrl = `${repositoryUrl}/pull/1`;
const port = Number(process.env.F1_ONBOARDING_PORT ?? "3600");
const origin = `http://localhost:${port}`;
const envKeys = [
	"PATH",
	"GH_TOKEN",
	"GITHUB_TOKEN",
	"BOBS_FACTORY_HOME",
	"BOBS_FACTORY_FACTORY_PORT",
	"BOBS_FACTORY_FACTORY_ORIGIN",
	"BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN",
	"BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY",
];
const savedEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
process.env.PATH = `${stubPath}:${process.env.PATH}`;
process.env.GH_TOKEN = "ambient-f1-secret";
delete process.env.GITHUB_TOKEN;
process.env.BOBS_FACTORY_HOME = home;
process.env.BOBS_FACTORY_FACTORY_PORT = String(port);
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	directory,
	"isolated-capacity",
);
delete process.env.BOBS_FACTORY_FACTORY_ORIGIN;
delete process.env.BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN;
writeFileSync(
	join(home, "config.json"),
	JSON.stringify({
		repositories: [],
		operatorNote: "must survive guided setup",
	}),
	{ mode: 0o600 },
);
const nativeFetch = globalThis.fetch;
let pr:
	| {
			title: string;
			body: string;
			draft: boolean;
			state: string;
			merged: boolean;
			branch: string;
			head: string;
			base: string;
	  }
	| undefined;
const requests: { method: string; path: string; body?: unknown }[] = [];
let mergeCount = 0;
let setupPreflightAllowed = false;
const response = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
globalThis.fetch = (async (input, init) => {
	const url = new URL(String(input));
	if (url.hostname === "localhost" || url.hostname === "127.0.0.1")
		return nativeFetch(input, init);
	try {
		assert.equal(
			url.origin,
			"https://api.github.com",
			"The drive never contacts live providers",
		);
		const auth = new Headers(init?.headers).get("authorization");
		const method = init?.method ?? "GET";
		const body = init?.body
			? (JSON.parse(String(init.body)) as Record<string, unknown>)
			: undefined;
		const path = `${url.pathname}${url.search}`;
		requests.push({ method, path, body });
		if (url.pathname === "/user") {
			assert.equal(auth, "Bearer saved-f1-secret");
			return response({ login: "f1-operator" });
		}
		if (url.pathname === "/repos/f1-test/onboarding") {
			assert.equal(auth, "Bearer saved-f1-secret");
			return response({ permissions: { push: true } });
		}
		assert.equal(
			auth,
			"Bearer saved-f1-secret",
			"Explicit connected account must win over ambient credentials",
		);
		assert.equal(
			init?.redirect,
			"error",
			"Credentials must not follow redirects",
		);
		if (path.startsWith("/repos/f1-test/onboarding/pulls?") && method === "GET")
			return response([]);
		const rawPr = () => {
			assert(pr);
			return {
				html_url: prUrl,
				number: 1,
				node_id: "F1_PR",
				title: pr.title,
				body: pr.body,
				draft: pr.draft,
				state: pr.state,
				merged: pr.merged,
				head: {
					ref: pr.branch,
					sha: pr.head,
					repo: { full_name: "f1-test/onboarding" },
				},
				base: {
					ref: "main",
					sha: pr.base,
					repo: { full_name: "f1-test/onboarding" },
				},
			};
		};
		if (path === "/repos/f1-test/onboarding/pulls" && method === "POST") {
			const branch = String(body?.head);
			pr = {
				title: String(body?.title),
				body: String(body?.body),
				draft: Boolean(body?.draft),
				state: "open",
				merged: false,
				branch,
				head: execFileSync(
					"git",
					["--git-dir", remote, "rev-parse", `refs/heads/${branch}`],
					{ encoding: "utf8" },
				).trim(),
				base: git("rev-parse", "main"),
			};
			return response(rawPr(), 201);
		}
		if (path === "/repos/f1-test/onboarding/pulls/1" && method === "GET")
			return response(rawPr());
		if (path === "/repos/f1-test/onboarding/pulls/1" && method === "PATCH") {
			assert(pr);
			pr.body = String(body?.body);
			return response(rawPr());
		}
		if (url.pathname === "/graphql") {
			const query = String(body?.query);
			if (query.includes("FactoryGithubSetup")) {
				assert.equal(method, "POST");
				assert.deepEqual(body?.variables, {
					owner: "f1-test",
					name: "onboarding",
				});
				if (!setupPreflightAllowed)
					return response({
						errors: [
							{ message: "Resource not accessible by personal access token" },
						],
					});
				return response({
					data: {
						repository: {
							nameWithOwner: "f1-test/onboarding",
							viewerPermission: "WRITE",
							defaultBranchRef: {
								target: {
									oid: git("rev-parse", "main"),
									statusCheckRollup: { contexts: { nodes: [] } },
								},
							},
							pullRequests: { nodes: [] },
						},
					},
				});
			}
			assert(pr);
			const mutation = query.includes("convertPullRequestToDraft")
				? "convertPullRequestToDraft"
				: query.includes("markPullRequestReadyForReview")
					? "markPullRequestReadyForReview"
					: undefined;
			if (mutation) {
				pr.draft = mutation === "convertPullRequestToDraft";
				return response({
					data: {
						[mutation]: { pullRequest: { id: "F1_PR", isDraft: pr.draft } },
					},
				});
			}
			return response(
				providerReceipt({
					url: prUrl,
					headRefOid: pr.head,
					baseRefOid: pr.base,
					isDraft: pr.draft,
					state: pr.merged ? "MERGED" : "OPEN",
					merged: pr.merged,
					mergeStateStatus: "CLEAN",
					reviewDecision: "APPROVED",
				}),
			);
		}
		if (/\/pulls\/1\/reviews/.test(path)) return response([]);
		if (url.pathname === "/repos/f1-test/onboarding/issues/1/comments")
			return response([]);
		if (
			path === "/repos/f1-test/onboarding/pulls/1/merge" &&
			method === "PUT"
		) {
			assert(pr);
			if (body?.sha !== pr.head)
				return response({ message: "Approved head changed" }, 409);
			mergeCount++;
			pr.merged = true;
			pr.state = "closed";
			return response({ merged: true, sha: pr.head });
		}
		throw new Error(`Unexpected controlled GitHub request: ${method} ${path}`);
	} catch (error) {
		console.error(
			`Controlled transport rejected ${url.href}: ${error instanceof Error ? error.message : String(error)}`,
		);
		throw error;
	}
}) as typeof fetch;

let worker: EdgeWorker | undefined;
let runnerCalls = 0;
const mock = f1AgentHandlers(
	"mock",
	"F1 onboarding issue processed without native agent execution.",
)!;
function createWorker() {
	const config = loadLocalConfig(home);
	let instance: EdgeWorker;
	const onboarding = new LocalOnboarding(home, (repo, runner) =>
		instance.configureLocalRepository(repo, runner),
	);
	instance = new EdgeWorker(
		{
			...config,
			repositories: config.repositories,
			platform: "cli",
			factoryHome: home,
			serverPort: port + 1,
			serverHost: "127.0.0.1",
			linearWorkspaces: { "cli-workspace": { linearToken: "f1-local-only" } },
			handlers: {
				...mock,
				createAgentRunner: (type, config) => {
					runnerCalls++;
					return mock.createAgentRunner!(type, config);
				},
			},
		},
		onboarding,
	);
	return instance;
}
type Internal = { getFactoryRuntime(): WorkflowRuntime };
const runtimeOf = (instance: EdgeWorker) =>
	(instance as unknown as Internal).getFactoryRuntime();
let sessionCookie = "";
type ApiPayload = {
	transaction: string;
	options: { challenge: string };
	required: boolean;
	project: { path: string };
	github: { account: string };
	repositories: { name: string }[];
	runner: string;
	authenticated: boolean;
};
type RpcPayload = {
	issue: { id: string };
	session: { sessionId: string };
	activities: { createdAt: number; type: string; content: string }[];
	totalCount: number;
};
async function request(
	path: string,
	method = "GET",
	body?: unknown,
	authenticated = true,
	extra: Record<string, string> = {},
) {
	const result = await fetch(`${origin}${path}`, {
		method,
		headers: {
			origin,
			"content-type": "application/json",
			"x-factory-request": "1",
			...(authenticated && sessionCookie ? { cookie: sessionCookie } : {}),
			...extra,
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return { result, value: (await result.json()) as ApiPayload };
}
async function api(path: string, method = "GET", body?: unknown) {
	const { result, value } = await request(path, method, body);
	assert(result.ok, `${path}: ${JSON.stringify(value)}`);
	return value;
}
async function rpc(method: string, params: unknown) {
	const result = await fetch(`http://localhost:${port + 1}/cli/rpc`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
	});
	const value = (await result.json()) as {
		error?: unknown;
		result: RpcPayload;
	};
	assert(!value.error, JSON.stringify(value));
	return value.result;
}
async function completed(runtime: WorkflowRuntime, id: string) {
	for (let attempt = 0; attempt < 300; attempt++) {
		const run = runtime.runs.get(id);
		if (run?.status === "completed") return run;
		if (run?.status === "failed") throw new Error(JSON.stringify(run));
		await new Promise((done) => setTimeout(done, 100));
	}
	throw new Error(`F1 run did not complete: ${id}`);
}
let success = false;
try {
	worker = createWorker();
	await worker.start();
	for (const [path, method] of [
		["/api/onboarding", "GET"],
		["/api/onboarding/project", "POST"],
		["/api/onboarding/github", "POST"],
	]) {
		const denied = await request(
			path!,
			method,
			method === "GET" ? undefined : {},
			false,
		);
		assert.equal(denied.result.status, 401);
	}
	const key = authenticator();
	const grant = JSON.parse(
		readFileSync(join(home, "factory/auth/enroll.json"), "utf8"),
	) as { token: string };
	const options = await request(
		"/api/auth/register/options",
		"POST",
		{ grant: grant.token },
		false,
	);
	assert.equal(options.result.status, 200);
	sessionCookie = options.result.headers.get("set-cookie")!.split(";")[0]!;
	const enrolled = await request("/api/auth/register/verify", "POST", {
		transaction: options.value.transaction,
		response: key.register(options.value.options.challenge, origin),
	});
	assert.equal(enrolled.result.status, 200);
	sessionCookie = enrolled.result.headers.get("set-cookie")!.split(";")[0]!;
	assert.equal((await api("/api/onboarding")).required, true);
	const invalid = await request("/api/onboarding/project", "POST", {
		repositoryPath: join(directory, "missing"),
		runner: "codex",
	});
	assert.equal(invalid.result.status, 409);
	assert.deepEqual(loadLocalConfig(home).repositories, []);
	const forged = await request(
		"/api/onboarding/project",
		"POST",
		{ repositoryPath: repository, runner: "codex" },
		true,
		{ origin: "https://untrusted.invalid" },
	);
	assert.equal(forged.result.status, 403);
	const configured = await api("/api/onboarding/project", "POST", {
		repositoryPath: repository,
		runner: "codex",
	});
	assert.equal(configured.required, false);
	assert.equal(configured.project.path, repository);
	const deniedConnection = await request("/api/onboarding/github", "POST", {
		token: "saved-f1-secret",
	});
	assert.equal(deniedConnection.result.status, 409);
	assert(!existsSync(join(home, "github-auth.json")));
	setupPreflightAllowed = true;
	const connected = await api("/api/onboarding/github", "POST", {
		token: "saved-f1-secret",
	});
	assert.equal(connected.github.account, "f1-operator");
	assert(
		requests.some(
			(request) =>
				request.method === "POST" &&
				request.path === "/graphql" &&
				JSON.stringify(request.body).includes("FactoryGithubSetup"),
		),
	);
	assert(!JSON.stringify(connected).includes("saved-f1-secret"));
	assert.equal(statSync(join(home, "github-auth.json")).mode & 0o777, 0o600);
	const saved = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
	assert.equal(saved.operatorNote, "must survive guided setup");
	assert.equal(saved.defaultRunner, "codex");
	assert.equal(saved.repositories[0].repositoryPath, repository);
	assert.equal((await api("/api/config")).repositories[0].name, "project");
	git("remote", "set-url", "origin", remote);
	git("fetch", "-q", "origin");
	console.log(
		"PASS real passkey registration; signed-out and forged-origin setup denied; project/agent saved privately; GitHub token not returned",
	);
	const authBefore = readFileSync(join(home, "factory/auth/state.json"));
	await worker.stop();
	worker = undefined;
	assert.equal(
		readFileSync(join(home, "factory/auth/state.json")).toString(),
		authBefore.toString(),
	);
	worker = createWorker();
	await worker.start();
	const restarted = await api("/api/onboarding");
	assert.equal(restarted.required, false);
	assert.equal(restarted.project.path, repository);
	assert.equal(restarted.runner, "codex");
	assert.equal(restarted.github.account, "f1-operator");
	assert.equal((await api("/api/auth/status")).authenticated, true);
	console.log(
		"PASS restart preserved selected project/agent, credentials, passkey and authenticated session",
	);
	const runtime = runtimeOf(worker);
	const workflow = WorkflowSchema.parse({
		id: "onboarding-f1",
		name: "Onboarding delivery drive",
		labels: ["onboarding-f1"],
		allowedTriggers: ["manual", "ticket-assignment"],
		steps: [
			{
				id: "observe",
				name: "Mock issue agent",
				type: "agent",
				prompt: "Reply with the deterministic F1 onboarding result.",
				json: false,
			},
			{
				id: "implement",
				name: "Scripted fixture change",
				type: "script",
				script:
					'printf \'F1 delivered after guided onboarding\\n\' > result.txt\ngit add result.txt\ngit commit -q -m \'feat: validate onboarding delivery\'\nprintf \'{"status":"completed","summary":"F1 scripted change","checks":[],"questions":[]}\'',
			},
			{
				id: "draft-pr",
				name: "Create draft through native GitHub API",
				type: "tool",
				tool: "draft-pr",
			},
			{
				id: "ci",
				name: "Read native GitHub readiness",
				type: "tool",
				tool: "ci",
			},
		],
	});
	runtime.updateWorkflows([...runtime.listWorkflows(), workflow], workflow.id);
	const created = await rpc("createIssue", {
		teamId: "team-default",
		title: "Deliver after guided setup",
		description:
			"[workflow=onboarding-f1]\nExercise protected onboarding and native delivery.",
		labels: ["onboarding-f1"],
	});
	assert(created.issue.id);
	const started = await rpc("startSession", { issueId: created.issue.id });
	const run = await completed(runtime, started.session.sessionId);
	assert.equal(run.repositoryId, "local");
	assert.equal(run.runner, "codex");
	assert(run.workspace.startsWith(join(home, "worktrees")));
	assert.equal(
		readFileSync(join(run.workspace, "result.txt"), "utf8"),
		"F1 delivered after guided onboarding\n",
	);
	assert.equal((run.outputs["draft-pr"] as { url: string }).url, prUrl);
	assert(pr);
	assert.equal(pr.draft, true);
	assert.equal(mergeCount, 0);
	assert(runnerCalls > 0);
	const timeline = await rpc("viewSession", {
		sessionId: run.id,
		limit: 100,
		offset: 0,
	});
	assert(timeline.totalCount > 0);
	assert(
		timeline.activities.every(
			(activity: { createdAt: unknown; type: unknown; content: unknown }) =>
				typeof activity.createdAt === "number" &&
				typeof activity.type === "string" &&
				typeof activity.content === "string",
		),
	);
	assert(JSON.stringify(timeline).includes("F1 onboarding issue processed"));
	const page = await rpc("viewSession", {
		sessionId: run.id,
		limit: 1,
		offset: 1,
	});
	assert.equal(page.activities.length, 1);
	assert.equal(page.totalCount, timeline.totalCount);
	assert.deepEqual(page.activities, timeline.activities.slice(1, 2));
	assert(!JSON.stringify(timeline).includes("saved-f1-secret"));
	assert(!JSON.stringify(run).includes("saved-f1-secret"));
	const activity = await api(`/api/runs/${run.id}/activity`);
	assert(
		JSON.stringify(activity).includes("Create draft through native GitHub API"),
	);
	console.log(
		"PASS F1 issue → selected repository/worktree → mocked agent activities → real local Git commit/push → native REST draft + GraphQL readiness",
	);
	const logs: string[] = [];
	const context = {
		factoryHome: home,
		run,
		workflow,
		step: {
			id: "merge",
			name: "Approved merge",
			type: "tool",
			tool: "merge",
			branches: [],
			maxVisits: 8,
		},
		signal: new AbortController().signal,
		input: {},
		outputs: run.outputs,
		evidenceDir: join(home, "factory/evidence", run.id),
		log: (line: string) => logs.push(line),
	} as ExecutionContext;
	const provider = gitProvider(
		(command, args) => executeCommand(context, command, args),
		{ type: "github", repositoryUrl },
	);
	await assert.rejects(
		() => provider.merge(prUrl, "", "squash"),
		/explicitly approved head SHA/,
	);
	const tools = new FactoryTools({ postComment: async () => {} });
	run.humanDecisions = [
		{
			reviewId: "f1-stale",
			decision: "approve",
			headSha: "stale",
			at: new Date().toISOString(),
		},
	];
	const stale = (await tools.tool(context)) as { fix?: boolean };
	assert.equal(stale.fix, true);
	assert.equal(mergeCount, 0);
	run.humanDecisions = [
		{
			reviewId: "f1-current",
			decision: "approve",
			headSha: pr.head,
			at: new Date().toISOString(),
		},
	];
	const merged = (await tools.tool(context)) as { merged?: boolean };
	assert.equal(merged.merged, true);
	assert.equal(mergeCount, 1);
	assert(
		requests.some(
			(request) =>
				request.path === "/graphql" &&
				JSON.stringify(request.body).includes("markPullRequestReadyForReview"),
		),
	);
	const put = requests.find(
		(request) => request.method === "PUT" && request.path.endsWith("/merge"),
	);
	assert(put);
	assert.equal((put.body as { sha: string }).sha, pr.head);
	assert(!logs.join("\n").includes("saved-f1-secret"));
	assert(
		!existsSync(attempted),
		"Neither gh nor the prepared coding agent may run",
	);
	await rpc("stopSession", { sessionId: run.id });
	console.log(
		"PASS stale approved SHA refused; current approved SHA → native draft transition → exact-SHA merge confirmation; zero gh/native-agent execution",
	);
	assert.equal(
		fingerprint(),
		before,
		"Runtime sources changed while testing; rerun the drive at the final fingerprint",
	);
	console.log(
		JSON.stringify(
			{
				testedCommit: commit,
				dirty: true,
				fingerprint: before,
				files,
				agentMode: "mock",
				liveProviderRequests: 0,
				ghExecutions: 0,
				nativeAgentExecutions: 0,
				nativeGitHubRequests: requests.length,
			},
			null,
			2,
		),
	);
	success = true;
} finally {
	globalThis.fetch = nativeFetch;
	if (worker) await worker.stop();
	for (const [key, value] of savedEnv) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	if (success) rmSync(directory, { recursive: true, force: true });
	else console.error(`Failed F1 fixture retained: ${directory}`);
}
