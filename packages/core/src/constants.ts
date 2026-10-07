import { join } from "node:path";

/**
 * Shared constants used across Bob’s Factory packages
 */

/**
 * Default proxy URL for Bob’s Factory hosted services
 */
export const DEFAULT_PROXY_URL = "";

/**
 * Default directory name for git worktrees
 */
export const DEFAULT_WORKTREES_DIR = "worktrees";

/**
 * Default directory name for cloned repositories
 */
export const DEFAULT_REPOS_DIR = "repos";

/**
 * Resolves the repos directory, preferring BOBS_FACTORY_REPOS_DIR env var over the default.
 */
export function getDefaultReposDir(factoryHome: string): string {
	return (
		process.env.BOBS_FACTORY_REPOS_DIR?.trim() ||
		join(factoryHome, DEFAULT_REPOS_DIR)
	);
}

/**
 * Resolves the worktrees directory, preferring BOBS_FACTORY_WORKTREES_DIR env var over the default.
 */
export function getDefaultWorktreesDir(factoryHome: string): string {
	return (
		process.env.BOBS_FACTORY_WORKTREES_DIR?.trim() ||
		join(factoryHome, DEFAULT_WORKTREES_DIR)
	);
}

/**
 * Default base branch for new repositories
 */
export const DEFAULT_BASE_BRANCH = "main";

/**
 * Default config filename
 */
export const DEFAULT_CONFIG_FILENAME = "config.json";
