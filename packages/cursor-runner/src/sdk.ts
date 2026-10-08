import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Run, SDKAgent, SDKMessage } from "@cursor/sdk";
import { isPackagedExecutable, runtimeAssetPath } from "bobs-factory-core";

import { resolvePreparedCursorInstallation } from "./installation.js";

export type CursorRun = Pick<Run, "stream" | "cancel">;
export type CursorAgent = Pick<SDKAgent, "agentId" | "close"> & {
	send(
		prompt: string,
		options?: Parameters<SDKAgent["send"]>[1],
	): Promise<CursorRun>;
};
type AgentOptions = Parameters<typeof import("@cursor/sdk").Agent.create>[0];

/** Run an unmodified, separately prepared SDK with its own Node runtime. */
export async function createPreparedCursorAgent(
	options: AgentOptions,
	sessionId?: string,
): Promise<CursorAgent> {
	const { sdk, node } = resolvePreparedCursorInstallation();
	const host = runtimeAssetPath(
		"cursor-runner/sdk-host.mjs",
		fileURLToPath(new URL("./sdk-host.mjs", import.meta.url)),
	);
	const child = fork(host, [sdk], {
		execPath: node,
		execArgv: [],
		stdio: ["ignore", "ignore", "inherit", "ipc"],
	});
	let wake: (() => void) | undefined;
	let failure: Error | undefined;
	let finished = false;
	let closed = false;
	let onDelta: NonNullable<Parameters<SDKAgent["send"]>[1]>["onDelta"];
	const events: SDKMessage[] = [];
	let resolveReady!: (agentId: string) => void;
	let rejectReady!: (error: Error) => void;
	const ready = new Promise<string>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const fail = (error: Error) => {
		failure = error;
		rejectReady(error);
		wake?.();
	};
	const send = (message: object) => {
		if (!child.connected) {
			fail(new Error("Cursor SDK host disconnected"));
			return;
		}
		child.send(message, (error) => {
			if (error) fail(error);
		});
	};
	child.on("message", (raw) => {
		const message = raw as {
			type: string;
			agentId: string;
			event: SDKMessage;
			delta: Parameters<NonNullable<typeof onDelta>>[0];
			error: string;
		};
		if (message.type === "ready") resolveReady(message.agentId);
		else if (message.type === "event") events.push(message.event);
		else if (message.type === "delta") {
			try {
				onDelta?.(message.delta);
			} catch (error) {
				fail(
					error instanceof Error
						? error
						: new Error("Cursor delta handler failed"),
				);
			}
		} else if (message.type === "done") finished = true;
		else if (message.type === "error") fail(new Error(message.error));
		wake?.();
	});
	child.on("error", fail);
	let resolveExited!: () => void;
	const exited = new Promise<void>((resolve) => {
		resolveExited = resolve;
	});
	child.on("exit", (code, signal) => {
		resolveExited();
		if (!closed && !finished && !failure)
			fail(new Error(`Cursor SDK host exited (${signal ?? code})`));
		wake?.();
	});
	const initTimeout = setTimeout(() => {
		fail(new Error("Cursor SDK host startup timed out"));
		child.kill("SIGKILL");
	}, 60_000);
	const close = () => {
		if (closed) return;
		closed = true;
		finished = true;
		if (child.connected) send({ type: "close" });
		const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
		timeout.unref();
		child.once("exit", () => clearTimeout(timeout));
		wake?.();
	};
	send({ type: "init", options, sessionId });
	let agentId: string;
	try {
		agentId = await ready;
	} catch (error) {
		close();
		await exited;
		throw error;
	} finally {
		clearTimeout(initTimeout);
	}
	return {
		agentId,
		close,
		async send(prompt, callbacks) {
			onDelta = callbacks?.onDelta;
			send({ type: "send", prompt });
			return {
				async cancel() {
					send({ type: "cancel" });
				},
				async *stream() {
					try {
						while (true) {
							if (events.length) yield events.shift()!;
							else if (failure) throw failure;
							else if (finished) return;
							else
								await new Promise<void>((resolve) => {
									wake = resolve;
								});
						}
					} finally {
						close();
						await exited;
					}
				},
			};
		},
	};
}

/** Checkout loads its installed SDK; archives never ship Cursor-owned code. */
export async function loadCursorSdk(): Promise<{
	Agent: {
		create(options: AgentOptions): Promise<CursorAgent>;
		resume(sessionId: string, options: AgentOptions): Promise<CursorAgent>;
	};
}> {
	if (!isPackagedExecutable) return import("@cursor/sdk");
	return {
		Agent: {
			create: (options) => createPreparedCursorAgent(options),
			resume: (sessionId, options) =>
				createPreparedCursorAgent(options, sessionId),
		},
	};
}
