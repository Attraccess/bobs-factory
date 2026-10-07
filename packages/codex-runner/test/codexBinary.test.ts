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
});
