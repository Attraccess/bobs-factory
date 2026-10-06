import { fork } from "node:child_process";
import { EventEmitter } from "node:events";
import type { SDKMessage } from "cyrus-core";
import type { CursorRunnerConfig, CursorSessionInfo } from "./types.js";

/** The local SDK inherits process.env. Give it a dedicated process, never a host mutation. */
export class CursorWorkerRunner extends EventEmitter {
	private running = false;
	private messages: SDKMessage[] = [];
	constructor(private config: CursorRunnerConfig) {
		super();
	}
	async start(prompt: string): Promise<CursorSessionInfo> {
		if (this.running) throw new Error("Cursor session already running");
		const {
			childEnvironment,
			additionalEnv,
			onMessage,
			onError,
			onComplete,
			logger,
			redact,
			...options
		} = this.config;
		// Functions and in-process SDK servers cannot cross the worker boundary.
		const serialized = JSON.stringify(
			{ ...options, cursorApiKey: childEnvironment?.CURSOR_API_KEY },
			(_key, value) => {
				if (typeof value === "function")
					throw new Error(
						"Cursor worker configuration contains an unsupported callback",
					);
				return value;
			},
		);
		const child = fork(new URL("./cursor-worker.js", import.meta.url), [], {
			env: { ...childEnvironment, ...additionalEnv },
			execArgv: [],
			detached: process.platform !== "win32",
			stdio: ["ignore", "ignore", "ignore", "ipc"],
		});
		this.running = true;
		this.messages = [];
		return new Promise((resolve, reject) => {
			let settled = false;
			let killTimer: ReturnType<typeof setTimeout> | undefined;
			const finish = (error?: Error, info?: CursorSessionInfo) => {
				if (settled) return;
				settled = true;
				this.running = false;
				this.removeListener("stop-worker", stop);
				if (killTimer) clearTimeout(killTimer);
				if (child.connected) child.disconnect();
				try {
					if (process.platform !== "win32" && child.pid)
						process.kill(-child.pid, "SIGTERM");
					else child.kill("SIGTERM");
				} catch {
					/* Already exited. */
				}
				if (error) reject(error);
				else resolve({ ...info!, startedAt: new Date(info!.startedAt) });
			};
			child.on("error", (error) => finish(error));
			child.on("exit", () =>
				finish(
					new Error("Cursor execution worker exited before returning a result"),
				),
			);
			child.on("message", (value: unknown) => {
				if (settled) return;
				const event = value as {
					type: string;
					message: SDKMessage;
					info: CursorSessionInfo;
					error: string;
				};
				if (event.type === "message") {
					const message = redact
						? JSON.parse(redact(JSON.stringify(event.message)))
						: event.message;
					this.messages.push(message);
					this.emit("message", message);
				} else if (event.type === "complete")
					this.emit("complete", this.getMessages());
				else if (event.type === "error") {
					const error = new Error(redact ? redact(event.error) : event.error);
					if (this.listenerCount("error")) this.emit("error", error);
				} else if (event.type === "result") finish(undefined, event.info);
				else if (event.type === "failed")
					finish(new Error(redact ? redact(event.error) : event.error));
			});
			child.send({ type: "start", config: JSON.parse(serialized), prompt });
			child.once("disconnect", () => {
				if (!settled) finish(new Error("Cursor execution worker disconnected"));
			});
			const stop = () => {
				if (settled) return;
				if (child.connected) child.send({ type: "stop" });
				killTimer = setTimeout(
					() => finish(new Error("Cursor execution worker stopped")),
					2000,
				);
				killTimer.unref();
			};
			this.once("stop-worker", stop);
		});
	}
	stop(): void {
		this.emit("stop-worker");
	}
	isRunning(): boolean {
		return this.running;
	}
	getMessages(): SDKMessage[] {
		return [...this.messages];
	}
}
