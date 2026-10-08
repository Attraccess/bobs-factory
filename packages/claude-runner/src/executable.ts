import { createRequire } from "node:module";
import { isPackagedExecutable, preparedExecutable } from "bobs-factory-core";

/** Resolve the same CLI for capability inspection and SDK execution. */
export function resolveClaudeExecutable(override?: string): string {
	if (override || isPackagedExecutable)
		return preparedExecutable(override || "claude");
	const require = createRequire(import.meta.url);
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
		return localRequire.resolve(
			`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${libcSuffix}/claude${suffix}`,
		);
	} catch {
		throw new Error(
			"Claude SDK native executable unavailable. Install its matching optional dependency before selecting a profile",
		);
	}
}
