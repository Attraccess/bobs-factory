import { EventEmitter } from "node:events";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CodexBackend, CodexUserInput } from "../src/backend/types.js";
import { CodexRunner } from "../src/CodexRunner.js";
import { CodexConfigBuilder } from "../src/config/CodexConfigBuilder.js";

/** Minimal fake backend for exercising runner-level streaming wiring. */
class FakeBackend extends EventEmitter implements CodexBackend {
	supportsSteer: boolean;
	steerCalls: CodexUserInput[][] = [];
	private active: boolean;
	constructor(opts: { supportsSteer: boolean; active: boolean }) {
		super();
		this.supportsSteer = opts.supportsSteer;
		this.active = opts.active;
	}
	setActive(active: boolean) {
		this.active = active;
	}
	async open() {
		return { threadId: "t" };
	}
	async runTurn() {}
	steer = vi.fn(async (input: CodexUserInput[]) => {
		this.steerCalls.push(input);
	});
	isTurnActive() {
		return this.active;
	}
	async interrupt() {}
	async close() {}
}

/** Attach a fake backend and mark the runner as running, like a live session. */
function attachRunning(runner: CodexRunner, backend: FakeBackend): void {
	(runner as unknown as { backend: CodexBackend }).backend = backend;
	(
		runner as unknown as {
			sessionInfo: { sessionId: string; startedAt: Date; isRunning: boolean };
		}
	).sessionInfo = { sessionId: "s", startedAt: new Date(), isRunning: true };
}

describe("CodexRunner streaming input selection", () => {
	it("always supports streaming input (Codex runs via app-server)", () => {
		const runner = new CodexRunner({
			workingDirectory: "/tmp",
			factoryHome: "/tmp",
		});
		expect(runner.supportsStreamingInput).toBe(true);
	});

	it("steers the active turn when a stream message arrives mid-turn", () => {
		const runner = new CodexRunner({
			workingDirectory: "/tmp",
			factoryHome: "/tmp",
		});
		const backend = new FakeBackend({ supportsSteer: true, active: true });
		attachRunning(runner, backend);

		runner.addStreamMessage("fix the auth bug too");

		expect(backend.steer).toHaveBeenCalledTimes(1);
		expect(backend.steerCalls[0]).toEqual([
			{ type: "text", text: "fix the auth bug too" },
		]);
		expect(runner.isStreaming()).toBe(true);
	});

	it("buffers a follow-up that arrives before the turn is active, then flushes it on turn-started", () => {
		const runner = new CodexRunner({
			workingDirectory: "/tmp",
			factoryHome: "/tmp",
		});
		// Running, but the turn has not started yet (startup gap).
		const backend = new FakeBackend({ supportsSteer: true, active: false });
		attachRunning(runner, backend);

		// isStreaming must be true during the gap so the caller streams the
		// message in rather than deferring/dropping it.
		expect(runner.isStreaming()).toBe(true);

		runner.addStreamMessage("hows it going?");
		// Not steered yet — buffered until the turn becomes steerable.
		expect(backend.steer).not.toHaveBeenCalled();

		// Turn starts → buffered follow-up is flushed via steer.
		backend.setActive(true);
		(
			runner as unknown as {
				handleBackendEvent: (e: { kind: string }) => void;
			}
		).handleBackendEvent({ kind: "turn-started" });

		expect(backend.steer).toHaveBeenCalledTimes(1);
		expect(backend.steerCalls[0]).toEqual([
			{ type: "text", text: "hows it going?" },
		]);
	});

	it("stops streaming and rejects once the turn has finished", () => {
		const runner = new CodexRunner({
			workingDirectory: "/tmp",
			factoryHome: "/tmp",
		});
		const backend = new FakeBackend({ supportsSteer: true, active: false });
		attachRunning(runner, backend);
		(
			runner as unknown as {
				handleBackendEvent: (e: unknown) => void;
			}
		).handleBackendEvent({
			kind: "turn-completed",
			usage: { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 },
		});

		expect(runner.isStreaming()).toBe(false);
		expect(() => runner.addStreamMessage("too late")).toThrow(
			/no active codex turn/i,
		);
	});
});

describe("CodexRunner startup cancellation", () => {
	it("does not open or run a backend after Stop during configuration", async () => {
		const runner = new CodexRunner({
			workingDirectory: "/tmp",
			factoryHome: "/tmp",
		});
		const backend = new FakeBackend({ supportsSteer: true, active: false });
		vi.spyOn(
			runner as unknown as { createBackend(): CodexBackend },
			"createBackend",
		).mockReturnValue(backend);
		const resolved = await new CodexConfigBuilder({
			workingDirectory: "/tmp",
			factoryHome: "/tmp",
		}).build();
		let finishBuild!: () => void;
		const build = vi
			.spyOn(CodexConfigBuilder.prototype, "build")
			.mockImplementation(
				() =>
					new Promise((resolve) => {
						finishBuild = () => resolve(resolved);
					}),
			);
		const open = vi.spyOn(backend, "open");
		const runTurn = vi.spyOn(backend, "runTurn");
		const complete = vi.fn();
		runner.on("complete", complete);
		try {
			const started = runner.start("hold");
			runner.stop();
			await started;
			finishBuild();
			expect(open).not.toHaveBeenCalled();
			expect(runTurn).not.toHaveBeenCalled();
			expect(runner.isRunning()).toBe(false);
			expect(complete).toHaveBeenCalledTimes(1);
		} finally {
			build.mockRestore();
		}
	});
});

describe("Codex configuration cancellation", () => {
	it("terminates the scripted login-status probe on cancellation", async () => {
		const root = mkdtempSync(join(tmpdir(), "codex-cancel-probe-"));
		const launcher = join(root, "codex");
		const pidFile = join(root, "pid");
		writeFileSync(
			launcher,
			`#!/bin/sh\necho $$ > "${pidFile}"\nexec /bin/sleep 30\n`,
		);
		chmodSync(launcher, 0o755);
		vi.stubEnv("OPENAI_API_KEY", "fixture-key");
		const cancellation = new AbortController();
		const fetchModel = vi.fn();
		vi.stubGlobal("fetch", fetchModel);
		try {
			const build = new CodexConfigBuilder({
				model: "fixture-model",
				fallbackModel: "fallback",
				codexPath: launcher,
			}).build(cancellation.signal);
			const outcome = build.catch(() => "cancelled");
			await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true));
			const pid = Number(readFileSync(pidFile, "utf8"));
			cancellation.abort(new Error("stopped"));
			expect(await outcome).toBe("cancelled");
			await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
			expect(fetchModel).not.toHaveBeenCalled();
		} finally {
			cancellation.abort();
			vi.unstubAllGlobals();
			vi.unstubAllEnvs();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("aborts a simulated model-availability request without applying a fallback", async () => {
		vi.stubEnv("OPENAI_API_KEY", "fixture-key");
		const cancellation = new AbortController();
		const fetchModel = vi.fn(
			(_url: string, options: { signal: AbortSignal }) =>
				new Promise((_resolve, reject) => {
					options.signal.addEventListener(
						"abort",
						() => reject(options.signal.reason),
						{ once: true },
					);
				}),
		);
		vi.stubGlobal("fetch", fetchModel);
		const config = {
			model: "fixture-model",
			fallbackModel: "fallback",
			codexPath: "/bin/false",
		};
		try {
			const outcome = new CodexConfigBuilder(config)
				.build(cancellation.signal)
				.catch(() => "cancelled");
			await vi.waitFor(() => expect(fetchModel).toHaveBeenCalledTimes(1));
			cancellation.abort(new Error("stopped"));
			expect(await outcome).toBe("cancelled");
			expect(config.model).toBe("fixture-model");
		} finally {
			cancellation.abort();
			vi.unstubAllGlobals();
			vi.unstubAllEnvs();
		}
	});
});
