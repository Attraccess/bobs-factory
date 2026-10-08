import { execFileSync } from "node:child_process";
import { isAbsolute } from "node:path";

/** Resolve both the per-worktree index/HEAD and shared objects/refs directories. */
export function resolveGitMetadataDirectories(
	workingDirectories: string[],
	env?: NodeJS.ProcessEnv,
): string[] {
	const metadata = new Set<string>();
	for (const cwd of new Set(workingDirectories)) {
		try {
			const output = execFileSync(
				"git",
				[
					"rev-parse",
					"--path-format=absolute",
					"--git-dir",
					"--git-common-dir",
				],
				{ cwd, env, encoding: "utf8", stdio: "pipe", timeout: 5_000 },
			);
			for (const directory of output.trim().split("\n")) {
				if (isAbsolute(directory)) metadata.add(directory);
			}
		} catch {
			// Chat/title workspaces and attachment directories need not be Git repos.
		}
	}
	return [...metadata];
}
