// Bob’s Factory's IPC adapter. Cursor's SDK and native programs are user-owned.
import { createRequire } from "node:module";
import { join } from "node:path";

const sdk = process.argv[2];
// Cursor locates its platform tools relative to argv[1]. Keep that lookup in
// the prepared installation rather than the factory's extracted resources.
process.argv[1] = join(sdk, "package.json");
const require = createRequire(process.argv[1]);
let agent;
let run;
let closing = false;
const send = (message) => {
	if (process.connected) process.send(message);
};
async function close() {
	if (closing) return;
	closing = true;
	try {
		await run?.cancel();
	} finally {
		try {
			if (agent?.[Symbol.asyncDispose]) await agent[Symbol.asyncDispose]();
			else agent?.close();
		} finally {
			if (process.connected) process.disconnect();
		}
	}
}
process.on("disconnect", () => void close().catch(() => {}));
for (const signal of ["SIGTERM", "SIGINT"]) {
	process.on(signal, () => void close().catch(() => {}));
}
process.on("message", async (message) => {
	try {
		if (message.type === "init") {
			const [major, minor] = process.versions.node.split(".").map(Number);
			if (major < 22 || (major === 22 && minor < 13))
				throw new Error(
					"Prepared Cursor SDK requires Node >=22.13; configure BOBS_FACTORY_CURSOR_NODE",
				);
			const { Agent } = require("@cursor/sdk");
			agent = message.sessionId
				? await Agent.resume(message.sessionId, message.options)
				: await Agent.create(message.options);
			send({ type: "ready", agentId: agent.agentId });
		} else if (message.type === "send") {
			run = await agent.send(message.prompt, {
				onDelta: (delta) => send({ type: "delta", delta }),
			});
			for await (const event of run.stream()) send({ type: "event", event });
			run = undefined;
			send({ type: "done" });
		} else if (message.type === "cancel") {
			await run?.cancel();
		} else if (message.type === "close") {
			await close();
		}
	} catch (error) {
		send({
			type: "error",
			error: error instanceof Error ? error.message : "Cursor SDK host failed",
		});
		await close().catch(() => {});
	}
});
