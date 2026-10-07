import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
	applyMigration,
	inspectMigration,
	restoreMigration,
} from "./migration.js";
import { canonicalPath } from "./paths.js";

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		execFileSync: (...args: Parameters<typeof actual.execFileSync>) =>
			args[0] === "ps" ? "" : actual.execFileSync(...args),
	};
});
const roots: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
const git = (directory: string, args: string[]) =>
	execFileSync("git", ["-C", directory, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();

it.each([
	true,
	false,
])("repairs both worktree links and restores original metadata (main repo moves: %s)", (mainMoves) => {
	const root = canonicalPath(
		mkdtempSync(join(tmpdir(), "factory-git-migrate-")),
	);
	roots.push(root);
	const source = join(root, "old"),
		destination = join(root, "new"),
		backup = join(root, "backup");
	mkdirSync(source);
	const repo = join(mainMoves ? source : root, "repo");
	mkdirSync(repo);
	git(repo, ["init", "-b", "main"]);
	git(repo, [
		"-c",
		"user.name=Migration",
		"-c",
		"user.email=migration@example.invalid",
		"commit",
		"--allow-empty",
		"-m",
		"initial",
	]);
	const worktree = join(mainMoves ? root : source, "worktree");
	git(repo, ["worktree", "add", "-b", "working", worktree]);
	writeFileSync(join(worktree, "uncommitted"), "preserve work");
	writeFileSync(
		join(source, "config.json"),
		JSON.stringify({
			repositories: [{ repositoryPath: repo, workspaceBaseDir: worktree }],
		}),
	);
	const original = readFileSync(join(worktree, ".git"));
	const manifest = inspectMigration(source, destination);
	expect(manifest.blockers).toEqual([]);
	expect(applyMigration(manifest, backup).status).toBe("applied");
	const newRepo = mainMoves ? join(destination, "repo") : repo;
	const newWorktree = mainMoves ? worktree : join(destination, "worktree");
	expect(git(newRepo, ["worktree", "list", "--porcelain"])).toContain(
		newWorktree,
	);
	expect(git(newWorktree, ["rev-parse", "HEAD"])).toBe(
		git(newRepo, ["rev-parse", "HEAD"]),
	);
	expect(readFileSync(join(newWorktree, "uncommitted"), "utf8")).toBe(
		"preserve work",
	);
	expect(applyMigration(manifest, backup).status).toBe("already-applied");
	expect(restoreMigration(backup).status).toBe("restored");
	expect(readFileSync(join(worktree, ".git"))).toEqual(original);
	expect(git(repo, ["worktree", "list", "--porcelain"])).toContain(worktree);
	expect(git(worktree, ["rev-parse", "HEAD"])).toBe(
		git(repo, ["rev-parse", "HEAD"]),
	);
});
