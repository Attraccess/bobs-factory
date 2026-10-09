import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { OpenCodeRunner } from "../src/OpenCodeRunner.js";

const directories: string[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

it.each([
	"native",
	"isolated",
] as const)("delivers Git/helper environment to the real %s child and preserves its config roots", async (mode) => {
	const directory = mkdtempSync(join(tmpdir(), "opencode-native-env-"));
	directories.push(directory);
	vi.stubEnv("GH_TOKEN", "ambient-token");
	vi.stubEnv("FACTORY_AMBIENT_CANARY", "host-only");
	vi.stubEnv("XDG_CONFIG_HOME", join(directory, "native-config"));
	const capture = join(directory, "environment.json");
	const executable = join(directory, "fake-opencode.mjs");
	writeFileSync(
		executable,
		`#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
readFileSync(0, "utf8");
writeFileSync(${JSON.stringify(capture)}, JSON.stringify(Object.fromEntries([
  "HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "FACTORY_AMBIENT_CANARY", "GH_TOKEN",
  "BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND", "BOBS_FACTORY_GITHUB_TOKENS",
  "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"
].map(key => [key, process.env[key]]))));
`,
		{ mode: 0o755 },
	);
	const childEnvironment =
		mode === "isolated"
			? { HOME: directory, PATH: process.env.PATH! }
			: undefined;
	const additionalEnv = {
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
	const runner = new OpenCodeRunner({
		factoryHome: directory,
		workingDirectory: directory,
		openCodePath: executable,
		childEnvironment,
		additionalEnv,
	});
	const result = await runner.start("environment fixture");
	expect(result.isRunning).toBe(false);
	const environment = JSON.parse(readFileSync(capture, "utf8"));
	expect(environment).toMatchObject(additionalEnv);
	expect(environment.HOME).toBe(childEnvironment?.HOME ?? process.env.HOME);
	expect(environment.XDG_CONFIG_HOME).toBe(
		mode === "native" ? process.env.XDG_CONFIG_HOME : undefined,
	);
	expect(environment.XDG_DATA_HOME).toBe(
		mode === "native" ? process.env.XDG_DATA_HOME : undefined,
	);
	expect(environment.FACTORY_AMBIENT_CANARY).toBe(
		mode === "native" ? "host-only" : undefined,
	);
	expect(process.env.GH_TOKEN).toBe("ambient-token");
});
