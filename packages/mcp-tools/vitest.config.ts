import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"bobs-factory-mcp-tools": fileURLToPath(
				new URL("./src/index.ts", import.meta.url),
			),
			"bobs-factory-codex-runner": fileURLToPath(
				new URL("../codex-runner/src/index.ts", import.meta.url),
			),
		},
	},
});
