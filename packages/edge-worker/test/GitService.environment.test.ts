import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ILogger, Issue, RepositoryConfig } from "cyrus-core";
import { afterEach, expect, it, vi } from "vitest";
import { GitService } from "../src/GitService.js";

const roots: string[] = [];
const logger: ILogger = {
	info() {},
	debug() {},
	warn() {},
	error() {},
	withContext() {
		return this;
	},
} as ILogger;
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "git-service-env-"));
	roots.push(root);
	const repo = join(root, "repo");
	mkdirSync(repo);
	const env = {
		PATH: process.env.PATH!,
		HOME: root,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_AUTHOR_NAME: "Selected author",
		GIT_AUTHOR_EMAIL: "author@example.test",
		GIT_COMMITTER_NAME: "Selected committer",
		GIT_COMMITTER_EMAIL: "committer@example.test",
	};
	const git = (args: string[]) =>
		execFileSync("git", args, { cwd: repo, env, stdio: "pipe" });
	git(["init", "-q", "-b", "main"]);
	writeFileSync(
		join(repo, "cyrus-setup.sh"),
		`#!/bin/sh\nnode -e 'require("node:fs").writeFileSync("probe.json",JSON.stringify({author:process.env.GIT_AUTHOR_NAME,home:process.env.HOME,ambient:process.env.GIT_SERVICE_HOST_CANARY??null}))'\n`,
		{ mode: 0o755 },
	);
	git(["add", "cyrus-setup.sh"]);
	git(["commit", "-qm", "fixture"]);
	git(["remote", "add", "origin", repo]);
	const repository = {
		id: "fixture",
		name: "fixture",
		repositoryPath: repo,
		workspaceBaseDir: join(root, "worktrees"),
		baseBranch: "main",
	} as RepositoryConfig;
	const issue = {
		id: "fixture",
		identifier: "ENV-57",
		title: "fixture",
		branchName: "env-test",
		labels: async () => ({ nodes: [] }),
	} as unknown as Issue;
	return { root, repo, env, git, repository, issue };
}
afterEach(() => {
	vi.unstubAllEnvs();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
it("keeps a scoped service environment through real worktree and hook grandchildren without changing the shared service", async () => {
	const { root, env, repository, issue } = fixture();
	vi.stubEnv("GIT_SERVICE_HOST_CANARY", "host-secret");
	const base = new GitService({ cyrusHome: root }, logger);
	const scoped = base.withEnvironment(env);
	const workspace = await scoped.createGitWorktree(issue, [repository]);
	expect(workspace.isGitWorktree).toBe(true);
	expect(
		JSON.parse(readFileSync(join(workspace.path, "probe.json"), "utf8")),
	).toEqual({ author: "Selected author", home: root, ambient: null });
	expect(process.env.GIT_SERVICE_HOST_CANARY).toBe("host-secret");
	// The base service still uses the host environment; scoped construction did not switch it.
	const legacy = await base.createGitWorktree(
		{ ...issue, identifier: "ENV-58", branchName: "legacy-test" },
		[repository],
	);
	expect(
		JSON.parse(readFileSync(join(legacy.path, "probe.json"), "utf8")).ambient,
	).toBe("host-secret");
});
it("rejects failed selected fetches without silently creating an unauthenticated fallback workspace", async () => {
	const { root, env, repository, issue, git } = fixture();
	git(["remote", "set-url", "origin", join(root, "missing-remote")]);
	const service = new GitService({ cyrusHome: root }, logger).withEnvironment(
		env,
	);
	await expect(service.createGitWorktree(issue, [repository])).rejects.toThrow(
		"No fallback workspace",
	);
	expect(existsSync(join(repository.workspaceBaseDir, issue.identifier))).toBe(
		false,
	);
});
