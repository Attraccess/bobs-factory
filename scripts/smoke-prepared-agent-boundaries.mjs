import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
	options: {
		"source-root": { type: "string" },
		binary: { type: "string" },
		output: { type: "string" },
		"allow-dirty-development": { type: "boolean", default: false },
	},
});
assert(values.binary && values.output, "Provide --binary and --output");
const binary = realpathSync(values.binary);
const build = JSON.parse(readFileSync(join(dirname(binary), "build.json")));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(build.product, "bobs-factory");
assert.equal(build.target, `${platform()}-${arch()}`);
assert.equal(build.executable.sha256, hash(readFileSync(binary)));
assert(
	!build.dirty || values["allow-dirty-development"],
	"Release smoke requires a clean build",
);
const root = values["source-root"]
	? resolve(values["source-root"])
	: resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "factory-prepared-boundaries-"));
const sdk = join(work, "sdk"),
	workspace = join(work, "workspace"),
	home = join(work, "home");
for (const directory of [sdk, workspace, home])
	mkdirSync(directory, { mode: 0o700 });
// This deliberately synthetic SDK is fixture material, never copied into the archive.
writeFileSync(
	join(sdk, "package.json"),
	JSON.stringify({
		name: "@cursor/sdk",
		version: "1.0.19",
		type: "commonjs",
		exports: "./index.js",
	}),
);
writeFileSync(
	join(sdk, "index.js"),
	`
const assert = require('node:assert/strict');
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const agent = (id, options) => ({ agentId: id, close() { appendFileSync(join(options.local.cwd[0], 'closed'), id + '\\n'); } });
exports.Agent = {
  async create(options) { const id = 'synthetic-native-session'; writeFileSync(join(options.local.cwd[0], 'session'), id); return agent(id, options); },
  async resume(id, options) { assert.equal(readFileSync(join(options.local.cwd[0], 'session'), 'utf8'), id); writeFileSync(join(options.local.cwd[0], 'resumed'), id); return agent(id, options); }
};
`,
);
const environment = {
	HOME: home,
	TMPDIR: work,
	PATH: "/usr/bin:/bin",
	BOBS_FACTORY_HOME: join(home, "state"),
	BOBS_FACTORY_SENTRY_DISABLED: "1",
	BOBS_FACTORY_CURSOR_SDK_PATH: sdk,
	BOBS_FACTORY_CURSOR_NODE: process.execPath,
};
const suites = {
	claude: [
		"ClaudeRunner.test.ts",
		"env-isolation.test.ts",
		"spawn-claude-code-process.test.ts",
		"pending-work-lifecycle.test.ts",
	],
	codex: [
		"AppServerCodexBackend.test.ts",
		"appServerProcess.test.ts",
		"CodexRunner.startup.test.ts",
		"CodexRunner.streaming.test.ts",
		"CodexRunner.mcp-config.test.ts",
	],
	gemini: ["GeminiRunner.test.ts", "SimpleGeminiRunner.test.ts"],
	opencode: [
		"OpenCodeRunner.test.ts",
		"OpenCodeRunner.environment.test.ts",
		"formatter.replay.test.ts",
	],
	cursor: [
		"prepared-sdk.test.ts",
		"CursorWorkerRunner.test.ts",
		"CursorRunner.environment.test.ts",
	],
};
try {
	const output = execFileSync(
		binary,
		["internal", "cursor-storage", workspace],
		{ env: environment, encoding: "utf8", timeout: 30000 },
	);
	assert(output.includes("Cursor SDK storage/create/resume passed"));
	assert.equal(
		readFileSync(join(workspace, "resumed"), "utf8"),
		"synthetic-native-session",
	);
	assert.deepEqual(
		readFileSync(join(workspace, "closed"), "utf8").trim().split("\n"),
		["synthetic-native-session", "synthetic-native-session"],
	);
	const adapters = {};
	const testEnvironment = {
		HOME: home,
		TMPDIR: work,
		PATH: process.env.PATH,
		CI: "true",
		BOBS_FACTORY_SENTRY_DISABLED: "1",
		BOBS_FACTORY_HOME: join(home, "state"),
		...(process.env.COREPACK_HOME
			? { COREPACK_HOME: process.env.COREPACK_HOME }
			: {}),
	};
	for (const [runner, files] of Object.entries(suites)) {
		const report = join(work, `${runner}.json`);
		execFileSync(
			"pnpm",
			[
				"exec",
				"vitest",
				"run",
				...files.map((file) => `test/${file}`),
				"--reporter=json",
				`--outputFile=${report}`,
			],
			{
				cwd: join(root, "packages", `${runner}-runner`),
				env: testEnvironment,
				encoding: "utf8",
				maxBuffer: 32 * 1024 * 1024,
				timeout: 180000,
			},
		);
		const result = JSON.parse(readFileSync(report));
		assert.equal(
			result.success,
			true,
			`${runner} protocol boundary checks failed`,
		);
		assert(result.numPassedTests > 0 && result.numFailedTests === 0);
		adapters[runner] = {
			status: "passed",
			passed: result.numPassedTests,
			skipped: result.numPendingTests,
			files,
			reportSha256: hash(readFileSync(report)),
		};
	}
	const receipt = {
		schemaVersion: 1,
		product: "bobs-factory",
		validation: "prepared-agent-boundaries",
		status: "passed",
		version: build.version,
		candidateDigest: build.candidateDigest,
		workflowSha: build.workflowSha,
		commit: build.commit,
		target: build.target,
		dirty: build.dirty,
		resourceDigest: build.resourceDigest,
		executableSha256: build.executable.sha256,
		scope: {
			agents: "synthetic-sdk-and-mocked-adapters",
			authenticatedProviders: false,
			agentInference: "none",
		},
		compiledCursorIpcCreateResume: "passed",
		adapterCheckout: {
			commit: execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: root,
				encoding: "utf8",
			}).trim(),
			dirty:
				execFileSync("git", ["status", "--porcelain"], {
					cwd: root,
					encoding: "utf8",
				}).trim().length > 0,
		},
		adapters,
	};
	mkdirSync(resolve(values.output), { recursive: true });
	writeFileSync(
		join(resolve(values.output), "prepared-agent-boundaries.json"),
		`${JSON.stringify(receipt, null, 2)}\n`,
		{ flag: "wx" },
	);
	console.log(
		`Prepared agent boundaries passed on ${build.target}; synthetic Cursor IPC and mocked adapters; authenticated-provider execution not tested`,
	);
} finally {
	rmSync(work, { recursive: true, force: true });
}
