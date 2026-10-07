import type { EdgeConfig } from "bobs-factory-core";

/**
 * Linear credentials obtained from OAuth flow
 */
export interface LinearCredentials {
	linearToken: string;
	linearWorkspaceId: string;
	linearWorkspaceName: string;
}

/**
 * Workspace information for issue processing
 */
export interface Workspace {
	path: string;
	isGitWorktree: boolean;
}

/**
 * Re-export EdgeConfig from bobs-factory-core for convenience
 */
export type { EdgeConfig };
