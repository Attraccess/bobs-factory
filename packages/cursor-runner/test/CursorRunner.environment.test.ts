import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

// Observe the real worker boundary; the worker's existing mock mode avoids SDK
// provider calls while proving additions arrive in a fresh, dedicated process.
vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return { ...actual, fork: vi.fn(actual.fork) };
});

import { fork } from "node:child_process";
import { CursorRunner } from "../dist/CursorRunner.js";

const directories: string[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	vi.clearAllMocks();
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

it.each([
	"native",
	"isolated",
] as const)("passes scoped Git credentials into a real %s SDK worker without changing host discovery", async (mode) => {
	const directory = mkdtempSync(join(tmpdir(), "cursor-native-env-"));
	directories.push(directory);
	vi.stubEnv("GH_TOKEN", "ambient-token");
	vi.stubEnv("FACTORY_AMBIENT_CANARY", "host-only");
	vi.stubEnv("XDG_CONFIG_HOME", join(directory, "native-config"));
	vi.stubEnv("BOBS_FACTORY_CURSOR_MOCK", "0");
	const childEnvironment =
		mode === "isolated"
			? { HOME: directory, PATH: process.env.PATH! }
			: undefined;
	const additionalEnv = {
		BOBS_FACTORY_CURSOR_MOCK: "1",
		GH_TOKEN: "selected-token",
		BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND: "/prepared/bobs-factory",
		BOBS_FACTORY_GITHUB_TOKENS: JSON.stringify([
			{
				host: "github.com",
				project: "fixture/project",
				token: "private-token",
			},
		]),
		GIT_CONFIG_COUNT: "1",
		GIT_CONFIG_KEY_0: "credential.helper",
		GIT_CONFIG_VALUE_0: "!/prepared/bobs-factory git-credential",
	};
	const runner = new CursorRunner({
		workingDirectory: directory,
		factoryHome: directory,
		childEnvironment,
		additionalEnv,
	});
	const result = await runner.start("environment fixture");
	expect(result.isRunning).toBe(false);
	expect(runner.getMessages().map((message) => message.type)).toEqual([
		"system",
		"assistant",
		"result",
	]);
	const env = vi.mocked(fork).mock.calls[0]?.[2]?.env;
	expect(env).toMatchObject(additionalEnv);
	expect(env?.HOME).toBe(childEnvironment?.HOME ?? process.env.HOME);
	expect(env?.XDG_CONFIG_HOME).toBe(
		mode === "native" ? process.env.XDG_CONFIG_HOME : undefined,
	);
	expect(env?.FACTORY_AMBIENT_CANARY).toBe(
		mode === "native" ? "host-only" : undefined,
	);
	expect(process.env.GH_TOKEN).toBe("ambient-token");
	expect(process.env.BOBS_FACTORY_CURSOR_MOCK).toBe("0");
}, 20_000);
