import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Application } from "./Application.js";
import { bootstrap } from "./bootstrap.js";
import { loadEnvFile } from "./envFile.js";

const roots: string[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

it("reloads Application values initially loaded by bootstrap", () => {
	vi.stubEnv("BOBS_FACTORY_DEFAULT_RUNNER", undefined);
	vi.stubEnv("BOBS_FACTORY_LOG_LEVEL", "host");
	const home = mkdtempSync(join(tmpdir(), "factory-env-application-"));
	roots.push(home);
	const path = join(home, ".env");
	writeFileSync(
		path,
		"BOBS_FACTORY_DEFAULT_RUNNER=claude\nBOBS_FACTORY_LOG_LEVEL=file\n",
	);
	bootstrap(["--home", home]);
	const application = new Application(home) as unknown as {
		loadEnvFile(): void;
		envWatcher: { close(): void };
	};
	try {
		writeFileSync(
			path,
			"BOBS_FACTORY_DEFAULT_RUNNER=codex\nBOBS_FACTORY_LOG_LEVEL=changed\n",
		);
		application.loadEnvFile();
		expect(process.env.BOBS_FACTORY_DEFAULT_RUNNER).toBe("codex");
		expect(process.env.BOBS_FACTORY_LOG_LEVEL).toBe("host");
	} finally {
		application.envWatcher.close();
	}
});

it("reloads bootstrap-owned values while preserving inherited and later external overrides", () => {
	const home = mkdtempSync(join(tmpdir(), "factory-env-"));
	roots.push(home);
	const path = join(home, ".env");
	const env: NodeJS.ProcessEnv = { BOBS_FACTORY_LOG_LEVEL: "host" };
	writeFileSync(
		path,
		"BOBS_FACTORY_DEFAULT_RUNNER=claude\nBOBS_FACTORY_LOG_LEVEL=file\nBOBS_FACTORY_SETUP_PENDING=1\n",
	);
	bootstrap(["--home", home], env);
	expect(env).toEqual({
		BOBS_FACTORY_LOG_LEVEL: "host",
		BOBS_FACTORY_DEFAULT_RUNNER: "claude",
		BOBS_FACTORY_SETUP_PENDING: "1",
	});
	writeFileSync(
		path,
		"BOBS_FACTORY_DEFAULT_RUNNER=codex\nBOBS_FACTORY_LOG_LEVEL=changed\n",
	);
	loadEnvFile(path, env);
	expect(env).toEqual({
		BOBS_FACTORY_LOG_LEVEL: "host",
		BOBS_FACTORY_DEFAULT_RUNNER: "codex",
	});
	env.BOBS_FACTORY_DEFAULT_RUNNER = "external";
	loadEnvFile(path, env);
	expect(env.BOBS_FACTORY_DEFAULT_RUNNER).toBe("external");
	rmSync(path);
	loadEnvFile(path, env);
	expect(env).toEqual({
		BOBS_FACTORY_LOG_LEVEL: "host",
		BOBS_FACTORY_DEFAULT_RUNNER: "external",
	});
});

it("retains the last successful values through an unreadable reload", () => {
	const home = mkdtempSync(join(tmpdir(), "factory-env-read-failure-"));
	roots.push(home);
	const path = join(home, ".env");
	const env: NodeJS.ProcessEnv = {};
	writeFileSync(path, "BOBS_FACTORY_DEFAULT_RUNNER=claude\n");
	loadEnvFile(path, env);
	rmSync(path);
	mkdirSync(path); // A directory is not a readable dotenv file.
	expect(() => loadEnvFile(path, env)).not.toThrow();
	expect(env.BOBS_FACTORY_DEFAULT_RUNNER).toBe("claude");
	rmSync(path, { recursive: true });
	writeFileSync(path, "BOBS_FACTORY_DEFAULT_RUNNER=codex\n");
	loadEnvFile(path, env);
	expect(env.BOBS_FACTORY_DEFAULT_RUNNER).toBe("codex");
});
