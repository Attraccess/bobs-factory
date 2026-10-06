import { CursorRunner } from "./CursorRunner.js";
import type { CursorRunnerConfig } from "./types.js";

let runner: CursorRunner | undefined;
const send = (value: unknown) => {
	if (process.connected) process.send?.(value);
};
process.on("message", async (value: unknown) => {
	const request = value as {
		type: string;
		config: CursorRunnerConfig;
		prompt: string;
	};
	if (request.type === "stop") {
		runner?.stop();
		return;
	}
	if (request.type !== "start" || runner) return;
	try {
		runner = new CursorRunner({
			...request.config,
			childEnvironment: undefined,
			onMessage: (message) => send({ type: "message", message }),
			onError: (error) => send({ type: "error", error: error.message }),
			onComplete: () => send({ type: "complete" }),
		});
		const info = await runner.start(request.prompt);
		send({ type: "result", info });
	} catch (error) {
		send({
			type: "failed",
			error: error instanceof Error ? error.message : "Cursor worker failed",
		});
	}
});
process.on("disconnect", () => {
	runner?.stop();
	process.exit(0);
});
