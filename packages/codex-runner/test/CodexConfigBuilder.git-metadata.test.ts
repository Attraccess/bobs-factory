import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { CodexConfigBuilder } from "../src/config/CodexConfigBuilder.js";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

function fixture() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-git-metadata-")));
	directories.push(root);
	const repository = join(root, "repo");
	const workspace = join(root, "workspace");
	const worktree = join(workspace, "worktree");
	mkdirSync(workspace);
	execFileSync("git", ["init", "-q", repository]);
	execFileSync("git", [
		"-C",
		repository,
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.test",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-q",
		"--allow-empty",
		"-m",
		"fixture",
	]);
	execFileSync("git", [
		"-C",
		repository,
		"worktree",
		"add",
		"-q",
		"-b",
		"fixture",
		worktree,
	]);
	return { root, repository, workspace, worktree };
}

it.each([
	false,
	true,
])("grants linked and shared Git metadata for worktrees (egress=%s)", async (egress) => {
	const { root, repository, worktree } = fixture();
	const config = await new CodexConfigBuilder({
		factoryHome: root,
		codexHome: join(root, "codex"),
		workingDirectory: worktree,
		allowedDirectories: [repository],
		...(egress && { sandboxSettings: { allowRead: [repository] } }),
	}).build();
	expect(config.approvalPolicy).toBe("never");
	expect(config.sandbox.kind).toBe("profile");
	if (config.sandbox.kind !== "profile") throw new Error("Expected profile");
	expect(config.sandbox.extends).toBe(":workspace");
	expect(config.sandbox.filesystem[join(repository, ".git")]).toBe("write");
	expect(
		config.sandbox.filesystem[join(repository, ".git/worktrees/worktree")],
	).toBe("write");
	expect(config.sandbox.filesystem[":root"]).toBe(egress ? "deny" : "read");
});

it("discovers Git metadata for sub-worktrees beneath a non-Git multi-repo container", async () => {
	const { root, repository, workspace, worktree } = fixture();
	const config = await new CodexConfigBuilder({
		factoryHome: root,
		codexHome: join(root, "codex"),
		workingDirectory: workspace,
		additionalDirectories: [worktree],
	}).build();
	expect(config.sandbox.kind).toBe("profile");
	if (config.sandbox.kind !== "profile") throw new Error("Expected profile");
	expect(config.sandbox.filesystem[join(repository, ".git")]).toBe("write");
	expect(
		config.sandbox.filesystem[join(repository, ".git/worktrees/worktree")],
	).toBe("write");
});

it("preserves explicit read-only mode in a Git worktree", async () => {
	const { root, worktree } = fixture();
	const config = await new CodexConfigBuilder({
		factoryHome: root,
		codexHome: join(root, "codex"),
		workingDirectory: worktree,
		sandbox: "read-only",
	}).build();
	expect(config.sandbox).toEqual({
		kind: "workspace-mode",
		mode: "read-only",
		writableRoots: [worktree],
		networkAccess: true,
	});
});
