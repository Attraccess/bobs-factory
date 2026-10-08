import { afterEach, expect, it, vi } from "vitest";
import { executionCapabilities } from "../src/factory/ExecutionCapabilities.js";

const { exec, claude, codex, cursor } = vi.hoisted(() => ({
	exec: vi.fn(),
	claude: vi.fn(() => "/prepared/claude"),
	codex: vi.fn(() => ({ command: "/prepared/codex", args: ["app-server"] })),
	cursor: vi.fn(() => ({
		sdk: "/prepared/cursor-sdk",
		node: "/prepared/node",
		version: "1.0.19",
	})),
}));
vi.mock("node:child_process", () => ({ execFileSync: exec }));
vi.mock("bobs-factory-claude-runner", () => ({
	resolveClaudeExecutable: claude,
}));
vi.mock("bobs-factory-codex-runner", () => ({
	resolveCodexAppServerLaunch: codex,
}));
vi.mock("bobs-factory-cursor-runner", () => ({
	resolveCursorInstallation: cursor,
}));
afterEach(() => {
	vi.clearAllMocks();
});

it.each([
	{ runner: "claude" as const, binary: "/prepared/claude", version: "2.1.281" },
	{
		runner: "codex" as const,
		binary: "/prepared/codex",
		version: "codex-cli 0.159.2",
	},
])("checks the executable selected by the $runner adapter", ({
	runner,
	binary,
	version,
}) => {
	exec.mockReturnValue(version);
	expect(executionCapabilities(runner)).toEqual({ binary, version });
	expect(exec).toHaveBeenCalledWith(
		binary,
		["--version"],
		expect.objectContaining({ timeout: 15000 }),
	);
});
it("rejects an unsupported PATH Codex rather than validating a different checkout version", () => {
	exec.mockReturnValue("codex-cli 0.160.1");
	expect(() => executionCapabilities("codex")).toThrow("expected 0.159.2");
});
it("reports the prepared Cursor SDK and checks its selected Node", () => {
	exec.mockReturnValue("v24.21.0");
	expect(executionCapabilities("cursor")).toEqual({
		binary: "/prepared/cursor-sdk (isolated worker; /prepared/node)",
		version: "1.0.19",
	});
	expect(exec).toHaveBeenCalledWith(
		"/prepared/node",
		["--version"],
		expect.any(Object),
	);
});
it.each([
	"v22.12.0",
	"v20.19.0",
	"invalid",
])("rejects unsupported prepared Cursor Node %s", (version) => {
	exec.mockReturnValue(version);
	expect(() => executionCapabilities("cursor")).toThrow("Node >=22.13");
});
