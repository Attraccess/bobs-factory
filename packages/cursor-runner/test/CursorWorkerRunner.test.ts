import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CursorWorkerRunner } from "../dist/CursorWorkerRunner.js";

// Exercise the built IPC worker with its real child process; no SDK network call.
const directories: string[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	for (const dir of directories.splice(0))
		rmSync(dir, { recursive: true, force: true });
});
it("runs two workers with independent environments and forwards native session events without mutating the host", async () => {
	vi.stubEnv("CURSOR_API_KEY", "host-canary");
	vi.stubEnv("HTTPS_PROXY", "host-proxy");
	const root = mkdtempSync(join(tmpdir(), "cursor-worker-"));
	directories.push(root);
	const make = (name: string) => {
		const workspace = mkdtempSync(join(root, `${name}-`));
		return new CursorWorkerRunner({
			workingDirectory: workspace,
			childEnvironment: {
				HOME: root,
				PATH: process.env.PATH!,
				BOBS_FACTORY_CURSOR_MOCK: "1",
				CURSOR_API_KEY: name,
			},
			allowedTools: ["Read"],
		});
	};
	const first = make("first");
	const second = make("second");
	const completed = vi.fn();
	first.on("complete", completed);
	const [a, b] = await Promise.all([
		first.start("fixture"),
		second.start("fixture"),
	]);
	expect(a.sessionId).not.toBe(b.sessionId);
	expect(a.isRunning).toBe(false);
	expect(first.getMessages().map((message) => message.type)).toEqual([
		"system",
		"assistant",
		"result",
	]);
	expect(completed).toHaveBeenCalledTimes(1);
	expect(process.env.CURSOR_API_KEY).toBe("host-canary");
	expect(process.env.HTTPS_PROXY).toBe("host-proxy");
	expect(first.isRunning()).toBe(false);
}, 20000);
it("rejects nonserializable SDK callbacks before spawning instead of dropping restrictions", async () => {
	const worker = new CursorWorkerRunner({
		childEnvironment: { PATH: process.env.PATH! },
		onAskUserQuestion: async () => ({ answered: false }),
	});
	await expect(worker.start("fixture")).rejects.toThrow("unsupported callback");
	expect(worker.isRunning()).toBe(false);
});
