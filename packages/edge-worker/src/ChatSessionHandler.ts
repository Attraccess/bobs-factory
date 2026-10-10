import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { SDKMessage, SdkPluginConfig } from "bobs-factory-claude-runner";
import type {
	AgentRunnerConfig,
	AgentSessionInfo,
	CyrusAgentSession,
	IAgentRunner,
	ILogger,
	OpenCodeConfigOverrides,
	RepositoryConfig,
	RunnerType,
} from "bobs-factory-core";
import { AgentSessionStatus, createLogger } from "bobs-factory-core";
import { AgentSessionManager } from "./AgentSessionManager.js";
import type { ChatRepositoryProvider } from "./ChatRepositoryProvider.js";
import { type ChatState, steeringState } from "./factory/SessionChat.js";
import {
	type RunnerStartCheckpoint,
	runnerCapacityState,
} from "./RunnerConcurrency.js";
import type { RunnerConfigBuilder } from "./RunnerConfigBuilder.js";
import { persistReplyEvent } from "./SessionRecovery.js";

/**
 * Defines what each chat platform must provide for the generic session lifecycle.
 *
 * Implementations are stateless data mappers — they translate platform-specific
 * events into the common operations the ChatSessionHandler needs.
 */
/** Platform identifiers supported by the session manager */
export type ChatPlatformName = "slack" | "linear" | "github" | "zulip";

export interface ChatPlatformAdapter<TEvent> {
	/** Rehydrate saved reply context using current platform credentials. */
	restoreReplyEvent?(event: unknown): TEvent;

	readonly platformName: ChatPlatformName;

	/** Extract the user's task text from the raw event */
	extractTaskInstructions(event: TEvent): string;

	/**
	 * Whether this event is allowed to *start* a brand-new session for its
	 * thread. Events that may only continue an already-bound thread (e.g. a
	 * plain Slack message that isn't an @mention) return false, so the handler
	 * ignores them when no session exists yet.
	 *
	 * Optional — when omitted, every event is treated as session-initiating
	 * (the behaviour for platforms where every event is an explicit invocation).
	 */
	isSessionInitiatingEvent?(event: TEvent): boolean;

	/** Derive a unique thread key for session tracking (e.g., "C123:1704110400.000100") */
	getThreadKey(event: TEvent): string;

	/** Get the unique event ID */
	getEventId(event: TEvent): string;

	/** Build a platform-specific system prompt */
	buildSystemPrompt(event: TEvent): string;

	/**
	 * Thread context as a formatted string, or "" if not applicable. Pass
	 * `sinceTs` to read only what followed it, so a resumed session catches up on
	 * discussion it never saw. `null` means the read failed — only a non-null
	 * result advances the cursor.
	 */
	fetchThreadContext(event: TEvent, sinceTs?: string): Promise<string | null>;

	/**
	 * This event's thread position, stored as the catch-up cursor. Optional —
	 * platforms that deliver every thread message omit it and get no catch-up.
	 */
	getThreadContextTs?(event: TEvent): string | undefined;

	/** Post the agent's final response back to the platform */
	postReply(event: TEvent, runner: IAgentRunner): Promise<void>;

	/** Acknowledge receipt of the event (e.g., emoji reaction). Fire-and-forget */
	acknowledgeReceipt(event: TEvent): Promise<void>;

	/**
	 * Acknowledge that the agent finished processing the event (e.g., swap the
	 * receipt reaction for a "done" one). Called after the turn completes,
	 * whether or not a reply was actually posted — this is what tells users a
	 * message was seen even when the agent chose to stay silent.
	 *
	 * Optional — platforms without a processed indicator omit it. Fire-and-forget.
	 */
	acknowledgeProcessed?(event: TEvent): Promise<void>;

	/** Notify the user that a previous request is still processing */
	notifyBusy(event: TEvent, threadKey: string): Promise<void>;
}

/**
 * Callbacks for EdgeWorker integration (same pattern as RepositoryRouterDeps).
 */
export interface ChatSessionHandlerDeps {
	requireWorkflowAvailable?(id?: string): void;
	onSessionChange?: (id: string) => void;
	isShuttingDown?: () => boolean;
	onNewSession?: (
		session: CyrusAgentSession,
		instructions: string,
		platform: string,
	) => void;
	factoryHome: string;
	/** Provider for live repository paths, default repo, and workspace ID */
	chatRepositoryProvider: ChatRepositoryProvider;
	/** Shared RunnerConfigBuilder for constructing runner configs */
	runnerConfigBuilder: RunnerConfigBuilder;
	/** Factory function that creates the appropriate runner for the chat session */
	createRunner: (
		config: AgentRunnerConfig,
		runnerType?: RunnerType,
		signal?: AbortSignal,
		sessionId?: string,
		/** Persist the first provider-start boundary after capacity admission. */
		beforeStart?: RunnerStartCheckpoint,
	) => IAgentRunner;
	/**
	 * Live read of the workspace-level custom-integration MCP config paths
	 * for the chat platform this handler is bound to (e.g.
	 * `config.slackMcpConfigs` for Slack). Chat sessions are repo-agnostic,
	 * so `repository.mcpConfigPath` is not consulted; only this list
	 * determines which custom `.mcp.json` files load. When empty/omitted,
	 * no custom files load (native MCP servers still run as usual).
	 */
	getPlatformMcpConfigOverrides?: () => readonly string[] | undefined;
	/** Live read of whether Claude should ignore ambient MCP configuration. */
	getStrictMcpConfig?: () => boolean | undefined;
	/** Live read of operator-configured writable roots for external tools. */
	getAdditionalWritableDirectories?: () => readonly string[] | undefined;
	/**
	 * Refresh the workspace's Linear access token if it has expired. Called
	 * before each runner config is built, because the Linear MCP server
	 * receives the token as a fixed header and cannot refresh it itself.
	 */
	ensureLinearTokenFresh?: (linearWorkspaceId: string) => Promise<void>;
	/** Resolve managed skill plugins and scoped skill names for a chat session. */
	resolveSkillsConfig?: (input: {
		repository?: RepositoryConfig;
		repositoryPaths: string[];
	}) => Promise<{ plugins?: SdkPluginConfig[]; skills?: string[] | "all" }>;
	/** Read live global OpenCode config overrides at session-build time */
	getOpenCodeGlobalConfig?: () => OpenCodeConfigOverrides["config"] | undefined;
	/** Read live global OpenCode CLI state scope at session-build time */
	getOpenCodeGlobalStateScope?: () =>
		| OpenCodeConfigOverrides["stateScope"]
		| undefined;
	onWebhookStart: () => void;
	onWebhookEnd: () => void;
	onStateChange: () => Promise<void>;
	/**
	 * Apply an input update inside the worker's state-save queue. On storage
	 * failure, run its returned rollback before allowing another update/save.
	 */
	persistMessage?: (update?: () => () => void) => Promise<void>;
	onClaudeError: (error: Error) => void;
}

/**
 * Generic session lifecycle engine for chat platform integrations.
 *
 * Manages the create/resume/inject/reply session lifecycle independent of any
 * specific chat platform. Platform-specific behavior is provided via a
 * ChatPlatformAdapter.
 */
export class ChatSessionHandler<TEvent> {
	private adapter: ChatPlatformAdapter<TEvent>;
	private sessionManager: AgentSessionManager;
	private threadSessions: Map<string, string> = new Map();
	private deps: ChatSessionHandlerDeps;
	private logger: ILogger;
	// Queue of events awaiting a reply, keyed by sessionId. Each entry is
	// enqueued when a new prompt (initial/resume/follow-up-inject) is sent to
	// the runner, and the queue is drained when a `result` message arrives on
	// the runner's message stream. This decouples reply posting from
	// `startStreaming()` resolution, which never resolves when warm sessions
	// hold the streaming prompt open across turns.
	//
	// Drained wholesale, NOT one-per-result: messages injected in quick
	// succession get merged by the runner into a single turn (one `result`
	// answering several queued prompts), so a strict FIFO pairing would leave
	// orphaned entries that never get acknowledged — and would pair them with
	// the wrong later turns.
	private pendingReplyEvents: Map<string, TEvent[]> = new Map();
	// Last event enqueued per session. When a merged turn drained the queue
	// ahead of schedule, a subsequent `result` finds the queue empty — this
	// remembers where to post that turn's reply (all events in a session share
	// one thread, so any recent event addresses it correctly).
	private lastReplyEvent: Map<string, TEvent> = new Map();
	// Follow-up events that arrived while a turn was running and could not be
	// streamed into it (e.g. the exec Codex backend, which has no mid-turn input
	// channel). Keyed by threadKey. Drained when the running turn completes and
	// re-dispatched as a fresh turn, so a follow-up is never silently dropped —
	// honoring the "I'll pick up your new message once I'm done" promise.
	private pendingFollowups: Map<string, TEvent[]> = new Map();
	private continuationStarts = new Map<string, AbortController>();
	private pendingMessageSaves = new Map<string, number>();
	private messageSaveQueue = Promise.resolve();

	constructor(
		adapter: ChatPlatformAdapter<TEvent>,
		deps: ChatSessionHandlerDeps,
		logger?: ILogger,
	) {
		this.adapter = adapter;
		this.deps = deps;
		this.logger = logger ?? createLogger({ component: "ChatSessionHandler" });

		// Initialize a dedicated AgentSessionManager (not tied to any repository)
		this.sessionManager = new AgentSessionManager(
			undefined, // No parent session lookup
			undefined, // No resume parent session
		);
		this.sessionManager.on("sessionChanged", (id: string) =>
			this.deps.onSessionChange?.(id),
		);
	}

	/**
	 * Main entry point — handles a single chat platform event.
	 *
	 * Replaces the per-platform handleXxxWebhook method in EdgeWorker.
	 */
	async handleEvent(event: TEvent): Promise<void> {
		this.deps.onWebhookStart();

		try {
			this.logger.info(
				`Processing ${this.adapter.platformName} webhook: ${this.adapter.getEventId(event)}`,
			);

			// Fire-and-forget acknowledgement (e.g., emoji reaction)
			this.adapter.acknowledgeReceipt(event).catch((err: unknown) => {
				this.logger.warn(
					`Failed to acknowledge ${this.adapter.platformName} event: ${err instanceof Error ? err.message : err}`,
				);
			});

			const taskInstructions = this.adapter.extractTaskInstructions(event);
			const threadKey = this.adapter.getThreadKey(event);

			// Check if there's already an active session for this thread
			const existingSessionId = this.threadSessions.get(threadKey);
			this.deps.requireWorkflowAvailable?.(existingSessionId);
			if (existingSessionId) {
				const existingSession =
					this.sessionManager.getSession(existingSessionId);
				const existingRunner =
					this.sessionManager.getAgentRunner(existingSessionId);

				if (
					existingSession &&
					this.continuationStarts.has(existingSessionId) &&
					!existingRunner?.isRunning()
				) {
					// Configuration and thread catch-up can await before isRunning()
					// becomes true. Both dashboard and platform starts share this guard.
					this.queuePendingFollowup(threadKey, event);
					await this.adapter.notifyBusy(event, threadKey);
					return;
				}

				if (existingSession && existingRunner?.isRunning()) {
					// Session is actively running — inject the follow-up via streaming input
					if (
						existingRunner.addStreamMessage &&
						existingRunner.isStreaming?.()
					) {
						this.logger.info(
							`Injecting follow-up prompt into running session ${existingSessionId} (thread ${threadKey})`,
						);
						this.enqueueReply(existingSessionId, event);
						existingRunner.addStreamMessage(
							await this.withThreadCatchup(
								existingSession,
								event,
								taskInstructions,
							),
						);
					} else {
						// Runner can't accept mid-turn input (e.g. exec Codex). Queue the
						// follow-up so it's delivered as a fresh turn once this one ends,
						// rather than dropped — then tell the user we'll pick it up.
						this.logger.info(
							`Session ${existingSessionId} is still running; queuing follow-up for after the turn (thread ${threadKey})`,
						);
						this.queuePendingFollowup(threadKey, event);
						await this.adapter.notifyBusy(event, threadKey);
					}
					return;
				}

				if (existingSession) {
					// Session exists but is not running — resume with --continue
					this.logger.info(
						`Resuming completed ${this.adapter.platformName} session ${existingSessionId} (thread ${threadKey})`,
					);

					const resumeInfo = this.getResumeInfo(existingSession);

					if (resumeInfo) {
						try {
							await this.resumeSession(
								event,
								existingSession,
								existingSessionId,
								resumeInfo.sessionId,
								resumeInfo.runnerType,
								taskInstructions,
							);
						} catch (error) {
							this.logger.error(
								`Failed to resume ${this.adapter.platformName} session ${existingSessionId}`,
								error instanceof Error ? error : new Error(String(error)),
							);
						}
						return;
					}
				}

				// Session exists but runner was lost — fall through to create a new session
				this.logger.info(
					`Previous session ${existingSessionId} for thread ${threadKey} has no runner, creating new session`,
				);
			}

			// No session exists for this thread. Only events explicitly allowed to
			// start a session may do so — e.g. a Slack @mention. A plain follow-up
			// message in an unbound thread must be ignored, otherwise every message
			// in any channel Bob’s Factory can see would spin up a session.
			if (
				!existingSessionId &&
				this.adapter.isSessionInitiatingEvent?.(event) === false
			) {
				this.logger.info(
					`Ignoring non-initiating ${this.adapter.platformName} event for unbound thread ${threadKey}`,
				);
				return;
			}

			// Create an empty workspace directory for this thread
			const workspace = await this.createWorkspace(threadKey);
			if (!workspace) {
				this.logger.error(
					`Failed to create workspace for ${this.adapter.platformName} thread ${threadKey}`,
				);
				return;
			}

			this.logger.info(
				`${this.adapter.platformName} workspace created at: ${workspace.path}`,
			);

			// Create a chat session (not tied to any issue or repository)
			const eventId = this.adapter.getEventId(event);
			const sessionId = `${this.adapter.platformName}-${eventId}`;
			this.sessionManager.createChatSession(
				sessionId,
				workspace,
				this.adapter.platformName,
			);

			const session = this.sessionManager.getSession(sessionId);
			if (!session) {
				this.logger.error(
					`Failed to create session for ${this.adapter.platformName} webhook ${eventId}`,
				);
				return;
			}

			// Track this thread → session mapping for follow-up messages
			this.threadSessions.set(threadKey, sessionId);

			// Initialize session metadata
			if (!session.metadata) {
				session.metadata = {};
			}

			// Build the system prompt
			const systemPrompt = this.adapter.buildSystemPrompt(event);
			session.metadata.chatRepositoryId =
				this.deps.chatRepositoryProvider.getDefaultRepository()?.id;
			if (
				this.adapter.platformName === "slack" ||
				this.adapter.platformName === "zulip"
			)
				session.metadata.chatPlatform = this.adapter.platformName;
			session.metadata.chatThreadKey = threadKey;
			session.metadata.chatSystemPrompt = systemPrompt;
			session.metadata.chatExecutionStarted = false;

			// Build runner config
			const runnerConfig = await this.buildRunnerConfig(
				session.workspace.path,
				sessionId,
				systemPrompt,
				sessionId,
			);

			const runner = this.deps.createRunner(
				runnerConfig,
				(runnerConfig as AgentRunnerConfig & { runnerType?: RunnerType })
					.runnerType,
				undefined,
				sessionId,
				() => this.markExecutionStarted(session),
			);

			// Store the runner in the session manager
			this.sessionManager.addAgentRunner(sessionId, runner);

			// Save persisted state
			await this.deps.onStateChange();

			// Fetch thread context for threaded mentions
			const userPrompt = await this.withThreadContext(
				session,
				event,
				taskInstructions,
			);

			this.logger.info(
				`Starting runner for ${this.adapter.platformName} event ${eventId}`,
			);

			// Start in streaming mode if supported (allows follow-up message injection),
			// otherwise fall back to non-streaming start.
			//
			// Reply posting happens from handleAgentMessage() when a `result`
			// message arrives on the runner's stream — we do NOT await turn
			// completion here, because with warm sessions the streaming prompt
			// stays open and the start() promise doesn't resolve until the
			// whole session ends.
			session.metadata!.pendingExecution = {
				prompt: userPrompt,
				systemPrompt,
				runner:
					(runnerConfig as AgentRunnerConfig & { runnerType?: RunnerType })
						.runnerType ?? "claude",
				model: runnerConfig.model,
				replyEvent: persistReplyEvent(event),
			};
			await this.deps.onStateChange();
			this.enqueueReply(sessionId, event);
			const startPromise =
				runner.supportsStreamingInput && runner.startStreaming
					? runner.startStreaming(userPrompt)
					: runner.start(userPrompt);
			this.deps.onNewSession?.(session, userPrompt, this.adapter.platformName);
			startPromise
				.then((sessionInfo: AgentSessionInfo) => {
					this.logger.info(
						`${this.adapter.platformName} session started: ${sessionInfo.sessionId}`,
					);
				})
				.catch((error: unknown) => {
					this.logger.error(
						`${this.adapter.platformName} session error for event ${eventId}`,
						error instanceof Error ? error : new Error(String(error)),
					);
					// Runner died before emitting a final `result`. Drop any
					// still-queued reply events for this session so a later
					// resumeSession() doesn't pair them with a future turn.
					this.clearPendingReplies(sessionId);
				})
				.finally(() => {
					this.drainDashboardMessages(sessionId);
					this.drainPendingFollowups(sessionId);
					this.sessionManager.emit("sessionChanged", sessionId);
					this.deps.onStateChange().catch((error: unknown) => {
						this.logger.error(
							`onStateChange failed after ${this.adapter.platformName} session ${sessionId}`,
							error instanceof Error ? error : new Error(String(error)),
						);
					});
				});
		} catch (error) {
			this.logger.error(
				`Failed to process ${this.adapter.platformName} webhook`,
				error instanceof Error ? error : new Error(String(error)),
			);
		} finally {
			this.deps.onWebhookEnd();
		}
	}

	/** Returns true if any runner managed by this handler is currently busy */
	isAnyRunnerBusy(): boolean {
		for (const runner of this.sessionManager.getAllAgentRunners()) {
			if (runner.isRunning()) {
				return true;
			}
		}
		return false;
	}

	/** Returns all runners managed by this handler (for shutdown) */
	getAllRunners(): IAgentRunner[] {
		return this.sessionManager.getAllAgentRunners();
	}

	/**
	 * Expose every active chat session this handler owns, so EdgeWorker
	 * can resolve a cwd → session bundle from outside (e.g. the
	 * `log_failure_mode` MCP tool needs to find a Slack/GitHub chat
	 * session's runner session id). Chat sessions live in this handler's
	 * dedicated AgentSessionManager — they aren't reachable from
	 * EdgeWorker's primary AgentSessionManager.
	 */
	getAllChatSessions(): CyrusAgentSession[] {
		return this.sessionManager.getAllSessions();
	}

	chatState(id: string): ChatState {
		const session = this.sessionManager.getSession(id);
		if (!session || session.status === AgentSessionStatus.Error)
			return {
				enabled: true,
				available: false,
				reason: "The chat session has stopped.",
			};
		const runner = session.agentRunner;
		const queued = session.metadata?.pendingChatMessages ?? [];
		const capacityQueued = runnerCapacityState(runner)?.phase === "queued";
		if (runner?.isRunning() || this.continuationStarts.has(id)) {
			const steer = steeringState(runner);
			const queuedMessages = [
				...((capacityQueued || !runner?.isRunning()) &&
				session.status === AgentSessionStatus.Active
					? (session.metadata?.pendingExecution?.dashboardMessages ?? [])
					: []),
				...queued,
			];
			if (
				!capacityQueued &&
				steer.available &&
				!queued.length &&
				!this.pendingMessageSaves.has(id)
			)
				return steer;
			return {
				enabled: true,
				available: true,
				mode: "queue",
				queuedMessageIds: queuedMessages.map((message) => message.id),
				reason: capacityQueued
					? "Waiting for instance capacity. Messages are queued and will be processed later."
					: "Messages are queued and will be processed after the current turn.",
			};
		}
		if (
			session.status === AgentSessionStatus.Complete &&
			this.getResumeInfo(session) &&
			(this.lastReplyEvent.has(id) || session.metadata?.chatSystemPrompt)
		)
			return {
				enabled: true,
				available: true,
				mode: "continue",
				queuedMessageIds: queued.map((message) => message.id),
			};
		return {
			enabled: true,
			available: false,
			reason: "The chat session is starting or needs recovery.",
		};
	}

	/** Dashboard feedback uses this handler's native conversation and platform context. */
	sendMessage(
		id: string,
		text: string,
		messageId: string = randomUUID(),
	): Promise<void> {
		const state = this.chatState(id);
		if (!state.available) throw new Error(state.reason ?? "Chat unavailable");
		const session = this.sessionManager.getSession(id)!;
		if (state.mode === "steer") {
			session.agentRunner!.addStreamMessage!(text);
			return Promise.resolve();
		}
		this.pendingMessageSaves.set(
			id,
			(this.pendingMessageSaves.get(id) ?? 0) + 1,
		);
		// Mutation, save and rollback share the worker's persistence queue. A
		// concurrent input or lifecycle save must never snapshot rejected input.
		return this.persistMessage(() => {
			if (
				session.status === AgentSessionStatus.Error ||
				this.deps.isShuttingDown?.()
			)
				throw new Error("The chat session has stopped.");
			session.metadata ??= {};
			session.metadata.pendingChatMessages ??= [];
			const queue = session.metadata.pendingChatMessages;
			const message = { id: messageId, text };
			queue.push(message);
			return () => {
				const index = queue.indexOf(message);
				if (index >= 0) queue.splice(index, 1);
			};
		}).finally(() => {
			const remaining = this.pendingMessageSaves.get(id)! - 1;
			if (remaining) this.pendingMessageSaves.set(id, remaining);
			else this.pendingMessageSaves.delete(id);
			this.sessionManager.emit("sessionChanged", id);
			this.drainDashboardMessages(id);
		});
	}

	private persistMessage(update?: () => () => void): Promise<void> {
		if (this.deps.persistMessage) return this.deps.persistMessage(update);
		// Standalone handlers without worker persistence still serialize input
		// updates through their lifecycle callback.
		const save = this.messageSaveQueue.then(async () => {
			const rollback = update?.();
			try {
				await this.deps.onStateChange();
			} catch (error) {
				rollback?.();
				throw error;
			}
		});
		this.messageSaveQueue = save.catch(() => {});
		return save;
	}

	private drainDashboardMessages(id: string): void {
		const session = this.sessionManager.getSession(id);
		if (
			!session ||
			session.status === AgentSessionStatus.Error ||
			this.deps.isShuttingDown?.() ||
			this.continuationStarts.has(id) ||
			this.pendingMessageSaves.has(id) ||
			session.agentRunner?.isRunning()
		)
			return;
		const messages = session.metadata?.pendingChatMessages;
		const resume = this.getResumeInfo(session);
		if (!messages?.length || !resume) return;
		// Take a snapshot; submissions during asynchronous setup stay in the queue.
		const batch = [...messages];
		void this.resumeSession(
			this.lastReplyEvent.get(id),
			session,
			id,
			resume.sessionId,
			resume.runnerType,
			batch.map((message) => message.text).join("\n\n"),
			undefined,
			false,
			batch,
		).catch(async (error: unknown) => {
			session.status = AgentSessionStatus.Error;
			await this.sessionManager.createResponseActivity(
				id,
				`Chat continuation failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			await this.deps.onStateChange();
		});
	}

	stopSession(id: string): void {
		const session = this.sessionManager.getSession(id);
		if (!session) return;
		this.sessionManager.requestSessionStop(id);
		session.status = AgentSessionStatus.Error;
		this.continuationStarts.get(id)?.abort();
		const threadKey = this.threadKeyForSession(id);
		if (threadKey) this.pendingFollowups.delete(threadKey);
		this.clearPendingReplies(id);
		delete session.metadata?.pendingChatMessages;
		session.agentRunner?.stop();
		this.sessionManager.emit("sessionChanged", id);
	}

	subscribe(listener: (id: string) => void): () => void {
		this.sessionManager.on("sessionChanged", listener);
		return () => {
			this.sessionManager.off("sessionChanged", listener);
		};
	}
	serializeState() {
		return this.sessionManager.serializeState();
	}
	/** Move restored chat records back to the manager that owns their runner config. */
	restoreState(
		sessions: Parameters<AgentSessionManager["restoreState"]>[0],
		entries: Parameters<AgentSessionManager["restoreState"]>[1],
	): void {
		this.sessionManager.restoreState(sessions, entries);
		for (const session of this.getAllChatSessions()) {
			const threadKey = session.metadata?.chatThreadKey;
			if (threadKey) this.threadSessions.set(threadKey, session.id);
		}
	}
	/** Resume only unfinished turns, through the same capacity-gated start path. */
	async recoverQueuedSessions(): Promise<void> {
		for (const session of this.getAllChatSessions()) {
			try {
				this.deps.requireWorkflowAvailable?.(session.id);
			} catch {
				continue;
			}
			if (session.status === AgentSessionStatus.Complete) {
				this.drainDashboardMessages(session.id);
				continue;
			}
			if (session.status !== AgentSessionStatus.Active) continue;
			const pending = session.metadata?.pendingExecution;
			const resume = this.getResumeInfo(session);
			if (
				!pending ||
				!resume ||
				session.agentRunner ||
				this.continuationStarts.has(session.id)
			)
				continue;
			try {
				// The saved prompt already includes thread catchup; do not assemble it twice.
				await this.resumeSession(
					undefined,
					session,
					session.id,
					resume.sessionId,
					resume.runnerType,
					pending.prompt,
					undefined,
					true,
				);
			} catch (error) {
				if (this.deps.isShuttingDown?.()) continue;
				session.status = AgentSessionStatus.Error;
				await this.sessionManager.createResponseActivity(
					session.id,
					`Chat recovery failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				await this.deps.onStateChange();
			}
		}
	}
	isWorkflowStopping(id: string): boolean {
		return this.continuationStarts.has(id);
	}
	interruptWorkflowSession(id: string): void {
		this.continuationStarts.get(id)?.abort();
		this.sessionManager.getSession(id)?.agentRunner?.stop();
	}
	async resumeBlockedSession(id: string): Promise<void> {
		const session = this.sessionManager.getSession(id);
		if (!session) throw new Error("Chat session not found");
		this.deps.requireWorkflowAvailable?.(id);
		const resume = this.getResumeInfo(session);
		if (!resume)
			throw new Error(
				"Saved native chat conversation ID is missing. Restore the saved conversation ID before resuming.",
			);
		// Continue the saved turn with its accepted model and queued input.
		await this.resumeSession(
			undefined,
			session,
			id,
			resume.sessionId,
			resume.runnerType,
			session.metadata?.pendingExecution?.prompt ??
				"Resume interrupted work using prior conversation and tool results.",
			undefined,
			true,
		);
	}
	get platformName(): ChatPlatformName {
		return this.adapter.platformName;
	}
	getSessionEntries(id: string) {
		return this.sessionManager.getSessionEntries(id);
	}

	updateDisplayTitle(
		id: string,
		title: string,
		job: CyrusAgentSession["titleGeneration"],
	): void {
		this.sessionManager.updateDisplayTitle(id, title, job);
	}

	/**
	 * Test/inspection: list all known thread keys and their session IDs.
	 * Used by F1 to discover chat sessions for follow-up prompts and replay.
	 */
	listThreads(): Array<{ threadKey: string; sessionId: string }> {
		return Array.from(this.threadSessions.entries()).map(
			([threadKey, sessionId]) => ({ threadKey, sessionId }),
		);
	}

	/**
	 * Test/inspection: resolve a chat thread to its runner. Returns undefined
	 * when the thread is unknown or the runner has been disposed.
	 */
	getRunnerForThread(threadKey: string): IAgentRunner | undefined {
		const sessionId = this.threadSessions.get(threadKey);
		if (!sessionId) return undefined;
		return this.sessionManager.getAgentRunner(sessionId);
	}

	/** Mark how far this session has thread context, for the next catch-up */
	private recordThreadContextTs(
		session: CyrusAgentSession,
		event: TEvent,
	): void {
		const ts = this.adapter.getThreadContextTs?.(event);
		if (!ts) {
			return;
		}
		if (!session.metadata) {
			session.metadata = {};
		}
		// Concurrent mentions race here; a backwards cursor re-delivers a message.
		// Slack ts is zero-padded, so string ordering is chronological.
		const current = session.metadata.lastContextTs;
		if (current && ts <= current) {
			return;
		}
		session.metadata.lastContextTs = ts;
	}

	/**
	 * Prefix the task instructions with thread context — the whole thread for a
	 * new session, or just what was said since the cursor for a follow-up. The
	 * cursor only advances on a successful read, so a failed one retries the same
	 * window instead of losing it.
	 */
	private async withThreadContext(
		session: CyrusAgentSession,
		event: TEvent,
		taskInstructions: string,
	): Promise<string> {
		let context: string | null;
		try {
			context = await this.adapter.fetchThreadContext(
				event,
				session.metadata?.lastContextTs,
			);
		} catch (error) {
			// A context read must never cost the user their message
			this.logger.warn(
				`Failed to fetch thread context for ${this.adapter.platformName} session: ${error instanceof Error ? error.message : String(error)}`,
			);
			return taskInstructions;
		}

		if (context !== null) {
			this.recordThreadContextTs(session, event);
		}

		return context ? `${context}\n\n${taskInstructions}` : taskInstructions;
	}

	/**
	 * Follow-up variant. Platforms with no thread cursor deliver every message
	 * already, so re-reading the thread would only duplicate what the session has.
	 */
	private async withThreadCatchup(
		session: CyrusAgentSession,
		event: TEvent,
		taskInstructions: string,
	): Promise<string> {
		if (!this.adapter.getThreadContextTs) {
			return taskInstructions;
		}
		return this.withThreadContext(session, event, taskInstructions);
	}

	/**
	 * Resume an existing session with a new prompt (--continue behavior).
	 */
	private async resumeSession(
		event: TEvent | undefined,
		existingSession: CyrusAgentSession,
		sessionId: string,
		resumeSessionId: string | undefined,
		runnerType: RunnerType,
		taskInstructions: string,
		cancelled?: () => boolean,
		recovering = false,
		dashboardMessages?: { id: string; text: string }[],
	): Promise<void> {
		this.deps.requireWorkflowAvailable?.(sessionId);
		if (this.continuationStarts.has(sessionId))
			throw new Error("The conversation is resuming.");
		const isCancelled = () =>
			cancelled?.() ||
			this.deps.isShuttingDown?.() ||
			existingSession.status === AgentSessionStatus.Error;
		const controller = new AbortController();
		this.continuationStarts.set(sessionId, controller);
		existingSession.metadata = {
			...existingSession.metadata,
			intentionalStop: false,
		};
		existingSession.status = AgentSessionStatus.Active;
		this.sessionManager.emit("sessionChanged", sessionId);
		let started = false;
		const releaseStart = () => {
			this.continuationStarts.delete(sessionId);
			this.sessionManager.emit("sessionChanged", sessionId);
			void this.deps.onStateChange().catch((error: unknown) => {
				this.logger.error(
					"Failed to persist chat continuation",
					error instanceof Error ? error : new Error(String(error)),
				);
			});
		};
		try {
			const systemPrompt = event
				? this.adapter.buildSystemPrompt(event)
				: existingSession.metadata!.chatSystemPrompt!;

			if (dashboardMessages) {
				// Checkpoint the new input before asynchronous setup changes an idle
				// conversation into an active turn. Recovery must never replay the
				// previous completed prompt while its follow-up is being prepared.
				existingSession.metadata ??= {};
				existingSession.metadata.pendingExecution = {
					prompt: taskInstructions,
					systemPrompt,
					runner: runnerType,
					dashboardMessages,
					replyEvent: persistReplyEvent(
						event ?? existingSession.metadata.pendingExecution?.replyEvent,
					),
				};
				existingSession.metadata.pendingChatMessages?.splice(
					0,
					dashboardMessages.length,
				);
				await this.persistMessage();
				if (isCancelled()) return;
			}

			const runnerConfig = await this.buildRunnerConfig(
				existingSession.workspace.path,
				sessionId,
				systemPrompt,
				sessionId,
				resumeSessionId,
				runnerType,
			);
			if (isCancelled()) return;
			if (recovering && existingSession.metadata?.pendingExecution?.model)
				runnerConfig.model = existingSession.metadata.pendingExecution.model;

			const runner = this.deps.createRunner(
				runnerConfig,
				runnerType,
				controller.signal,
				sessionId,
				() => this.markExecutionStarted(existingSession),
			);
			this.sessionManager.addAgentRunner(sessionId, runner);

			const resumePrompt = event
				? await this.withThreadCatchup(existingSession, event, taskInstructions)
				: taskInstructions;
			if (isCancelled()) {
				runner.stop();
				return;
			}

			// Reply posting is driven by `result` messages on the runner's stream
			// (see handleAgentMessage). We must not await turn completion here —
			// warm sessions hold the streaming prompt open across turns so the
			// start() promise only resolves when the whole session ends.
			existingSession.metadata ??= {};
			const queuedDashboard =
				dashboardMessages ??
				(recovering
					? existingSession.metadata.pendingExecution?.dashboardMessages
					: undefined);
			existingSession.metadata.pendingExecution = {
				dashboardMessages: queuedDashboard,
				prompt: resumePrompt,
				systemPrompt,
				runner: runnerType,
				model: runnerConfig.model,
				replyEvent: persistReplyEvent(
					event ?? existingSession.metadata.pendingExecution?.replyEvent,
				),
			};
			await this.deps.onStateChange();
			if (isCancelled()) return;
			const replyEvent =
				event ??
				(existingSession.metadata.pendingExecution.replyEvent as
					| TEvent
					| undefined);
			if (replyEvent)
				this.enqueueReply(
					sessionId,
					event
						? event
						: (this.adapter.restoreReplyEvent?.(replyEvent) ?? replyEvent),
				);
			const startPromise =
				runner.supportsStreamingInput && runner.startStreaming
					? runner.startStreaming(resumePrompt)
					: runner.start(resumePrompt);
			started = true;
			startPromise
				.then((sessionInfo: AgentSessionInfo) => {
					this.logger.info(
						`${this.adapter.platformName} session resumed: ${sessionInfo.sessionId} (was ${resumeSessionId})`,
					);
				})
				.catch((error: unknown) => {
					this.logger.error(
						`${this.adapter.platformName} resume session error for ${sessionId}`,
						error instanceof Error ? error : new Error(String(error)),
					);
					if (this.deps.isShuttingDown?.()) return;
					existingSession.status = AgentSessionStatus.Error;
					this.sessionManager.emit("sessionChanged", sessionId);
					void this.deps.onStateChange();
					this.clearPendingReplies(sessionId);
				})
				.finally(() => {
					releaseStart();
					if (
						!this.deps.isShuttingDown?.() &&
						existingSession.status !== AgentSessionStatus.Error
					) {
						this.drainDashboardMessages(sessionId);
						this.drainPendingFollowups(sessionId);
					}
				});
		} catch (error) {
			if (!this.deps.isShuttingDown?.())
				existingSession.status = AgentSessionStatus.Error;
			throw error;
		} finally {
			// start() can await concurrency admission before isRunning() is true.
			// Its completion releases the guard; setup errors/cancellation release here.
			if (!started) releaseStart();
		}
	}

	private getResumeInfo(
		session: CyrusAgentSession,
	): { sessionId?: string; runnerType: RunnerType } | undefined {
		if (session.claudeSessionId) {
			return { sessionId: session.claudeSessionId, runnerType: "claude" };
		}
		if (session.geminiSessionId) {
			return { sessionId: session.geminiSessionId, runnerType: "gemini" };
		}
		if (session.codexSessionId) {
			return { sessionId: session.codexSessionId, runnerType: "codex" };
		}
		if (session.cursorSessionId) {
			return { sessionId: session.cursorSessionId, runnerType: "cursor" };
		}
		if (session.opencodeSessionId) {
			return { sessionId: session.opencodeSessionId, runnerType: "opencode" };
		}
		if (
			session.metadata?.chatExecutionStarted === false &&
			session.metadata.pendingExecution
		)
			return { runnerType: session.metadata.pendingExecution.runner };
		return undefined;
	}

	private async markExecutionStarted(
		session: CyrusAgentSession,
	): ReturnType<RunnerStartCheckpoint> {
		if (session.metadata?.chatExecutionStarted !== false) return;
		// Persist before any provider side effects. Missing IDs after this boundary
		// require recovery; only an explicitly never-started turn can start afresh.
		await this.persistMessage(() => {
			session.metadata!.chatExecutionStarted = true;
			return () => {
				session.metadata!.chatExecutionStarted = false;
			};
		});
		// The capacity wrapper invokes this only when post-save cancellation or
		// admission rejection confirms that provider execution never began.
		return () =>
			this.persistMessage(() => {
				session.metadata!.chatExecutionStarted = false;
				return () => {
					session.metadata!.chatExecutionStarted = true;
				};
			});
	}

	/**
	 * Handle agent messages for chat sessions.
	 * Routes to the dedicated AgentSessionManager, and posts a reply when the
	 * SDK emits a `result` message (signalling turn completion).
	 */
	private async handleAgentMessage(
		sessionId: string,
		message: SDKMessage,
	): Promise<void> {
		await this.sessionManager.handleClaudeMessage(sessionId, message);

		if (message.type === "result") {
			await this.deps.onStateChange();
			// A `result` ends the turn, and the turn has seen every prompt
			// injected so far — drain the whole queue, not just one entry
			// (quick-succession messages get merged into a single turn).
			const events = this.drainReplies(sessionId);
			const runner = this.sessionManager.getAgentRunner(sessionId);
			// Queue already drained by an earlier merged turn? The reply still
			// belongs to this session's thread — post it via the last event.
			const replyEvent = events[0] ?? this.lastReplyEvent.get(sessionId);
			if (replyEvent && runner) {
				try {
					await this.adapter.postReply(replyEvent, runner);
				} catch (error) {
					this.logger.error(
						`Failed to post ${this.adapter.platformName} reply for session ${sessionId}`,
						error instanceof Error ? error : new Error(String(error)),
					);
				}
				// Fire-and-forget processed acknowledgement for every drained
				// event (e.g., swap the receipt reaction) — runs even when
				// postReply stayed silent.
				for (const event of events) {
					this.adapter.acknowledgeProcessed?.(event).catch((err: unknown) => {
						this.logger.warn(
							`Failed to acknowledge processed ${this.adapter.platformName} event: ${err instanceof Error ? err.message : err}`,
						);
					});
				}
			} else if (!replyEvent) {
				this.logger.warn(
					`Received result for session ${sessionId} with no pending reply event — nothing to post`,
				);
			}

			// The turn is done — deliver any follow-ups that arrived while busy.
			this.drainPendingFollowups(sessionId);
		}
	}

	private queuePendingFollowup(threadKey: string, event: TEvent): void {
		const queue = this.pendingFollowups.get(threadKey) ?? [];
		queue.push(event);
		this.pendingFollowups.set(threadKey, queue);
	}

	private threadKeyForSession(sessionId: string): string | undefined {
		for (const [threadKey, id] of this.threadSessions) {
			if (id === sessionId) {
				return threadKey;
			}
		}
		return undefined;
	}

	/**
	 * Re-dispatch any follow-ups queued for a thread while it was busy. Runs
	 * after the current turn settles (the runner has finalized), so each
	 * re-dispatched event takes the normal resume path. Any that still find the
	 * runner running re-queue themselves and are drained on the next completion.
	 */
	private drainPendingFollowups(sessionId: string): void {
		const threadKey = this.threadKeyForSession(sessionId);
		if (!threadKey) {
			return;
		}
		const queue = this.pendingFollowups.get(threadKey);
		if (!queue || queue.length === 0) {
			return;
		}
		this.pendingFollowups.delete(threadKey);
		// Defer so the just-finished runner has fully transitioned to not-running
		// before the follow-up is re-evaluated (otherwise it would re-queue).
		setImmediate(() => {
			if (
				this.sessionManager.getSession(sessionId)?.status ===
				AgentSessionStatus.Error
			)
				return;
			for (const event of queue) {
				this.handleEvent(event).catch((error: unknown) => {
					this.logger.error(
						`Failed to re-dispatch queued ${this.adapter.platformName} follow-up (thread ${threadKey})`,
						error instanceof Error ? error : new Error(String(error)),
					);
				});
			}
		});
	}

	private enqueueReply(sessionId: string, event: TEvent): void {
		const queue = this.pendingReplyEvents.get(sessionId) ?? [];
		queue.push(event);
		this.pendingReplyEvents.set(sessionId, queue);
		this.lastReplyEvent.set(sessionId, event);
	}

	private drainReplies(sessionId: string): TEvent[] {
		const queue = this.pendingReplyEvents.get(sessionId);
		if (!queue || queue.length === 0) return [];
		this.pendingReplyEvents.delete(sessionId);
		return queue;
	}

	/**
	 * Discard all queued reply events for a session. Called when the runner
	 * rejects before emitting a final `result` — without this, a later
	 * resumeSession() on the same sessionId would pair the stale events with
	 * the first `result` of the new runner.
	 */
	private clearPendingReplies(sessionId: string): void {
		this.lastReplyEvent.delete(sessionId);
		const queue = this.pendingReplyEvents.get(sessionId);
		if (!queue || queue.length === 0) return;
		this.logger.warn(
			`Discarding ${queue.length} pending ${this.adapter.platformName} reply event(s) for session ${sessionId} after runner error`,
		);
		this.pendingReplyEvents.delete(sessionId);
	}

	/**
	 * Create an empty workspace directory for a chat thread.
	 * Unlike repository-associated sessions, chat sessions use plain directories (not git worktrees).
	 */
	private async createWorkspace(
		threadKey: string,
	): Promise<{ path: string; isGitWorktree: boolean } | null> {
		try {
			const sanitizedKey = threadKey.replace(/[^a-zA-Z0-9.-]/g, "_");
			const workspacePath = join(
				this.deps.factoryHome,
				`${this.adapter.platformName}-workspaces`,
				sanitizedKey,
			);

			await mkdir(workspacePath, { recursive: true });

			return { path: workspacePath, isGitWorktree: false };
		} catch (error) {
			this.logger.error(
				`Failed to create ${this.adapter.platformName} workspace for thread ${threadKey}`,
				error instanceof Error ? error : new Error(String(error)),
			);
			return null;
		}
	}

	/**
	 * Build a runner config for a chat session.
	 * Delegates to RunnerConfigBuilder for config assembly.
	 */
	private async buildRunnerConfig(
		workspacePath: string,
		workspaceName: string | undefined,
		systemPrompt: string,
		sessionId: string,
		resumeSessionId?: string,
		runnerType?: RunnerType,
	): Promise<AgentRunnerConfig> {
		const sessionLogger = this.logger.withContext({
			sessionId,
			platform: this.adapter.platformName,
		});

		// Read live values from the provider at session-build time
		const provider = this.deps.chatRepositoryProvider;
		const repository = provider.getDefaultRepository();
		const repositoryPaths = provider.getRepositoryPaths();
		const skillsConfig = this.deps.resolveSkillsConfig
			? await this.deps.resolveSkillsConfig({ repository, repositoryPaths })
			: {};
		const linearWorkspaceId = provider.getDefaultLinearWorkspaceId();
		if (linearWorkspaceId && this.deps.ensureLinearTokenFresh) {
			await this.deps.ensureLinearTokenFresh(linearWorkspaceId);
		}

		return this.deps.runnerConfigBuilder.buildChatConfig({
			workspacePath,
			workspaceName,
			systemPrompt,
			sessionId,
			resumeSessionId,
			runnerType,
			factoryHome: this.deps.factoryHome,
			platformName: this.adapter.platformName,
			linearWorkspaceId,
			repository,
			repositoryPaths,
			repositories: provider.getRepositories?.(),
			platformMcpConfigOverrides: this.deps.getPlatformMcpConfigOverrides?.(),
			strictMcpConfig: this.deps.getStrictMcpConfig?.(),
			additionalWritableDirectories:
				this.deps.getAdditionalWritableDirectories?.(),
			plugins: skillsConfig.plugins,
			skills: skillsConfig.skills,
			opencodeGlobalConfig: this.deps.getOpenCodeGlobalConfig?.(),
			opencodeGlobalStateScope: this.deps.getOpenCodeGlobalStateScope?.(),
			logger: sessionLogger,
			onMessage: (message: SDKMessage) =>
				this.handleAgentMessage(sessionId, message),
			onError: (error: Error) => this.deps.onClaudeError(error),
		});
	}
}
