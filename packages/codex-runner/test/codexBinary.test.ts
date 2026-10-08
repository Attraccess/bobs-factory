import { describe, expect, it } from "vitest";
import { resolveCodexAppServerLaunch } from "../src/backend/codexBinary.js";

const APP_SERVER_ARGS = ["app-server", "--listen", "stdio://"];

describe("resolveCodexAppServerLaunch", () => {
	it("launches an explicit override binary directly", () => {
		expect(resolveCodexAppServerLaunch("/opt/codex")).toEqual({
			command: "/opt/codex",
			args: APP_SERVER_ARGS,
		});
	});

	it("launches the prepared CLI without treating the factory executable as Node", () => {
		expect(resolveCodexAppServerLaunch()).toEqual({
			command: "codex",
			args: APP_SERVER_ARGS,
		});
	});

	it("encodes launch overrides as TOML without splitting path or profile keys", () => {
		expect(
			resolveCodexAppServerLaunch("/opt/codex", {
				permissions: {
					"factory.profile": {
						filesystem: { '/tmp/a "quoted"/repo.git': "write" },
						network: { enabled: true },
						workspace_roots: { "/tmp/repo": true },
					},
				},
				default_permissions: "factory.profile",
			}),
		).toEqual({
			command: "/opt/codex",
			args: [
				...APP_SERVER_ARGS,
				"-c",
				'default_permissions="factory.profile"',
				"-c",
				'permissions={"factory.profile" = {"filesystem" = {"/tmp/a \\"quoted\\"/repo.git" = "write"}, "network" = {"enabled" = true}, "workspace_roots" = {"/tmp/repo" = true}}}',
			],
		});
	});
});
