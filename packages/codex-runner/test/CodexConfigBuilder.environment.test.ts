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
	const resolved = await new CodexConfigBuilder({
		factoryHome: directory,
		workingDirectory: directory,
		childEnvironment,
	}).build();
	expect(resolved.env).toEqual(childEnvironment);
	expect(resolved.codexHome).toBe(childEnvironment.CODEX_HOME);
	expect(process.env.OPENAI_API_KEY).toBe("host-key");
});
