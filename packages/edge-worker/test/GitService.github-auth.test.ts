import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
	AgentRunnerConfig,
	CyrusAgentSession,
	ILogger,
	Issue,
	RepositoryConfig,
} from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { executeCommand } from "../src/factory/FactoryTools.js";
import {
	managedGithubAgentEnvironment,
	managedGithubGitEnvironment,
} from "../src/factory/GithubApi.js";
import type {
	ExecutionContext,
	FactoryRun,
} from "../src/factory/WorkflowRuntime.js";
import { GitService } from "../src/GitService.js";
import { RunnerConfigBuilder } from "../src/RunnerConfigBuilder.js";

const roots: string[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const logger: ILogger = {
	info() {},
	debug() {},
	warn() {},
	error() {},
	withContext() {
		return this;
	},
} as ILogger;
function fixture(project = "test/repo") {
	const root = mkdtempSync(join(tmpdir(), "github-git-bridge-"));
	roots.push(root);
	const repo = join(root, "repo"),
		bare = join(root, "remote.git"),
		bin = join(root, "bin");
	mkdirSync(repo);
	mkdirSync(bin);
	const gitPath = execFileSync("/bin/sh", ["-c", "command -v git"], {
		encoding: "utf8",
	}).trim();
	const gitExecPath = execFileSync(gitPath, ["--exec-path"], {
		encoding: "utf8",
	}).trim();
	const env: NodeJS.ProcessEnv = {
		...process.env,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_AUTHOR_NAME: "Fixture",
		GIT_AUTHOR_EMAIL: "fixture@example.test",
		GIT_COMMITTER_NAME: "Fixture",
		GIT_COMMITTER_EMAIL: "fixture@example.test",
	};
	const git = (args: string[], directory = repo, environment = env) =>
		execFileSync(gitPath, args, {
			cwd: directory,
			env: environment,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	git(["init", "-q", "-b", "main"]);
	writeFileSync(join(repo, "fixture.txt"), "initial\n");
	git(["add", "fixture.txt"]);
	git(["commit", "-qm", "fixture"]);
	git(["clone", "-q", "--bare", repo, bare]);
	git(["remote", "add", "origin", `git@github.com:${project}.git`]);
	writeFileSync(
		join(root, "github-auth.json"),
		JSON.stringify({
			version: 1,
			hosts: { "github.com": { token: "browser-token", account: "selected" } },
		}),
		{ mode: 0o600 },
	);
	const helper = join(bin, "factory-credential");
	writeFileSync(
		helper,
		"#!/bin/sh\ncat >/dev/null\nprintf 'username=x-access-token\\npassword=browser-token\\n\\n'\n",
		{ mode: 0o755 },
	);
	const canary = join(root, "unexpected-gh-ssh");
	for (const name of ["gh", "ssh"])
		writeFileSync(
			join(bin, name),
			`#!/bin/sh\nprintf '%s\\n' ${quote(name)} >> ${quote(canary)}\nexit 99\n`,
			{ mode: 0o755 },
		);
	const probe = join(root, "transport.log");
	// A controlled remote helper connects Git's native upload/receive protocol to a local bare fixture.
	// No GitHub traffic occurs; it records the exact transport URL selected by real Git.
	writeFileSync(
		join(bin, "git-remote-https"),
		`#!/bin/sh\nprintf '%s\\n' "$2" >> ${quote(probe)}\nwhile IFS= read -r command; do\n case "$command" in\n capabilities) printf 'connect\\n\\n';;\n option*) printf 'unsupported\\n';;\n 'connect git-upload-pack') printf '\\n'; exec ${quote(join(gitExecPath, "git-upload-pack"))} ${quote(bare)};;\n 'connect git-receive-pack') printf '\\n'; exec ${quote(join(gitExecPath, "git-receive-pack"))} ${quote(bare)};;\n *) exit 98;;\n esac\ndone\n`,
		{ mode: 0o755 },
	);
	const managedEnvironment = {
		...env,
		PATH: `${bin}:${dirname(gitPath)}:/usr/bin:/bin`,
		GIT_EXEC_PATH: bin,
		BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND: quote(helper),
		GH_TOKEN: "ambient-token",
		GIT_SSH_COMMAND: join(bin, "ssh"),
	};
	const repository = {
		id: "repo",
		name: "Fixture",
		repositoryPath: repo,
		workspaceBaseDir: join(root, "worktrees"),
		baseBranch: "main",
		githubUrl: `https://github.com/${project}`,
		isActive: true,
		linearWorkspaceId: "cli-workspace",
	} as RepositoryConfig;
	const issue = {
		id: "issue",
		identifier: "AUTH-1",
		title: "Fixture",
		branchName: "native-auth-test",
		labels: async () => ({ nodes: [] }),
	} as unknown as Issue;
	return {
		root,
		repo,
		bare,
		bin,
		git,
		gitPath,
		env,
		managedEnvironment,
		repository,
		issue,
		probe,
		canary,
	};
}
function hostEnvironment(env: NodeJS.ProcessEnv) {
	for (const [key, value] of Object.entries(env))
		if (value !== undefined) vi.stubEnv(key, value);
}

function runnerBuilder() {
	return new RunnerConfigBuilder(
		{ buildChatAllowedTools: () => ["Read(**)"] },
		{ buildMcpConfig: () => ({}), buildMergedMcpConfigPath: () => undefined },
		{
			getDefaultRunner: () => "codex",
			determineRunnerSelection: () => ({ runnerType: "codex" }),
			getDefaultModelForRunner: () => undefined,
			getDefaultFallbackModelForRunner: () => undefined,
		},
	);
}

function issueRunnerInput(f: ReturnType<typeof fixture>, workspace = f.repo) {
	return {
		session: {
			issueId: f.issue.id,
			workspace: { path: workspace, isGitWorktree: true },
		} as CyrusAgentSession,
		repository: f.repository,
		sessionId: "native-issue",
		systemPrompt: "Fixture",
		allowedTools: ["Bash(*)"],
		allowedDirectories: [workspace],
		disallowedTools: [],
		factoryHome: f.root,
		linearWorkspaceId: "cli-workspace",
		logger,
		onMessage() {},
		onError() {},
		requireLinearWorkspaceId: () => "cli-workspace",
	};
}

it("fetches an SSH-origin project with browser credentials and pushes its worktree through canonical HTTPS without changing stored config", async () => {
	const f = fixture();
	hostEnvironment(f.managedEnvironment);
	const original = f.git([
		"config",
		"--local",
		"--get-regexp",
		"^(remote|credential|url)\\.",
	]);
	const service = new GitService({ factoryHome: f.root }, logger);
	const workspace = await service.createGitWorktree(f.issue, [f.repository]);
	expect(workspace.isGitWorktree).toBe(true);
	writeFileSync(join(workspace.path, "change.txt"), "change\n");
	f.git(["add", "change.txt"], workspace.path);
	f.git(["commit", "-qm", "change"], workspace.path);
	const ctx = {
		factoryHome: f.root,
		run: {
			workspace: workspace.path,
			outputs: { repository: { githubUrl: f.repository.githubUrl } },
			gitProvider: { type: "github", repositoryUrl: f.repository.githubUrl },
		},
		signal: new AbortController().signal,
		input: {},
		log: () => {},
		evidenceDir: join(f.root, "evidence"),
	} as unknown as ExecutionContext;
	await executeCommand(ctx, "git", ["push", "origin", "HEAD"]);
	expect(f.git(["rev-parse", f.issue.branchName!], f.bare)).toBe(
		f.git(["rev-parse", "HEAD"], workspace.path),
	);
	expect(readFileSync(f.probe, "utf8").trim().split("\n")).toEqual([
		`https://github.com/test/repo.git`,
		`https://github.com/test/repo.git`,
		`https://github.com/test/repo.git`,
	]);
	expect(
		f.git(["config", "--local", "--get-regexp", "^(remote|credential|url)\\."]),
	).toBe(original);
	expect(f.git(["config", "--local", "--get", "remote.origin.url"])).toBe(
		"git@github.com:test/repo.git",
	);
	expect(existsSync(f.canary)).toBe(false);
});

it("keeps grouped agent origin rewrites distinct and does not inherit ambient Git credentials into accepted private profiles", async () => {
	const first = fixture("test/first"),
		second = fixture("test/second");
	hostEnvironment(first.managedEnvironment);
	const managed = managedGithubAgentEnvironment({
		factoryHome: first.root,
		environment: first.managedEnvironment,
		repositories: [
			{ directory: first.repo, repositoryUrl: first.repository.githubUrl },
			{ directory: second.repo, repositoryUrl: second.repository.githubUrl },
		],
	})!;
	const child = { ...first.managedEnvironment, ...managed };
	expect(first.git(["remote", "get-url", "origin"], first.repo, child)).toBe(
		"https://github.com/test/first.git",
	);
	expect(
		second.git(["remote", "get-url", "--push", "origin"], second.repo, child),
	).toBe("https://github.com/test/second.git");
	expect(JSON.parse(managed.BOBS_FACTORY_GITHUB_REPOSITORIES!)).toEqual([
		{ host: "github.com", project: "test/first" },
		{ host: "github.com", project: "test/second" },
	]);
	expect(
		managedGithubGitEnvironment({
			factoryHome: first.root,
			directory: first.repo,
			environment: first.managedEnvironment,
			explicit: true,
		}),
	).toBeUndefined();
	expect(
		managedGithubAgentEnvironment({
			factoryHome: first.root,
			repositories: [{ directory: first.repo }],
			environment: {
				...first.managedEnvironment,
				BOBS_FACTORY_GITHUB_EXPLICIT_CREDENTIALS: "1",
			},
		}),
	).toBeUndefined();
	expect(first.git(["config", "--local", "--get", "remote.origin.url"])).toBe(
		"git@github.com:test/first.git",
	);
});

it("wires grouped native coding-agent environments through EdgeWorker without redirecting sibling repositories", async () => {
	const first = fixture("test/first"),
		second = fixture("test/second");
	hostEnvironment(first.managedEnvironment);
	const repository2 = { ...second.repository, id: "second" };
	const worker = new EdgeWorker({
		platform: "cli",
		factoryHome: first.root,
		repositories: [first.repository, repository2],
	});
	const edge = worker as unknown as {
		applyRunExecution(
			run: FactoryRun,
			runner: string,
			config: AgentRunnerConfig,
		): Promise<unknown>;
	};
	const run = {
		repositoryId: first.repository.id,
		workspace: first.repo,
		repositories: [first.repository, repository2].map((repo) => ({
			...repo,
			workspace: repo.repositoryPath,
		})),
		outputs: {},
	} as unknown as FactoryRun;
	const config = {
		factoryHome: first.root,
		workingDirectory: first.repo,
	} as AgentRunnerConfig;
	await edge.applyRunExecution(run, "codex", config);
	const child = { ...first.managedEnvironment, ...config.additionalEnv };
	expect(first.git(["remote", "get-url", "origin"], first.repo, child)).toBe(
		"https://github.com/test/first.git",
	);
	expect(second.git(["remote", "get-url", "origin"], second.repo, child)).toBe(
		"https://github.com/test/second.git",
	);
});

it("rejects a foreign push destination before touching either remote and does not create fallback workspaces", async () => {
	const f = fixture();
	hostEnvironment(f.managedEnvironment);
	f.git([
		"remote",
		"set-url",
		"--push",
		"origin",
		"git@github.com:other/repo.git",
	]);
	const service = new GitService({ factoryHome: f.root }, logger);
	await expect(
		service.createGitWorktree(f.issue, [f.repository]),
	).rejects.toThrow("No fallback workspace");
	expect(
		existsSync(join(f.repository.workspaceBaseDir, f.issue.identifier)),
	).toBe(false);
	expect(existsSync(f.probe)).toBe(false);
	expect(f.git(["remote", "get-url", "--push", "origin"])).toBe(
		"git@github.com:other/repo.git",
	);
});

it("lets a native Simple issue runner push its SSH-origin worktree with browser credentials", async () => {
	const f = fixture();
	hostEnvironment(f.managedEnvironment);
	const workspace = await new GitService(
		{ factoryHome: f.root },
		logger,
	).createGitWorktree(f.issue, [f.repository]);
	const executable = join(f.bin, "factory-credential");
	vi.stubEnv("BOBS_FACTORY_INTERNAL_EXECUTABLE", executable);
	const { config } = runnerBuilder().buildIssueConfig({
		...issueRunnerInput(f, workspace.path),
		sandboxSettings: { enabled: true },
	});
	writeFileSync(join(workspace.path, "simple.txt"), "simple\n");
	f.git(["add", "simple.txt"], workspace.path);
	f.git(["commit", "-qm", "simple"], workspace.path);
	f.git(["push", "origin", "HEAD"], workspace.path, {
		...f.managedEnvironment,
		...config.additionalEnv,
	});
	expect(f.git(["rev-parse", f.issue.branchName!], f.bare)).toBe(
		f.git(["rev-parse", "HEAD"], workspace.path),
	);
	expect(config.additionalEnv?.BOBS_FACTORY_HOME).toBe(f.root);
	expect(config.redact?.(JSON.stringify(config.additionalEnv))).not.toContain(
		"browser-token",
	);
	const sandboxed = config as AgentRunnerConfig & {
		sandboxSettings: { allowRead: string[] };
	};
	expect(sandboxed.sandboxSettings.allowRead).toContain(executable);
	expect(sandboxed.sandboxSettings.allowRead).not.toContain(f.root);
	expect(existsSync(f.canary)).toBe(false);
	expect(f.git(["config", "--local", "--get", "remote.origin.url"])).toBe(
		"git@github.com:test/repo.git",
	);
});

it("gives chat runners grouped Git bindings and a quoted API helper that works before PATH reload", () => {
	const first = fixture("test/first"),
		second = fixture("test/second");
	hostEnvironment(first.managedEnvironment);
	const helper = join(first.root, "Bob's Factory binary");
	writeFileSync(helper, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n", { mode: 0o755 });
	vi.stubEnv("BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND", quote(helper));
	const config = runnerBuilder().buildChatConfig({
		workspacePath: join(first.root, "chat"),
		workspaceName: "Chat",
		systemPrompt: "Fixture",
		sessionId: "native-chat",
		factoryHome: first.root,
		platformName: "slack",
		repository: first.repository,
		repositories: [first.repository, { ...second.repository, id: "second" }],
		repositoryPaths: [first.repo, second.repo],
		logger,
		onMessage() {},
		onError() {},
	});
	const child = { ...first.managedEnvironment, ...config.additionalEnv };
	expect(first.git(["remote", "get-url", "origin"], first.repo, child)).toBe(
		"https://github.com/test/first.git",
	);
	expect(second.git(["remote", "get-url", "origin"], second.repo, child)).toBe(
		"https://github.com/test/second.git",
	);
	const request = join(first.root, "request with 'quotes' $(exit 99).json");
	const args = ["--repo", first.repository.githubUrl!, "--request", request];
	expect(
		execFileSync(
			"/bin/sh",
			[
				"-c",
				`${config.additionalEnv!.BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND} github-api "$@"`,
				"bobs-factory",
				...args,
			],
			{ env: { ...child, PATH: "/usr/bin:/bin" }, encoding: "utf8" },
		)
			.trim()
			.split("\n"),
	).toEqual(["github-api", ...args]);
});

it("skips browser credential discovery entirely before an explicit issue profile is applied", () => {
	const f = fixture();
	hostEnvironment(f.managedEnvironment);
	chmodSync(join(f.root, "github-auth.json"), 0o644);
	const { config } = runnerBuilder().buildIssueConfig({
		...issueRunnerInput(f),
		nativeGithubCredentials: false,
	});
	expect(config.additionalEnv).toBeUndefined();
});
