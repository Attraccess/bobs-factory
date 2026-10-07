import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { AgentRunnerConfig, RunnerType } from "bobs-factory-core";
import type { ExecutionSnapshot } from "./ExecutionProfiles.js";

/** Version gates are deliberately explicit; native source suppression is not portable across releases. */
export function executionCapabilities(runner: RunnerType): {
	binary: string;
	version: string;
} {
	const require = createRequire(import.meta.url);
	if (runner === "cursor") {
		const sdk = require.resolve("bobs-factory-cursor-runner");
		const localRequire = createRequire(sdk);
		const entry = localRequire.resolve("@cursor/sdk");
		const version = JSON.parse(
			readFileSync(join(dirname(entry), "..", "..", "package.json"), "utf8"),
		).version as string;
		if (version !== "1.0.19")
			throw new Error(
				"Cursor execution profiles require capability-tested SDK 1.0.19",
			);
		return { binary: "@cursor/sdk (isolated worker)", version };
	}
	let binary = runner as string;
	let args = ["--version"];
	if (runner === "codex") {
		const localRequire = createRequire(
			require.resolve("bobs-factory-codex-runner"),
		);
		const file = localRequire.resolve("@openai/codex/package.json");
		const pkg = localRequire(file);
		binary = process.execPath;
		args = [
			join(
				dirname(file),
				typeof pkg.bin === "string" ? pkg.bin : pkg.bin.codex,
			),
			"--version",
		];
	} else if (runner === "claude") {
		const sdk = require.resolve("@anthropic-ai/claude-agent-sdk");
		const localRequire = createRequire(sdk);
		const suffix = process.platform === "win32" ? ".exe" : "";
		let libcSuffix = "";
		if (process.platform === "linux") {
			// Only Linux needs libc detection. Node reports otherwise inspect open
			// sockets and can block on reverse DNS before the executable timeout.
			// Available since Node 20.13; the workspace's Node 20 typings lag it.
			const diagnostic = process.report as typeof process.report & {
				excludeNetwork: boolean;
			};
			const excludeNetwork = diagnostic.excludeNetwork;
			try {
				diagnostic.excludeNetwork = true;
				const report = diagnostic.getReport() as {
					header?: { glibcVersionRuntime?: string };
				};
				if (!report.header?.glibcVersionRuntime) libcSuffix = "-musl";
			} finally {
				diagnostic.excludeNetwork = excludeNetwork;
			}
		}
		try {
			binary = localRequire.resolve(
				`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${libcSuffix}/claude${suffix}`,
			);
		} catch {
			throw new Error(
				"Claude SDK native executable unavailable. Install its matching optional dependency before selecting a profile",
			);
		}
		args = ["--version"];
	}
	let version: string;
	try {
		version = execFileSync(binary, args, {
			encoding: "utf8",
			timeout: 15000,
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	} catch {
		throw new Error(
			`${runner} executable unavailable. Install a supported CLI before selecting an execution profile`,
		);
	}
	const expected = {
		claude: "2.1.281",
		codex: "0.159.2",
		gemini: "0.17.0",
		opencode: "1.18.33",
	}[runner];
	if (version.match(/\d+\.\d+\.\d+(?:-[^\s]+)?/)?.[0] !== expected)
		throw new Error(
			`${runner} version ${version} has not been capability-tested for execution profiles; expected ${expected}`,
		);
	return { binary: [binary, ...args.slice(0, -1)].join(" "), version };
}

/** Reject requests the installed adapter cannot faithfully enforce, before constructing a runner. */
export function validateProfileRunner(
	config: AgentRunnerConfig,
	snapshot: ExecutionSnapshot,
	runner: RunnerType,
): void {
	const auth = snapshot.identity?.runners[runner];
	const expected = {
		claude: "anthropic",
		codex: "openai",
		gemini: "google",
		cursor: "cursor",
	};
	if (!auth || (runner !== "opencode" && auth.provider !== expected[runner]))
		throw new Error(
			`${runner} requires its matching explicit API credential binding`,
		);
	if (
		auth.kind === "native-login" &&
		(!["claude", "codex"].includes(runner) ||
			auth.mode !== "share" ||
			snapshot.tools?.mode !== "share")
	)
		throw new Error(
			"Native login Share is supported only for Claude/Codex with Share tools. Select an API binding for private tools",
		);
	if (runner === "opencode" && auth.provider === "cursor")
		throw new Error(
			"OpenCode profiles require a first-party Anthropic, OpenAI or Google API binding",
		);
	if (
		runner === "opencode" &&
		config.model &&
		!config.model.startsWith(`${auth.provider}/`)
	)
		throw new Error(
			"OpenCode model provider differs from the accepted identity binding",
		);
}
