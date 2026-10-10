import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EdgeConfigSchema, factoryRuntimeIdentity } from "bobs-factory-core";
import { WorkflowRuntime } from "../factory/WorkflowRuntime.js";
/** Called only against an isolated copied home. Never resume or launch agents. */
export function preflightFactoryState(home: string) {
	const config = join(home, "config.json");
	if (existsSync(config))
		EdgeConfigSchema.parse(JSON.parse(readFileSync(config, "utf8")));
	const forbidden = async () => {
		throw new Error("State preflight must never execute workflow work");
	};
	const runtime = new WorkflowRuntime(home, {
		agent: forbidden,
		script: forbidden,
		tool: forbidden,
	});
	return {
		stateCompatible: true as const,
		runtime: factoryRuntimeIdentity,
		runIds: [...runtime.runs.keys()].sort(),
		workflows: runtime.listWorkflows().map((w) => w.id),
	};
}
