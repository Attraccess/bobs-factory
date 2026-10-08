import { spawn } from "node:child_process";
import { runtimeAssetPath } from "bobs-factory-core";
import { loadCursorSdk, serveCursorWorker } from "bobs-factory-cursor-runner";
import { serveFactoryContext } from "bobs-factory-mcp-tools";

/** Dispatch before logging, env loading or application bootstrap: protocol stdout is clean. */
export async function runInternal(args: string[]): Promise<void> {
	const [mode, ...rest] = args;
	if (mode === "cursor-worker") {
		serveCursorWorker();
		return;
	}
	if (mode === "factory-context") {
		await serveFactoryContext(rest[0]);
		return;
	}
	if (mode === "cursor-permission") {
		if (!rest[0])
			throw new Error("cursor-permission requires a permissions file");
		process.env.BOBS_FACTORY_CURSOR_PERMISSIONS = rest[0];
		await import(runtimeAssetPath("cursor-runner/permission-check.mjs", ""));
		return;
	}
	if (mode === "cursor-storage") {
		if (!rest[0])
			throw new Error("cursor-storage requires an isolated workspace");
		const { Agent } = await loadCursorSdk();
		const options = {
			local: { cwd: [rest[0]], sandboxOptions: { enabled: false } },
		};
		const agent = await Agent.create(options);
		const resumed = await Agent.resume(agent.agentId, options);
		if (resumed.agentId !== agent.agentId)
			throw new Error("Cursor storage continuation failed");
		agent.close();
		resumed.close();
		console.log("Cursor SDK storage/create/resume passed");
		return;
	}
	if (mode === "stdio") {
		const [cwd, command, ...argv] = rest;
		if (!cwd || !command)
			throw new Error("stdio requires a working directory and command");
		const child = spawn(command, argv, { cwd, stdio: "inherit" });
		child.on("error", (error) => {
			console.error(error.message);
			process.exit(1);
		});
		child.on("exit", (code) => process.exit(code ?? 1));
		for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
			process.on(signal, () => child.kill(signal));
		return;
	}
	throw new Error("Unknown internal helper mode");
}
