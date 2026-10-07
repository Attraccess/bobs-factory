import { execFileSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface GitRepair {
	commonDirectory: string;
	workspaces: string[];
}
export function relocated(path: string, source: string, destination: string) {
	const suffix = relative(source, path);
	return suffix !== ".." && !suffix.startsWith("../") && !isAbsolute(suffix)
		? resolve(destination, suffix)
		: path;
}
const git = (args: string[]) =>
	execFileSync("git", args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();

/** Discover both directions of Git's worktree links before any file is changed. */
export function discoverWorktrees(
	source: string,
	destination: string,
	paths: string[],
) {
	const repairs = new Map<string, GitRepair>();
	const backups = new Set<string>();
	for (const path of paths) {
		const commonDirectory = git([
			"-C",
			dirname(join(source, path)),
			"rev-parse",
			"--path-format=absolute",
			"--git-common-dir",
		]);
		if (!isAbsolute(commonDirectory))
			throw new Error("Cannot discover Git metadata");
		if (repairs.has(commonDirectory)) continue;
		const workspaces = git([
			"--git-dir",
			commonDirectory,
			"worktree",
			"list",
			"--porcelain",
			"-z",
		])
			.split("\0")
			.filter((line) => line.startsWith("worktree "))
			.map((line) => line.slice(9));
		if (!workspaces.length) throw new Error("Git has no registered worktrees");
		repairs.set(commonDirectory, { commonDirectory, workspaces });
		for (const workspace of workspaces) {
			const gitPath = join(workspace, ".git");
			if (
				relocated(workspace, source, destination) === workspace &&
				existsSync(gitPath) &&
				lstatSync(gitPath).isFile()
			)
				backups.add(gitPath);
		}
		if (relocated(commonDirectory, source, destination) === commonDirectory) {
			// Repair changes administrative gitdir files outside the state home.
			const administration = join(commonDirectory, "worktrees");
			if (existsSync(administration)) backups.add(administration);
		}
	}
	// Backups must be disjoint; an external main .git includes its worktrees directory.
	const externalPaths = [...backups].filter(
		(path, _, all) =>
			!all.some(
				(parent) =>
					parent !== path && relocated(path, parent, "/placeholder") !== path,
			),
	);
	return { repairs: [...repairs.values()], externalPaths };
}

export function repairWorktrees(
	repairs: GitRepair[],
	source: string,
	destination: string,
) {
	for (const repair of repairs) {
		const common = relocated(repair.commonDirectory, source, destination);
		const workspaces = repair.workspaces.map((path) =>
			relocated(path, source, destination),
		);
		git(["--git-dir", common, "worktree", "repair", ...workspaces]);
		for (const workspace of workspaces) {
			if (
				git([
					"-C",
					workspace,
					"rev-parse",
					"--path-format=absolute",
					"--git-common-dir",
				]) !== common
			)
				throw new Error(
					"Migrated Git worktree metadata does not match its repository",
				);
		}
	}
}
