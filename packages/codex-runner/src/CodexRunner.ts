import { EventEmitter } from "node:events";
import type {
	IAgentRunner,
	IMessageFormatter,
	SDKMessage,
} from "bobs-factory-core";
import { AppServerCodexBackend } from "./backend/AppServerCodexBackend.js";
import { waitWithAbort } from "./backend/abort.js";
import type {
	CodexBackend,
	CodexUserInput,
	NormalizedCodexEvent,
} from "./backend/types.js";
import { CodexEventMapper, type MapperContext } from "./CodexEventMapper.js";
import { CodexSkillStager } from "./CodexSkillStager.js";
import { CodexConfigBuilder } from "./config/CodexConfigBuilder.js";
import { CodexMessageFormatter } from "./formatter.js";
import type {
	CodexRunnerConfig,
	CodexRunnerEvents,
	CodexSessionInfo,
} from "./types.js";

export declare interface CodexRunner {
	on<K extends keyof CodexRunnerEvents>(
		event: K,
		listener: CodexRunnerEvents[K],
	): this;
	emit<K extends keyof CodexRunnerEvents>(
		event: K,
		...args: Parameters<CodexRunnerEvents[K]>
	): boolean;
}

/**
 * Adapts Codex to Bob’s Factory's {@link IAgentRunner} contract.
 *
 * The runner is a thin orchestrator: it owns session lifecycle and delegates
 * configuration assembly ({@link CodexConfigBuilder}), skill staging
 * ({@link CodexSkillStager}), event→message mapping ({@link CodexEventMapper}),
 * and transport ({@link CodexBackend}) to dedicated collaborators. Codex is
 * driven exclusively through the app-server backend, which supports mid-turn
 * input injection (`turn/steer`).
 */
export class CodexRunner extends EventEmitter implements IAgentRunner {
	readonly supportsStreamingInput = true;

	private readonly config: CodexRunnerConfig;
	private readonly formatter: IMessageFormatter;
	private readonly skillStager: CodexSkillStager;
	private readonly mapper: CodexEventMapper;

	private sessionInfo: CodexSessionInfo | null = null;
	private backend: CodexBackend | null = null;
	private wasStopped = false;
	private cancellation: AbortController | null = null;
	private cleanupPromise: Promise<void> | null = null;
	/** Set once the turn reaches a terminal state; gates {@link isStreaming}. */
	private turnFinished = false;
	/**
	 * Follow-up messages that arrived before the turn became steerable (during
	 * config build / process spawn / thread start). Flushed via `steer` once the
	 * turn starts, so a fast follow-up is never lost or wrongly deferred.
	 */
	private pendingFollowups: string[] = [];

	constructor(config: CodexRunnerConfig) {
		super();
		this.config = config;
		this.formatter = new CodexMessageFormatter();
		this.skillStager = new CodexSkillStager({
			workingDirectory: config.workingDirectory,
			additionalDirectories: config.additionalDirectories,
			skills: config.skills,
			plugins: config.plugins,
		});
		this.mapper = new CodexEventMapper(this.buildMapperContext());

		if (config.onMessage) this.on("message", config.onMessage);
		if (config.onError) this.on("error", config.onError);
		if (config.onComplete) this.on("complete", config.onComplete);
	}

	async start(prompt: string): Promise<CodexSessionInfo> {
		return this.startWithPrompt(prompt);
	}

	async startStreaming(initialPrompt?: string): Promise<CodexSessionInfo> {
		return this.startWithPrompt(initialPrompt);
	}

	/**
	 * Inject a message mid-session. While a turn is steerable it is sent
	 * immediately (`turn/steer`); during the startup window (before the turn
	 * begins) it is buffered and flushed once the turn starts. Throws only once
	 * the turn has finished, where the caller should resume with a new turn.
	 */
	addStreamMessage(content: string): void {
		if (this.backend?.isTurnActive()) {
			this.steer(content);
			return;
		}
		if (this.isRunning() && !this.turnFinished) {
			this.pendingFollowups.push(content);
			return;
		}
		throw new Error("Cannot stream message: no active Codex turn");
	}

	completeStream(): void {
		// No-op: each turn's input is delivered up front (or via steer); there is
		// no open input stream to close.
	}

	isStreaming(): boolean {
		// True for the whole running, not-yet-finished window — including the
		// startup gap before the turn is active — so callers stream follow-ups in
		// (buffered if needed) rather than deferring them.
		return (
			this.supportsStreamingInput &&
			this.isRunning() &&
			!this.turnFinished &&
			!this.wasStopped
		);
	}

	stop(): void {
		if (this.sessionInfo?.isRunning) {
			this.wasStopped = true;
			this.cancellation?.abort(new Error("Codex session stopped"));
		}
		void this.cleanupRuntimeState();
	}

	isRunning(): boolean {
		return this.sessionInfo?.isRunning ?? false;
	}

	getMessages(): SDKMessage[] {
		return this.config.redact
			? JSON.parse(
					this.config.redact(JSON.stringify(this.mapper.getMessages())),
				)
			: this.mapper.getMessages();
	}

	getFormatter(): IMessageFormatter {
		return this.formatter;
	}

	// ---- internals ----------------------------------------------------------

	private async startWithPrompt(
		prompt?: string | null,
	): Promise<CodexSessionInfo> {
		if (this.isRunning()) {
			throw new Error("Codex session already running");
		}

		this.sessionInfo = {
			// Only Codex can assign a resumable thread ID. A startup failure must
			// not publish a locally generated UUID as a native conversation.
			sessionId: this.config.resumeSessionId || null,
			startedAt: new Date(),
			isRunning: true,
		};
		this.wasStopped = false;
		const cancellation = new AbortController();
		this.cancellation = cancellation;
		this.turnFinished = false;
		this.pendingFollowups = [];
		this.mapper.reset();

		// Create the backend up front (before the slow config build / process
		// spawn) so addStreamMessage can buffer follow-ups that arrive during the
		// startup window rather than throwing.
		const backend = this.createBackend();
		this.backend = backend;
		backend.on("event", (event) => this.handleBackendEvent(event));

		let caughtError: unknown;
		try {
			const resolved = await waitWithAbort(
				new CodexConfigBuilder(this.config).build(cancellation.signal),
				cancellation.signal,
			);
			if (this.wasStopped) return this.sessionInfo;
			this.skillStager.stage();

			const input: CodexUserInput[] = prompt?.trim()
				? [{ type: "text", text: prompt.trim() }]
				: [];

			await backend.open(resolved);
			if (!this.wasStopped) await backend.runTurn(input);
		} catch (error) {
			caughtError = error;
		} finally {
			await this.finalizeSession(caughtError);
		}

		return this.sessionInfo;
	}

	private createBackend(): CodexBackend {
		return new AppServerCodexBackend();
	}

	private handleBackendEvent(event: NormalizedCodexEvent): void {
		if (event.kind === "turn-started") {
			// Turn is now steerable — deliver anything buffered during startup.
			this.flushPendingFollowups();
		} else if (
			event.kind === "turn-completed" ||
			event.kind === "turn-failed"
		) {
			this.turnFinished = true;
		}
		this.mapper.handle(event);
	}

	private steer(content: string): void {
		void this.backend
			?.steer?.([{ type: "text", text: content }])
			.catch((error) => {
				this.emit(
					"error",
					error instanceof Error ? error : new Error(String(error)),
				);
			});
	}

	private flushPendingFollowups(): void {
		const queued = this.pendingFollowups;
		this.pendingFollowups = [];
		for (const content of queued) {
			this.steer(content);
		}
	}

	private buildMapperContext(): MapperContext {
		const self = this;
		return {
			get workingDirectory(): string | undefined {
				return self.config.workingDirectory;
			},
			get model(): string | undefined {
				return self.config.model;
			},
			getSessionId: () => self.sessionInfo?.sessionId || "pending",
			getStagedSkillNames: () => self.skillStager.getStagedSkillNames(),
			emitMessage: (message) =>
				self.emit(
					"message",
					self.config.redact
						? JSON.parse(self.config.redact(JSON.stringify(message)))
						: message,
				),
			onThreadStarted: (threadId) => {
				if (self.sessionInfo) {
					self.sessionInfo.sessionId = threadId;
				}
			},
		};
	}

	private async finalizeSession(caughtError?: unknown): Promise<void> {
		if (!this.sessionInfo) {
			await this.cleanupRuntimeState();
			return;
		}

		this.sessionInfo.isRunning = false;
		this.mapper.finalize({
			caughtError,
			wasStopped: this.wasStopped,
		});
		await this.cleanupRuntimeState();
		this.emit("complete", this.getMessages());
	}

	private async cleanupRuntimeState(): Promise<void> {
		if (this.cleanupPromise) {
			await this.cleanupPromise;
			return;
		}
		const backend = this.backend;
		this.backend = null;
		const cleanup = (async () => {
			try {
				await backend?.close();
			} finally {
				this.skillStager.cleanup();
			}
		})();
		this.cleanupPromise = cleanup;
		try {
			await cleanup;
		} finally {
			this.cleanupPromise = null;
		}
	}
}
