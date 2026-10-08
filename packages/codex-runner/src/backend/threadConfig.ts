import type { CodexConfigOverrides } from "../types.js";
import type { ResolvedCodexConfig } from "./types.js";

/** The native thread config and app-server reloads must share profile definitions. */
export function buildCodexThreadConfig(
	config: ResolvedCodexConfig,
): CodexConfigOverrides {
	const base: CodexConfigOverrides = { ...config.configOverrides };
	const sandbox = config.sandbox;
	if (sandbox.kind === "profile") {
		base.permissions = {
			[sandbox.profileId]: {
				...(sandbox.extends ? { extends: sandbox.extends } : {}),
				...(sandbox.workspaceRoots?.length && {
					workspace_roots: Object.fromEntries(
						sandbox.workspaceRoots.map((root) => [root, true]),
					),
				}),
				filesystem: { ...sandbox.filesystem },
				network: { enabled: sandbox.networkAccess },
			},
		};
	} else if (sandbox.mode === "workspace-write") {
		base.sandbox_workspace_write = {
			network_access: sandbox.networkAccess,
			...(sandbox.writableRoots.length > 0
				? { writable_roots: [...sandbox.writableRoots] }
				: {}),
		};
	}
	return base;
}
