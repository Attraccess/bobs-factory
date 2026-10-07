import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AppServerCodexBackend } from "../src/backend/AppServerCodexBackend.js";
import { CodexRunner } from "../src/CodexRunner.js";

const homes: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function runner(resumeSessionId?: string) {
	const home = mkdtempSync(join(tmpdir(), "codex-startup-"));
	homes.push(home);
	vi.spyOn(AppServerCodexBackend.prototype, "close").mockResolvedValue();
	return new CodexRunner({
		workingDirectory: home,
		codexHome: join(home, "codex"),
		skills: [],
		resumeSessionId,
	});
}

it.each([
	"initialize timed out after 60000ms",
	"thread/start failed: unavailable",
])("does not publish a resumable session when startup fails: %s", async (error) => {
	const codex = runner();
	vi.spyOn(AppServerCodexBackend.prototype, "open").mockRejectedValue(
		new Error(error),
	);
	const turn = vi.spyOn(AppServerCodexBackend.prototype, "runTurn");
	const messages = vi.fn();
	codex.on("message", messages);
	const session = await codex.start("Run the task");
	expect(session).toMatchObject({ sessionId: null, isRunning: false });
	expect(turn).not.toHaveBeenCalled();
	expect(codex.getMessages()).toEqual([
		expect.objectContaining({
			type: "result",
			is_error: true,
			session_id: "pending",
			errors: [error],
		}),
	]);
	expect(messages).toHaveBeenCalledTimes(1);
});

it("retains a confirmed thread when its turn fails", async () => {
	const codex = runner();
	vi.spyOn(AppServerCodexBackend.prototype, "open").mockImplementation(
		async function () {
			this.emit("event", { kind: "thread-started", threadId: "real-thread" });
			return { threadId: "real-thread" };
		},
	);
	vi.spyOn(AppServerCodexBackend.prototype, "runTurn").mockRejectedValue(
		new Error("codex app-server produced no activity for 300000ms"),
	);
	expect(await codex.start("Run the task")).toMatchObject({
		sessionId: "real-thread",
	});
	expect(codex.getMessages()).toEqual([
		expect.objectContaining({
			type: "system",
			subtype: "init",
			session_id: "real-thread",
		}),
		expect.objectContaining({
			type: "result",
			is_error: true,
			session_id: "real-thread",
		}),
	]);
});

it("preserves the saved thread on a failed resume without emitting an unconfirmed init", async () => {
	const codex = runner("saved-thread");
	const open = vi
		.spyOn(AppServerCodexBackend.prototype, "open")
		.mockRejectedValue(new Error("initialize timed out after 60000ms"));
	expect(await codex.startStreaming("Continue")).toMatchObject({
		sessionId: "saved-thread",
		isRunning: false,
	});
	expect(open).toHaveBeenCalledWith(
		expect.objectContaining({ resumeSessionId: "saved-thread" }),
	);
	expect(codex.getMessages()).toEqual([
		expect.objectContaining({
			type: "result",
			is_error: true,
			session_id: "saved-thread",
		}),
	]);
});
