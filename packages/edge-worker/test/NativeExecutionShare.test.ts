import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
	account: "native@example.test",
	inspect: vi.fn(),
}));
vi.mock("cyrus-codex-runner", async (original) => ({
	...(await original<any>()),
	inspectCodexNativeLogin: native.inspect,
}));
vi.mock("../src/factory/ExecutionCapabilities.js", async (original) => ({
	...(await original<any>()),
	executionCapabilities: () => ({
		binary: "native-claude-test",
		version: "2.1.281",
	}),
}));
vi.mock("node:child_process", async (original) => {
	const actual = await original<typeof import("node:child_process")>();
	return {
		...actual,
		execFileSync: (...args: any[]) =>
			args[0] === "native-claude-test"
				? JSON.stringify({
						loggedIn: true,
						authMethod: "claude.ai",
						email: native.account,
					})
				: (actual.execFileSync as any)(...args),
	};
});

import { ExecutionEnvironmentResolver } from "../src/factory/ExecutionEnvironment.js";
import {
	IdentityProfileSchema,
	ToolProfileSchema,
} from "../src/factory/ExecutionProfiles.js";

const roots: string[] = [];
afterEach(() => {
	native.account = "native@example.test";
	vi.clearAllMocks();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function fixture(runner: "claude" | "codex") {
	const root = mkdtempSync(join(tmpdir(), "native-share-"));
	roots.push(root);
	execFileSync("git", ["init", "-q", root]);
	const configDirectory = join(root, "existing-login");
	mkdirSync(configDirectory);
	writeFileSync(join(configDirectory, "auth.json"), "native-store-canary");
	const identity = IdentityProfileSchema.parse({
		id: "native",
		revision: 1,
		name: "Native account",
		author: {
			mode: "factory-only",
			value: { name: "Factory", email: "factory@example.test" },
		},
		committer: {
			mode: "factory-only",
			value: { name: "Integrator", email: "integrator@example.test" },
		},
		signing: { format: "disabled" },
		repositories: [],
		runners: {
			[runner]: {
				kind: "native-login",
				mode: "share",
				provider: runner === "claude" ? "anthropic" : "openai",
				configDirectory,
				account: "native@example.test",
			},
		},
	});
	const tools = ToolProfileSchema.parse({
		id: "shared",
		revision: 1,
		name: "Shared tools",
		mode: "share",
		mcp: { declared: { type: "stdio", command: "node" } },
	});
	const snapshot = {
		schemaVersion: 1 as const,
		identity,
		tools,
		sources: { identity: "manual" as const, tools: "manual" as const },
	};
	const resolver = new ExecutionEnvironmentResolver(join(root, "factory"), {
		PATH: process.env.PATH,
		HOME: root,
		USER: "native-user",
		LOGNAME: "native-user",
		OPENAI_API_KEY: "wrong-account",
		ANTHROPIC_API_KEY: "wrong-account",
		CLAUDE_CODE_OAUTH_TOKEN: "wrong-account",
		CODEX_HOME: "/unselected",
	});
	native.inspect.mockResolvedValue({
		account: native.account,
		mcp: ["unselectedNative"],
	});
	return { root, configDirectory, snapshot, resolver };
}
it.each([
	"claude",
	"codex",
] as const)("reuses %s's selected native store with shared tools and independent factory Git", async (runner) => {
	const { root, configDirectory, snapshot, resolver } = fixture(runner);
	const parent = { ...process.env };
	const resolved = await resolver.resolve(
		snapshot,
		"native-share",
		root,
		runner,
	);
	expect(
		resolved.environment[
			runner === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME"
		],
	).toBe(configDirectory);
	if (runner === "codex") expect(resolved.environment.HOME).not.toBe(root);
	else expect(resolved.environment.HOME).toBe(root);
	for (const key of [
		"OPENAI_API_KEY",
		"ANTHROPIC_API_KEY",
		"CLAUDE_CODE_OAUTH_TOKEN",
	])
		expect(resolved.environment[key]).toBeUndefined();
	expect(resolved.git).toMatchObject({
		author: "Factory <factory@example.test>",
		committer: "Integrator <integrator@example.test>",
	});
	expect(Object.keys(resolved.mcp)).toEqual(["declared"]);
	if (runner === "codex")
		expect(resolved.disabledMcp).toContain("unselectedNative");
	const config: any = { cyrusHome: root };
	resolver.apply(config, snapshot, resolved);
	expect(config.strictMcpConfig).toBe(true);
	expect(config.settingSources).toEqual([]);
	expect(config.mcpConfig.declared.command).toBe("node");
	resolver.cleanupCredentials("native-share");
	expect(readFileSync(join(configDirectory, "auth.json"), "utf8")).toBe(
		"native-store-canary",
	);
	expect(
		existsSync(join(resolved.environment.HOME!, ".codex", "auth.json")),
	).toBe(false);
	expect(JSON.stringify(snapshot)).not.toContain("native-store-canary");
	expect(process.env).toEqual(parent);
	native.account = "other@example.test";
	native.inspect.mockResolvedValue({ account: native.account, mcp: [] });
	await expect(
		resolver.resolve(snapshot, "native-share", root, runner),
	).rejects.toThrow("differs from the accepted account");
});
it("rejects native login with private/overlay tools before materialization", async () => {
	const { root, snapshot, resolver } = fixture("codex");
	snapshot.tools.mode = "factory-only";
	await expect(
		resolver.resolve(snapshot, "unsupported", root, "codex"),
	).rejects.toThrow("only for Claude/Codex with Share tools");
	expect(
		existsSync(join(root, "factory", "execution-private", "unsupported")),
	).toBe(false);
});
it("requires a selected native root/account and rejects secret-copy fields", () => {
	const { snapshot } = fixture("claude");
	for (const auth of [
		{ kind: "native-login", mode: "factory-only", provider: "anthropic" },
		{
			kind: "native-login",
			mode: "share",
			provider: "anthropic",
			configDirectory: "/host",
		},
	])
		expect(() =>
			IdentityProfileSchema.parse({
				...snapshot.identity,
				runners: { claude: auth },
			}),
		).toThrow("Native login requires");
});
