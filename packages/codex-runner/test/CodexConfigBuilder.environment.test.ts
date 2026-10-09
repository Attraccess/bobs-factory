import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CodexConfigBuilder } from "../src/config/CodexConfigBuilder.js";

const directories: string[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
it("uses the selected complete environment for the app-server without inheriting a host key", async () => {
	const directory = mkdtempSync(join(tmpdir(), "codex-execution-"));
	directories.push(directory);
	vi.stubEnv("OPENAI_API_KEY", "host-key");
	vi.stubEnv("FACTORY_AMBIENT_CANARY", "host-only");
	const childEnvironment = {
		HOME: directory,
		CODEX_HOME: join(directory, "codex"),
		OPENAI_API_KEY: "selected-key",
	};
	const additionalEnv = {
		BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND: "/prepared/bobs-factory",
	};
	const resolved = await new CodexConfigBuilder({
		factoryHome: directory,
		workingDirectory: directory,
		childEnvironment,
		additionalEnv,
	}).build();
	expect(resolved.env).toEqual({ ...childEnvironment, ...additionalEnv });
	expect(resolved.codexHome).toBe(childEnvironment.CODEX_HOME);
	expect(process.env.OPENAI_API_KEY).toBe("host-key");
});

it("passes native Git credentials and helpers without replacing native home discovery", async () => {
	const directory = mkdtempSync(join(tmpdir(), "codex-native-env-"));
	directories.push(directory);
	vi.stubEnv("CODEX_HOME", join(directory, "existing-codex"));
	vi.stubEnv("GH_TOKEN", "ambient-token");
	const nativeHome = process.env.HOME;
	const config = {
		factoryHome: directory,
		workingDirectory: directory,
		additionalEnv: {
			GH_TOKEN: "selected-token",
			BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND: "/prepared/bobs-factory",
			GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "credential.helper",
			GIT_CONFIG_VALUE_0: "!/prepared/bobs-factory git-credential",
		},
	};
	const resolved = await new CodexConfigBuilder(config).build();
	expect(resolved.env).toMatchObject({
		...config.additionalEnv,
		HOME: nativeHome,
		CODEX_HOME: process.env.CODEX_HOME,
	});
	expect(resolved.codexHome).toBe(process.env.CODEX_HOME);
	expect(config).not.toHaveProperty("childEnvironment");
	expect(process.env.GH_TOKEN).toBe("ambient-token");
	expect(process.env).not.toHaveProperty(
		"BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND",
	);
});

it("keeps native CODEX_HOME unset when only a Git environment addition is requested", async () => {
	const directory = mkdtempSync(join(tmpdir(), "codex-native-discovery-"));
	directories.push(directory);
	vi.stubEnv("CODEX_HOME", undefined);
	const resolved = await new CodexConfigBuilder({
		factoryHome: directory,
		workingDirectory: directory,
		additionalEnv: { GH_TOKEN: "selected-token" },
	}).build();
	expect(resolved.env?.GH_TOKEN).toBe("selected-token");
	expect(resolved.env).not.toHaveProperty("CODEX_HOME");
	expect(resolved.env?.HOME).toBe(process.env.HOME);
});
