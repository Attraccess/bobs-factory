import { AsyncLocalStorage } from "node:async_hooks";
import { execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { LinearClient } from "@linear/sdk";
import type {
	McpServerConfig,
	SDKMessage,
	SessionStore,
	WarmQuery,
} from "bobs-factory-claude-runner";
import {
	buildBaseSessionEnv,
	ClaudeRunner,
	normalizeMcpHttpTransport,
} from "bobs-factory-claude-runner";
import { CodexRunner, callCodexMcpTool } from "bobs-factory-codex-runner";
import { ConfigUpdater } from "bobs-factory-config-updater";
import type {
	AgentActivityCreateInput,
	AgentEvent,
	AgentRunnerConfig,
	AgentSessionCreatedWebhook,
	AgentSessionPromptedWebhook,
	BaseBranchResolution,
	ContentUpdateMessage,
	CyrusAgentSession,
	EdgeWorkerConfig,
	GuidanceRule,
	IAgentRunner,
	IIssueTrackerService,
	ILogger,
	InternalMessage,
	Issue,
	IssueMinimal,
	IssueStateChangeMessage,
	IssueUnassignedWebhook,
	IssueUpdateWebhook,
	RepositoryConfig,
	RunnerType,
	SerializableEdgeWorkerState,
	SessionStartMessage,
	StopSignalMessage,
	UnassignMessage,
	UserPromptMessage,
	Webhook,
	WebhookAgentSession,
	WebhookIssue,
	WorkflowTriggerOrigin,
	Workspace,
} from "bobs-factory-core";
import {
	AgentSessionStatus,
	AgentSessionType,
	CLIIssueTrackerService,
	CLIRPCServer,
	createLogger,
	DEFAULT_PROXY_URL,
	executionEnvironment,
	GitHubTokenStore,
	isAgentSessionCreatedWebhook,
	isAgentSessionPromptedWebhook,
	isContentUpdateMessage,
	isIssueAssignedWebhook,
	isIssueCommentMentionWebhook,
	isIssueDeletedWebhook,
	isIssueNewCommentWebhook,
	isIssueStateChangeMessage,
	isIssueStateChangeWebhook,
	isIssueStateIdUpdateWebhook,
	isIssueTitleOrDescriptionUpdateWebhook,
	isIssueUnassignedWebhook,
	isSessionStartMessage,
	isStopSignalMessage,
	isUnassignMessage,
	isUserPromptMessage,
	PersistenceManager,
	type RunTitleJob,
	requireLinearWorkspaceId,
	resolvePath,
	WebhookIpValidator,
} from "bobs-factory-core";
import { CursorRunner } from "bobs-factory-cursor-runner";
import { GeminiRunner } from "bobs-factory-gemini-runner";
import {
	extractCommentAuthor,
	extractCommentBody,
	extractCommentId,
	extractCommentUrl,
	extractPRBaseBranchRef,
	extractPRBranchRef,
	extractPRNumber,
	extractPRTitle,
	extractRepoFullName,
	extractRepoName,
	extractRepoOwner,
	extractSessionKey,
	GitHubAppTokenProvider,
	GitHubCommentService,
	type GitHubCommentWebhookEvent,
	GitHubEventTransport,
	type GitHubPushPayload,
	type GitHubWebhookEvent,
	isCommentOnPullRequest,
	isIssueCommentPayload,
	isPullRequestReviewCommentPayload,
	isPullRequestReviewPayload,
	stripMention,
} from "bobs-factory-github-event-transport";
import type { GitLabWebhookEvent } from "bobs-factory-gitlab-event-transport";
import {
	extractDiscussionId,
	extractSessionKey as extractGitLabSessionKey,
	extractMRBaseBranchRef,
	extractMRBranchRef,
	extractMRIid,
	extractMRTitle,
	extractMRUrl,
	extractNoteAuthor,
	extractNoteBody,
	extractNoteId,
	extractNoteUrl,
	extractProjectId,
	extractProjectPath,
	GitLabCommentService,
	GitLabEventTransport,
	isNoteOnMergeRequest,
	stripMention as stripGitLabMention,
} from "bobs-factory-gitlab-event-transport";
import {
	LinearEventTransport,
	LinearIssueTrackerService,
	type LinearOAuthConfig,
} from "bobs-factory-linear-event-transport";
import {
	type CyrusToolsOptions,
	callConfiguredTool,
	createCyrusToolsServer,
	createFetchFailureModesClient,
	type FailureModesHttpClient,
	factoryContextInstructions,
	prepareFactoryContext,
	type ResolvedSession,
} from "bobs-factory-mcp-tools";
import { OpenCodeRunner } from "bobs-factory-opencode-runner";
import {
	SlackEventTransport,
	type SlackWebhookEvent,
} from "bobs-factory-slack-event-transport";
import {
	ZulipEventTransport,
	type ZulipWebhookEvent,
} from "bobs-factory-zulip-event-transport";
import { Sessions, streamableHttp } from "fastify-mcp";
import { ActivityPoster } from "./ActivityPoster.js";
import { AgentSessionManager } from "./AgentSessionManager.js";
import { AskUserQuestionHandler } from "./AskUserQuestionHandler.js";
import { AttachmentService } from "./AttachmentService.js";
import type { ChatRepositoryProvider } from "./ChatRepositoryProvider.js";
import { LiveChatRepositoryProvider } from "./ChatRepositoryProvider.js";
import type { ChatSessionHandlerDeps } from "./ChatSessionHandler.js";
import { ChatSessionHandler } from "./ChatSessionHandler.js";
import { ConfigManager, type RepositoryChanges } from "./ConfigManager.js";
import { DefaultSkillsDeployer } from "./DefaultSkillsDeployer.js";
import { EgressProxy } from "./EgressProxy.js";
import { resolveAgentSettings } from "./factory/AgentSettings.js";
import {
	executionCapabilities,
	validateProfileRunner,
} from "./factory/ExecutionCapabilities.js";
import {
	ExecutionEnvironmentResolver,
	type ResolvedExecutionEnvironment,
} from "./factory/ExecutionEnvironment.js";
import {
	ExecutionProfileStore,
	ExecutionSnapshotSchema,
} from "./factory/ExecutionProfiles.js";
import { FactoryPush } from "./factory/FactoryPush.js";
import { validateFactoryResult } from "./factory/FactoryResults.js";
import { FactoryServer } from "./factory/FactoryServer.js";
import {
	CaptureReuseError,
	captureEvidence,
	executeCommand,
	FactoryTools,
	parseAgentOutput,
	toolArguments,
} from "./factory/FactoryTools.js";
import { factoryFeedbackContext } from "./factory/FeedbackPolicy.js";
import {
	normalizeGitProviderConfig,
	resolveGitProvider,
} from "./factory/GitProvider.js";
import { isPullRequestSource } from "./factory/GitProviderReference.js";
import {
	validateGuideCoverage,
	validateGuideGeneration,
} from "./factory/Guide.js";
import {
	completedAgentResult,
	incrementalInstructions,
	incrementalRoleInstructions,
	roleProgress,
} from "./factory/Incremental.js";
import { issueSnapshot } from "./factory/issueSnapshot.js";
import {
	LaunchAdmission,
	type TicketLaunchReceipt,
} from "./factory/LaunchAdmission.js";
import type { ResolvedLaunchRequest } from "./factory/LaunchFields.js";
import { resolveLaunchRequest } from "./factory/LaunchFields.js";
import {
	assessFeedback,
	type MergeReadiness,
	recordFeedbackAssessment,
} from "./factory/MergeReadiness.js";
import {
	confirmedMerge,
	pendingMergeConfirmation,
} from "./factory/MergeRecovery.js";
import {
	OutputValidationError,
	outputValidationError,
} from "./factory/OutputValidation.js";
import { type QaScope, qaDigest, qaRequirementIssues } from "./factory/Qa.js";
import {
	normalizeQuestionResult,
	questionInstructions,
	questionNotification,
} from "./factory/Questions.js";
import { finalizeGuideFiles } from "./factory/ReviewFiles.js";
import {
	factoryReviewFixContext,
	recordReviewFix,
	validateReviewFix,
} from "./factory/ReviewRecovery.js";
import {
	buildTitleContext,
	RunTitleGenerator,
	type TitleContext,
	titleSystemPrompt,
} from "./factory/RunTitleGenerator.js";
import {
	type ChatState,
	SessionChat,
	steeringState,
} from "./factory/SessionChat.js";
import {
	inspectPullRequest,
	type TakeoverPullRequest,
	ticketIdentifier,
} from "./factory/Takeover.js";
import {
	nativeAdapter,
	originatingTicket,
	type TicketAdapter,
	TicketReferenceSchema,
	TicketTracking,
	taskbotAdapter,
	taskbotServer,
	taskbotSource,
} from "./factory/TicketTracking.js";
import { titleMcpConfig } from "./factory/TitleMcpConfig.js";
import {
	capacityInstructions,
	readPath as readFactoryPath,
	type Workflow,
	type WorkflowStep,
	workflowTriggerInstructions,
} from "./factory/Workflow.js";
import {
	type ExecutionContext,
	type FactoryRun,
	WorkflowRuntime,
} from "./factory/WorkflowRuntime.js";
import { resolveWorkflowSelector } from "./factory/WorkflowSelector.js";
import { GitService, setupExecutionScope } from "./GitService.js";
import { GlobalSessionRegistry } from "./GlobalSessionRegistry.js";
import {
	DEFAULT_MACHINE_CAPACITY,
	MachineCapacity,
} from "./MachineCapacity.js";
import { McpConfigService } from "./McpConfigService.js";
import { PromptBuilder } from "./PromptBuilder.js";
import type {
	IssueContextResult,
	PromptAssembly,
	PromptAssemblyInput,
	PromptComponent,
	PromptType,
} from "./prompt-assembly/types.js";
import {
	RepositoryRouter,
	type RepositoryRouterDeps,
} from "./RepositoryRouter.js";
import {
	capRunnerStarts,
	runnerCapacityState,
	waitForRunnerCapacity,
} from "./RunnerConcurrency.js";
import {
	RunnerConfigBuilder,
	resolveIssueMcpConfigPath,
} from "./RunnerConfigBuilder.js";
import { RunnerSelectionService } from "./RunnerSelectionService.js";
import { persistReplyEvent } from "./SessionRecovery.js";
import { SharedApplicationServer } from "./SharedApplicationServer.js";
import {
	type SkillSessionContext,
	SkillsPluginResolver,
} from "./SkillsPluginResolver.js";
import { SlackChatAdapter } from "./SlackChatAdapter.js";
import type { IActivitySink } from "./sinks/IActivitySink.js";
import { LinearActivitySink } from "./sinks/LinearActivitySink.js";
import { ToolPermissionResolver } from "./ToolPermissionResolver.js";
import type { AgentSessionData, EdgeWorkerEvents } from "./types.js";
import { UserAccessControl } from "./UserAccessControl.js";
import { ZulipChatAdapter } from "./ZulipChatAdapter.js";

export declare interface EdgeWorker {
	on<K extends keyof EdgeWorkerEvents>(
		event: K,
		listener: EdgeWorkerEvents[K],
	): this;
	emit<K extends keyof EdgeWorkerEvents>(
		event: K,
		...args: Parameters<EdgeWorkerEvents[K]>
	): boolean;
}

type CyrusToolsMcpContext = {
	contextId?: string;
};

/**
 * Unified edge worker that **orchestrates**
 *   capturing Linear webhooks,
 *   managing Claude Code processes, and
 *   processes results through to Linear Agent Activity Sessions
 */
export class EdgeWorker extends EventEmitter {
	private config: EdgeWorkerConfig;
	private repositories: Map<string, RepositoryConfig> = new Map(); // repository 'id' (internal, stored in config.json) mapped to the full repo config
	private agentSessionManager: AgentSessionManager; // Single instance managing all agent sessions across repositories
	private activitySinks: Map<string, IActivitySink> = new Map(); // Maps Linear workspace ID to activity sink (one per workspace, mirrors issueTrackers)
	private sessionRepositories: Map<string, string> = new Map(); // Maps session ID to repository ID
	private lastStopTimeBySession: Map<string, number> = new Map(); // Maps session ID to timestamp of last stop signal (for double-stop detection)
	private warmInstances: Map<string, WarmQuery> = new Map(); // Pre-warmed Claude sessions keyed by agentSessionId
	private issueTrackers: Map<string, IIssueTrackerService> = new Map(); // one issue tracker per Linear workspace (keyed by linearWorkspaceId)
	private linearEventTransport: LinearEventTransport | null = null; // Single event transport for webhook delivery
	private gitHubEventTransport: GitHubEventTransport | null = null; // GitHub event transport for forwarded GitHub webhooks
	private gitHubAppTokenProvider: GitHubAppTokenProvider | null = null; // Self-hosted GitHub App token minting
	private gitLabEventTransport: GitLabEventTransport | null = null; // GitLab event transport for forwarded GitLab webhooks
	private slackEventTransport: SlackEventTransport | null = null;
	private zulipEventTransport: ZulipEventTransport | null = null;
	private zulipChatSessionHandler: ChatSessionHandler<ZulipWebhookEvent> | null =
		null;
	private chatSessionHandler: ChatSessionHandler<SlackWebhookEvent> | null =
		null;
	private gitHubCommentService: GitHubCommentService; // Service for posting comments back to GitHub PRs
	private gitLabCommentService: GitLabCommentService; // Service for posting comments back to GitLab MRs
	private cliRPCServer: CLIRPCServer | null = null; // CLI RPC server for CLI platform mode
	private configUpdater: ConfigUpdater | null = null; // Single config updater for configuration updates
	private persistenceManager: PersistenceManager;
	private sharedApplicationServer: SharedApplicationServer;
	private factoryHome: string;
	private factoryRuntime?: WorkflowRuntime;
	private executionResolver?: ExecutionEnvironmentResolver;
	private ticketTracking?: TicketTracking;
	private titleGenerator?: RunTitleGenerator;
	private titleStarted = new Set<string>();
	private stateSaveQueue: Promise<void> = Promise.resolve();
	private pendingStateSave?: Promise<void>;
	private recoveryAbort = new AbortController();
	private preparationStarts = new Map<string, AbortController>();
	private stopping = false;
	private factoryServer?: FactoryServer;
	private factoryPush?: FactoryPush;
	private factoryChat = new SessionChat();
	private chatContinuations = new Set<string>();
	/** Per-org GitHub App installation tokens pushed by cyrus-hosted (lazy file-backed reads) */
	private githubTokenStore: GitHubTokenStore;
	private globalSessionRegistry: GlobalSessionRegistry; // Centralized session storage across all repositories
	private configPath?: string; // Path to config.json file
	/** @internal - Exposed for testing only */
	public repositoryRouter: RepositoryRouter; // Repository routing and selection
	private gitService: GitService;
	private activeWebhookCount = 0; // Track number of webhooks currently being processed
	// GitHub webhook handlers share a PR worktree, so only one may run per PR.
	private activeGitHubPrSessions = new Set<string>();
	private queuedGitHubPrEvents = new Map<string, GitHubCommentWebhookEvent[]>();
	/** Handler for AskUserQuestion tool invocations via Linear select signal */
	private askUserQuestionHandler: AskUserQuestionHandler;
	/** User access control for whitelisting/blacklisting Linear users */
	private userAccessControl: UserAccessControl;
	private logger: ILogger;
	// Extracted service modules
	private attachmentService: AttachmentService;
	private runnerSelectionService: RunnerSelectionService;
	/** Instance cap on concurrently executing runner sessions (see maxConcurrentSessions). */
	private runnerSlots: MachineCapacity;
	private toolPermissionResolver: ToolPermissionResolver;
	private mcpConfigService: McpConfigService;
	private runnerConfigBuilder: RunnerConfigBuilder;
	private activityPoster: ActivityPoster;
	private configManager: ConfigManager;
	private promptBuilder: PromptBuilder;
	private defaultSkillsDeployer: DefaultSkillsDeployer;
	private skillsPluginResolver: SkillsPluginResolver;
	private readonly factoryToolsMcpEndpoint = "/mcp/bobs-factory-tools";
	private factoryToolsMcpRegistered = false;
	private factoryToolsMcpRequestContext =
		new AsyncLocalStorage<CyrusToolsMcpContext>();
	private factoryToolsMcpSessions = new Sessions<any>();
	/** Validates webhook source IPs against known provider allowlists */
	private webhookIpValidator: WebhookIpValidator;
	/** Egress proxy for sandbox network traffic filtering and header injection */
	private egressProxy: EgressProxy | null = null;
	/** Base SDK sandbox settings to pass to ClaudeRunner sessions (set when proxy starts) */
	private sdkSandboxSettings:
		| import("bobs-factory-claude-runner").SandboxSettings
		| null = null;
	/** CA cert path for MITM TLS termination (passed per-session env, not process.env) */
	private egressCaCertPath: string | null = null;
	/**
	 * Remote SessionStore that mirrors Claude SDK transcripts to the Bob’s Factory
	 * hosted control plane. Enabled when all three of `BOBS_FACTORY_APP_URL`,
	 * `BOBS_FACTORY_API_KEY`, and `BOBS_FACTORY_TEAM_ID` are set — used by any Claude
	 * runner spawned from this worker so transcripts survive ephemeral
	 * worktrees and are resumable from any host.
	 */
	private claudeSessionStore: SessionStore | null = null;
	/**
	 * Tracks recently processed issue-update webhook keys to prevent
	 * duplicate deliveries from Linear's at-least-once delivery.
	 * Key format: `${createdAt}:${issueId}`
	 */
	private processedIssueUpdateKeys = new Set<string>();

	/**
	 * Sessions parked due to blocked-by dependencies.
	 * Key: Linear issue ID (the blocked issue)
	 * Value: All data needed to replay initializeAgentRunner when unblocked
	 */
	private pendingTriggerOrigins = new Map<string, WorkflowTriggerOrigin>();
	private pendingTriggerMessages = new Map<string, string | null>();
	private launchAdmission?: LaunchAdmission;
	private inFlightTicketStarts = new Set<string>();

	private parkedSessions = new Map<
		string,
		{
			agentSession: AgentSessionCreatedWebhook["agentSession"];
			repositories: RepositoryConfig[];
			linearWorkspaceId: string;
			guidance?: AgentSessionCreatedWebhook["guidance"];
			commentBody?: string | null;
			baseBranchOverrides?: Map<string, string>;
			routingMethod?: string;
			blockingIssueIds: string[];
		}
	>();

	/**
	 * Resolve `~/` prefixes in path-bearing config fields that are otherwise
	 * passed verbatim to `fs.readFileSync` (which does not expand tildes).
	 * Repository-scoped paths are normalized separately in addNew /
	 * updateModified; this covers the platform-level MCP config lists that
	 * cyrus-hosted writes with literal `~/.bobs-factory/...` prefixes when
	 * generating self-host config.
	 */
	private static normalizeConfigPaths(
		config: EdgeWorkerConfig,
	): EdgeWorkerConfig {
		const resolveList = (paths: string[] | undefined): string[] | undefined =>
			paths ? paths.map(resolvePath) : undefined;
		return {
			...config,
			slackMcpConfigs: resolveList(config.slackMcpConfigs),
			zulipMcpConfigs: resolveList(config.zulipMcpConfigs),
			linearMcpConfigs: resolveList(config.linearMcpConfigs),
			githubMcpConfigs: resolveList(config.githubMcpConfigs),
		};
	}

	constructor(config: EdgeWorkerConfig) {
		super();
		this.config = EdgeWorker.normalizeConfigPaths(config);
		this.factoryHome = config.factoryHome;
		this.githubTokenStore = new GitHubTokenStore(this.factoryHome);
		this.logger = createLogger({ component: "EdgeWorker" });
		this.persistenceManager = new PersistenceManager(
			join(this.factoryHome, "state"),
		);

		// Independent self-hosting keeps transcripts local. Host credentials are unchanged.

		// Initialize GitHub comment service for posting replies to GitHub PRs
		this.gitHubCommentService = new GitHubCommentService();

		// Initialize GitLab comment service for posting replies to GitLab MRs.
		// For Self-Managed GitLab the API base URL must be derived from the
		// configured repos' gitlabUrl host; otherwise the service falls back to
		// gitlab.com and 404s on every reply. Picks the first configured
		// GitLab repo's host (single GitLab host per Bob’s Factory instance).
		const firstGitlabRepo = config.repositories.find((r) => r.gitlabUrl);
		let gitlabApiBaseUrl: string | undefined;
		if (firstGitlabRepo?.gitlabUrl) {
			try {
				gitlabApiBaseUrl = new URL(firstGitlabRepo.gitlabUrl).origin;
			} catch {
				// malformed gitlabUrl — leave undefined and fall through to default
			}
		}
		this.gitLabCommentService = new GitLabCommentService(
			gitlabApiBaseUrl ? { apiBaseUrl: gitlabApiBaseUrl } : undefined,
		);

		// Initialize global session registry (centralized session storage)
		this.globalSessionRegistry = new GlobalSessionRegistry();

		// Initialize repository router with dependencies
		const repositoryRouterDeps: RepositoryRouterDeps = {
			fetchIssueLabels: async (issueId: string, linearWorkspaceId: string) => {
				// Use workspace ID directly from webhook context (Linear-native source)
				const issueTracker = this.issueTrackers.get(linearWorkspaceId);
				if (!issueTracker) return [];

				// Use platform-agnostic getIssueLabels method
				return await issueTracker.getIssueLabels(issueId);
			},
			fetchIssueDescription: async (
				issueId: string,
				linearWorkspaceId: string,
			): Promise<string | undefined> => {
				// Use workspace ID directly from webhook context (Linear-native source)
				const issueTracker = this.issueTrackers.get(linearWorkspaceId);
				if (!issueTracker) return undefined;

				// Fetch issue and get description
				try {
					const issue = await issueTracker.fetchIssue(issueId);
					return issue?.description ?? undefined;
				} catch (error) {
					this.logger.error(
						`Failed to fetch issue description for routing:`,
						error,
					);
					return undefined;
				}
			},
			hasActiveSession: (issueId: string, _repositoryId: string) => {
				const activeSessions =
					this.agentSessionManager.getActiveSessionsByIssueId(issueId);
				return activeSessions.length > 0;
			},
			getIssueTracker: (linearWorkspaceId: string) => {
				return this.getIssueTrackerForWorkspace(linearWorkspaceId);
			},
		};
		this.repositoryRouter = new RepositoryRouter(repositoryRouterDeps);
		this.gitService = new GitService({
			factoryHome: this.factoryHome,
			capacity: () => this.runnerSlots,
		});

		// Initialize AskUserQuestion handler for elicitation via Linear select signal
		this.askUserQuestionHandler = new AskUserQuestionHandler({
			getIssueTracker: (linearWorkspaceId: string) => {
				return this.getIssueTrackerForWorkspace(linearWorkspaceId) ?? null;
			},
		});

		// Initialize webhook IP validator
		// Enabled by default in self-hosted mode (BOBS_FACTORY_HOST_EXTERNAL=true),
		// can be overridden with WEBHOOK_IP_VALIDATION=false to disable
		const isExternalHost =
			process.env.BOBS_FACTORY_HOST_EXTERNAL?.toLowerCase().trim() === "true";
		const ipValidationEnv =
			process.env.WEBHOOK_IP_VALIDATION?.toLowerCase().trim();
		const ipValidationEnabled =
			ipValidationEnv === "true" ||
			(ipValidationEnv !== "false" && isExternalHost);
		this.webhookIpValidator = new WebhookIpValidator({
			enabled: ipValidationEnabled,
		});
		if (ipValidationEnabled) {
			this.logger.info("Webhook IP validation enabled");
		}

		// Initialize shared application server
		const serverPort = config.serverPort || config.webhookPort || 3456;
		const serverHost = config.serverHost || "localhost";
		const skipTunnel = config.platform === "cli"; // Skip Cloudflare tunnel in CLI mode
		this.sharedApplicationServer = new SharedApplicationServer(
			serverPort,
			serverHost,
			skipTunnel,
		);

		// Create single AgentSessionManager instance shared across all repositories
		this.agentSessionManager = new AgentSessionManager(
			(childSessionId: string) => {
				this.logger.debug(
					`Looking up parent session for child ${childSessionId}`,
				);
				const parentId =
					this.globalSessionRegistry.getParentSessionId(childSessionId);
				this.logger.debug(
					`Child ${childSessionId} -> Parent ${parentId || "not found"}`,
				);
				return parentId;
			},
			async (parentSessionId, prompt, childSessionId) => {
				const repoId = this.sessionRepositories.get(childSessionId);
				const repo = repoId ? this.repositories.get(repoId) : undefined;
				if (!repo) {
					this.logger.error(
						`No repository found for child session ${childSessionId}`,
					);
					return;
				}
				await this.handleResumeParentSession(
					parentSessionId,
					prompt,
					childSessionId,
				);
			},
		);

		// Initialize repositories with path resolution
		for (const repo of config.repositories) {
			if (repo.isActive !== false) {
				// Resolve paths that may contain tilde (~) prefix
				const resolvedRepo: RepositoryConfig = {
					...repo,
					repositoryPath: resolvePath(repo.repositoryPath),
					gitProvider: normalizeGitProviderConfig(repo.gitProvider),
					workspaceBaseDir: resolvePath(repo.workspaceBaseDir),
					mcpConfigPath: Array.isArray(repo.mcpConfigPath)
						? repo.mcpConfigPath.map(resolvePath)
						: repo.mcpConfigPath
							? resolvePath(repo.mcpConfigPath)
							: undefined,
					promptTemplatePath: repo.promptTemplatePath
						? resolvePath(repo.promptTemplatePath)
						: undefined,
				};

				this.repositories.set(repo.id, resolvedRepo);
			}
		}

		// Initialize issue trackers per workspace (one per workspace, not per repo)
		if (config.linearWorkspaces) {
			for (const [linearWorkspaceId, wsConfig] of Object.entries(
				config.linearWorkspaces,
			)) {
				const issueTracker =
					this.config.platform === "cli"
						? (() => {
								const service = new CLIIssueTrackerService();
								service.seedDefaultData();
								return service;
							})()
						: new LinearIssueTrackerService(
								new LinearClient({
									accessToken: wsConfig.linearToken,
								}),
								this.buildOAuthConfig(linearWorkspaceId),
							);
				this.issueTrackers.set(linearWorkspaceId, issueTracker);
			}
		}

		// Create activity sinks per workspace (one per workspace, mirrors issueTrackers)
		for (const [workspaceId, issueTracker] of this.issueTrackers) {
			this.activitySinks.set(
				workspaceId,
				new LinearActivitySink(issueTracker, workspaceId),
			);
		}

		// Initialize user access control with global and per-repository configs
		const repoAccessConfigs = new Map<
			string,
			import("bobs-factory-core").UserAccessControlConfig | undefined
		>();
		for (const repo of config.repositories) {
			if (repo.isActive !== false) {
				repoAccessConfigs.set(repo.id, repo.userAccessControl);
			}
		}
		this.userAccessControl = new UserAccessControl(
			config.userAccessControl,
			repoAccessConfigs,
		);

		// Initialize extracted service modules
		this.attachmentService = new AttachmentService(
			this.logger,
			this.factoryHome,
			this.config.linearWorkspaces || {},
		);
		this.runnerSelectionService = new RunnerSelectionService(this.config);
		this.runnerSlots = new MachineCapacity(
			this.config.maxConcurrentSessions,
			join(this.factoryHome, "machine-capacity"),
		);
		this.toolPermissionResolver = new ToolPermissionResolver(
			this.config,
			this.logger,
		);
		this.mcpConfigService = new McpConfigService({
			getLinearTokenForWorkspace: (workspaceId) =>
				this.getLinearTokenForWorkspace(workspaceId),
			getIssueTracker: (workspaceId) =>
				this.issueTrackers.get(workspaceId) as
					| (IIssueTrackerService & {
							getClient?: () => import("@linear/sdk").LinearClient;
					  })
					| undefined,
			getCyrusToolsMcpUrl: () => this.getCyrusToolsMcpUrl(),
			createCyrusToolsOptions: (parentSessionId) =>
				this.createCyrusToolsOptions(parentSessionId),
		});
		this.runnerConfigBuilder = new RunnerConfigBuilder(
			this.toolPermissionResolver,
			this.mcpConfigService,
			this.runnerSelectionService,
		);
		this.activityPoster = new ActivityPoster(
			this.issueTrackers,
			this.repositories,
			this.logger,
		);
		this.configManager = new ConfigManager(
			this.config,
			this.logger,
			this.configPath,
			this.repositories,
		);
		this.promptBuilder = new PromptBuilder({
			logger: this.logger,
			repositories: this.repositories,
			issueTrackers: this.issueTrackers,
			gitService: this.gitService,
		});
		this.defaultSkillsDeployer = new DefaultSkillsDeployer(
			this.factoryHome,
			this.logger,
		);
		this.skillsPluginResolver = new SkillsPluginResolver(
			this.factoryHome,
			this.logger,
		);

		// Components will be initialized and registered in start() method before server starts
	}

	/**
	 * Start the edge worker
	 */
	async start(): Promise<void> {
		await this.runnerSlots.ready();
		const factory = this.getFactoryRuntime();
		await this.runnerSlots.reconcileQueue((identity) => {
			const prefix = `${factory.directory}:run:`;
			if (!identity.startsWith(prefix)) return false;
			const id = identity.slice(prefix.length).split(":")[0]!;
			const run = factory.runs.get(id);
			return !run || ["completed", "failed", "stopped"].includes(run.status);
		});

		// Deploy default skills to factoryHome if not already present (one-time setup)
		await this.defaultSkillsDeployer.ensureDeployed();

		// Scaffold user skills plugin manifest if needed (one-time setup)
		await this.skillsPluginResolver.ensureUserPluginScaffolded();

		// Load persisted state for each repository
		await this.loadPersistedState();
		await this.runnerSlots.reconcileQueue((identity) => {
			const preparationPrefix = `${this.factoryHome}:preparation:`;
			if (identity.startsWith(preparationPrefix)) {
				const receipt = this.getLaunchAdmission()
					.values()
					.find(
						(r) => r.sessionId === identity.slice(preparationPrefix.length),
					);
				return !receipt || receipt.phase === "settled";
			}
			const prefix = `${this.factoryHome}:session:`;
			if (!identity.startsWith(prefix)) return false;
			const session = this.titleSession(identity.slice(prefix.length));
			return (
				!session ||
				Boolean(
					[AgentSessionStatus.Complete, AgentSessionStatus.Error].includes(
						session.status,
					),
				)
			);
		});

		// Pre-warm the 30 most recent Claude sessions in the background
		// so their first query after restart has near-zero cold-start latency.
		// Disabled by default; opt in with BOBS_FACTORY_ENABLE_WARM_SESSIONS=1.
		if (this.isWarmSessionsEnabled()) {
			this.warmupRecentSessions(30).catch((err) => {
				this.logger.warn("Session warmup failed (non-fatal):", err);
			});
		}

		// Start config file watcher via ConfigManager
		this.configManager.on(
			"configChanged",
			async (changes: RepositoryChanges) => {
				const strictMcpConfigChanged =
					(this.config.strictMcpConfig ?? true) !==
					(changes.newConfig.strictMcpConfig ?? true);
				if (strictMcpConfigChanged) {
					for (const warmSession of this.warmInstances.values()) {
						warmSession.close();
					}
					this.warmInstances.clear();
				}
				this.updateLinearWorkspaceTokens(changes.newConfig);
				await this.removeDeletedRepositories(changes.removed);
				await this.updateModifiedRepositories(changes.modified);
				await this.addNewRepositories(changes.added);
				// Live-update sandbox / egress proxy settings
				await this.applySandboxConfigChanges(changes.newConfig);
				if (
					changes.newConfig.maxConcurrentSessions !==
					this.config.maxConcurrentSessions
				) {
					await this.runnerSlots.setLimit(
						changes.newConfig.maxConcurrentSessions ?? DEFAULT_MACHINE_CAPACITY,
					);
				}
				this.config = EdgeWorker.normalizeConfigPaths(changes.newConfig);
				this.configManager.setConfig(changes.newConfig);
				this.runnerSelectionService.setConfig(changes.newConfig);
				this.toolPermissionResolver.setConfig(changes.newConfig);
			},
		);
		this.configManager.startConfigWatcher();

		// Start egress proxy if sandbox is enabled.
		// The proxy intercepts Bash-spawned subprocess traffic only (git, gh, npm, etc.).
		// Claude's inference API, MCP servers, and built-in file tools bypass the proxy.
		if (this.config.sandbox?.enabled) {
			this.logger.info("🛡️  Sandbox egress proxy: starting...");
			this.egressProxy = new EgressProxy(
				this.config.sandbox,
				this.factoryHome,
				this.logger,
			);
			await this.egressProxy.start();

			// Store base SDK sandbox settings — merged per-session with worktree path
			this.sdkSandboxSettings = {
				enabled: true,
				network: {
					httpProxyPort: this.egressProxy.getHttpProxyPort(),
					socksProxyPort: this.egressProxy.getSocksProxyPort(),
				},
			};

			const systemWideCert = this.config.sandbox?.systemWideCert === true;
			this.logCertTrustInstructions(
				this.egressProxy.getCACertPath(),
				systemWideCert,
			);

			// When systemWideCert is true, the OS cert store handles trust
			// for all tools — skip per-session cert env vars.
			if (!systemWideCert) {
				this.egressCaCertPath = this.egressProxy.buildCACertBundle();
			}
		} else {
			this.logger.info(
				"🛡️  Sandbox egress proxy: disabled (set sandbox.enabled=true in config.json to enable)",
			);
		}

		// Initialize and register components BEFORE starting server (routes must be registered before listen())
		await this.initializeComponents();

		// Refresh GitHub webhook allowlist from /meta API (non-blocking)
		if (this.webhookIpValidator.isEnabled()) {
			this.webhookIpValidator.refreshGitHubAllowlist().catch((error) => {
				this.logger.warn(
					"Failed to refresh GitHub webhook allowlist",
					error instanceof Error ? error : new Error(String(error)),
				);
			});
		}

		// Start shared application server (this also starts Cloudflare tunnel if CLOUDFLARE_TOKEN is set)
		await this.sharedApplicationServer.start();
		this.factoryPush?.attach(this.getFactoryRuntime(), {
			sessions: () =>
				this.getAllKnownSessions().map((session) => {
					const work = session.agentRunner?.getPendingWork?.();
					return {
						id: session.id,
						status: session.status,
						stopped: session.metadata?.intentionalStop,
						// Saved execution input survives normal completion. Active recovery
						// has no eligible status; only shutdown suppresses terminal alerts.
						recovering: this.stopping,
						pendingWork: Boolean(
							work && (work.sessionCrons.length || work.backgroundTasks.length),
						),
					};
				}),
			subscribe: (notify) => {
				this.agentSessionManager.on("sessionChanged", notify);
				this.on("chatSessionChanged", notify);
				return () => {
					this.agentSessionManager.off("sessionChanged", notify);
					this.off("chatSessionChanged", notify);
				};
			},
		});
		this.recoverFactoryRuns();
		this.recoverPendingTicketLaunches();
	}

	/**
	 * Initialize and register components (routes) before server starts
	 */
	private async initializeComponents(): Promise<void> {
		if (
			process.env.BOBS_FACTORY_FACTORY_PORT &&
			process.env.BOBS_FACTORY_FACTORY_PORT !== "0"
		) {
			this.factoryPush ??= new FactoryPush(this.factoryHome);
			this.factoryServer = new FactoryServer(this.getFactoryRuntime(), {
				push: this.factoryPush,
				capacity: this.runnerSlots,
				defaultRunner: () => this.runnerSelectionService.getDefaultRunner(),
				repositories: () =>
					Array.from(this.repositories.values())
						.filter((repo) => repo.isActive)
						.map((repo) => ({ id: repo.id, name: repo.name })),
				sessions: () =>
					this.getAllKnownSessions().map((session) => ({
						id: session.id,
						title: session.displayTitle ?? session.issue?.title ?? session.id,
						titleGeneration: session.titleGeneration,
						status:
							runnerCapacityState(session.agentRunner)?.phase === "queued"
								? "capacity-waiting"
								: session.agentRunner?.isRunning()
									? "running"
									: session.status,
						createdAt: new Date(session.createdAt).toISOString(),
						triggerOrigin: session.triggerOrigin,
						workspace: session.workspace.path,
						repositoryId: this.sessionRepositories.get(session.id),
					})),
				entries: (id) =>
					this.agentSessionManager.getSession(id)
						? this.agentSessionManager.getSessionEntries(id)
						: (this.activeChatSessionHandlers
								.find((handler) =>
									handler
										.getAllChatSessions()
										.some((session) => session.id === id),
								)
								?.getSessionEntries(id) ?? []),
				subscribe: (notify) => {
					this.agentSessionManager.on("sessionChanged", notify);
					// Chat handlers are registered after this listener starts. Use the
					// worker bridge so later handlers also reach existing SSE clients.
					this.on("chatSessionChanged", notify);
					return () => {
						this.agentSessionManager.off("sessionChanged", notify);
						this.off("chatSessionChanged", notify);
					};
				},
				previewExecution: async (
					repositoryId,
					selection,
					runner,
					workflowId,
					model,
				) => {
					const snapshot = this.getFactoryRuntime().executionProfiles.select(
						repositoryId,
						selection,
					);
					if (!snapshot)
						return { mode: "Legacy", validation: "Existing runner behavior" };
					const id = `preview-${randomUUID()}`;
					try {
						const temporary = {
							id,
							repositoryId,
							workspace: "",
							runner,
							executionSnapshot: snapshot,
							model,
						} as FactoryRun;
						if (workflowId) {
							const runtime = this.getFactoryRuntime();
							const selected = runtime.selectWorkflow([], "manual", workflowId);
							await this.preflightExecution(
								temporary,
								selected,
								runtime.listWorkflows(),
							);
						}
						const resolved = await this.resolveRunExecution(temporary);
						return {
							diagnostics: temporary.executionDiagnostics,
							snapshot,
							accounts: resolved?.accounts,
							mcp: Object.keys(resolved?.mcp ?? {}),
							validation:
								"Configuration and repository accounts checked. Runner API owner remains declared and unverified",
						};
					} finally {
						await rm(
							join(this.factoryHome, "factory", "execution-private", id),
							{
								recursive: true,
								force: true,
							},
						);
					}
				},
				chat: (id) => this.factoryChatState(id),
				message: (id, text, messageId) =>
					this.sendFactoryChat(id, text, messageId),
				start: (input) => this.startManualFactoryRun(input),
				followup: (id, feedback) => this.startFactoryFollowup(id, feedback),
				retryTitle: (id) => this.retryRunTitle(id),
				stop: (id) => {
					this.settleTicketLaunch(id);
					this.factoryRuntime?.runs.has(id) && this.factoryRuntime.stop(id);
					this.cancelRunTitle(id);
					const chatHandler = this.chatHandlerForSession(id);
					if (chatHandler) chatHandler.stopSession(id);
					else {
						this.agentSessionManager.requestSessionStop(id);
						this.titleSession(id)?.agentRunner?.stop();
					}
					void this.savePersistedState();
				},
			});
			await this.factoryServer.start(
				Number(process.env.BOBS_FACTORY_FACTORY_PORT),
			);
			this.logger.info(
				`Software factory UI: http://127.0.0.1:${process.env.BOBS_FACTORY_FACTORY_PORT}`,
			);
		}
		// 1. Platform-specific initialization
		if (this.config.platform === "cli") {
			// CLI mode: ensure a CLIIssueTrackerService exists for each repo workspace.
			// Repos from config.repositories don't go through linearWorkspaces init,
			// so we create trackers here if missing.
			for (const repo of this.repositories.values()) {
				const wsId = repo.linearWorkspaceId;
				if (wsId && !this.issueTrackers.has(wsId)) {
					const service = new CLIIssueTrackerService();
					service.seedDefaultData();
					this.issueTrackers.set(wsId, service);
					const activitySink = new LinearActivitySink(service, wsId);
					this.activitySinks.set(wsId, activitySink);
				}
			}

			const firstCliTracker = Array.from(this.issueTrackers.values()).find(
				(tracker): tracker is CLIIssueTrackerService =>
					tracker instanceof CLIIssueTrackerService,
			);

			if (firstCliTracker) {
				this.cliRPCServer = new CLIRPCServer({
					fastifyServer: this.sharedApplicationServer.getFastifyInstance(),
					issueTracker: firstCliTracker,
					version: "1.0.0",
				});

				// Register the /cli/rpc endpoint
				this.cliRPCServer.register();

				this.logger.info("✅ CLI RPC server registered");
				this.logger.info("   RPC endpoint: /cli/rpc");

				// Create CLI event transport and register listener
				const cliEventTransport = firstCliTracker.createEventTransport({
					platform: "cli",
					fastifyServer: this.sharedApplicationServer.getFastifyInstance(),
				});

				// Listen for webhook events
				cliEventTransport.on("event", (event: AgentEvent) => {
					const repos = Array.from(this.repositories.values());
					this.handleWebhook(event as unknown as Webhook, repos);
				});

				// Listen for unified internal messages (used by F1 to emit
				// IssueStateChangeMessage when an issue is terminated).
				cliEventTransport.on("message", (message: InternalMessage) => {
					this.handleMessage(message);
				});

				// Listen for errors
				cliEventTransport.on("error", (error: Error) => {
					this.handleError(error);
				});

				// Register the CLI event transport endpoints
				cliEventTransport.register();

				this.logger.info("✅ CLI event transport registered");
				this.logger.info(
					"   Event listener: listening for AgentSessionCreated events",
				);
			}
		} else {
			// Linear mode: Create and register LinearEventTransport
			const useDirectWebhooks =
				process.env.LINEAR_DIRECT_WEBHOOKS?.toLowerCase() === "true";
			const verificationMode = useDirectWebhooks ? "direct" : "proxy";

			// Get appropriate secret based on mode
			const secret = useDirectWebhooks
				? process.env.LINEAR_WEBHOOK_SECRET || ""
				: process.env.BOBS_FACTORY_API_KEY || "";

			this.linearEventTransport = new LinearEventTransport({
				fastifyServer: this.sharedApplicationServer.getFastifyInstance(),
				verificationMode,
				secret,
				ipAllowlist:
					verificationMode === "direct" && this.webhookIpValidator.isEnabled()
						? this.webhookIpValidator.getAllowlist("linear")
						: undefined,
			});

			// Listen for legacy webhook events (deprecated, kept for backward compatibility)
			this.linearEventTransport.on("event", (event: AgentEvent) => {
				const repos = Array.from(this.repositories.values());
				this.handleWebhook(event as unknown as Webhook, repos);
			});

			// Listen for unified internal messages (new message bus)
			this.linearEventTransport.on("message", (message: InternalMessage) => {
				this.handleMessage(message);
			});

			// Listen for errors
			this.linearEventTransport.on("error", (error: Error) => {
				this.handleError(error);
			});

			// Register the /linear-webhook endpoint (with /webhook retained as a deprecated alias)
			this.linearEventTransport.register();

			this.logger.info(
				`✅ Linear event transport registered (${verificationMode} mode)`,
			);
			this.logger.info(
				`   Webhook endpoint: ${this.sharedApplicationServer.getWebhookUrl()}`,
			);
		}

		// 2. Register GitHub and Slack event transports unconditionally
		// These don't require repositories and must be available during onboarding
		// for webhook URL verification to succeed.
		this.registerGitHubEventTransport();
		this.registerGitLabEventTransport();
		this.registerSlackEventTransport();
		this.registerZulipEventTransport();
		this.restoreChatSessionOwnership();

		// 3. Create and register ConfigUpdater (both platforms)
		this.configUpdater = new ConfigUpdater(
			this.sharedApplicationServer.getFastifyInstance(),
			this.factoryHome,
			() => process.env.BOBS_FACTORY_API_KEY || "",
		);

		// Register config update routes
		this.configUpdater.register();

		this.logger.info("✅ Config updater registered");
		this.logger.info(
			"   Routes: /api/update/bobs-factory-config, /api/update/bobs-factory-env,",
		);
		this.logger.info(
			"           /api/update/repository, /api/update/test-mcp, /api/update/configure-mcp",
		);

		// 3. Register MCP endpoint for bobs-factory-tools on the same Fastify server/port
		await this.registerCyrusToolsMcpEndpoint();
		// 4. Register /status endpoint for process activity monitoring
		this.registerStatusEndpoint();

		// 5. Register /version endpoint for CLI version info
		this.registerVersionEndpoint();
	}

	/**
	 * Register the /status endpoint for checking if the process is busy or idle
	 * This endpoint is used to determine if the process can be safely restarted
	 */
	private registerStatusEndpoint(): void {
		const fastify = this.sharedApplicationServer.getFastifyInstance();

		fastify.get("/status", async (_request, reply) => {
			const status = this.computeStatus();
			return reply.status(200).send({ status });
		});

		this.logger.info("✅ Status endpoint registered");
		this.logger.info("   Route: GET /status");
	}

	/**
	 * Register the /version endpoint for CLI version information
	 * This endpoint is used by dashboards to display the installed CLI version
	 */
	private registerVersionEndpoint(): void {
		const fastify = this.sharedApplicationServer.getFastifyInstance();

		fastify.get("/version", async (_request, reply) => {
			return reply.status(200).send({
				cyrus_cli_version: this.config.version ?? null,
			});
		});

		this.logger.info("✅ Version endpoint registered");
		this.logger.info("   Route: GET /version");
	}

	/**
	 * Register the GitHub event transport for receiving forwarded GitHub webhooks from CYHOST.
	 * This creates a /github-webhook endpoint that handles @cyrusagent mentions on GitHub PRs.
	 */
	private registerGitHubEventTransport(): void {
		// Use direct GitHub signature verification only when BOTH:
		// 1. GITHUB_WEBHOOK_SECRET is set (we have the secret to verify)
		// 2. BOBS_FACTORY_HOST_EXTERNAL is true (self-hosted: GitHub sends directly to us)
		// On cloud droplets, CYHOST forwards webhooks with Bearer token auth
		// (it verifies the GitHub signature itself and doesn't forward the headers).
		const isExternalHost =
			process.env.BOBS_FACTORY_HOST_EXTERNAL?.toLowerCase().trim() === "true";
		const hasGithubWebhookSecret =
			process.env.GITHUB_WEBHOOK_SECRET != null &&
			process.env.GITHUB_WEBHOOK_SECRET !== "";
		const useSignatureVerification = isExternalHost && hasGithubWebhookSecret;
		const verificationMode = useSignatureVerification ? "signature" : "proxy";
		const secret = useSignatureVerification
			? process.env.GITHUB_WEBHOOK_SECRET!
			: process.env.BOBS_FACTORY_API_KEY || "";

		this.gitHubEventTransport = new GitHubEventTransport({
			fastifyServer: this.sharedApplicationServer.getFastifyInstance(),
			verificationMode,
			secret,
			ipAllowlist:
				useSignatureVerification && this.webhookIpValidator.isEnabled()
					? this.webhookIpValidator.getAllowlist("github")
					: undefined,
		});

		// Listen for legacy GitHub webhook events (deprecated, kept for backward compatibility)
		this.gitHubEventTransport.on("event", (event: GitHubWebhookEvent) => {
			// Route push events to the base branch notification handler
			if (event.eventType === "push") {
				this.handleGitHubPushWebhook(event.payload as GitHubPushPayload).catch(
					(error) => {
						this.logger.error(
							"Failed to handle GitHub push webhook",
							error instanceof Error ? error : new Error(String(error)),
						);
					},
				);
				return;
			}
			this.handleGitHubWebhook(event as GitHubCommentWebhookEvent).catch(
				(error) => {
					this.logger.error(
						"Failed to handle GitHub webhook",
						error instanceof Error ? error : new Error(String(error)),
					);
				},
			);
		});

		// Listen for unified internal messages (new message bus)
		this.gitHubEventTransport.on("message", (message: InternalMessage) => {
			this.handleMessage(message);
		});

		// Listen for errors
		this.gitHubEventTransport.on("error", (error: Error) => {
			this.handleError(error);
		});

		// Register the /github-webhook endpoint
		this.gitHubEventTransport.register();

		// Initialize GitHub App token provider for self-hosted users
		const appId = process.env.GITHUB_APP_ID;
		const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
		if (appId && installationId) {
			const pemPath = join(this.factoryHome, "github-app.pem");
			this.gitHubAppTokenProvider = new GitHubAppTokenProvider({
				appId,
				installationId,
				privateKeyPath: pemPath,
			});
			this.logger.info(
				"GitHub App token provider initialized (self-hosted mode)",
			);
		}

		this.logger.info(
			`GitHub event transport registered (${verificationMode} mode)`,
		);
		this.logger.info("Webhook endpoint: POST /github-webhook");
	}

	/**
	 * Register the GitLab event transport for receiving forwarded GitLab webhooks.
	 * This creates a /gitlab-webhook endpoint that handles note events on merge requests.
	 */
	private registerGitLabEventTransport(): void {
		const isExternalHost =
			process.env.BOBS_FACTORY_HOST_EXTERNAL?.toLowerCase().trim() === "true";
		const hasGitlabWebhookSecret =
			process.env.GITLAB_WEBHOOK_SECRET != null &&
			process.env.GITLAB_WEBHOOK_SECRET !== "";
		const useSignatureVerification = isExternalHost && hasGitlabWebhookSecret;
		const verificationMode = useSignatureVerification ? "signature" : "proxy";
		const secret = useSignatureVerification
			? process.env.GITLAB_WEBHOOK_SECRET!
			: process.env.BOBS_FACTORY_API_KEY || "";

		this.gitLabEventTransport = new GitLabEventTransport({
			fastifyServer: this.sharedApplicationServer.getFastifyInstance(),
			verificationMode,
			secret,
		});

		// Listen for legacy GitLab webhook events
		this.gitLabEventTransport.on("event", (event: GitLabWebhookEvent) => {
			this.handleGitLabWebhook(event).catch((error) => {
				this.logger.error(
					"Failed to handle GitLab webhook",
					error instanceof Error ? error : new Error(String(error)),
				);
			});
		});

		// Listen for unified internal messages (new message bus)
		this.gitLabEventTransport.on("message", (message: InternalMessage) => {
			this.handleMessage(message);
		});

		// Listen for errors
		this.gitLabEventTransport.on("error", (error: Error) => {
			this.handleError(error);
		});

		// Register the /gitlab-webhook endpoint
		this.gitLabEventTransport.register();

		this.logger.info(
			`GitLab event transport registered (${verificationMode} mode)`,
		);
		this.logger.info("Webhook endpoint: POST /gitlab-webhook");
	}

	/**
	 * Whether Bob’s Factory should follow plain replies in a Slack thread it was
	 * @mentioned in. Enabled by default; controlled by the per-team
	 * `slackThreadFollowing` config toggle (Behaviours page) and force-disabled
	 * by the `BOBS_FACTORY_SLACK_THREAD_FOLLOWING_DISABLED` env kill-switch, which takes
	 * precedence over the toggle. When disabled, only @mentions are processed.
	 */
	private isSlackThreadFollowingEnabled(): boolean {
		const envValue = (
			process.env.BOBS_FACTORY_SLACK_THREAD_FOLLOWING_DISABLED ?? ""
		)
			.toLowerCase()
			.trim();
		if (envValue === "true" || envValue === "1" || envValue === "yes") {
			return false;
		}
		// Config toggle defaults to enabled when unset.
		return this.config.slackThreadFollowing !== false;
	}

	/**
	 * Build the EdgeWorker-side dependencies every chat platform handler needs.
	 *
	 * Only the MCP config override list differs per platform, so it is the one
	 * parameter — everything else (runner factory, skills resolution, webhook
	 * accounting, state persistence) is identical across chat platforms and
	 * would otherwise be copied per registration.
	 */
	private buildChatSessionHandlerDeps(
		chatRepositoryProvider: ChatRepositoryProvider,
		getPlatformMcpConfigOverrides: () => readonly string[] | undefined,
	): ChatSessionHandlerDeps {
		return {
			factoryHome: this.factoryHome,
			chatRepositoryProvider,
			onSessionChange: (id) => this.emit("chatSessionChanged", id),
			runnerConfigBuilder: this.runnerConfigBuilder,
			createRunner: (config, chatRunnerType, signal, sessionId) => {
				const runnerType =
					chatRunnerType ?? this.runnerSelectionService.getDefaultRunner();
				return this.createRunnerForType(
					runnerType,
					{
						...config,
						model: this.getDefaultModelForRunner(runnerType),
						fallbackModel: this.getDefaultFallbackModelForRunner(runnerType),
					},
					signal,
					sessionId,
				);
			},
			getPlatformMcpConfigOverrides,
			onNewSession: (session, instructions, platform) => {
				const repository = chatRepositoryProvider.getDefaultRepository();
				this.prepareRunTitle(
					session.id,
					repository,
					{ instructions },
					platform,
					getPlatformMcpConfigOverrides(),
				);
				this.startRunTitle(session.id);
			},
			getStrictMcpConfig: () => this.config.strictMcpConfig,
			getAdditionalWritableDirectories: () =>
				this.config.sandbox?.additionalWritableDirectories,
			ensureLinearTokenFresh: (linearWorkspaceId) =>
				this.ensureLinearTokenFresh(linearWorkspaceId),
			resolveSkillsConfig: async ({ repository, repositoryPaths }) => {
				const plugins = await this.skillsPluginResolver.resolve();
				const skills = await this.skillsPluginResolver.discoverSkillNames(
					plugins,
					{
						repositoryId: repository?.id,
						repoPaths: repositoryPaths,
					},
				);
				return { plugins, skills };
			},
			getOpenCodeGlobalConfig: () => this.config.opencode?.config,
			getOpenCodeGlobalStateScope: () => this.config.opencode?.stateScope,
			onWebhookStart: () => {
				this.activeWebhookCount++;
			},
			onWebhookEnd: () => {
				this.activeWebhookCount--;
			},
			onStateChange: () => this.savePersistedState(),
			persistMessage: (update) => this.savePersistedState(true, update),
			isShuttingDown: () => this.stopping,
			onClaudeError: (error) => this.handleClaudeError(error),
		};
	}

	/**
	 * Every chat platform handler that is actually registered.
	 *
	 * Slack is always registered; Zulip only when it is configured. Aggregate
	 * queries (busy check, runner enumeration, session enumeration) go through
	 * here so adding a chat platform does not mean hunting down every call site.
	 */
	private get activeChatSessionHandlers(): Array<
		| ChatSessionHandler<SlackWebhookEvent>
		| ChatSessionHandler<ZulipWebhookEvent>
	> {
		return [this.chatSessionHandler, this.zulipChatSessionHandler].filter(
			(handler) => handler !== null,
		);
	}

	/**
	 * Register the Zulip event transport, if Zulip is configured.
	 *
	 * Unlike Slack, this is conditional: a Zulip outgoing webhook has no URL
	 * verification handshake to answer during onboarding, so there is nothing
	 * to gain from mounting the route before credentials exist. All four
	 * values are required — the site, bot email and API key are how replies
	 * get posted, and the token is the only thing authenticating an inbound
	 * request.
	 */
	private registerZulipEventTransport(): void {
		const site = process.env.ZULIP_SITE?.trim();
		const botEmail = process.env.ZULIP_BOT_EMAIL?.trim();
		const apiKey = process.env.ZULIP_API_KEY?.trim();
		const token = process.env.ZULIP_WEBHOOK_TOKEN?.trim();

		if (!site || !botEmail || !apiKey || !token) {
			return;
		}

		const chatRepositoryProvider = new LiveChatRepositoryProvider(
			this.repositories,
			() => this.config.linearWorkspaces || {},
		);

		const zulipAdapter = new ZulipChatAdapter(
			chatRepositoryProvider,
			this.logger,
			{
				repositoryRoutingContext:
					this.promptBuilder.generateRoutingContextForAllWorkspaces(),
			},
		);

		this.zulipChatSessionHandler = new ChatSessionHandler(
			zulipAdapter,
			this.buildChatSessionHandlerDeps(
				chatRepositoryProvider,
				() => this.config.zulipMcpConfigs,
			),
			this.logger,
		);

		this.zulipEventTransport = new ZulipEventTransport(
			{
				fastifyServer: this.sharedApplicationServer.getFastifyInstance(),
				token,
				credentials: { site, botEmail, apiKey },
			},
			this.logger,
		);

		this.zulipEventTransport.on("event", (event: ZulipWebhookEvent) => {
			this.zulipChatSessionHandler!.handleEvent(event).catch((error) => {
				this.logger.error(
					"Failed to handle Zulip webhook",
					error instanceof Error ? error : new Error(String(error)),
				);
			});
		});
		this.zulipEventTransport.on("error", (error: Error) => {
			this.handleError(error);
		});

		this.zulipEventTransport.register();

		this.logger.info("Zulip event transport registered");
	}

	/**
	 * Register the Slack event transport for receiving forwarded Slack webhooks from CYHOST.
	 * This creates a /slack-webhook endpoint that handles @mention events from Slack.
	 */
	private registerSlackEventTransport(): void {
		// Live provider reads from the repository map on demand — no snapshot needed
		const chatRepositoryProvider = new LiveChatRepositoryProvider(
			this.repositories,
			() => this.config.linearWorkspaces || {},
		);

		const routingContext =
			this.promptBuilder.generateRoutingContextForAllWorkspaces();
		// Only managed teams (cloud or self-hosted, paired with cyrus-hosted)
		// have a Behaviours page where automatic Slack thread listening can be
		// turned off — BOBS_FACTORY_API_KEY is proof of that pairing, so the
		// stop-listening prompt guidance is gated on it. Community members
		// don't have the key (or the page).
		const factoryAppBaseUrl = undefined;
		const slackAdapter = new SlackChatAdapter(
			chatRepositoryProvider,
			this.logger,
			{ repositoryRoutingContext: routingContext, factoryAppBaseUrl },
		);

		if (
			!chatRepositoryProvider.getDefaultLinearWorkspaceId() ||
			!chatRepositoryProvider.getDefaultRepository()
		) {
			this.logger.warn(
				"No repositories or workspaces configured — Slack sessions will not have access to MCP tools",
			);
		}

		this.chatSessionHandler = new ChatSessionHandler(
			slackAdapter,
			this.buildChatSessionHandlerDeps(
				chatRepositoryProvider,
				// Live read so hot-reloaded config (`setConfig`) picks up new
				// per-platform MCP paths without rebuilding the handler.
				() => this.config.slackMcpConfigs,
			),
			this.logger,
		);

		// Use direct Slack signature verification only when BOTH:
		// 1. SLACK_SIGNING_SECRET is set (we have the secret to verify)
		// 2. BOBS_FACTORY_HOST_EXTERNAL is true (self-hosted: Slack sends directly to us)
		// On cloud droplets, CYHOST forwards webhooks with Bearer token auth
		// (it verifies the Slack signature itself and doesn't forward the headers).
		const isExternalHost =
			process.env.BOBS_FACTORY_HOST_EXTERNAL?.toLowerCase().trim() === "true";
		const hasSlackSigningSecret =
			process.env.SLACK_SIGNING_SECRET != null &&
			process.env.SLACK_SIGNING_SECRET !== "";
		const useDirectSlackWebhooks = isExternalHost && hasSlackSigningSecret;

		const slackVerificationMode = useDirectSlackWebhooks ? "direct" : "proxy";
		const slackSecret = useDirectSlackWebhooks
			? process.env.SLACK_SIGNING_SECRET!
			: process.env.BOBS_FACTORY_API_KEY || "";

		this.slackEventTransport = new SlackEventTransport({
			fastifyServer: this.sharedApplicationServer.getFastifyInstance(),
			verificationMode: slackVerificationMode,
			secret: slackSecret,
			// Live read so the per-team toggle (hot-reloaded via config) and the
			// env kill-switch both take effect without rebuilding the transport.
			isThreadFollowingEnabled: () => this.isSlackThreadFollowingEnabled(),
		});

		this.slackEventTransport.on("event", (event: SlackWebhookEvent) => {
			this.chatSessionHandler!.handleEvent(event).catch((error) => {
				this.logger.error(
					"Failed to handle Slack webhook",
					error instanceof Error ? error : new Error(String(error)),
				);
			});
		});
		this.slackEventTransport.on("message", (message: InternalMessage) => {
			this.handleMessage(message);
		});
		this.slackEventTransport.on("error", (error: Error) => {
			this.handleError(error);
		});

		this.slackEventTransport.register();

		this.logger.info(
			`Slack event transport registered (${slackVerificationMode} mode)`,
		);
	}

	/**
	 * Handle a GitHub webhook event (forwarded from CYHOST).
	 *
	 * This creates a new session for the GitHub PR comment, checks out the PR branch
	 * via git worktree, and processes the comment as a task prompt.
	 */
	/**
	 * Resolve a GitHub API token from (in priority order):
	 * 1. Org-matched installation token from the local token store (pushed by
	 *    cyrus-hosted via /api/update/github-tokens — multi-org support)
	 * 2. Forwarded installation token from CYHOST (cloud/proxy mode)
	 * 3. Self-minted installation token from GitHub App credentials (self-hosted)
	 * 4. Personal access token from GITHUB_TOKEN env var (fallback)
	 */
	private async resolveGitHubToken(
		event: GitHubWebhookEvent,
		repository?: RepositoryConfig,
	): Promise<string | undefined> {
		if (repository?.githubUrl) {
			const storedToken = this.githubTokenStore.getTokenForRepoUrl(
				repository.githubUrl,
			);
			if (storedToken) return storedToken;
		}
		if (event.installationToken) return event.installationToken;
		if (this.gitHubAppTokenProvider) {
			try {
				return await this.gitHubAppTokenProvider.getToken();
			} catch (error) {
				this.logger.warn(
					"Failed to mint GitHub App installation token, falling back to GITHUB_TOKEN",
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		}
		return process.env.GITHUB_TOKEN;
	}

	private async handleGitHubWebhook(
		event: GitHubCommentWebhookEvent,
		reservedGitHubPrSlot = false,
	): Promise<void> {
		this.activeWebhookCount++;
		let githubPrQueueKey: string | undefined;
		let hasReservedGitHubPrSlot = reservedGitHubPrSlot;
		let githubPrSlotReleased = false;

		try {
			// Only handle comments on pull requests
			if (!isCommentOnPullRequest(event)) {
				this.logger.debug("Ignoring GitHub comment on non-PR issue");
				return;
			}

			const repoFullName = extractRepoFullName(event);
			const prNumber = extractPRNumber(event);
			const commentBody = extractCommentBody(event);
			const commentAuthor = extractCommentAuthor(event);
			const prTitle = extractPRTitle(event);
			const sessionKey = extractSessionKey(event);
			githubPrQueueKey = sessionKey;

			const isPullRequestReview = isPullRequestReviewPayload(event.payload);

			// Skip comments from the bot itself to prevent infinite loops
			const botUsername = process.env.GITHUB_BOT_USERNAME;
			if (botUsername && commentAuthor === botUsername) {
				this.logger.debug(
					`Ignoring comment from bot user @${botUsername} on ${repoFullName}#${prNumber}`,
				);
				return;
			}

			// For pull_request_review events, defensively check review state
			// (must happen before the mention check — reviews don't contain @mentions)
			if (isPullRequestReviewPayload(event.payload)) {
				if (event.payload.review.state !== "changes_requested") {
					this.logger.debug(
						`Ignoring pull_request_review with state: ${event.payload.review.state}`,
					);
					return;
				}
			}

			// Honor the PR-review trigger toggle: when disabled, ignore
			// pull_request_review events entirely — no acknowledgement comment and
			// no agent session. Defaults to enabled when the flag is unset.
			if (isPullRequestReview && this.config.prReviewTrigger === false) {
				this.logger.debug(
					`PR review trigger is disabled, ignoring pull_request_review on ${repoFullName}#${prNumber}`,
				);
				return;
			}

			// Only trigger on comments that mention the bot (when configured)
			// Skip this check for pull_request_review events — reviews don't @mention the bot
			if (
				!isPullRequestReview &&
				botUsername &&
				!commentBody.includes(`@${botUsername}`)
			) {
				this.logger.debug(
					`Ignoring comment without @${botUsername} mention on ${repoFullName}#${prNumber}`,
				);
				return;
			}

			this.logger.info(
				`Processing GitHub webhook: ${repoFullName}#${prNumber} by @${commentAuthor}${isPullRequestReview ? " (pull_request_review)" : ""}`,
			);

			// Add "eyes" reaction to acknowledge receipt (not for pull_request_review — we post a comment instead)
			const reactionToken = await this.resolveGitHubToken(
				event,
				this.findRepositoryByGitHubUrl(repoFullName) ?? undefined,
			);
			if (reactionToken && !isPullRequestReview) {
				const commentId = extractCommentId(event);
				if (commentId) {
					this.gitHubCommentService
						.addReaction({
							token: reactionToken,
							owner: extractRepoOwner(event),
							repo: extractRepoName(event),
							commentId,
							isPullRequestReviewComment: isPullRequestReviewCommentPayload(
								event.payload,
							),
							content: "eyes",
						})
						.catch((err: unknown) => {
							this.logger.warn(
								`Failed to add reaction: ${err instanceof Error ? err.message : err}`,
							);
						});
				}
			}

			// Find the repository configuration that matches this GitHub repo
			const repository = this.findRepositoryByGitHubUrl(repoFullName);
			if (!repository) {
				this.logger.warn(
					`No repository configured for GitHub repo: ${repoFullName}`,
				);

				// Only reply on signals where the user clearly directed something at us:
				// an explicit @-mention, or a pull_request_review requesting changes.
				const wasMentioned =
					!!botUsername && commentBody.includes(`@${botUsername}`);
				const shouldReply = wasMentioned || isPullRequestReview;

				if (shouldReply && reactionToken && prNumber) {
					// Presence of BOBS_FACTORY_API_KEY indicates this worker is paired with the
					// managed control plane (paid customer). Absence means the worker is
					// running on the Community plan (self-managed config.json).
					const isManagedCustomer = !!process.env.BOBS_FACTORY_API_KEY;

					const commonPreamble = [
						`Bob’s Factory received this webhook but has no repository configured for \`${repoFullName}\`, so no agent session was started.`,
						``,
						`**Likely causes:**`,
						`- The owner/org was **renamed or transferred** on GitHub. Webhooks are delivered under the current owner name, but Bob’s Factory's stored repository URL still points at the old one. GitHub's web redirects don't apply to webhook payloads — the stored URL has to be updated explicitly.`,
						`- The stored repository URL has a typo (e.g. wrong org/owner) and doesn't match the repo this event came from.`,
						`- The GitHub App / webhook is installed on a repo Bob’s Factory isn't configured for at all.`,
						``,
					];

					const fix = isManagedCustomer
						? `**What to do:** there's currently no self-serve way to update the stored repository URL on your plan — please reach out to Bob’s Factory support and reference \`${repoFullName}\` and we'll reconcile it on the backend.`
						: `**What to do:** open \`~/.bobs-factory/config.json\` on the worker and update the \`githubUrl\` of the relevant repository to \`https://github.com/${repoFullName}\`. The worker watches the config file and will pick up the change automatically. If this repo shouldn't be sending events to Bob’s Factory at all, remove the GitHub App from it instead.`;

					this.gitHubCommentService
						.postIssueComment({
							token: reactionToken,
							owner: extractRepoOwner(event),
							repo: extractRepoName(event),
							issueNumber: prNumber,
							body: [...commonPreamble, fix].join("\n"),
						})
						.catch((err: unknown) => {
							this.logger.warn(
								`Failed to post unconfigured-repo notice: ${err instanceof Error ? err.message : err}`,
							);
						});
				}
				return;
			}

			const agentSessionManager = this.agentSessionManager;

			if (!reservedGitHubPrSlot) {
				if (this.activeGitHubPrSessions.has(sessionKey)) {
					const queue = this.queuedGitHubPrEvents.get(sessionKey) ?? [];
					queue.push(event);
					this.queuedGitHubPrEvents.set(sessionKey, queue);
					this.logger.info(
						`Queued GitHub webhook for ${repoFullName}#${prNumber}; ${queue.length} event(s) waiting`,
					);

					if (reactionToken && prNumber) {
						this.gitHubCommentService
							.postIssueComment({
								token: reactionToken,
								owner: extractRepoOwner(event),
								repo: extractRepoName(event),
								issueNumber: prNumber,
								body: "Received your request. It is queued and will start after Bob’s Factory finishes the current task on this PR.",
							})
							.catch((err: unknown) => {
								this.logger.warn(
									`Failed to post queued acknowledgement: ${err instanceof Error ? err.message : err}`,
								);
							});
					}
					return;
				}

				this.activeGitHubPrSessions.add(sessionKey);
				hasReservedGitHubPrSlot = true;
			}

			// For pull_request_review events, post an instant acknowledgement comment
			if (isPullRequestReview && reactionToken && prNumber) {
				this.gitHubCommentService
					.postIssueComment({
						token: reactionToken,
						owner: extractRepoOwner(event),
						repo: extractRepoName(event),
						issueNumber: prNumber,
						body: "Received your change request. Getting started on those changes now.",
					})
					.catch((err: unknown) => {
						this.logger.warn(
							`Failed to post acknowledgement comment: ${err instanceof Error ? err.message : err}`,
						);
					});
			}

			// Determine the PR head branch and base branch
			let branchRef = extractPRBranchRef(event);
			let baseBranchRef = extractPRBaseBranchRef(event);

			// For issue_comment events, the branch refs are not in the payload
			// We need to fetch them from the GitHub API
			if (!branchRef && isIssueCommentPayload(event.payload)) {
				const refs = await this.fetchPRBranchRefs(event, repository);
				branchRef = refs?.headRef ?? null;
				baseBranchRef = refs?.baseRef ?? null;
			}

			if (!branchRef || !prNumber) {
				this.logger.error(
					`Could not determine branch or PR number for ${repoFullName}#${prNumber}`,
				);
				return;
			}

			// For pull_request_review, the review body IS the task context (no mention to strip)
			// For other events, strip the bot mention to get the task instructions
			const mentionHandle = botUsername ? `@${botUsername}` : "@cyrusagent";
			const taskInstructions = isPullRequestReview
				? commentBody ||
					"A reviewer has requested changes on this PR. Read the review comments to understand what needs to be changed."
				: stripMention(commentBody, mentionHandle);

			// Check for an existing multi-repo session that includes this repository.
			// If found, use its sub-worktree instead of creating a new workspace.
			let workspace: { path: string; isGitWorktree: boolean } | null = null;
			const multiRepoSession =
				agentSessionManager.getActiveMultiRepoSessionForRepository(
					repository.id,
				);

			if (multiRepoSession) {
				const subWorktreePath =
					multiRepoSession.workspace.repoPaths?.[repository.id];
				if (subWorktreePath) {
					workspace = { path: subWorktreePath, isGitWorktree: true };
					this.logger.info(
						`Resolved multi-repo sub-worktree for ${repository.name}: ${subWorktreePath}`,
					);
				} else {
					this.logger.warn(
						`No sub-worktree found for repo ${repository.name} in multi-repo session ${multiRepoSession.id}, falling back to root workspace`,
					);
					workspace = {
						path: multiRepoSession.workspace.path,
						isGitWorktree: true,
					};
				}
			} else {
				// Single-repo or no existing session: create workspace as before
				workspace = await this.createGitHubWorkspace(
					repository,
					branchRef,
					prNumber,
				);
			}

			if (!workspace) {
				this.logger.error(
					`Failed to create workspace for ${repoFullName}#${prNumber}`,
				);
				return;
			}

			this.logger.info(`GitHub workspace created at: ${workspace.path}`);

			// Create a synthetic session for this GitHub PR comment
			const issueMinimal: IssueMinimal = {
				id: sessionKey,
				identifier: `${extractRepoName(event)}#${prNumber}`,
				title: prTitle || `PR #${prNumber}`,
				branchName: branchRef,
			};

			// Create an internal agent session (no Linear session for GitHub)
			const githubSessionId = `github-${event.deliveryId}`;
			agentSessionManager.createCyrusAgentSession(
				githubSessionId,
				sessionKey,
				issueMinimal,
				workspace,
				"github", // Don't stream activities to Linear for GitHub sources
				[
					{
						repositoryId: repository.id,
						branchName: branchRef,
						baseBranchName: baseBranchRef ?? repository.baseBranch,
					},
				],
			);

			// Register session-to-repo mapping and activity sink
			this.sessionRepositories.set(githubSessionId, repository.id);
			const activitySink = this.getActivitySinkForRepo(repository.id);
			if (activitySink) {
				agentSessionManager.setActivitySink(githubSessionId, activitySink);
			}

			const session = agentSessionManager.getSession(githubSessionId);
			if (!session) {
				this.logger.error(
					`Failed to create session for GitHub webhook ${event.deliveryId}`,
				);
				return;
			}

			this.prepareRunTitle(
				githubSessionId,
				repository,
				{
					instructions: taskInstructions,
					ticket: {
						title: prTitle ?? undefined,
						identifier: issueMinimal.identifier,
						body:
							("pull_request" in event.payload
								? event.payload.pull_request.body
								: event.payload.issue.body) ?? undefined,
					},
					source: extractCommentUrl(event),
				},
				"github",
			);

			// Initialize session metadata
			if (!session.metadata) {
				session.metadata = {};
			}

			// Store GitHub-specific metadata for reply posting
			session.metadata.commentId = String(extractCommentId(event));

			// Build the system prompt for this GitHub PR session
			const systemPrompt = isPullRequestReview
				? this.buildGitHubChangeRequestSystemPrompt(
						event,
						branchRef,
						taskInstructions,
					)
				: this.buildGitHubSystemPrompt(event, branchRef, taskInstructions);

			// Build allowed tools using the GitHub platform resolver, which honors
			// `githubAllowedTools` on the workspace config and falls back to
			// `GITHUB_DEFAULT_ALLOWED_TOOLS` (which intentionally omits
			// `mcp__slack` — no subtractive filtering needed).
			const allowedTools =
				this.toolPermissionResolver.buildGithubAllowedTools(repository);
			const disallowedTools = this.buildDisallowedTools(repository);
			const allowedDirectories: string[] = [repository.repositoryPath];

			// Create agent runner using the standard config builder
			const { config: runnerConfig, runnerType } =
				await this.buildAgentRunnerConfig(
					session,
					repository,
					githubSessionId,
					systemPrompt,
					allowedTools,
					allowedDirectories,
					disallowedTools,
					undefined, // resumeSessionId
					undefined, // labels
					undefined, // issueDescription
					200, // maxTurns
					undefined, // linearWorkspaceId
					this.buildSkillSessionContext(repository, undefined, session),
					"github", // sessionPlatform → uses githubMcpConfigs override
				);

			// A runner's start() promise can remain open after a successful turn
			// (for example, warm Claude sessions). Advance the PR queue on the
			// terminal result instead, so one held-open process cannot block later
			// GitHub requests for the same worktree indefinitely.
			const onMessage = runnerConfig.onMessage;
			let githubReplyPosted = false;
			let runner: IAgentRunner;
			runnerConfig.onMessage = async (message: SDKMessage) => {
				try {
					await onMessage?.(message);
				} finally {
					if (message.type === "result" && !githubReplyPosted) {
						githubReplyPosted = true;
						this.postGitHubReply(event, runner, repository).catch((error) => {
							this.logger.error(
								`Failed to post GitHub reply to ${repoFullName}#${prNumber}`,
								error instanceof Error ? error : new Error(String(error)),
							);
						});
						runner.completeStream?.();
						if (hasReservedGitHubPrSlot && githubPrQueueKey) {
							this.advanceGitHubPrQueue(githubPrQueueKey);
							githubPrSlotReleased = true;
						}
					}
				}
			};

			runner = this.createRunnerForType(
				runnerType,
				runnerConfig,
				undefined,
				githubSessionId,
			);

			// Store the runner in the session manager
			agentSessionManager.addAgentRunner(githubSessionId, runner);
			session.metadata!.pendingExecution = {
				prompt: taskInstructions,
				systemPrompt,
				runner: runnerType,
				model: runnerConfig.model,
				replyEvent: persistReplyEvent(event),
			};

			// Save persisted state
			await this.savePersistedState();

			this.emit(
				"session:started",
				sessionKey,
				issueMinimal as unknown as Issue,
				repository.id,
			);

			this.logger.info(
				`Starting ${runnerType} runner for GitHub PR ${repoFullName}#${prNumber}`,
			);

			// Start the session and handle completion
			try {
				const sessionInfo = await runner.start(taskInstructions);
				this.logger.info(`GitHub session started: ${sessionInfo.sessionId}`);

				// A runner that exits before emitting a result still needs a reply.
				if (!githubReplyPosted) {
					githubReplyPosted = true;
					await this.postGitHubReply(event, runner, repository);
				}
			} catch (error) {
				this.logger.error(
					`GitHub session error for ${repoFullName}#${prNumber}`,
					error instanceof Error ? error : new Error(String(error)),
				);
			} finally {
				await this.savePersistedState();
			}
		} catch (error) {
			this.logger.error(
				"Failed to process GitHub webhook",
				error instanceof Error ? error : new Error(String(error)),
			);
		} finally {
			if (
				hasReservedGitHubPrSlot &&
				githubPrQueueKey &&
				!githubPrSlotReleased
			) {
				this.advanceGitHubPrQueue(githubPrQueueKey);
			}
			this.activeWebhookCount--;
		}
	}

	private advanceGitHubPrQueue(sessionKey: string): void {
		const queue = this.queuedGitHubPrEvents.get(sessionKey);
		const nextEvent = queue?.shift();
		if (queue && queue.length === 0) {
			this.queuedGitHubPrEvents.delete(sessionKey);
		}

		if (nextEvent) {
			// Keep the slot reserved while the next event starts to prevent a newly
			// arrived webhook from overtaking the FIFO queue.
			this.handleGitHubWebhook(nextEvent, true).catch((error) => {
				this.logger.error(
					"Failed to process queued GitHub webhook",
					error instanceof Error ? error : new Error(String(error)),
				);
			});
		} else {
			this.activeGitHubPrSessions.delete(sessionKey);
		}
	}

	/**
	 * Handle GitHub push webhook events.
	 * When a base branch receives new commits, find active sessions tracking that
	 * branch and stream a rebase notification to the running agent.
	 */
	private async handleGitHubPushWebhook(
		payload: GitHubPushPayload,
	): Promise<void> {
		// Only handle branch pushes (refs/heads/*), not tags
		if (!payload.ref.startsWith("refs/heads/")) {
			return;
		}

		// Ignore branch deletions
		if (payload.deleted) {
			return;
		}

		const branchName = payload.ref.replace("refs/heads/", "");
		const repoFullName = payload.repository.full_name;

		// Find the matching repository config
		const repository = this.findRepositoryByGitHubUrl(repoFullName);
		if (!repository) {
			this.logger.debug(
				`No repository configured for GitHub push from ${repoFullName}`,
			);
			return;
		}

		// Find active sessions tracking this branch as their base branch
		const sessions = this.agentSessionManager.getSessionsByBaseBranch(
			branchName,
			repository.id,
		);

		if (sessions.length === 0) {
			this.logger.debug(
				`No active sessions tracking base branch ${branchName} for ${repository.name}`,
			);
			return;
		}

		// Build a notification prompt with commit summary
		const commitCount = payload.commits.length;
		const commitSummary = payload.commits
			.slice(0, 5)
			.map((c) => `- ${c.message.split("\n")[0]}`)
			.join("\n");
		const moreCommits =
			commitCount > 5 ? `\n- ... and ${commitCount - 5} more` : "";

		const notification = `<base_branch_update>
<branch>${branchName}</branch>
<repository>${repoFullName}</repository>
<commit_count>${commitCount}</commit_count>
<compare_url>${payload.compare}</compare_url>
<commits>
${commitSummary}${moreCommits}
</commits>
<guidance>
Your base branch \`${branchName}\` has received ${commitCount} new commit(s). Consider rebasing your working branch onto the updated base to avoid merge conflicts. You can do this with: \`git fetch origin && git rebase origin/${branchName}\`
</guidance>
</base_branch_update>`;

		this.logger.info(
			`Base branch ${branchName} updated (${commitCount} commits) — notifying ${sessions.length} active session(s)`,
		);

		// Stream notification to the first running session that supports streaming
		const sortedSessions = [...sessions].sort(
			(a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
		);

		for (const session of sortedSessions) {
			const existingRunner = session.agentRunner;
			const isRunning = existingRunner?.isRunning() || false;

			if (
				isRunning &&
				existingRunner?.supportsStreamingInput &&
				existingRunner.addStreamMessage
			) {
				// Best-effort notification; a steer-only backend may reject it if no
				// turn is active. Don't let that throw out of the update handler.
				try {
					existingRunner.addStreamMessage(notification);
					this.logger.debug(
						`[base-branch-update] Streamed notification to session ${session.id} for branch ${branchName}`,
					);
					break;
				} catch (error) {
					this.logger.debug(
						`[base-branch-update] Stream rejected for session ${session.id}; skipping`,
						{ error: error instanceof Error ? error.message : String(error) },
					);
				}
			}
		}
	}

	/**
	 * Find a repository configuration that matches a GitHub repository URL.
	 * Matches against the githubUrl field in repository config.
	 */
	private findRepositoryByGitHubUrl(
		repoFullName: string,
	): RepositoryConfig | null {
		for (const repo of this.repositories.values()) {
			if (!repo.githubUrl) continue;
			// Match against full name (owner/repo) or URL containing it
			if (
				repo.githubUrl.includes(repoFullName) ||
				repo.githubUrl.endsWith(`/${repoFullName}`)
			) {
				return repo;
			}
		}
		return null;
	}

	/**
	 * Fetch the PR head and base branch refs for an issue_comment webhook.
	 * For issue_comment events, the branch refs are not in the payload
	 * and must be fetched from the GitHub API.
	 */
	private async fetchPRBranchRefs(
		event: GitHubCommentWebhookEvent,
		repository: RepositoryConfig,
	): Promise<{ headRef: string; baseRef: string } | null> {
		if (!isIssueCommentPayload(event.payload)) return null;

		const prUrl = event.payload.issue.pull_request?.url;
		if (!prUrl) return null;

		try {
			const owner = extractRepoOwner(event);
			const repo = extractRepoName(event);
			const prNumber = event.payload.issue.number;

			const headers: Record<string, string> = {
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			};

			// Resolve GitHub token (org-matched store token > installation token > App token > PAT)
			const token = await this.resolveGitHubToken(event, repository);
			if (token) {
				headers.Authorization = `Bearer ${token}`;
			}

			const response = await fetch(
				`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
				{ headers },
			);

			if (!response.ok) {
				this.logger.warn(
					`Failed to fetch PR details from GitHub API: ${response.status}`,
				);
				return null;
			}

			const prData = (await response.json()) as {
				head?: { ref?: string };
				base?: { ref?: string };
			};
			const headRef = prData.head?.ref;
			const baseRef = prData.base?.ref;
			if (!headRef) return null;
			return { headRef, baseRef: baseRef ?? "" };
		} catch (error) {
			this.logger.error(
				"Failed to fetch PR branch refs",
				error instanceof Error ? error : new Error(String(error)),
			);
			return null;
		}
	}

	/**
	 * Create a git worktree for a GitHub PR branch.
	 * If the worktree already exists for this branch, reuse it.
	 */
	private async createGitHubWorkspace(
		repository: RepositoryConfig,
		branchRef: string,
		prNumber: number,
	): Promise<{ path: string; isGitWorktree: boolean } | null> {
		try {
			// Use the GitService to create the worktree
			// Create a synthetic issue-like object for the git service
			const syntheticIssue = {
				id: `github-pr-${prNumber}`,
				identifier: `PR-${prNumber}`,
				title: `PR #${prNumber}`,
				description: null,
				url: "",
				branchName: branchRef,
				assigneeId: null,
				stateId: null,
				teamId: null,
				labelIds: [],
				priority: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
				archivedAt: null,
				state: Promise.resolve(undefined),
				assignee: Promise.resolve(undefined),
				team: Promise.resolve(undefined),
				parent: Promise.resolve(undefined),
				project: Promise.resolve(undefined),
				labels: () => Promise.resolve({ nodes: [] }),
				comments: () => Promise.resolve({ nodes: [] }),
				attachments: () => Promise.resolve({ nodes: [] }),
				children: () => Promise.resolve({ nodes: [] }),
				inverseRelations: () => Promise.resolve({ nodes: [] }),
				update: () =>
					Promise.resolve({
						success: true,
						issue: undefined,
						lastSyncId: 0,
					}),
			} as unknown as Issue;

			return await this.gitService.createGitWorktree(syntheticIssue, [
				repository,
			]);
		} catch (error) {
			this.logger.error(
				`Failed to create GitHub workspace for PR #${prNumber}`,
				error instanceof Error ? error : new Error(String(error)),
			);
			return null;
		}
	}

	/**
	 * Build a system prompt for a GitHub PR comment session.
	 */
	private buildGitHubSystemPrompt(
		event: GitHubCommentWebhookEvent,
		branchRef: string,
		taskInstructions: string,
	): string {
		const repoFullName = extractRepoFullName(event);
		const prNumber = extractPRNumber(event);
		const prTitle = extractPRTitle(event);
		const commentAuthor = extractCommentAuthor(event);
		const commentUrl = extractCommentUrl(event);

		return `You are working on a GitHub Pull Request.

## Context
- **Repository**: ${repoFullName}
- **PR**: #${prNumber} - ${prTitle || "Untitled"}
- **Branch**: ${branchRef}
- **Requested by**: @${commentAuthor}
- **Comment URL**: ${commentUrl}

## Task
${taskInstructions}

## Instructions
- You are already checked out on the PR branch \`${branchRef}\`
- Make changes directly to the code on this branch
- After making changes, commit and push them to the branch
- Be concise in your responses as they will be posted back to the GitHub PR`;
	}

	/**
	 * Build a system prompt for a GitHub PR change request review session.
	 */
	private buildGitHubChangeRequestSystemPrompt(
		event: GitHubCommentWebhookEvent,
		branchRef: string,
		reviewBody: string,
	): string {
		const repoFullName = extractRepoFullName(event);
		const prNumber = extractPRNumber(event);
		const prTitle = extractPRTitle(event);
		const commentAuthor = extractCommentAuthor(event);
		const commentUrl = extractCommentUrl(event);

		const hasReviewBody = reviewBody.trim().length > 0;

		const taskSection = hasReviewBody
			? `## Reviewer Feedback
${reviewBody}

## Instructions
- Read the PR diff and the reviewer's feedback above to understand all requested changes
- You are already checked out on the PR branch \`${branchRef}\`
- Address all the reviewer's feedback and make the necessary changes
- After making changes, commit and push them to the branch
- Respond with a concise summary of the changes you made`
			: `## Instructions
- The reviewer has requested changes but did not leave a summary comment
- Use \`gh api repos/${repoFullName}/pulls/${prNumber}/reviews\` to read the review comments and understand what changes are needed
- You are already checked out on the PR branch \`${branchRef}\`
- Address all the reviewer's feedback and make the necessary changes
- After making changes, commit and push them to the branch
- Respond with a concise summary of the changes you made`;

		return `You are working on a GitHub Pull Request that has received a change request review.

## Context
- **Repository**: ${repoFullName}
- **PR**: #${prNumber} - ${prTitle || "Untitled"}
- **Branch**: ${branchRef}
- **Reviewer**: @${commentAuthor}
- **Review URL**: ${commentUrl}

${taskSection}`;
	}

	/**
	 * Post a reply back to the GitHub PR comment after the session completes.
	 */
	private async postGitHubReply(
		event: GitHubCommentWebhookEvent,
		runner: IAgentRunner,
		repository: RepositoryConfig,
	): Promise<void> {
		try {
			// Get the last assistant message from the runner as the summary
			const messages = runner.getMessages();
			const lastAssistantMessage = [...messages]
				.reverse()
				.find((m) => m.type === "assistant");

			let summary = "Task completed. Please review the changes on this branch.";
			if (
				lastAssistantMessage &&
				lastAssistantMessage.type === "assistant" &&
				"message" in lastAssistantMessage
			) {
				const msg = lastAssistantMessage as {
					message: { content: Array<{ type: string; text?: string }> };
				};
				const textBlock = msg.message.content?.find(
					(block) => block.type === "text" && block.text,
				);
				if (textBlock?.text) {
					summary = textBlock.text;
				}
			}

			const owner = extractRepoOwner(event);
			const repo = extractRepoName(event);
			const prNumber = extractPRNumber(event);
			const commentId = extractCommentId(event);

			if (!prNumber) {
				this.logger.warn("Cannot post GitHub reply: no PR number");
				return;
			}

			// Resolve GitHub token (org-matched store token > installation token > App token > PAT)
			const token = await this.resolveGitHubToken(event, repository);
			if (!token) {
				this.logger.warn(
					"Cannot post GitHub reply: no installation token or GITHUB_TOKEN configured",
				);
				this.logger.debug(
					`Would have posted reply to ${owner}/${repo}#${prNumber} (comment ${commentId}): ${summary}`,
				);
				return;
			}

			if (event.eventType === "pull_request_review_comment") {
				// Reply to the specific review comment thread
				await this.gitHubCommentService.postReviewCommentReply({
					token,
					owner,
					repo,
					pullNumber: prNumber,
					commentId,
					body: summary,
				});
			} else {
				// Post as a regular issue comment on the PR
				await this.gitHubCommentService.postIssueComment({
					token,
					owner,
					repo,
					issueNumber: prNumber,
					body: summary,
				});
			}

			this.logger.info(`Posted GitHub reply to ${owner}/${repo}#${prNumber}`);
		} catch (error) {
			this.logger.error(
				"Failed to post GitHub reply",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	/**
	 * Handle an incoming GitLab webhook event (note on a merge request).
	 * Mirrors the GitHub webhook handler but uses GitLab-specific utilities.
	 */
	private async handleGitLabWebhook(event: GitLabWebhookEvent): Promise<void> {
		this.activeWebhookCount++;

		try {
			// Only handle notes on merge requests
			if (!isNoteOnMergeRequest(event)) {
				this.logger.debug(
					"Ignoring GitLab event: not a note on a merge request",
				);
				return;
			}

			const projectPath = extractProjectPath(event);
			const mrIid = extractMRIid(event);
			const noteBody = extractNoteBody(event);
			const noteAuthor = extractNoteAuthor(event);
			const mrTitle = extractMRTitle(event);
			const sessionKey = extractGitLabSessionKey(event);

			// Skip comments from the bot itself to prevent infinite loops
			const botUsername = process.env.GITLAB_BOT_USERNAME;
			if (botUsername && noteAuthor === botUsername) {
				this.logger.debug(
					`Ignoring note from bot user @${botUsername} on ${projectPath}!${mrIid}`,
				);
				return;
			}

			// Only trigger on notes that mention the bot (when configured)
			if (botUsername && !noteBody.includes(`@${botUsername}`)) {
				this.logger.debug(
					`Ignoring note without @${botUsername} mention on ${projectPath}!${mrIid}`,
				);
				return;
			}

			this.logger.info(
				`Processing GitLab webhook: ${projectPath}!${mrIid} by @${noteAuthor}`,
			);

			// Add "eyes" emoji reaction to acknowledge receipt
			const reactionToken =
				event.accessToken || process.env.GITLAB_ACCESS_TOKEN;
			const noteId = extractNoteId(event);
			const projectId = extractProjectId(event);
			if (reactionToken && noteId && projectId && mrIid) {
				this.gitLabCommentService
					.addAwardEmoji({
						token: reactionToken,
						projectId,
						mrIid,
						noteId,
						name: "eyes",
					})
					.catch((err: unknown) => {
						this.logger.warn(
							`Failed to add GitLab emoji reaction: ${err instanceof Error ? err.message : err}`,
						);
					});
			}

			// Find the repository configuration that matches this GitLab project
			const repository = this.findRepositoryByGitLabUrl(projectPath);
			if (!repository) {
				this.logger.warn(
					`No repository configured for GitLab project: ${projectPath}`,
				);
				return;
			}

			const agentSessionManager = this.agentSessionManager;

			// Branch refs are available directly from the MR payload
			const branchRef = extractMRBranchRef(event);
			const baseBranchRef = extractMRBaseBranchRef(event);

			if (!branchRef || !mrIid) {
				this.logger.error(
					`Could not determine branch or MR iid for ${projectPath}!${mrIid}`,
				);
				return;
			}

			// Strip the bot mention to get the task instructions
			const mentionHandle = botUsername ? `@${botUsername}` : "@cyrusagent";
			const taskInstructions = stripGitLabMention(noteBody, mentionHandle);

			// Check for an existing multi-repo session that includes this repository
			let workspace: { path: string; isGitWorktree: boolean } | null = null;
			const multiRepoSession =
				agentSessionManager.getActiveMultiRepoSessionForRepository(
					repository.id,
				);

			if (multiRepoSession) {
				const subWorktreePath =
					multiRepoSession.workspace.repoPaths?.[repository.id];
				if (subWorktreePath) {
					workspace = {
						path: subWorktreePath,
						isGitWorktree: true,
					};
					this.logger.info(
						`Resolved multi-repo sub-worktree for ${repository.name}: ${subWorktreePath}`,
					);
				} else {
					this.logger.warn(
						`No sub-worktree found for repo ${repository.name} in multi-repo session ${multiRepoSession.id}, falling back to root workspace`,
					);
					workspace = {
						path: multiRepoSession.workspace.path,
						isGitWorktree: true,
					};
				}
			} else {
				// Single-repo or no existing session: create workspace
				workspace = await this.createGitLabWorkspace(
					repository,
					branchRef,
					mrIid,
				);
			}

			if (!workspace) {
				this.logger.error(
					`Failed to create workspace for ${projectPath}!${mrIid}`,
				);
				return;
			}

			this.logger.info(`GitLab workspace created at: ${workspace.path}`);

			// Check if another active session is already using this branch/workspace
			const existingSessions =
				agentSessionManager.getActiveSessionsByBranchName(branchRef);
			const firstExisting = existingSessions[0];
			if (firstExisting) {
				this.logger.warn(
					`Reusing workspace from active session ${firstExisting.id} — concurrent writes possible`,
				);
			}

			// Create a synthetic session for this GitLab MR note
			const issueMinimal: IssueMinimal = {
				id: sessionKey,
				identifier: `${projectPath}!${mrIid}`,
				title: mrTitle || `MR !${mrIid}`,
				branchName: branchRef,
			};

			// Create an internal agent session (no Linear session for GitLab)
			const gitlabSessionId = `gitlab-${Date.now()}`;
			agentSessionManager.createCyrusAgentSession(
				gitlabSessionId,
				sessionKey,
				issueMinimal,
				workspace,
				"gitlab", // Don't stream activities to Linear for GitLab sources
				[
					{
						repositoryId: repository.id,
						branchName: branchRef,
						baseBranchName: baseBranchRef ?? repository.baseBranch,
					},
				],
			);

			// Register session-to-repo mapping and activity sink
			this.sessionRepositories.set(gitlabSessionId, repository.id);
			const activitySink = this.getActivitySinkForRepo(repository.id);
			if (activitySink) {
				agentSessionManager.setActivitySink(gitlabSessionId, activitySink);
			}

			const session = agentSessionManager.getSession(gitlabSessionId);
			if (!session) {
				this.logger.error(
					`Failed to create session for GitLab webhook on ${projectPath}!${mrIid}`,
				);
				return;
			}

			// Initialize procedure metadata
			if (!session.metadata) {
				session.metadata = {};
			}

			this.prepareRunTitle(
				gitlabSessionId,
				repository,
				{
					instructions: taskInstructions,
					ticket: {
						title: mrTitle ?? undefined,
						identifier: issueMinimal.identifier,
						description:
							("merge_request" in event.payload
								? event.payload.merge_request?.description
								: "description" in event.payload.object_attributes
									? event.payload.object_attributes.description
									: undefined) ?? undefined,
					},
					source: extractMRUrl(event) ?? extractNoteUrl(event),
				},
				"gitlab",
			);

			// Store GitLab-specific metadata for reply posting
			// Reuse commentId for note ID (serves the same purpose across platforms)
			session.metadata.commentId = String(noteId);

			// Build the system prompt for this GitLab MR session
			// TODO: Use buildGitLabChangeRequestSystemPrompt for merge_request approval events
			const isMergeRequestEvent = event.eventType === "merge_request";
			const systemPrompt = isMergeRequestEvent
				? this.buildGitLabChangeRequestSystemPrompt(
						event,
						branchRef,
						taskInstructions,
					)
				: this.buildGitLabSystemPrompt(event, branchRef, taskInstructions);

			// Build allowed tools using the GitHub platform resolver — GitLab and
			// GitHub share the same PR-targeted, single-repo intent, so they use
			// the same `githubAllowedTools` knob and the same `GITHUB_*` default.
			const allowedTools =
				this.toolPermissionResolver.buildGithubAllowedTools(repository);
			const disallowedTools = this.buildDisallowedTools(repository);
			const allowedDirectories: string[] = [repository.repositoryPath];

			// Create agent runner using the standard config builder
			const { config: runnerConfig, runnerType } =
				await this.buildAgentRunnerConfig(
					session,
					repository,
					gitlabSessionId,
					systemPrompt,
					allowedTools,
					allowedDirectories,
					disallowedTools,
					undefined, // resumeSessionId
					undefined, // labels
					undefined, // issueDescription
					200, // maxTurns
					undefined, // linearWorkspaceId
					this.buildSkillSessionContext(repository, undefined, session),
					"gitlab", // sessionPlatform → uses githubMcpConfigs override
				);

			const runner = this.createRunnerForType(
				runnerType,
				runnerConfig,
				undefined,
				gitlabSessionId,
			);

			// Store the runner in the session manager
			agentSessionManager.addAgentRunner(gitlabSessionId, runner);
			session.metadata!.pendingExecution = {
				prompt: taskInstructions,
				systemPrompt,
				runner: runnerType,
				model: runnerConfig.model,
				replyEvent: persistReplyEvent(event),
			};

			// Save persisted state
			await this.savePersistedState();

			this.emit(
				"session:started",
				sessionKey,
				issueMinimal as unknown as Issue,
				repository.id,
			);

			this.logger.info(
				`Starting ${runnerType} runner for GitLab MR ${projectPath}!${mrIid}`,
			);

			// Start the session and handle completion
			try {
				const sessionInfo = await runner.start(taskInstructions);
				this.logger.info(`GitLab session started: ${sessionInfo.sessionId}`);

				// When session completes, post the reply back to GitLab
				await this.postGitLabReply(event, runner, repository);
			} catch (error) {
				this.logger.error(
					`GitLab session error for ${projectPath}!${mrIid}`,
					error instanceof Error ? error : new Error(String(error)),
				);
			} finally {
				await this.savePersistedState();
			}
		} catch (error) {
			this.logger.error(
				"Failed to process GitLab webhook",
				error instanceof Error ? error : new Error(String(error)),
			);
		} finally {
			this.activeWebhookCount--;
		}
	}

	/**
	 * Find a repository configuration that matches a GitLab project URL.
	 * Matches against the gitlabUrl field in repository config.
	 */
	private findRepositoryByGitLabUrl(
		projectPath: string,
	): RepositoryConfig | null {
		for (const repo of this.repositories.values()) {
			if (!repo.gitlabUrl) continue;
			if (
				repo.gitlabUrl.includes(projectPath) ||
				repo.gitlabUrl.endsWith(`/${projectPath}`)
			) {
				return repo;
			}
		}
		return null;
	}

	/**
	 * Create a git worktree for a GitLab MR branch.
	 * If the worktree already exists for this branch, reuse it.
	 */
	private async createGitLabWorkspace(
		repository: RepositoryConfig,
		branchRef: string,
		mrIid: number,
	): Promise<{ path: string; isGitWorktree: boolean } | null> {
		try {
			// Create a synthetic issue-like object for the git service
			const syntheticIssue = {
				id: `gitlab-mr-${mrIid}`,
				identifier: `MR-${mrIid}`,
				title: `MR !${mrIid}`,
				description: null,
				url: "",
				branchName: branchRef,
				assigneeId: null,
				stateId: null,
				teamId: null,
				labelIds: [],
				priority: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
				archivedAt: null,
				state: Promise.resolve(undefined),
				assignee: Promise.resolve(undefined),
				team: Promise.resolve(undefined),
				parent: Promise.resolve(undefined),
				project: Promise.resolve(undefined),
				labels: () => Promise.resolve({ nodes: [] }),
				comments: () => Promise.resolve({ nodes: [] }),
				attachments: () => Promise.resolve({ nodes: [] }),
				children: () => Promise.resolve({ nodes: [] }),
				inverseRelations: () => Promise.resolve({ nodes: [] }),
				update: () =>
					Promise.resolve({
						success: true,
						issue: undefined,
						lastSyncId: 0,
					}),
			} as unknown as Issue;

			return await this.gitService.createGitWorktree(syntheticIssue, [
				repository,
			]);
		} catch (error) {
			this.logger.error(
				`Failed to create GitLab workspace for MR !${mrIid}`,
				error instanceof Error ? error : new Error(String(error)),
			);
			return null;
		}
	}

	/**
	 * Build a system prompt for a GitLab MR note session.
	 */
	private buildGitLabSystemPrompt(
		event: GitLabWebhookEvent,
		branchRef: string,
		taskInstructions: string,
	): string {
		const projectPath = extractProjectPath(event);
		const mrIid = extractMRIid(event);
		const mrTitle = extractMRTitle(event);
		const noteAuthor = extractNoteAuthor(event);
		const noteUrl = extractNoteUrl(event);

		return `You are working on a GitLab Merge Request.

## Context
- **Project**: ${projectPath}
- **MR**: !${mrIid} - ${mrTitle || "Untitled"}
- **Branch**: ${branchRef}
- **Requested by**: @${noteAuthor}
- **Note URL**: ${noteUrl}

## Task
${taskInstructions}

## Instructions
- You are already checked out on the MR branch \`${branchRef}\`
- Make changes directly to the code on this branch
- After making changes, commit and push them to the branch
- Use \`glab\` CLI commands for GitLab-specific operations
- Be concise in your responses as they will be posted back to the GitLab MR`;
	}

	/**
	 * Build a system prompt for a GitLab MR change request session.
	 */
	private buildGitLabChangeRequestSystemPrompt(
		event: GitLabWebhookEvent,
		branchRef: string,
		reviewBody: string,
	): string {
		const projectPath = extractProjectPath(event);
		const mrIid = extractMRIid(event);
		const mrTitle = extractMRTitle(event);
		const noteAuthor = extractNoteAuthor(event);
		const noteUrl = extractNoteUrl(event);

		const hasReviewBody = reviewBody.trim().length > 0;

		const taskSection = hasReviewBody
			? `## Reviewer Feedback
${reviewBody}

## Instructions
- Read the MR diff and the reviewer's feedback above to understand all requested changes
- You are already checked out on the MR branch \`${branchRef}\`
- Address all the reviewer's feedback and make the necessary changes
- After making changes, commit and push them to the branch
- Respond with a concise summary of the changes you made`
			: `## Instructions
- The reviewer has requested changes but did not leave a summary comment
- Use \`glab mr view ${mrIid}\` and \`glab mr diff ${mrIid}\` to review the MR context
- You are already checked out on the MR branch \`${branchRef}\`
- Address all the reviewer's feedback and make the necessary changes
- After making changes, commit and push them to the branch
- Respond with a concise summary of the changes you made`;

		return `You are working on a GitLab Merge Request that has received a change request review.

## Context
- **Project**: ${projectPath}
- **MR**: !${mrIid} - ${mrTitle || "Untitled"}
- **Branch**: ${branchRef}
- **Reviewer**: @${noteAuthor}
- **Note URL**: ${noteUrl}

${taskSection}`;
	}

	/**
	 * Post a reply back to the GitLab MR after the session completes.
	 */
	private async postGitLabReply(
		event: GitLabWebhookEvent,
		runner: IAgentRunner,
		_repository: RepositoryConfig,
	): Promise<void> {
		try {
			// Get the last assistant message from the runner as the summary
			const messages = runner.getMessages();
			const lastAssistantMessage = [...messages]
				.reverse()
				.find((m) => m.type === "assistant");

			let summary = "Task completed. Please review the changes on this branch.";
			if (
				lastAssistantMessage &&
				lastAssistantMessage.type === "assistant" &&
				"message" in lastAssistantMessage
			) {
				const msg = lastAssistantMessage as {
					message: {
						content: Array<{ type: string; text?: string }>;
					};
				};
				const textBlock = msg.message.content?.find(
					(block) => block.type === "text" && block.text,
				);
				if (textBlock?.text) {
					summary = textBlock.text;
				}
			}

			const projectId = extractProjectId(event);
			const mrIid = extractMRIid(event);
			const discussionId = extractDiscussionId(event);

			if (!mrIid) {
				this.logger.warn("Cannot post GitLab reply: no MR iid");
				return;
			}

			const token = event.accessToken || process.env.GITLAB_ACCESS_TOKEN;
			if (!token) {
				this.logger.warn(
					"Cannot post GitLab reply: no access token or GITLAB_ACCESS_TOKEN configured",
				);
				this.logger.debug(
					`Would have posted reply to ${extractProjectPath(event)}!${mrIid}: ${summary}`,
				);
				return;
			}

			if (discussionId) {
				// Reply to the specific discussion thread
				await this.gitLabCommentService.postDiscussionReply({
					token,
					projectId,
					mrIid,
					discussionId,
					body: summary,
				});
			} else {
				// Post as a top-level MR note
				await this.gitLabCommentService.postMRNote({
					token,
					projectId,
					mrIid,
					body: summary,
				});
			}

			this.logger.info(
				`Posted GitLab reply to ${extractProjectPath(event)}!${mrIid}`,
			);
		} catch (error) {
			this.logger.error(
				"Failed to post GitLab reply",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	/**
	 * Compute the current status of the Bob’s Factory process
	 * @returns "idle" if the process can be safely restarted, "busy" if work is in progress
	 */
	private computeStatus(): "idle" | "busy" {
		if (
			[...(this.factoryRuntime?.runs.values() ?? [])].some(
				(run) => run.status === "running",
			)
		)
			return "busy";
		// Busy if any webhooks are currently being processed
		if (this.activeWebhookCount > 0) {
			return "busy";
		}

		// Busy if any runner is actively running
		const runners = this.agentSessionManager.getAllAgentRunners();
		for (const runner of runners) {
			if (runner.isRunning()) {
				return "busy";
			}
		}

		// Busy if any chat platform runner is actively running
		if (
			this.activeChatSessionHandlers.some((handler) =>
				handler.isAnyRunnerBusy(),
			)
		) {
			return "busy";
		}

		return "idle";
	}

	/**
	 * Test-only: dispatch a synthetic Slack webhook event through the chat
	 * session handler. Used by the F1 test harness to exercise the Slack →
	 * ClaudeRunner code path end-to-end without a real Slack signature.
	 */
	async dispatchChatTestEvent(event: SlackWebhookEvent): Promise<void> {
		if (!this.chatSessionHandler) {
			throw new Error("chatSessionHandler not initialized");
		}
		await this.chatSessionHandler.handleEvent(event);
	}

	/**
	 * Public accessor for the shared Fastify-based application server.
	 * Used by F1 to register test-only routes alongside production webhook routes.
	 */
	getSharedApplicationServer(): SharedApplicationServer {
		return this.sharedApplicationServer;
	}

	/**
	 * Test-only: list active chat threads (threadKey → sessionId).
	 */
	listChatThreads(): Array<{ threadKey: string; sessionId: string }> {
		if (!this.chatSessionHandler) return [];
		return this.chatSessionHandler.listThreads();
	}

	/**
	 * Test-only: fetch the last assistant text reply for a chat thread.
	 * Returns null when the thread or runner is unknown, or no assistant
	 * message has been produced yet.
	 */
	getChatThreadLastReply(threadKey: string): {
		text: string;
		isRunning: boolean;
		messageCount: number;
	} | null {
		if (!this.chatSessionHandler) return null;
		const runner = this.chatSessionHandler.getRunnerForThread(threadKey);
		if (!runner) return null;
		const messages = runner.getMessages();
		const lastAssistant = [...messages]
			.reverse()
			.find((m) => m.type === "assistant");
		let text = "";
		if (
			lastAssistant &&
			lastAssistant.type === "assistant" &&
			"message" in lastAssistant
		) {
			const msg = lastAssistant as {
				message: { content: Array<{ type: string; text?: string }> };
			};
			const block = msg.message.content?.find(
				(b) => b.type === "text" && b.text,
			);
			if (block?.text) text = block.text;
		}
		return {
			text,
			isRunning: runner.isRunning(),
			messageCount: messages.length,
		};
	}

	/**
	 * Stop the edge worker
	 */
	async stop(): Promise<void> {
		this.stopping = true;
		await this.factoryPush?.stop();
		await this.runnerSlots.shutdown();
		this.recoveryAbort.abort();
		await this.titleGenerator?.shutdown();
		this.ticketTracking?.stop();
		await this.factoryRuntime?.shutdown();
		await this.factoryServer?.stop();
		// Stop config file watcher
		await this.configManager.stop();

		try {
			await this.savePersistedState();
			this.logger.info("✅ EdgeWorker state saved successfully");
		} catch (error) {
			this.logger.error(
				"❌ Failed to save EdgeWorker state during shutdown:",
				error,
			);
		}

		// get all agent runners (including chat platform sessions)
		const agentRunners: IAgentRunner[] = [
			...this.agentSessionManager.getAllAgentRunners(),
		];
		for (const handler of this.activeChatSessionHandlers) {
			agentRunners.push(...handler.getAllRunners());
		}

		// Kill all agent processes with null checking
		for (const runner of agentRunners) {
			if (runner) {
				try {
					runner.stop();
				} catch (error) {
					this.logger.error("Error stopping Claude runner:", error);
				}
			}
		}

		// Clear event transport (no explicit cleanup needed, routes are removed when server stops)
		await Promise.allSettled(agentRunners.map(waitForRunnerCapacity));
		this.linearEventTransport = null;
		this.configUpdater = null;
		this.mcpConfigService.clearAllContexts();
		this.factoryToolsMcpSessions.removeAllListeners();
		this.factoryToolsMcpRegistered = false;

		// Stop egress proxy
		if (this.egressProxy) {
			await this.egressProxy.stop();
			this.egressProxy = null;
			this.sdkSandboxSettings = null;
			this.egressCaCertPath = null;
		}

		// Stop shared application server (this also stops Cloudflare tunnel if running)
		await this.sharedApplicationServer.stop();
	}

	/**
	 * Apply sandbox config changes from a config reload.
	 * Handles three transitions:
	 * - enabled → enabled: update network policy on the running proxy
	 * - disabled → enabled: start a new proxy
	 * - enabled → disabled: stop the running proxy
	 */
	private async applySandboxConfigChanges(
		newConfig: EdgeWorkerConfig,
	): Promise<void> {
		const wasEnabled = this.egressProxy !== null;
		const isEnabled = newConfig.sandbox?.enabled === true;

		if (wasEnabled && isEnabled) {
			// Policy update — proxy stays running, rules change
			// Pass current policy (or empty object to reset to allow-all)
			this.egressProxy!.updateNetworkPolicy(
				newConfig.sandbox?.networkPolicy ?? {},
			);
			// Handle systemWideCert toggling while proxy is running
			if (newConfig.sandbox?.systemWideCert) {
				this.egressCaCertPath = null;
			} else if (!this.egressCaCertPath) {
				this.egressCaCertPath = this.egressProxy!.buildCACertBundle();
			}
		} else if (!wasEnabled && isEnabled) {
			// Start proxy for the first time
			this.logger.info("🛡️  Sandbox egress proxy: starting (config change)...");
			this.egressProxy = new EgressProxy(
				newConfig.sandbox!,
				this.factoryHome,
				this.logger,
			);
			await this.egressProxy.start();

			this.sdkSandboxSettings = {
				enabled: true,
				network: {
					httpProxyPort: this.egressProxy.getHttpProxyPort(),
					socksProxyPort: this.egressProxy.getSocksProxyPort(),
				},
			};
			const systemWideCert = newConfig.sandbox?.systemWideCert === true;
			this.logCertTrustInstructions(
				this.egressProxy.getCACertPath(),
				systemWideCert,
			);

			if (!systemWideCert) {
				this.egressCaCertPath = this.egressProxy.buildCACertBundle();
			}
		} else if (wasEnabled && !isEnabled) {
			// Stop proxy
			this.logger.info(
				"🛡️  Sandbox egress proxy: stopping (disabled in config)",
			);
			await this.egressProxy!.stop();
			this.egressProxy = null;
			this.sdkSandboxSettings = null;
			this.egressCaCertPath = null;
		}
	}

	/**
	 * Log instructions for trusting the egress proxy CA certificate.
	 * When systemWideCert is true, logs that env vars are skipped and trust
	 * is expected from the OS cert store. Otherwise logs env var list and
	 * checks macOS keychain trust status.
	 */
	private logCertTrustInstructions(
		certPath: string,
		systemWideCert = false,
	): void {
		this.logger.info(`🛡️  Sandbox TLS interception CA certificate: ${certPath}`);

		if (systemWideCert) {
			this.logger.info(
				"🛡️  systemWideCert: true — per-session CA cert env vars are skipped (OS cert store handles trust)",
			);
		} else {
			this.logger.info(
				"🛡️  Per-session env vars are set automatically: NODE_EXTRA_CA_CERTS, GIT_SSL_CAINFO, SSL_CERT_FILE, REQUESTS_CA_BUNDLE, PIP_CERT, CURL_CA_BUNDLE, CARGO_HTTP_CAINFO, AWS_CA_BUNDLE, DENO_CERT",
			);
		}

		const trusted = this.isCertTrustedSystemWide();
		if (trusted) {
			this.logger.info("🛡️  CA certificate is trusted system-wide ✓");
			if (!systemWideCert) {
				this.logger.info(
					"🛡️  Tip: set sandbox.systemWideCert: true in config.json to skip per-session cert env vars",
				);
			}
		} else {
			if (process.platform === "darwin") {
				this.logger.warn(
					"🛡️  CA certificate is NOT trusted in the macOS System keychain. To trust (requires sudo):",
				);
				this.logger.warn(
					`🛡️  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ${certPath}`,
				);
			} else if (process.platform === "linux") {
				this.logger.warn(
					"🛡️  CA certificate is NOT trusted system-wide. To trust (requires sudo):",
				);
				this.logger.warn(
					`🛡️  sudo cp ${certPath} /usr/local/share/ca-certificates/cyrus-egress-ca.crt && sudo update-ca-certificates`,
				);
			}
			if (systemWideCert) {
				this.logger.warn(
					"🛡️  systemWideCert is true but cert is not trusted — tools using the OS cert store will fail TLS verification",
				);
			}
		}
	}

	/**
	 * Check whether the Bob’s Factory egress proxy CA is trusted at the OS level.
	 * macOS: searches the System keychain. Linux: checks update-ca-certificates output.
	 */
	private isCertTrustedSystemWide(): boolean {
		try {
			if (process.platform === "darwin") {
				execSync(
					'security find-certificate -c "Bob’s Factory Egress Proxy CA" /Library/Keychains/System.keychain',
					{ stdio: "ignore" },
				);
				return true;
			}
			if (process.platform === "linux") {
				// Check if our cert exists in the system CA certificates directory
				execSync(
					"test -f /usr/local/share/ca-certificates/cyrus-egress-ca.crt",
					{ stdio: "ignore" },
				);
				return true;
			}
			return false;
		} catch {
			return false;
		}
	}

	/**
	 * Set the config file path for dynamic reloading
	 */
	setConfigPath(configPath: string): void {
		this.configPath = configPath;
		this.configManager.setConfigPath(configPath);
	}

	/**
	 * Handle resuming a parent session when a child session completes
	 * This is the core logic used by the resume parent session callback
	 * Extracted to reduce duplication between constructor and addNewRepositories
	 */
	private async handleResumeParentSession(
		parentSessionId: string,
		prompt: string,
		childSessionId: string,
	): Promise<void> {
		const log = this.logger.withContext({ sessionId: parentSessionId });
		log.info(
			`Child session completed, resuming parent session ${parentSessionId}`,
		);

		// Find parent session from the single session manager
		log.debug(`Looking up parent session ${parentSessionId}`);
		const parentSession = this.agentSessionManager.getSession(parentSessionId);
		const parentRepoId = this.sessionRepositories.get(parentSessionId);
		const parentRepo = parentRepoId
			? this.repositories.get(parentRepoId)
			: undefined;
		const parentAgentSessionManager = this.agentSessionManager;

		if (!parentSession || !parentRepo) {
			log.error(
				`Parent session ${parentSessionId} not found in any repository's agent session manager`,
			);
			return;
		}

		// Extract workspace ID once for all operations in this method
		const parentWorkspaceId = requireLinearWorkspaceId(parentRepo);

		log.debug(
			`Found parent session - Issue: ${parentSession.issueId}, Workspace: ${parentSession.workspace.path}`,
		);

		// Get the child session to access its workspace path
		const childSession = this.agentSessionManager.getSession(childSessionId);
		const childWorkspaceDirs: string[] = [];
		if (childSession) {
			childWorkspaceDirs.push(childSession.workspace.path);
			log.debug(
				`Adding child workspace to parent allowed directories: ${childSession.workspace.path}`,
			);
		} else {
			log.warn(
				`Could not find child session ${childSessionId} to add workspace to parent allowed directories`,
			);
		}

		await this.postParentResumeAcknowledgment(
			parentSessionId,
			parentWorkspaceId,
		);

		// Post thought showing child result receipt
		// Use parent's issue tracker since we're posting to the parent's session
		const issueTracker = this.issueTrackers.get(parentWorkspaceId);
		if (issueTracker && childSession) {
			const childIssueIdentifier =
				childSession.issue?.identifier || childSession.issueId;
			const resultThought = `Received result from sub-issue ${childIssueIdentifier}:\n\n---\n\n${prompt}\n\n---`;

			await this.postActivityDirect(
				issueTracker,
				{
					agentSessionId: parentSessionId,
					content: { type: "thought", body: resultThought },
				},
				"child result receipt",
			);
		}

		// Use centralized streaming check and routing logic
		log.info(`Handling child result for parent session ${parentSessionId}`);
		try {
			await this.handlePromptWithStreamingCheck(
				parentSession,
				parentRepo,
				parentSessionId,
				parentAgentSessionManager,
				prompt,
				"", // No attachment manifest for child results
				false, // Not a new session
				childWorkspaceDirs, // Add child workspace directories to parent's allowed directories
				"parent resume from child",
				parentWorkspaceId,
			);
			log.info(
				`Successfully handled child result for parent session ${parentSessionId}`,
			);
		} catch (error) {
			log.error(`Failed to resume parent session ${parentSessionId}:`, error);
			log.error(
				`Error context - Parent issue: ${parentSession.issueId}, Repository: ${parentRepo.name}`,
			);
		}
	}

	/**
	 * Detect workspace token changes and update all dependent services.
	 *
	 * When an OAuth token is refreshed (at least once per day), the new token is
	 * persisted to config.json which triggers the file watcher.  This method
	 * compares the previous in-memory tokens against the new config and calls
	 * `setAccessToken()` on any affected `LinearIssueTrackerService` instances,
	 * and pushes the updated workspace configs to `AttachmentService`.
	 */
	private updateLinearWorkspaceTokens(newConfig: EdgeWorkerConfig): void {
		const oldWorkspaces = this.config.linearWorkspaces ?? {};
		const newWorkspaces = newConfig.linearWorkspaces ?? {};

		let anyTokenChanged = false;

		for (const [workspaceId, newWsConfig] of Object.entries(newWorkspaces)) {
			const oldToken = oldWorkspaces[workspaceId]?.linearToken;
			const newToken = newWsConfig.linearToken;

			if (oldToken === newToken) continue;

			anyTokenChanged = true;

			// Update existing issue tracker in-place
			const issueTracker = this.issueTrackers.get(workspaceId);
			if (issueTracker) {
				(issueTracker as LinearIssueTrackerService).setAccessToken(newToken);
				this.logger.info(
					`🔑 Updated Linear token for workspace ${workspaceId}`,
				);
			} else if (this.config.platform !== "cli") {
				// Workspace is new — create a tracker and activity sink for it
				const newIssueTracker = new LinearIssueTrackerService(
					new LinearClient({ accessToken: newToken }),
					this.buildOAuthConfig(workspaceId),
				);
				this.issueTrackers.set(workspaceId, newIssueTracker);
				this.activitySinks.set(
					workspaceId,
					new LinearActivitySink(newIssueTracker, workspaceId),
				);
				this.logger.info(
					`🔑 Created issue tracker for new workspace ${workspaceId}`,
				);
			}
		}

		if (anyTokenChanged) {
			// Push refreshed workspace configs to AttachmentService
			this.attachmentService.setLinearWorkspaces(newWorkspaces);
		}
	}

	/**
	 * Add new repositories to the running EdgeWorker
	 */
	private async addNewRepositories(repos: RepositoryConfig[]): Promise<void> {
		for (const repo of repos) {
			if (repo.isActive === false) {
				this.logger.info(`⏭️  Skipping inactive repository: ${repo.name}`);
				continue;
			}

			try {
				this.logger.info(`➕ Adding repository: ${repo.name} (${repo.id})`);

				// Resolve paths that may contain tilde (~) prefix
				const resolvedRepo: RepositoryConfig = {
					...repo,
					repositoryPath: resolvePath(repo.repositoryPath),
					gitProvider: normalizeGitProviderConfig(repo.gitProvider),
					workspaceBaseDir: resolvePath(repo.workspaceBaseDir),
					mcpConfigPath: Array.isArray(repo.mcpConfigPath)
						? repo.mcpConfigPath.map(resolvePath)
						: repo.mcpConfigPath
							? resolvePath(repo.mcpConfigPath)
							: undefined,
					promptTemplatePath: repo.promptTemplatePath
						? resolvePath(repo.promptTemplatePath)
						: undefined,
				};

				// Add to internal map
				this.repositories.set(repo.id, resolvedRepo);

				this.logger.info(`✅ Repository added successfully: ${repo.name}`);
			} catch (error) {
				this.logger.error(`❌ Failed to add repository ${repo.name}:`, error);
			}
		}
	}

	/**
	 * Update existing repositories
	 */
	private async updateModifiedRepositories(
		repos: RepositoryConfig[],
	): Promise<void> {
		for (const repo of repos) {
			try {
				const oldRepo = this.repositories.get(repo.id);
				if (!oldRepo) {
					this.logger.warn(
						`⚠️  Repository ${repo.id} not found for update, skipping`,
					);
					continue;
				}

				this.logger.info(`🔄 Updating repository: ${repo.name} (${repo.id})`);

				// Resolve paths that may contain tilde (~) prefix
				const resolvedRepo: RepositoryConfig = {
					...repo,
					repositoryPath: resolvePath(repo.repositoryPath),
					gitProvider: normalizeGitProviderConfig(repo.gitProvider),
					workspaceBaseDir: resolvePath(repo.workspaceBaseDir),
					mcpConfigPath: Array.isArray(repo.mcpConfigPath)
						? repo.mcpConfigPath.map(resolvePath)
						: repo.mcpConfigPath
							? resolvePath(repo.mcpConfigPath)
							: undefined,
					promptTemplatePath: repo.promptTemplatePath
						? resolvePath(repo.promptTemplatePath)
						: undefined,
				};

				// Update stored config
				this.repositories.set(repo.id, resolvedRepo);

				// If active status changed
				if (oldRepo.isActive !== repo.isActive) {
					if (repo.isActive === false) {
						this.logger.info(
							`  ⏸️  Repository set to inactive - existing sessions will continue`,
						);
					} else {
						this.logger.info(`  ▶️  Repository reactivated`);
					}
				}

				this.logger.info(`✅ Repository updated successfully: ${repo.name}`);
			} catch (error) {
				this.logger.error(
					`❌ Failed to update repository ${repo.name}:`,
					error,
				);
			}
		}
	}

	/**
	 * Remove deleted repositories
	 */
	private async removeDeletedRepositories(
		repos: RepositoryConfig[],
	): Promise<void> {
		for (const repo of repos) {
			try {
				this.logger.info(`🗑️  Removing repository: ${repo.name} (${repo.id})`);

				// Check for active sessions for this repository
				const allActiveSessions = this.agentSessionManager.getActiveSessions();
				const activeSessions = allActiveSessions.filter(
					(s) => this.sessionRepositories.get(s.id) === repo.id,
				);

				if (activeSessions.length > 0) {
					this.logger.warn(
						`  ⚠️  Repository has ${activeSessions.length} active sessions - stopping them`,
					);

					// Stop all active sessions and notify Linear
					for (const session of activeSessions) {
						try {
							this.logger.debug(
								`  🛑 Stopping session for issue ${session.issueId}`,
							);

							// Get the agent runner for this session
							const runner = this.agentSessionManager.getAgentRunner(
								session.id,
							);
							if (runner) {
								// Stop the agent process
								runner.stop();
								this.logger.debug(
									`  ✅ Stopped Claude runner for session ${session.id}`,
								);
							}

							// Post cancellation message to tracker
							const issueTracker = this.issueTrackers.get(
								requireLinearWorkspaceId(repo),
							);
							if (issueTracker && session.externalSessionId) {
								await this.postActivityDirect(
									issueTracker,
									{
										agentSessionId: session.externalSessionId,
										content: {
											type: "response",
											body: `**Repository Removed from Configuration**\n\nThis repository (\`${repo.name}\`) has been removed from the Bob’s Factory configuration. All active sessions for this repository have been stopped.\n\nIf you need to continue working on this issue, please contact your administrator to restore the repository configuration.`,
										},
									},
									"repository removal",
								);
							}
						} catch (error) {
							this.logger.error(
								`  ❌ Failed to stop session ${session.id}:`,
								error,
							);
						}
					}
				}

				// Remove repository from the repositories map.
				// Note: we intentionally do NOT remove workspace-level issue trackers
				// or activity sinks here. They are keyed by workspace ID and may be
				// needed by other repositories in the same workspace, or by new
				// repositories about to be added in the same configChanged cycle.
				// They will be naturally replaced when workspace tokens are updated.
				this.repositories.delete(repo.id);

				this.logger.info(`✅ Repository removed successfully: ${repo.name}`);
			} catch (error) {
				this.logger.error(
					`❌ Failed to remove repository ${repo.name}:`,
					error,
				);
			}
		}
	}

	/**
	 * Handle errors
	 */
	private handleError(error: Error): void {
		this.emit("error", error);
		this.config.handlers?.onError?.(error);
	}

	/**
	 * Get cached repositories for an issue (used by agentSessionPrompted Branch 3)
	 * Returns null if nothing cached, or array of resolved RepositoryConfigs.
	 */
	private getCachedRepositories(issueId: string): RepositoryConfig[] | null {
		return this.repositoryRouter.getCachedRepositories(
			issueId,
			this.repositories,
		);
	}

	/**
	 * Get first cached repository for an issue (convenience for single-repo callers)
	 */
	private getCachedRepository(issueId: string): RepositoryConfig | null {
		const repos = this.getCachedRepositories(issueId);
		return repos && repos.length > 0 ? repos[0]! : null;
	}

	/**
	 * Handle webhook events from proxy - main router for all webhooks
	 */
	private async handleWebhook(
		webhook: Webhook,
		repos: RepositoryConfig[],
	): Promise<void> {
		// Track active webhook processing for status endpoint
		this.activeWebhookCount++;

		const webhookAction = (webhook as { action?: string }).action;
		const webhookType = (webhook as { type?: string }).type;
		this.logger.event("webhook_received", {
			source: "linear",
			action: webhookAction,
			type: webhookType,
			repoCount: repos.length,
		});

		// Log verbose webhook info if enabled
		if (process.env.BOBS_FACTORY_WEBHOOK_DEBUG === "true") {
			this.logger.debug(
				`Full webhook payload:`,
				JSON.stringify(webhook, null, 2),
			);
		}

		try {
			// Route to specific webhook handlers based on webhook type
			// NOTE: Traditional webhooks (assigned, comment) are disabled in favor of agent session events
			if (isIssueAssignedWebhook(webhook)) {
				return;
			} else if (isIssueCommentMentionWebhook(webhook)) {
				return;
			} else if (isIssueNewCommentWebhook(webhook)) {
				return;
			} else if (isIssueUnassignedWebhook(webhook)) {
				// Keep unassigned webhook active
				await this.handleIssueUnassignedWebhook(webhook);
			} else if (isAgentSessionCreatedWebhook(webhook)) {
				await this.handleAgentSessionCreatedWebhook(webhook, repos);
			} else if (isAgentSessionPromptedWebhook(webhook)) {
				await this.handleUserPromptedAgentActivity(webhook);
			} else if (isIssueStateChangeWebhook(webhook)) {
				// Intentional early return: state changes are handled exclusively via the message bus
				// (handleIssueStateChangeMessage), not the legacy webhook path. This differs from
				// unassign which still uses the legacy handler — state change was built message-bus-first.
				return;
			} else if (isIssueDeletedWebhook(webhook)) {
				// Issue deletion also handled via message bus — same cleanup as terminal state.
				return;
			} else if (isIssueTitleOrDescriptionUpdateWebhook(webhook)) {
				// Handle issue title/description/attachments updates - feed changes into active session
				await this.handleIssueContentUpdate(webhook);
			} else if (isIssueStateIdUpdateWebhook(webhook)) {
				// Handle issue state changes — wake up parked sessions when blocking issues complete
				await this.handleIssueStateChange(webhook);
			} else {
				if (process.env.BOBS_FACTORY_WEBHOOK_DEBUG === "true") {
					this.logger.debug(
						`Unhandled webhook type: ${(webhook as any).action}`,
					);
				}
			}
		} catch (error) {
			this.logger.error(
				`Failed to process webhook: ${(webhook as any).action}`,
				error,
			);
			// Don't re-throw webhook processing errors to prevent application crashes
			// The error has been logged and individual webhook failures shouldn't crash the entire system
		} finally {
			// Always decrement counter when webhook processing completes
			this.activeWebhookCount--;
		}
	}

	// ============================================================================
	// INTERNAL MESSAGE BUS HANDLERS
	// ============================================================================
	// These handlers process unified InternalMessage types from the message bus.
	// They provide a platform-agnostic interface for handling events from
	// Linear, GitHub, Slack, and other platforms.
	// ============================================================================

	/**
	 * Handle unified internal messages from the message bus.
	 * This is the new entry point for processing events from all platforms.
	 *
	 * Note: For now, this runs in parallel with legacy webhook handlers.
	 * Once migration is complete, legacy handlers will be removed.
	 */
	private async handleMessage(message: InternalMessage): Promise<void> {
		// NOTE: activeWebhookCount is NOT tracked here because legacy webhook handlers
		// already increment/decrement it for every event. Counting here would double-count.
		// TODO: When legacy handlers are removed, restore activeWebhookCount tracking here.

		// Log verbose message info if enabled
		if (process.env.BOBS_FACTORY_WEBHOOK_DEBUG === "true") {
			this.logger.debug(
				`Internal message received: ${message.source}/${message.action}`,
				JSON.stringify(message, null, 2),
			);
		}

		try {
			// Route to specific message handlers based on action type
			if (isSessionStartMessage(message)) {
				await this.handleSessionStartMessage(message);
			} else if (isUserPromptMessage(message)) {
				await this.handleUserPromptMessage(message);
			} else if (isStopSignalMessage(message)) {
				await this.handleStopSignalMessage(message);
			} else if (isContentUpdateMessage(message)) {
				await this.handleContentUpdateMessage(message);
			} else if (isUnassignMessage(message)) {
				await this.handleUnassignMessage(message);
			} else if (isIssueStateChangeMessage(message)) {
				await this.handleIssueStateChangeMessage(message);
			} else {
				// This branch should never be reached due to exhaustive type checking
				// If it is reached, log the unexpected message for debugging
				if (process.env.BOBS_FACTORY_WEBHOOK_DEBUG === "true") {
					const unexpectedMessage = message as InternalMessage;
					this.logger.debug(
						`Unhandled message action: ${unexpectedMessage.action}`,
					);
				}
			}
		} catch (error) {
			this.logger.error(
				`Failed to process message: ${message.source}/${message.action}`,
				error,
			);
			// Don't re-throw message processing errors to prevent application crashes
		}
	}

	/**
	 * Handle session start message (unified handler for session creation).
	 *
	 * This is a placeholder that logs the message for now.
	 * TODO: Migrate logic from handleAgentSessionCreatedWebhook and handleGitHubWebhook.
	 */
	private async handleSessionStartMessage(
		message: SessionStartMessage,
	): Promise<void> {
		this.logger.debug(
			`[MessageBus] Session start: ${message.workItemIdentifier} from ${message.source}`,
		);
		// TODO: Implement unified session start handling
		// For now, the legacy handlers (handleAgentSessionCreatedWebhook, handleGitHubWebhook)
		// continue to process the actual session creation via the 'event' emitter.
	}

	/**
	 * Handle user prompt message (unified handler for mid-session prompts).
	 *
	 * This is a placeholder that logs the message for now.
	 * TODO: Migrate logic from handleUserPromptedAgentActivity (branch 3).
	 */
	private async handleUserPromptMessage(
		message: UserPromptMessage,
	): Promise<void> {
		this.logger.debug(
			`[MessageBus] User prompt: ${message.workItemIdentifier} from ${message.source}`,
		);
		// TODO: Implement unified user prompt handling
		// For now, the legacy handler (handleUserPromptedAgentActivity)
		// continues to process the actual prompt via the 'event' emitter.
	}

	/**
	 * Handle stop signal message (unified handler for session termination).
	 *
	 * This is a placeholder that logs the message for now.
	 * TODO: Migrate logic from handleUserPromptedAgentActivity (branch 1).
	 */
	private async handleStopSignalMessage(
		message: StopSignalMessage,
	): Promise<void> {
		this.logger.debug(
			`[MessageBus] Stop signal: ${message.workItemIdentifier} from ${message.source}`,
		);
		// TODO: Implement unified stop signal handling
		// For now, the legacy handler (handleUserPromptedAgentActivity)
		// continues to process the actual stop via the 'event' emitter.
	}

	/**
	 * Handle content update message (unified handler for issue/PR content changes).
	 *
	 * This is a placeholder that logs the message for now.
	 * TODO: Migrate logic from handleIssueContentUpdate.
	 */
	private async handleContentUpdateMessage(
		message: ContentUpdateMessage,
	): Promise<void> {
		this.logger.debug(
			`[MessageBus] Content update: ${message.workItemIdentifier} from ${message.source}`,
		);
		// TODO: Implement unified content update handling
		// For now, the legacy handler (handleIssueContentUpdate)
		// continues to process the actual update via the 'event' emitter.
	}

	/**
	 * Handle unassign message (unified handler for task unassignment).
	 *
	 * This is a placeholder that logs the message for now.
	 * TODO: Migrate logic from handleIssueUnassignedWebhook.
	 */
	private async handleUnassignMessage(message: UnassignMessage): Promise<void> {
		this.logger.debug(
			`[MessageBus] Unassign: ${message.workItemIdentifier} from ${message.source}`,
		);
		// TODO: Implement unified unassign handling
		// For now, the legacy handler (handleIssueUnassignedWebhook)
		// continues to process the actual unassignment via the 'event' emitter.
	}

	/**
	 * Handle issue state change message (terminal state reached).
	 * Stops active sessions and deletes worktrees for the issue.
	 */
	private async handleIssueStateChangeMessage(
		message: IssueStateChangeMessage,
	): Promise<void> {
		this.logger.info(
			`[MessageBus] Issue reached terminal state: ${message.workItemIdentifier}`,
		);

		const issueId = message.workItemId;
		const issueKey = LaunchAdmission.issueKey(
			this.config.platform === "cli" ? "cli" : "linear",
			message.organizationId,
			issueId,
		);
		for (const receipt of this.getLaunchAdmission().values())
			if (receipt.issueKey === issueKey)
				this.settleTicketLaunch(receipt.sessionId);

		// Stop all active sessions for this issue
		const sessions = this.agentSessionManager.getSessionsByIssueId(issueId);
		for (const session of sessions) {
			this.logger.info(
				`Stopping agent runner for ${message.workItemIdentifier} (issue terminal)`,
			);
			if (this.factoryRuntime?.runs.has(session.id))
				this.factoryRuntime.stop(session.id);
			this.cancelRunTitle(session.id);
			this.agentSessionManager.requestSessionStop(session.id);
			session.agentRunner?.stop();
		}

		// Post a response activity to each stopped session's Linear thread,
		// then remove the session so subsequent prompts don't find stale state.
		for (const session of sessions) {
			await this.agentSessionManager.createResponseActivity(
				session.id,
				`Session stopped — ${message.workItemIdentifier} was marked as Done or Canceled.`,
			);
			this.agentSessionManager.removeSession(session.id);
		}

		// Build the set of repositories involved with this issue so per-repo
		// bobs-factory-teardown.sh scripts (if present) can run before worktrees are
		// removed. Source-of-truth is the session manager: each session's
		// repositoryId maps to a configured RepositoryConfig.
		const repoIds = new Set<string>();
		for (const session of sessions) {
			const repoId = this.sessionRepositories.get(session.id);
			if (repoId) repoIds.add(repoId);
		}
		const teardownRepositories: RepositoryConfig[] = [];
		for (const repoId of repoIds) {
			const repo = this.repositories.get(repoId);
			if (repo) teardownRepositories.push(repo);
		}

		// Delete worktrees for this issue, keyed by the Linear issue identifier.
		const configured = sessions.find(
			(session) => session.metadata?.executionSnapshot,
		);
		let teardownService = this.gitService;
		if (configured) {
			const snapshot = ExecutionSnapshotSchema.parse(
				configured.metadata!.executionSnapshot,
			);
			const resolved = await this.getExecutionResolver().resolve(
				snapshot,
				configured.id,
				configured.workspace.path,
				configured.titleGeneration?.settings.runner ??
					this.runnerSelectionService.getDefaultRunner(),
			);
			teardownService = this.gitService.withEnvironment(resolved.environment);
		}
		await teardownService.deleteWorktree(message.workItemIdentifier, {
			repositories: teardownRepositories,
		});

		this.logger.info(
			`Completed cleanup for ${message.workItemIdentifier}: stopped ${sessions.length} session(s)`,
		);
	}

	// ============================================================================
	// LEGACY WEBHOOK HANDLERS
	// ============================================================================

	/**
	 * Handle issue unassignment webhook
	 */
	private async handleIssueUnassignedWebhook(
		webhook: IssueUnassignedWebhook,
	): Promise<void> {
		if (!webhook.notification.issue) {
			this.logger.warn("Received issue unassignment webhook without issue");
			return;
		}

		const issueId = webhook.notification.issue.id;

		// Get cached repository, with fallback to searching sessions
		let repository = this.getCachedRepository(issueId);
		if (!repository) {
			// Fallback: search sessions for this issue to find the repository
			this.logger.info(
				`No cached repository for issue unassignment ${webhook.notification.issue.identifier}, searching sessions`,
			);

			const sessions = this.agentSessionManager.getSessionsByIssueId(issueId);
			if (sessions.length > 0) {
				const firstSession = sessions[0]!;
				const repoId = this.sessionRepositories.get(firstSession.id);
				if (repoId) {
					repository = this.repositories.get(repoId) ?? null;
					if (repository) {
						this.logger.info(
							`Recovered repository ${repoId} for unassignment of ${webhook.notification.issue.identifier} from session manager`,
						);
					}
				}

				if (!repository) {
					// Sessions exist but no repository mapping — still stop the sessions
					this.logger.warn(
						`Found ${sessions.length} session(s) for unassigned issue ${webhook.notification.issue.identifier} but no repository mapping, stopping sessions without farewell comment`,
					);
					for (const session of sessions) {
						if (this.factoryRuntime?.runs.has(session.id))
							this.factoryRuntime.stop(session.id);
						this.cancelRunTitle(session.id);
						this.agentSessionManager.requestSessionStop(session.id);
						session.agentRunner?.stop();
					}
					return;
				}
			}

			if (!repository) {
				this.logger.debug(
					`No active sessions found for unassigned issue ${webhook.notification.issue.identifier}`,
				);
				return;
			}
		}

		this.logger.info(
			`Handling issue unassignment: ${webhook.notification.issue.identifier}`,
		);

		await this.handleIssueUnassigned(
			webhook.notification.issue,
			webhook.organizationId,
		);
	}

	/**
	 * Handle issue content update webhook (title, description, or attachments).
	 *
	 * When the title, description, or attachments of an issue are updated, this handler feeds
	 * the changes into any active session for that issue, allowing the AI to
	 * compare old vs new values and decide whether to take action.
	 *
	 * The prompt uses XML-style formatting to clearly show what changed:
	 * - <issue_update> wrapper with timestamp and issue identifier
	 * - <title_change> with <old_title> and <new_title> if title changed
	 * - <description_change> with <old_description> and <new_description> if description changed
	 * - <attachments_change> with <old_attachments> and <new_attachments> if attachments changed
	 * - <guidance> section instructing the agent to evaluate whether changes affect its work
	 *
	 * @see https://studio.apollographql.com/public/Linear-Webhooks/variant/current/schema/reference/objects/EntityWebhookPayload
	 * @see https://studio.apollographql.com/public/Linear-Webhooks/variant/current/schema/reference/objects/IssueWebhookPayload
	 * @see https://studio.apollographql.com/public/Linear-Webhooks/variant/current/schema/reference/unions/DataWebhookPayload
	 */
	private async handleIssueContentUpdate(
		webhook: IssueUpdateWebhook,
	): Promise<void> {
		// Check if issue update trigger is enabled (defaults to true if not set)
		if (this.config.issueUpdateTrigger === false) {
			if (process.env.BOBS_FACTORY_WEBHOOK_DEBUG === "true") {
				this.logger.debug(
					"Issue update trigger is disabled, skipping issue content update",
				);
			}
			return;
		}

		const issueData = webhook.data;
		const issueId = issueData.id;
		const issueIdentifier = issueData.identifier;
		const updatedFrom = webhook.updatedFrom;
		const webhookKey = `${webhook.createdAt}:${issueId}`;

		if (!updatedFrom) {
			this.logger.warn(
				`Issue update webhook for ${issueIdentifier} has no updatedFrom data`,
			);
			return;
		}

		// Deduplicate: skip if we've already processed a webhook with the same key
		if (this.processedIssueUpdateKeys.has(webhookKey)) {
			this.logger.debug(
				`Duplicate issue update webhook for ${issueIdentifier} (key=${webhookKey}), skipping`,
			);
			return;
		}
		this.processedIssueUpdateKeys.add(webhookKey);

		// Prevent unbounded growth — prune old keys when the set gets large
		if (this.processedIssueUpdateKeys.size > 500) {
			const keys = [...this.processedIssueUpdateKeys];
			for (const key of keys.slice(0, 250)) {
				this.processedIssueUpdateKeys.delete(key);
			}
		}

		// Get cached repository, with fallback to searching sessions
		let repository = this.getCachedRepository(issueId);
		if (!repository) {
			// Fallback: search sessions for this issue to find the repository
			const issueSessions =
				this.agentSessionManager.getSessionsByIssueId(issueId);
			if (issueSessions.length > 0) {
				const firstSession = issueSessions[0]!;
				const repoId = this.sessionRepositories.get(firstSession.id);
				if (repoId) {
					repository = this.repositories.get(repoId) ?? null;
					if (repository) {
						this.logger.info(
							`Recovered repository ${repoId} for issue update ${issueIdentifier} from session manager`,
						);
					}
				}
			}

			if (!repository) {
				this.logger.debug(
					`No active sessions found for issue update ${issueIdentifier}`,
				);
				return;
			}
		}

		// Determine what changed for logging
		const changedFields: string[] = [];
		if ("title" in updatedFrom) changedFields.push("title");
		if ("description" in updatedFrom) changedFields.push("description");
		if ("attachments" in updatedFrom) changedFields.push("attachments");

		this.logger.info(
			`Handling issue content update: ${issueIdentifier} (changed: ${changedFields.join(", ")})`,
		);

		// Find session(s) for this issue
		const sessions = this.agentSessionManager.getSessionsByIssueId(issueId);
		if (sessions.length === 0) {
			if (process.env.BOBS_FACTORY_WEBHOOK_DEBUG === "true") {
				this.logger.debug(
					`No sessions found for issue ${issueIdentifier} to receive update`,
				);
			}
			return;
		}

		// Process attachments from the updated description if description changed
		let attachmentManifest = "";
		if ("description" in updatedFrom && issueData.description) {
			const firstSession = sessions[0];
			if (!firstSession) {
				this.logger.debug(`No sessions found for issue ${issueIdentifier}`);
				return;
			}
			const workspaceFolderName = basename(firstSession.workspace.path);
			const attachmentsDir = join(
				this.factoryHome,
				workspaceFolderName,
				"attachments",
			);

			try {
				// Ensure directory exists
				await mkdir(attachmentsDir, { recursive: true });

				// Count existing attachments
				const existingFiles = await readdir(attachmentsDir).catch(() => []);
				const existingAttachmentCount = existingFiles.filter(
					(file) => file.startsWith("attachment_") || file.startsWith("image_"),
				).length;

				// Download attachments from the new description
				// Use organizationId from webhook as the Linear-native workspace ID source
				const linearToken = this.getLinearTokenForWorkspace(
					webhook.organizationId,
				);
				const downloadResult = await this.downloadCommentAttachments(
					issueData.description,
					attachmentsDir,
					linearToken,
					existingAttachmentCount,
				);

				if (downloadResult.totalNewAttachments > 0) {
					attachmentManifest =
						this.generateNewAttachmentManifest(downloadResult);
					this.logger.debug(
						`Downloaded ${downloadResult.totalNewAttachments} attachments from updated description`,
					);
				}
			} catch (error) {
				this.logger.error(
					"Failed to process attachments from updated description:",
					error,
				);
			}
		}

		// Build the XML-formatted prompt showing old vs new values
		const promptBody = this.buildIssueUpdatePrompt(
			issueIdentifier,
			issueData,
			updatedFrom,
		);

		// CYPACK-954: Issue update events are ONLY delivered to the first running
		// session (by most-recently-updated) that supports streaming input.
		// If no such session exists, the event is silently ignored.

		// Combine prompt body with attachment manifest
		let fullPrompt = promptBody;
		if (attachmentManifest) {
			fullPrompt = `${promptBody}\n\n${attachmentManifest}`;
		}

		// Sort by updatedAt descending so the most recent session is first
		const sortedSessions = [...sessions].sort(
			(a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
		);

		let delivered = false;
		for (const session of sortedSessions) {
			const sessionId = session.id;
			const existingRunner = session.agentRunner;
			const isRunning = existingRunner?.isRunning() || false;

			if (
				isRunning &&
				existingRunner?.supportsStreamingInput &&
				existingRunner.addStreamMessage
			) {
				// Best-effort; a steer-only backend may reject when no turn is active.
				try {
					existingRunner.addStreamMessage(fullPrompt);
					delivered = true;
					this.logger.debug(
						`[issue-update] Streamed update to session ${sessionId} (key=${webhookKey}, changed=[${changedFields.join(", ")}])`,
					);
					break;
				} catch (error) {
					this.logger.debug(
						`[issue-update] Stream rejected for session ${sessionId}; skipping (key=${webhookKey})`,
						{ error: error instanceof Error ? error.message : String(error) },
					);
				}
			} else if (isRunning) {
				this.logger.debug(
					`[issue-update] Session ${sessionId} is running but doesn't support streaming input, skipping (key=${webhookKey})`,
				);
			} else {
				this.logger.debug(
					`[issue-update] Session ${sessionId} is idle, ignoring update (key=${webhookKey})`,
				);
			}
		}

		if (!delivered) {
			this.logger.debug(
				`[issue-update] No running streaming sessions for ${issueIdentifier}, update discarded (key=${webhookKey})`,
			);
		}
	}

	/**
	 * Build an XML-formatted prompt for issue content updates (title, description, attachments).
	 *
	 * The prompt clearly shows what fields changed by comparing old vs new values,
	 * and includes guidance for the agent to evaluate whether these changes affect
	 * its current implementation or action plan.
	 */
	/**
	 * Check if an issue has unresolved blocked-by dependencies.
	 * Fetches the issue from Linear and checks its inverse relations for blocking issues
	 * that haven't been completed or canceled.
	 */
	private async checkBlockedByDependencies(
		agentSession: AgentSessionCreatedWebhook["agentSession"],
		linearWorkspaceId: string,
	): Promise<{
		blocked: boolean;
		blockingIssueIds: string[];
		blockingIdentifiers: string[];
	}> {
		const issue = agentSession.issue;
		if (!issue) {
			return { blocked: false, blockingIssueIds: [], blockingIdentifiers: [] };
		}

		try {
			const fullIssue = await this.fetchFullIssueDetails(
				issue.id,
				linearWorkspaceId,
			);
			if (!fullIssue) {
				return {
					blocked: false,
					blockingIssueIds: [],
					blockingIdentifiers: [],
				};
			}

			const blockingIssues =
				await this.promptBuilder.fetchBlockingIssues(fullIssue);
			if (blockingIssues.length === 0) {
				return {
					blocked: false,
					blockingIssueIds: [],
					blockingIdentifiers: [],
				};
			}

			// Filter to only unresolved blockers (not completed or canceled)
			const unresolvedBlockers: Array<{
				id: string;
				identifier: string;
			}> = [];
			for (const blocker of blockingIssues) {
				try {
					const state = await blocker.state;
					if (
						state &&
						state.type !== "completed" &&
						state.type !== "canceled"
					) {
						unresolvedBlockers.push({
							id: blocker.id,
							identifier: blocker.identifier,
						});
					}
				} catch {
					// If we can't resolve the state, assume it's unresolved
					unresolvedBlockers.push({
						id: blocker.id,
						identifier: blocker.identifier,
					});
				}
			}

			if (unresolvedBlockers.length === 0) {
				return {
					blocked: false,
					blockingIssueIds: [],
					blockingIdentifiers: [],
				};
			}

			return {
				blocked: true,
				blockingIssueIds: unresolvedBlockers.map((b) => b.id),
				blockingIdentifiers: unresolvedBlockers.map((b) => b.identifier),
			};
		} catch (error) {
			this.logger.error(
				`Failed to check blocked-by dependencies for ${issue.identifier}:`,
				error,
			);
			// On error, don't block — proceed with normal flow
			return { blocked: false, blockingIssueIds: [], blockingIdentifiers: [] };
		}
	}

	/**
	 * Handle issue state change webhooks.
	 * When a blocking issue is completed, wake up any parked sessions that were waiting on it.
	 */
	private async handleIssueStateChange(
		webhook: IssueUpdateWebhook,
	): Promise<void> {
		const issueData = webhook.data;
		const completedIssueId = issueData.id;
		const issueIdentifier = issueData.identifier;

		// Only care about transitions TO completed or canceled states
		// The IssueWebhookPayload has a stateId field — resolve the state
		// via the issue tracker to check if it's a completion state
		const stateId = issueData.stateId;
		if (!stateId) {
			return;
		}

		// Find workspace for this webhook to resolve state type
		const linearWorkspaceId = webhook.organizationId;
		const issueTracker = this.issueTrackers.get(linearWorkspaceId);
		if (!issueTracker) {
			return;
		}

		// Fetch the issue to check its current state type
		let stateType: string | undefined;
		try {
			const fullIssue = await issueTracker.fetchIssue(completedIssueId);
			const state = await fullIssue.state;
			stateType = state?.type;
		} catch {
			// Can't resolve state — skip
			return;
		}

		if (stateType !== "completed" && stateType !== "canceled") {
			return;
		}

		this.logger.debug(
			`Issue ${issueIdentifier} moved to ${stateType} — checking for parked sessions to wake`,
		);

		// Find parked sessions that were blocked by this issue
		const sessionsToWake: string[] = [];
		for (const [blockedIssueId, parked] of this.parkedSessions.entries()) {
			if (parked.blockingIssueIds.includes(completedIssueId)) {
				// Remove this blocker from the list
				parked.blockingIssueIds = parked.blockingIssueIds.filter(
					(id) => id !== completedIssueId,
				);

				// If no more blockers, wake the session
				if (parked.blockingIssueIds.length === 0) {
					sessionsToWake.push(blockedIssueId);
				} else {
					this.logger.debug(
						`Parked session for issue ${blockedIssueId} still has ${parked.blockingIssueIds.length} remaining blocker(s)`,
					);
				}
			}
		}

		// Wake up unblocked sessions
		for (const blockedIssueId of sessionsToWake) {
			const parked = this.parkedSessions.get(blockedIssueId);
			if (!parked) continue;

			this.parkedSessions.delete(blockedIssueId);

			this.logger.info(
				`Waking parked session for issue ${parked.agentSession.issue?.identifier} — all blockers resolved`,
			);

			// Post activity about waking up
			await this.activityPoster.postThoughtActivity(
				parked.agentSession.id,
				parked.linearWorkspaceId,
				`All blocking dependencies are now resolved — starting work.`,
			);

			// Replay the normal initializeAgentRunner flow
			try {
				await this.initializeAgentRunner(
					parked.agentSession,
					parked.repositories,
					parked.linearWorkspaceId,
					parked.guidance,
					parked.commentBody,
					parked.baseBranchOverrides,
					parked.routingMethod,
				);
			} catch (error) {
				this.logger.error(
					`Failed to wake parked session for issue ${blockedIssueId}:`,
					error,
				);
			}
		}
	}

	/**
	 * Handle a user re-prompt on a parked (blocked-by) session.
	 * Re-checks blocking status: if clear, wakes the session; if still blocked, re-posts status.
	 */
	private async handleParkedSessionReprompt(
		_webhook: AgentSessionPromptedWebhook,
		issueId: string,
	): Promise<void> {
		const parked = this.parkedSessions.get(issueId);
		if (!parked) return;

		const blockResult = await this.checkBlockedByDependencies(
			parked.agentSession,
			parked.linearWorkspaceId,
		);

		if (blockResult.blocked) {
			// Still blocked — update the parked entry and re-post status
			parked.blockingIssueIds = blockResult.blockingIssueIds;
			const blockerList = blockResult.blockingIdentifiers
				.map((id) => `**${id}**`)
				.join(", ");
			await this.activityPoster.postThoughtActivity(
				parked.agentSession.id,
				parked.linearWorkspaceId,
				`Still blocked by ${blockerList}. Will start automatically when resolved.`,
			);
			this.logger.info(
				`Re-prompt on parked session for ${parked.agentSession.issue?.identifier}: still blocked by ${blockResult.blockingIdentifiers.join(", ")}`,
			);
			return;
		}

		// Blockers resolved — wake the session
		this.parkedSessions.delete(issueId);
		this.logger.info(
			`Re-prompt cleared blockers for ${parked.agentSession.issue?.identifier} — waking session`,
		);

		await this.activityPoster.postThoughtActivity(
			parked.agentSession.id,
			parked.linearWorkspaceId,
			`Blocking dependencies are now resolved — starting work.`,
		);

		try {
			await this.initializeAgentRunner(
				parked.agentSession,
				parked.repositories,
				parked.linearWorkspaceId,
				parked.guidance,
				parked.commentBody,
				parked.baseBranchOverrides,
				parked.routingMethod,
			);
		} catch (error) {
			this.logger.error(
				`Failed to wake parked session for issue ${issueId} on re-prompt:`,
				error,
			);
		}
	}

	private buildIssueUpdatePrompt(
		issueIdentifier: string,
		issueData: {
			title: string;
			description?: string | null;
			attachments?: unknown;
		},
		updatedFrom: {
			title?: string;
			description?: string;
			attachments?: unknown;
		},
	): string {
		return this.promptBuilder.buildIssueUpdatePrompt(
			issueIdentifier,
			issueData,
			updatedFrom,
		);
	}

	/**
	 * Get issue tracker for a workspace (direct lookup by workspace ID)
	 */
	private getIssueTrackerForWorkspace(
		linearWorkspaceId: string,
	): IIssueTrackerService | undefined {
		return this.issueTrackers.get(linearWorkspaceId);
	}

	/**
	 * Get the activity sink for a repository by looking up its workspace.
	 */
	private getActivitySinkForRepo(repoId: string): IActivitySink | undefined {
		const repo = this.repositories.get(repoId);
		if (!repo?.linearWorkspaceId) return undefined;
		return this.activitySinks.get(repo.linearWorkspaceId);
	}

	/**
	 * Refresh a workspace's Linear access token if it has expired.
	 *
	 * Only the issue tracker's Linear client refreshes the token, and only when
	 * one of its own requests gets a 401. Chat sessions copy the token into the
	 * Linear MCP server's Authorization header, so a deployment that goes a day
	 * without a Linear webhook hands every chat session an expired token. A
	 * cheap `viewer` query goes through that client, which refreshes and
	 * persists the token (via `onTokenRefresh`) before the MCP config reads it.
	 */
	private async ensureLinearTokenFresh(
		linearWorkspaceId: string,
	): Promise<void> {
		const issueTracker = this.getIssueTrackerForWorkspace(linearWorkspaceId);
		if (!issueTracker) {
			return;
		}
		try {
			await issueTracker.fetchCurrentUser();
		} catch (error) {
			this.logger.warn(
				`Could not validate Linear token for workspace ${linearWorkspaceId}; the Linear MCP server may be unavailable in this session`,
				error,
			);
		}
	}

	/**
	 * Get the Linear API token for a workspace from workspace-level config.
	 */
	private getLinearTokenForWorkspace(linearWorkspaceId: string): string | null {
		const workspaceConfig = this.config.linearWorkspaces?.[linearWorkspaceId];
		if (!workspaceConfig) {
			return null; // CLI platform or unconfigured workspace
		}
		return workspaceConfig.linearToken;
	}

	/**
	 * Create a new Bob’s Factory agent session with all necessary setup
	 * @param sessionId The Linear agent activity session ID
	 * @param issue Linear issue object
	 * @param repositories Repository configurations (primary repo is repositories[0])
	 * @param agentSessionManager Agent session manager instance
	 * @param linearWorkspaceId Linear workspace ID (from webhook.organizationId)
	 * @returns Object containing session details and setup information
	 */
	private async createCyrusAgentSession(
		sessionId: string,
		issue: { id: string; identifier: string },
		repositoriesOrSingle: RepositoryConfig | RepositoryConfig[],
		agentSessionManager: AgentSessionManager,
		linearWorkspaceId: string,
		baseBranchOverrides?: Map<string, string>,
		routingMethod?: string,
	): Promise<AgentSessionData> {
		const repositories = Array.isArray(repositoriesOrSingle)
			? repositoriesOrSingle
			: [repositoriesOrSingle];
		const primaryRepo = repositories[0]!;

		// Fetch full Linear issue details using workspace ID from webhook context
		const fullIssue = await this.fetchFullIssueDetails(
			issue.id,
			linearWorkspaceId,
		);
		if (!fullIssue) {
			throw new Error(`Failed to fetch full issue details for ${issue.id}`);
		}

		let launch: ReturnType<WorkflowRuntime["selectLaunch"]>;
		try {
			launch = await this.selectTicketLaunch(
				sessionId,
				fullIssue,
				linearWorkspaceId,
			);
			if (launch.workflow.id !== "simple" && repositories.length !== 1)
				throw new Error(
					"Factory MVP runs use one repository; use Simple for multi-repository tasks",
				);
		} catch (error) {
			const tracker = this.issueTrackers.get(linearWorkspaceId);
			if (tracker)
				await this.activityPoster.postActivityDirect(
					tracker,
					{
						agentSessionId: sessionId,
						content: {
							type: "response",
							body:
								error instanceof Error
									? error.message
									: "Workflow launch rejected",
						},
					},
					"workflow rejection",
				);
			throw error;
		}
		const executionSnapshot = new ExecutionProfileStore(
			join(this.factoryHome, "factory"),
		).select(primaryRepo.id);
		let execution: ResolvedExecutionEnvironment | undefined;
		if (executionSnapshot) {
			if (repositories.length !== 1)
				throw new Error("Execution profiles require one repository per root");
			const labels = await this.fetchIssueLabels(fullIssue);
			const selection = this.runnerSelectionService.determineRunnerSelection(
				labels,
				fullIssue.description ?? undefined,
			);
			await this.preflightExecution(
				{
					id: sessionId,
					repositoryId: primaryRepo.id,
					workspace: "",
					runner: selection.runnerType,
					model: selection.modelOverride,
					executionSnapshot,
				} as FactoryRun,
				launch.workflow,
				launch.workflowDefinitions,
			);
			executionCapabilities(selection.runnerType);
			execution = await this.getExecutionResolver().resolve(
				executionSnapshot,
				sessionId,
				primaryRepo.repositoryPath,
				selection.runnerType,
			);
		}
		const gitService = execution
			? this.gitService.withEnvironment(execution.environment)
			: this.gitService;
		const takeover = launch.workflow.id === "takeover";
		this.ensureTicketLaunchOpen(linearWorkspaceId, sessionId);
		if (takeover && fullIssue.branchName) {
			baseBranchOverrides = new Map(baseBranchOverrides);
			for (const repo of repositories)
				baseBranchOverrides.set(repo.id, fullIssue.branchName);
		}

		// Move issue to started state automatically, in case it's not already
		await this.moveIssueToStartedState(fullIssue, linearWorkspaceId);

		// Create workspace using full issue data
		// IMPORTANT: The CLI app (apps/cli/src/services/WorkerService.ts) typically provides
		// a custom createWorkspace handler, so the handler path is the one taken in production.
		// When adding new options here, always update the handler signature in config-types.ts
		// AND the CLI's handler implementation in WorkerService.ts to pass them through.
		this.logger.info(
			`createCyrusAgentSession: passing baseBranchOverrides=${baseBranchOverrides ? `Map(size=${baseBranchOverrides.size}, keys=[${Array.from(baseBranchOverrides.keys()).join(",")}])` : "undefined"}, useCustomHandler=${!!this.config.handlers?.createWorkspace}`,
		);
		const preparation = new AbortController();
		this.preparationStarts.set(sessionId, preparation);
		const restart = () => preparation.abort();
		this.recoveryAbort.signal.addEventListener("abort", restart, {
			once: true,
		});
		let workspace: Workspace;
		try {
			this.ensureTicketLaunchOpen(linearWorkspaceId, sessionId);
			this.recoveryAbort.signal.throwIfAborted();
			workspace = await setupExecutionScope.run(
				{
					signal: preparation.signal,
					service: this.runnerSlots,
					capacity: {
						identity: `${this.factoryHome}:preparation:${sessionId}`,
						recoverable: true,
					},
				},
				async () =>
					this.config.handlers?.createWorkspace
						? await this.config.handlers.createWorkspace(
								fullIssue,
								repositories,
								{
									childEnvironment: execution?.environment,
									baseBranchOverrides,
									onRepoSetupHookEvent: (activity) =>
										this.activityPoster.postRepoSetupHookActivity(
											sessionId,
											linearWorkspaceId,
											activity,
										),
								},
							)
						: await gitService.createGitWorktree(fullIssue, repositories, {
								baseBranchOverrides,
								onRepoSetupHookEvent: (activity) =>
									this.activityPoster.postRepoSetupHookActivity(
										sessionId,
										linearWorkspaceId,
										activity,
									),
							}),
			);
			preparation.signal.throwIfAborted();
		} finally {
			this.preparationStarts.delete(sessionId);
			this.recoveryAbort.signal.removeEventListener("abort", restart);
		}

		if (
			takeover &&
			[...(this.factoryRuntime?.runs.values() ?? [])].some(
				(run) =>
					["running", "waiting"].includes(run.status) &&
					run.workspace === workspace.path,
			)
		)
			throw new Error(
				"Another run is using this worktree; terminate it before taking over",
			);
		this.logger.debug(`Workspace created at: ${workspace.path}`);
		this.ensureTicketLaunchOpen(linearWorkspaceId, sessionId);

		const issueMinimal = this.convertLinearIssueToCore(fullIssue);

		// Create RepositoryContext entries for ALL repositories
		// Use resolved base branches from workspace creation (already accounts for
		// commit-ish overrides, graphite blocked-by, parent issues, and defaults)
		const repositoryContexts = repositories.map((repo) => ({
			repositoryId: repo.id,
			branchName: issueMinimal.branchName,
			baseBranchName:
				workspace.resolvedBaseBranches?.[repo.id]?.branch ?? repo.baseBranch,
		}));

		agentSessionManager.createCyrusAgentSession(
			sessionId,
			issue.id,
			issueMinimal,
			workspace,
			"linear",
			repositoryContexts,
		);

		const origin = this.pendingTriggerOrigins.get(sessionId) ?? {
			type: "ticket-assignment" as const,
			workflowId: launch.workflow.id,
			at: new Date().toISOString(),
			ticket: {
				provider:
					this.config.platform === "cli"
						? ("cli" as const)
						: ("linear" as const),
				workspaceId: linearWorkspaceId,
				issueId: fullIssue.id,
				agentSessionId: sessionId,
			},
		};
		const createdSession = agentSessionManager.getSession(sessionId)!;
		if (executionSnapshot)
			createdSession.metadata = {
				...createdSession.metadata,
				executionSnapshot,
			};
		createdSession.workflowChat = launch.workflow.chat ?? false;
		createdSession.triggerOrigin = {
			...origin,
			workflowId: launch.workflow.id,
			selectionMethod: launch.selectionMethod,
			ticket: {
				...origin.ticket!,
				identifier: fullIssue.identifier,
				url: fullIssue.url,
			},
		};
		this.pendingTriggerOrigins.delete(sessionId);
		this.pendingTriggerMessages.delete(sessionId);
		const receipt = this.getLaunchAdmission().get(linearWorkspaceId, sessionId);
		if (receipt)
			this.getLaunchAdmission().update(receipt, {
				origin: createdSession.triggerOrigin,
			});

		// Register session-to-repo mapping and activity sink (use primary repo)
		this.sessionRepositories.set(sessionId, primaryRepo.id);
		const activitySink = this.getActivitySinkForRepo(primaryRepo.id);
		if (activitySink) {
			agentSessionManager.setActivitySink(sessionId, activitySink);
		}

		// Post combined routing + base branch activity
		{
			const repoLines = repositories.map((repo) => {
				const resolution = workspace.resolvedBaseBranches?.[repo.id];
				const branch = resolution?.branch ?? repo.baseBranch;
				const sourceLabel = !resolution
					? "default"
					: resolution.source === "commit-ish"
						? "override"
						: resolution.source === "graphite-blocked-by"
							? (resolution.detail ?? "graphite")
							: resolution.source === "parent-issue"
								? (resolution.detail ?? "parent")
								: "default";
				return `- **${repo.name}** → \`${branch}\` (${sourceLabel})`;
			});
			await this.postRoutingActivity(
				sessionId,
				linearWorkspaceId,
				repoLines,
				routingMethod,
			);
		}

		// Get the newly created session
		const session = agentSessionManager.getSession(sessionId);
		if (!session) {
			throw new Error(
				`Failed to create session for agent activity session ${sessionId}`,
			);
		}

		// Download attachments before creating Claude runner
		const attachmentResult = await this.downloadIssueAttachments(
			fullIssue,
			linearWorkspaceId,
			workspace.path,
		);

		// Pre-create attachments directory even if no attachments exist yet
		const workspaceFolderName = basename(workspace.path);
		const attachmentsDir = join(
			this.factoryHome,
			workspaceFolderName,
			"attachments",
		);
		await mkdir(attachmentsDir, { recursive: true });

		// Write Claude settings to disable co-authored-by attribution in the workspace.
		// This uses the SDK's "local" settings source (loaded via settingSources: ["user", "project", "local"])
		// to ensure Bob’s Factory sessions don't add "Co-Authored-By: Claude" trailers to git commits.
		const claudeSettingsDir = join(workspace.path, ".claude");
		await mkdir(claudeSettingsDir, { recursive: true });
		await writeFile(
			join(claudeSettingsDir, "settings.local.json"),
			JSON.stringify(
				{
					includeCoAuthoredBy: false,
				},
				null,
				"\t",
			),
		);

		// Build allowed directories list - always include attachments directory
		// Include repository paths from all repositories
		const allRepoPaths = repositories.map((repo) => repo.repositoryPath);
		const allowedDirectories: string[] = [
			...new Set([
				attachmentsDir,
				...allRepoPaths,
				...this.gitService.getGitMetadataDirectoriesForWorkspace(workspace),
			]),
		];

		this.logger.debug(
			`Configured allowed directories for ${fullIssue.identifier}:`,
			allowedDirectories,
		);

		// Build allowed tools list with Linear MCP tools
		const allowedTools = this.buildAllowedTools(repositories);
		const disallowedTools = this.buildDisallowedTools(repositories);

		return {
			launch,
			session,
			fullIssue,
			workspace,
			attachmentResult,
			attachmentsDir,
			allowedDirectories,
			allowedTools,
			disallowedTools,
		};
	}

	/**
	 * Handle agent session created webhook
	 * Can happen due to being 'delegated' or @ mentioned in a new thread
	 * @param webhook The agent session created webhook
	 * @param repos All available repositories for routing
	 */
	private getLaunchAdmission(): LaunchAdmission {
		this.launchAdmission ??= new LaunchAdmission(this.factoryHome);
		return this.launchAdmission;
	}

	private ticketReceiptIsActive(receipt: TicketLaunchReceipt): boolean {
		if (receipt.phase === "settled") return false;
		if (["pending", "starting", "recovery"].includes(receipt.phase))
			return true;
		const run = this.getFactoryRuntime().runs.get(receipt.sessionId);
		if (run) return !["completed", "stopped"].includes(run.status);
		const session = this.agentSessionManager.getSession(receipt.sessionId);
		if (session) return this.ticketSessionIsActive(session);
		return true; // Reserved setup, repository/blocker wait or interrupted startup.
	}
	private ticketSessionIsActive(session: CyrusAgentSession): boolean {
		const graphRun = this.getFactoryRuntime().runs.get(session.id);
		if (graphRun && graphRun.workflow.id !== "simple")
			return !["completed", "stopped"].includes(graphRun.status);
		if (session.status !== AgentSessionStatus.Complete) return true;
		const work = session.agentRunner?.getPendingWork?.();
		return Boolean(
			work && (work.sessionCrons.length || work.backgroundTasks.length),
		);
	}

	private ticketStartupIsIncomplete(session: CyrusAgentSession): boolean {
		if (this.factoryRuntime?.runs.has(session.id)) return false;
		const receipt = this.launchAdmission
			?.values()
			.find((item) => item.sessionId === session.id);
		return (
			receipt?.phase === "recovery" ||
			Boolean(
				session.triggerOrigin?.workflowId &&
					session.triggerOrigin.workflowId !== "simple",
			)
		);
	}

	private activeTicketRun(
		workspace: string,
		issue: string,
		except: string,
	): string | undefined {
		const run = [...this.getFactoryRuntime().runs.values()].find(
			(item) =>
				item.id !== except &&
				item.workspaceId === workspace &&
				item.issueId === issue &&
				!["completed", "stopped"].includes(item.status),
		);
		if (run) return run.id;
		return this.agentSessionManager
			.getSessionsByIssueId(issue)
			.find(
				(session) =>
					session.id !== except &&
					(session.issueContext?.issueId ?? session.issueId) === issue &&
					(session.triggerOrigin?.ticket?.workspaceId ??
						this.repositories.get(
							this.sessionRepositories.get(session.id) ??
								session.repositories?.[0]?.repositoryId ??
								"",
						)?.linearWorkspaceId) === workspace &&
					this.ticketSessionIsActive(session) &&
					this.getLaunchAdmission().get(workspace, session.id)?.phase !==
						"settled",
			)?.id;
	}

	private async ticketLaunchFeedback(
		webhook: Pick<AgentSessionCreatedWebhook, "organizationId"> & {
			agentSession: { id: string };
		},
		body: string,
	): Promise<void> {
		const tracker = this.issueTrackers.get(webhook.organizationId);
		if (tracker)
			await this.activityPoster.postActivityDirect(
				tracker,
				{
					agentSessionId: webhook.agentSession.id,
					content: { type: "response", body },
				},
				"workflow launch feedback",
			);
	}

	private async selectTicketLaunch(
		sessionId: string,
		issue: Issue,
		workspace: string,
	): Promise<ReturnType<WorkflowRuntime["selectLaunch"]>> {
		const admission = this.getLaunchAdmission();
		const receipt = admission.get(workspace, sessionId);
		if (receipt?.launch) return structuredClone(receipt.launch);
		const origin = receipt?.origin ?? this.pendingTriggerOrigins.get(sessionId);
		let comment = receipt
			? receipt.commentBody
			: this.pendingTriggerMessages.get(sessionId);
		const source = receipt?.webhook.agentSession.sourceCommentId;
		if (
			receipt &&
			origin?.ticket?.commentId &&
			((source && source !== receipt.webhook.agentSession.comment?.id) ||
				(comment === undefined && origin.ticket.provider === "linear"))
		) {
			const tracker = this.issueTrackers.get(workspace);
			if (!tracker)
				throw new Error("Original triggering comment is unavailable");
			comment = (await tracker.fetchComment(origin.ticket.commentId)).body;
			admission.update(receipt, { commentBody: comment });
		}
		const selector = resolveWorkflowSelector({
			comment: origin?.ticket?.subtype === "assignment" ? undefined : comment,
			description: issue.description,
		});
		const labels = await this.fetchIssueLabels(issue);
		const launch = this.getFactoryRuntime().selectLaunch(
			labels,
			"ticket-assignment",
			selector.workflowId,
		);
		if (origin)
			origin.selection =
				selector.selection ??
				(launch.selectionMethod === "label"
					? {
							source: "label",
							label: launch.workflow.labels.find((label) =>
								labels.includes(label),
							),
						}
					: { source: "default" });
		if (receipt) admission.update(receipt, { launch, origin: origin! });
		return launch;
	}

	private settleTicketLaunch(sessionId: string): void {
		this.preparationStarts.get(sessionId)?.abort();
		for (const receipt of this.getLaunchAdmission().values()) {
			if (receipt.sessionId !== sessionId) continue;
			this.getLaunchAdmission().update(receipt, { phase: "settled" });
			const issue = receipt.origin.ticket!.issueId;
			if (this.parkedSessions.get(issue)?.agentSession.id === sessionId)
				this.parkedSessions.delete(issue);
			this.repositoryRouter.cancelPendingSelection(sessionId);
		}
	}
	private ensureTicketLaunchOpen(workspace: string, session: string): void {
		if (this.getLaunchAdmission().get(workspace, session)?.phase === "settled")
			throw new Error("This ticket launch was stopped");
	}

	private recoverPendingTicketLaunches(): void {
		for (const receipt of this.getLaunchAdmission().values()) {
			if (receipt.phase === "pending") {
				void this.startAcceptedTicketLaunch(receipt, [
					...this.repositories.values(),
				]);
				continue;
			}
			const session = this.agentSessionManager.getSession(receipt.sessionId);
			if (
				receipt.phase !== "settled" &&
				!this.getFactoryRuntime().runs.has(receipt.sessionId) &&
				(receipt.phase === "recovery" ||
					(["starting", "started"].includes(receipt.phase) &&
						(!session || this.ticketStartupIsIncomplete(session))))
			) {
				this.getLaunchAdmission().update(receipt, { phase: "recovery" });
				if (session) session.status = AgentSessionStatus.Error;
				void this.savePersistedState();
				void this.ticketLaunchFeedback(
					receipt.webhook,
					"Startup was interrupted before the accepted workflow was ready. Ownership is retained to prevent duplicate work. Send stop to settle this launch, then start a new session.",
				);
			}
		}
	}

	private captureTicketOrigin(
		webhook: AgentSessionCreatedWebhook,
		created: boolean,
	): void {
		const { agentSession, agentActivity } = webhook;
		if (!agentSession.issue || this.pendingTriggerOrigins.has(agentSession.id))
			return;
		const body = agentSession.comment?.body;
		this.pendingTriggerMessages.set(agentSession.id, body ?? null);
		this.pendingTriggerOrigins.set(agentSession.id, {
			type: "ticket-assignment",
			workflowId: "",
			at: new Date().toISOString(),
			ticket: {
				provider: this.config.platform === "cli" ? "cli" : "linear",
				// CLI issue sessions omit comments; its comment-session API retains them.
				// Linear sessions without source evidence keep the subtype unavailable.
				subtype: created
					? agentSession.sourceCommentId
						? "mention"
						: body
							? !body.includes("This thread is for an agent session")
								? "mention"
								: "assignment"
							: this.config.platform === "cli"
								? "assignment"
								: undefined
					: undefined,
				workspaceId: webhook.organizationId,
				issueId: agentSession.issue.id,
				identifier: agentSession.issue.identifier,
				agentSessionId: agentSession.id,
				commentId:
					agentSession.sourceCommentId ??
					agentSession.comment?.id ??
					agentSession.commentId ??
					agentActivity?.sourceCommentId ??
					undefined,
				activityId: agentActivity?.id,
				sourceTimestamp: webhook.createdAt
					? webhook.createdAt instanceof Date
						? webhook.createdAt.toISOString()
						: String(webhook.createdAt)
					: undefined,
			},
		});
		void this.savePersistedState();
	}

	private async handleAgentSessionCreatedWebhook(
		webhook: AgentSessionCreatedWebhook,
		repos: RepositoryConfig[],
	): Promise<void> {
		this.captureTicketOrigin(webhook, true);
		const issue = webhook.agentSession.issue;
		if (!issue) return;
		const origin = this.pendingTriggerOrigins.get(webhook.agentSession.id)!;
		const admission = this.getLaunchAdmission();
		const issueKey = LaunchAdmission.issueKey(
			origin.ticket!.provider,
			webhook.organizationId,
			issue.id,
		);
		const existing = this.activeTicketRun(
			webhook.organizationId,
			issue.id,
			webhook.agentSession.id,
		);
		const result = admission.reserve(
			{
				issueKey,
				sessionId: webhook.agentSession.id,
				webhook,
				origin,
				commentBody: webhook.agentSession.comment?.body,
			},
			(receipt) => this.ticketReceiptIsActive(receipt),
		);
		if (result.type === "duplicate") {
			this.pendingTriggerOrigins.delete(webhook.agentSession.id);
			return;
		}
		if (existing && result.type === "accepted") {
			admission.update(result.receipt, { phase: "settled" });
			await this.ticketLaunchFeedback(
				webhook,
				`Workflow launch rejected: this issue already has active run ${existing}. Reply to that session or stop it before starting another run. This temporary restriction will be replaced by #36.`,
			);
			this.pendingTriggerOrigins.delete(webhook.agentSession.id);
			return;
		}
		if (result.type === "busy") {
			await this.ticketLaunchFeedback(
				webhook,
				`Workflow launch rejected: this issue already has active run ${result.sessionId}. Reply to that session or stop it before starting another run. This temporary restriction will be replaced by #36.`,
			);
			this.pendingTriggerOrigins.delete(webhook.agentSession.id);
			return;
		}
		// Adopt receipts for pre-journal sessions too; completion is not permission
		// to replay their original created event.
		if (
			this.agentSessionManager.getSession(webhook.agentSession.id)?.id ===
				webhook.agentSession.id ||
			this.getFactoryRuntime().runs.has(webhook.agentSession.id)
		) {
			admission.update(result.receipt, { phase: "started" });
			this.pendingTriggerOrigins.delete(webhook.agentSession.id);
			return;
		}
		await this.startAcceptedTicketLaunch(result.receipt, repos);
	}

	private async startAcceptedTicketLaunch(
		receipt: TicketLaunchReceipt,
		repos: RepositoryConfig[],
	): Promise<void> {
		if (
			this.inFlightTicketStarts.has(receipt.key) ||
			receipt.phase === "settled"
		)
			return;
		this.inFlightTicketStarts.add(receipt.key);
		const { webhook } = receipt;
		this.pendingTriggerOrigins.set(receipt.sessionId, receipt.origin);
		try {
			await this.preflightTicketLaunch(receipt);
			if (
				this.getLaunchAdmission().get(webhook.organizationId, receipt.sessionId)
					?.phase === "settled"
			)
				return; // Stop during preflight.
			await this.routeAcceptedTicketLaunch(webhook, repos);
		} catch (error) {
			const phase =
				this.getLaunchAdmission().get(webhook.organizationId, receipt.sessionId)
					?.phase === "settled"
					? "settled"
					: receipt.phase === "starting" ||
							this.agentSessionManager.getSession(receipt.sessionId)
						? "recovery"
						: "settled";
			this.getLaunchAdmission().update(receipt, { phase });
			await this.ticketLaunchFeedback(
				webhook,
				`${error instanceof Error ? error.message : String(error)}${phase === "recovery" ? " Startup was interrupted; ownership is retained to prevent duplicate work. Inspect the existing session, or send stop before launching a new session." : " Check the workflow ID, labels, default and ticket-assignment permission in Recipes; no fallback was launched."}`,
			);
		} finally {
			this.inFlightTicketStarts.delete(receipt.key);
			await this.savePersistedState();
		}
	}

	private async preflightTicketLaunch(
		receipt: TicketLaunchReceipt,
	): Promise<void> {
		const fullIssue = await this.fetchFullIssueDetails(
			receipt.origin.ticket!.issueId,
			receipt.webhook.organizationId,
		);
		if (!fullIssue)
			throw new Error("Ticket details unavailable; no workflow launched");
		await this.selectTicketLaunch(
			receipt.sessionId,
			fullIssue,
			receipt.webhook.organizationId,
		);
	}

	private async routeAcceptedTicketLaunch(
		webhook: AgentSessionCreatedWebhook,
		repos: RepositoryConfig[],
	): Promise<void> {
		const issueId = webhook.agentSession?.issue?.id;

		// Check the cache first, as the agentSessionCreated webhook may have been triggered by an @mention
		// on an issue that already has an agentSession and an associated repository.
		let repositories: RepositoryConfig[] | null = null;
		let baseBranchOverrides: Map<string, string> | undefined;
		let routingMethod: string | undefined;
		if (issueId) {
			const cachedRepos = this.getCachedRepositories(issueId);
			if (cachedRepos && cachedRepos.length > 0) {
				repositories = cachedRepos;
				this.logger.debug(
					`Using cached repositories [${cachedRepos.map((r) => r.name).join(", ")}] for issue ${issueId}`,
				);
			}
		}

		// If not cached, perform routing logic
		if (!repositories) {
			const routingResult =
				await this.repositoryRouter.determineRepositoryForWebhook(
					webhook,
					repos,
				);

			if (routingResult.type === "none") {
				this.settleTicketLaunch(webhook.agentSession.id);
				if (process.env.BOBS_FACTORY_WEBHOOK_DEBUG === "true") {
					this.logger.info(
						`No repository configured for webhook from workspace ${webhook.organizationId}`,
					);
				}
				return;
			}

			// Handle needs_selection case
			if (routingResult.type === "needs_selection") {
				await this.repositoryRouter.elicitUserRepositorySelection(
					webhook,
					routingResult.workspaceRepos,
				);
				// Selection in progress - will be handled by handleRepositorySelectionResponse
				return;
			}

			// At this point, routingResult.type === "selected"
			repositories = routingResult.repositories;
			baseBranchOverrides = routingResult.baseBranchOverrides;
			if (baseBranchOverrides && baseBranchOverrides.size > 0) {
				this.logger.info(
					`baseBranchOverrides received from routing: ${Array.from(
						baseBranchOverrides.entries(),
					)
						.map(([id, branch]) => `${id}→${branch}`)
						.join(", ")}`,
				);
			} else {
				this.logger.info(`No baseBranchOverrides from routing result`);
			}
			routingMethod = routingResult.routingMethod;

			// Cache all matched repositories for this issue as string[]
			if (issueId) {
				this.repositoryRouter.getIssueRepositoryCache().set(
					issueId,
					repositories.map((r) => r.id),
				);
			}
		}

		if (!webhook.agentSession.issue) {
			this.logger.warn("Agent session created webhook missing issue");
			return;
		}

		// User access control check (use primary repo)
		const primaryRepo = repositories[0]!;
		const accessResult = this.checkUserAccess(webhook, primaryRepo);
		if (!accessResult.allowed) {
			this.logger.info(
				`User ${accessResult.userName} blocked from delegating: ${accessResult.reason}`,
			);
			await this.handleBlockedUser(webhook, primaryRepo, accessResult.reason);
			this.settleTicketLaunch(webhook.agentSession.id);
			return;
		}

		// Use organizationId from webhook as the Linear-native workspace ID source
		const linearWorkspaceId = webhook.organizationId;

		const log = this.logger.withContext({
			sessionId: webhook.agentSession.id,
			platform: this.getRepositoryPlatform(linearWorkspaceId),
			issueIdentifier: webhook.agentSession.issue.identifier,
		});
		log.info(`Handling agent session created`);
		const { agentSession, guidance } = webhook;
		const commentBody = agentSession.comment?.body;

		// If this issue is a sub-issue of an issue Bob’s Factory has a session on, link the
		// two so the parent is resumed when this session completes. Done before the
		// blocked-by check so a parked child is linked as well.
		await this.linkChildSessionToParentIssueSession(
			agentSession.id,
			agentSession.issue,
			linearWorkspaceId,
		);

		// Check for blocked-by dependencies before starting work
		const blockResult = await this.checkBlockedByDependencies(
			agentSession,
			linearWorkspaceId,
		);
		if (blockResult.blocked) {
			// Park the session — don't create worktree or runner
			const parkedIssueId = agentSession.issue!.id;
			this.parkedSessions.set(parkedIssueId, {
				agentSession,
				repositories,
				linearWorkspaceId,
				guidance,
				commentBody,
				baseBranchOverrides,
				routingMethod,
				blockingIssueIds: blockResult.blockingIssueIds,
			});

			// Post acknowledgment to the Linear agent session
			const blockerList = blockResult.blockingIdentifiers
				.map((id) => `**${id}**`)
				.join(", ");
			await this.activityPoster.postThoughtActivity(
				agentSession.id,
				linearWorkspaceId,
				`Blocked by ${blockerList} — will start automatically when ${blockResult.blockingIdentifiers.length === 1 ? "it is" : "they are"} resolved.`,
			);

			log.info(
				`Session parked: issue ${agentSession.issue!.identifier} is blocked by ${blockResult.blockingIdentifiers.join(", ")}`,
			);
			return;
		}

		// Initialize agent runner using shared logic (pass full repositories array)
		await this.initializeAgentRunner(
			agentSession,
			repositories,
			linearWorkspaceId,
			guidance,
			commentBody,
			baseBranchOverrides,
			routingMethod,
		);
	}

	/**
	 * Initialize and start agent runner for an agent session
	 * This method contains the shared logic for creating an agent runner that both
	 * handleAgentSessionCreatedWebhook and handleUserPromptedAgentActivity use.
	 *
	 * @param agentSession The Linear agent session
	 * @param repositories Repository configurations (primary repo is repositories[0])
	 * @param linearWorkspaceId Linear workspace ID (from webhook.organizationId)
	 * @param guidance Optional guidance rules from Linear
	 * @param commentBody Optional comment body (for mentions)
	 * @param baseBranchOverrides Per-repo base branch overrides from [repo=name#branch] syntax
	 */
	private async initializeAgentRunner(
		agentSession: AgentSessionCreatedWebhook["agentSession"],
		repositories: RepositoryConfig[],
		linearWorkspaceId: string,
		guidance?: AgentSessionCreatedWebhook["guidance"],
		commentBody?: string | null,
		baseBranchOverrides?: Map<string, string>,
		routingMethod?: string,
	): Promise<void> {
		const sessionId = agentSession.id;
		const receipt = this.getLaunchAdmission().get(linearWorkspaceId, sessionId);
		if (receipt?.phase === "settled") return;
		if (receipt) {
			commentBody = receipt.commentBody;
			this.getLaunchAdmission().update(receipt, { phase: "starting" });
		} else if (this.pendingTriggerMessages.has(sessionId)) {
			commentBody = this.pendingTriggerMessages.get(sessionId);
		}
		const { issue } = agentSession;

		if (!issue) {
			this.logger.warn("Cannot initialize Claude runner without issue");
			return;
		}

		const primaryRepo = repositories[0]!;

		const log = this.logger.withContext({
			sessionId,
			issueIdentifier: issue.identifier,
		});

		// Log guidance if present
		if (guidance && guidance.length > 0) {
			log.debug(`Agent guidance received: ${guidance.length} rule(s)`);
			for (const rule of guidance) {
				let origin = "Unknown";
				if (rule.origin) {
					if (rule.origin.__typename === "TeamOriginWebhookPayload") {
						origin = `Team: ${rule.origin.team.displayName}`;
					} else {
						origin = "Organization";
					}
				}
				log.info(`- ${origin}: ${rule.body.substring(0, 100)}...`);
			}
		}

		// HACK: This is required since the comment body is always populated, thus there is no other way to differentiate between the two trigger events
		const AGENT_SESSION_MARKER = "This thread is for an agent session";
		const isMentionTriggered =
			commentBody && !commentBody.includes(AGENT_SESSION_MARKER);
		// Check if the comment contains the /label-based-prompt command
		const isLabelBasedPromptRequested = commentBody?.includes(
			"/label-based-prompt",
		);

		const agentSessionManager = this.agentSessionManager;

		// Post instant acknowledgment thought
		await this.postInstantAcknowledgment(sessionId, linearWorkspaceId);

		// Create the session using the shared method (pass full repositories array)
		const sessionData = await this.createCyrusAgentSession(
			sessionId,
			issue,
			repositories,
			agentSessionManager,
			linearWorkspaceId,
			baseBranchOverrides,
			routingMethod,
		);

		// Destructure the session data (excluding allowedTools which we'll build with promptType)
		const {
			session,
			fullIssue,
			workspace: _workspace,
			attachmentResult,
			attachmentsDir: _attachmentsDir,
			allowedDirectories,
		} = sessionData;

		this.prepareRunTitle(sessionId, primaryRepo, {
			instructions: fullIssue.description ?? "",
			ticket: fullIssue,
			comment: commentBody ?? undefined,
		});

		// Fetch labels early (needed for system prompt and runner selection)
		const labels = await this.fetchIssueLabels(fullIssue);

		log.info(`Starting agent session for issue ${fullIssue.identifier}`);

		// Build and start Claude with initial prompt using full issue (streaming mode)
		log.info(`Building initial prompt for issue ${fullIssue.identifier}`);
		try {
			// Create input for unified prompt assembly
			const input: PromptAssemblyInput = {
				session,
				fullIssue,
				repositories,
				repository: primaryRepo,
				userComment: commentBody || "", // Empty for delegation, present for mentions
				attachmentManifest: attachmentResult.manifest,
				guidance: guidance || undefined,
				agentSession,
				labels,
				isNewSession: true,
				isStreaming: false, // Not yet streaming
				isMentionTriggered: isMentionTriggered || false,
				isLabelBasedPromptRequested: isLabelBasedPromptRequested || false,
				resolvedBaseBranches: sessionData.workspace.resolvedBaseBranches,
				linearWorkspaceId,
			};

			// Use unified prompt assembly
			const assembly = await this.assemblePrompt(input);
			const ticket = await issueSnapshot(
				fullIssue,
				labels,
				this.issueTrackers.get(linearWorkspaceId),
			);
			assembly.userPrompt += `\n\nComplete ticket snapshot:\n${JSON.stringify(ticket, null, 2)}`;

			// Get systemPromptVersion for tracking (TODO: add to PromptAssembly metadata)
			let systemPromptVersion: string | undefined;
			let promptType:
				| "debugger"
				| "builder"
				| "scoper"
				| "orchestrator"
				| "graphite-orchestrator"
				| undefined;

			if (!isMentionTriggered || isLabelBasedPromptRequested) {
				const systemPromptResult = await this.determineSystemPromptFromLabels(
					labels,
					primaryRepo,
				);
				systemPromptVersion = systemPromptResult?.version;
				promptType = systemPromptResult?.type;

				// Post thought about system prompt selection
				if (assembly.systemPrompt) {
					await this.postSystemPromptSelectionThought(
						sessionId,
						labels,
						linearWorkspaceId,
						primaryRepo.id,
					);
				}
			}

			// Build allowed tools list with Linear MCP tools (now with prompt type context)
			const allowedTools = this.buildAllowedTools(repositories, promptType);
			const disallowedTools = this.buildDisallowedTools(
				repositories,
				promptType,
			);

			log.debug(
				`Configured allowed tools for ${fullIssue.identifier}:`,
				allowedTools,
			);
			if (disallowedTools.length > 0) {
				log.debug(
					`Configured disallowed tools for ${fullIssue.identifier}:`,
					disallowedTools,
				);
			}

			// Create agent runner with system prompt from assembly
			const { workflow, workflowDefinitions } = sessionData.launch;
			this.ensureTicketLaunchOpen(linearWorkspaceId, sessionId);
			if (workflow.id !== "simple") {
				if (repositories.length !== 1)
					throw new Error(
						"Factory MVP runs use one repository; use Simple for multi-repository tasks",
					);
				const selectedRunner = await this.buildAgentRunnerConfig(
					session,
					primaryRepo,
					sessionId,
					undefined,
					allowedTools,
					allowedDirectories,
					disallowedTools,
					undefined,
					labels,
					fullIssue.description ?? undefined,
					undefined,
					linearWorkspaceId,
				);
				this.ensureTicketLaunchOpen(linearWorkspaceId, sessionId);
				const run = this.getFactoryRuntime().create({
					id: sessionId,
					executionSnapshot: session.metadata?.executionSnapshot
						? ExecutionSnapshotSchema.parse(session.metadata.executionSnapshot)
						: undefined,
					title: fullIssue.title,
					repositoryId: primaryRepo.id,
					workflow,
					workflowDefinitions,
					triggerOrigin: session.triggerOrigin!,
					workspace: session.workspace.path,
					input: assembly.userPrompt,
					issueId: fullIssue.id,
					workspaceId: linearWorkspaceId,
				});
				run.outputs.repository = {
					baseBranch:
						workflow.id === "takeover"
							? primaryRepo.baseBranch
							: (session.repositories[0]?.baseBranchName ??
								primaryRepo.baseBranch),
					name: primaryRepo.name,
					githubUrl: primaryRepo.githubUrl,
					gitlabUrl: primaryRepo.gitlabUrl,
					gitProvider: primaryRepo.gitProvider,
				};
				run.titleGeneration = session.titleGeneration;
				run.outputs.ticket = ticket;
				const tracker = this.issueTrackers.get(linearWorkspaceId)!;
				run.ticketReference = {
					provider: "native",
					platform: tracker.getPlatformType(),
					workspaceId: linearWorkspaceId,
					id: fullIssue.id,
					url: fullIssue.url,
				};
				run.runner = selectedRunner.runnerType;
				run.model = selectedRunner.config.model;
				this.saveFactorySession(run);
				this.getFactoryRuntime().save(run);
				if (receipt)
					this.getLaunchAdmission().update(receipt, { phase: "started" });
				this.emit("session:started", fullIssue.id, fullIssue, primaryRepo.id);
				this.config.handlers?.onSessionStart?.(
					fullIssue.id,
					fullIssue,
					primaryRepo.id,
				);
				void this.getFactoryRuntime().launch(run);
				return;
			}

			// Create agent runner with system prompt from assembly
			// buildAgentRunnerConfig now determines runner type from labels internally
			const { config: runnerConfig, runnerType } =
				await this.buildAgentRunnerConfig(
					session,
					primaryRepo,
					sessionId,
					assembly.systemPrompt,
					allowedTools,
					allowedDirectories,
					disallowedTools,
					undefined, // resumeSessionId
					labels, // Pass labels for runner selection and model override
					fullIssue.description || undefined, // Description tags can override label selectors
					undefined, // maxTurns
					linearWorkspaceId,
					this.buildSkillSessionContext(primaryRepo, fullIssue, session),
				);

			log.debug(
				`Label-based runner selection for new session: ${runnerType} (session ${sessionId})`,
			);

			const runner = this.createRunnerForType(
				runnerType,
				runnerConfig,
				undefined,
				sessionId,
			);
			this.ensureTicketLaunchOpen(linearWorkspaceId, sessionId);

			// Store runner by comment ID
			agentSessionManager.addAgentRunner(sessionId, runner);
			if (receipt)
				this.getLaunchAdmission().update(receipt, { phase: "started" });

			// Save state after mapping changes
			await this.savePersistedState();

			// Emit events using full issue (core Issue type)
			this.emit("session:started", fullIssue.id, fullIssue, primaryRepo.id);
			this.config.handlers?.onSessionStart?.(
				fullIssue.id,
				fullIssue,
				primaryRepo.id,
			);

			// Update runner with version information (if available)
			// Note: updatePromptVersions is specific to ClaudeRunner
			if (
				systemPromptVersion &&
				"updatePromptVersions" in runner &&
				typeof runner.updatePromptVersions === "function"
			) {
				runner.updatePromptVersions({
					systemPromptVersion,
				});
			}

			// Log metadata for debugging
			log.debug(
				`Initial prompt built successfully - components: ${assembly.metadata.components.join(", ")}, type: ${assembly.metadata.promptType}, length: ${assembly.userPrompt.length} characters`,
			);

			// Start session - use streaming mode if supported for ability to add messages later
			// Unassignment or stop can settle ownership while persistence is awaiting.
			this.ensureTicketLaunchOpen(linearWorkspaceId, sessionId);
			if (runner.supportsStreamingInput && runner.startStreaming) {
				log.debug(`Starting streaming session`);
				const sessionInfo = await runner.startStreaming(assembly.userPrompt);
				log.debug(`Streaming session started: ${sessionInfo.sessionId}`);
			} else {
				log.debug(`Starting non-streaming session`);
				const sessionInfo = await runner.start(assembly.userPrompt);
				log.debug(`Non-streaming session started: ${sessionInfo.sessionId}`);
			}
			// Note: AgentSessionManager will be initialized automatically when the first system message
			// is received via handleClaudeMessage() callback
		} catch (error) {
			log.error(`Error in prompt building/starting:`, error);
			throw error;
		}
	}

	/**
	 * Handle stop signal from prompted webhook
	 * Branch 1 of agentSessionPrompted (see packages/CLAUDE.md)
	 *
	 * IMPORTANT: Stop signals do NOT require repository lookup.
	 * The session must already exist (per CLAUDE.md), so we search
	 * all agent session managers to find it.
	 */
	private async handleStopSignal(
		webhook: AgentSessionPromptedWebhook,
	): Promise<void> {
		const agentSessionId = webhook.agentSession.id;
		const receipt = this.getLaunchAdmission().get(
			webhook.organizationId,
			agentSessionId,
		);
		if (
			receipt &&
			!this.agentSessionManager.getSession(agentSessionId) &&
			!this.getFactoryRuntime().runs.has(agentSessionId)
		) {
			this.settleTicketLaunch(agentSessionId);
			await this.ticketLaunchFeedback(
				webhook,
				"Stopped the pending ticket launch. Its ownership is settled; a new assignment or mention can start a new run.",
			);
			return;
		}
		if (this.factoryRuntime?.runs.has(agentSessionId)) {
			this.settleTicketLaunch(agentSessionId);
			this.factoryRuntime.stop(agentSessionId);
			this.agentSessionManager.getAgentRunner(agentSessionId)?.stop();
			return;
		}
		const { issue } = webhook.agentSession;
		const log = this.logger.withContext({ sessionId: agentSessionId });

		log.info(
			`Received stop signal for agent activity session ${agentSessionId}`,
		);

		// Find the session in the single session manager
		const foundSession = this.agentSessionManager.getSession(agentSessionId);

		if (!foundSession) {
			this.settleTicketLaunch(agentSessionId);
			// Legacy recovery: session lost after restart/migration
			// Post acknowledgment so the user doesn't see a hanging state
			log.info(
				`No session found for stop signal ${agentSessionId} (likely a legacy session after restart)`,
			);

			const issueTitle = issue?.title || "this issue";
			await this.agentSessionManager.createResponseActivity(
				agentSessionId,
				`Stop signal received for ${issueTitle}. No active session was found (the session may have ended or the system was restarted). No further action is needed.`,
			);
			return;
		}

		// Double-stop detection: two stop signals within 10s → full abort
		const now = Date.now();
		const lastStop = this.lastStopTimeBySession.get(agentSessionId);
		const isDoubleStop = lastStop !== undefined && now - lastStop < 10_000;
		this.lastStopTimeBySession.set(agentSessionId, now);

		const existingRunner = foundSession.agentRunner;
		this.cancelRunTitle(agentSessionId);
		const issueTitle = issue?.title || "this issue";
		const senderName = webhook.agentSession.creator?.name || "user";

		// Only warm sessions can be safely interrupted without killing the
		// underlying request. Non-warm sessions get a single-shot full stop —
		// calling interrupt() on them surfaces a "Request was aborted" error
		// from the SDK (see CYPACK-1145).
		const supportsInterrupt = Boolean(
			existingRunner?.interrupt && existingRunner?.isWarm?.(),
		);

		if (isDoubleStop || !supportsInterrupt) {
			this.settleTicketLaunch(agentSessionId);
			// Either a second stop within window, or a non-warm runner — full kill
			this.agentSessionManager.requestSessionStop(agentSessionId);
			if (existingRunner) {
				existingRunner.stop();
				log.info(
					isDoubleStop
						? `Double-stop: fully aborted session ${agentSessionId}`
						: `Stopped session ${agentSessionId} (interrupt not supported)`,
				);
			}
			this.lastStopTimeBySession.delete(agentSessionId);
			await this.agentSessionManager.createResponseActivity(
				agentSessionId,
				isDoubleStop
					? `I've fully stopped working on ${issueTitle}.\n\n**Stop Signal:** Received from ${senderName} (second stop)\n**Action Taken:** Session terminated`
					: `I've stopped working on ${issueTitle}.\n\n**Stop Signal:** Received from ${senderName}\n**Action Taken:** Session terminated`,
			);
		} else {
			// First stop on a warm session — interrupt current turn, keep session warm
			await existingRunner!.interrupt!();
			log.info(
				`Interrupted current turn for session ${agentSessionId} (send stop again within 10s to fully terminate)`,
			);
			await this.agentSessionManager.createResponseActivity(
				agentSessionId,
				`Interrupted by ${senderName}\n**Tip:** Type and send "stop" within 10 seconds to fully terminate the session.`,
			);
		}
	}

	/**
	 * Handle repository selection response from prompted webhook
	 * Branch 2 of agentSessionPrompted (see packages/CLAUDE.md)
	 *
	 * This method extracts the user's repository selection from their response,
	 * or uses the fallback repository if their message doesn't match any option.
	 * In both cases, the selected repository is cached for future use.
	 */
	private async handleRepositorySelectionResponse(
		webhook: AgentSessionPromptedWebhook,
	): Promise<void> {
		const { agentSession, agentActivity, guidance } = webhook;
		const commentBody = agentSession.comment?.body;
		const agentSessionId = agentSession.id;
		const log = this.logger.withContext({ sessionId: agentSessionId });

		if (!agentActivity) {
			log.warn("Cannot handle repository selection without agentActivity");
			return;
		}

		if (!agentSession.issue) {
			log.warn("Cannot handle repository selection without issue");
			return;
		}

		const userMessage = agentActivity.content.body;

		log.debug(`Processing repository selection response: "${userMessage}"`);

		// Get the selected repository (or fallback)
		const repository = await this.repositoryRouter.selectRepositoryFromResponse(
			agentSessionId,
			userMessage,
		);

		if (!repository) {
			log.error(
				`Failed to select repository for agent session ${agentSessionId}`,
			);
			return;
		}

		// Cache the selected repository for this issue as string[]
		const issueId = agentSession.issue.id;
		this.repositoryRouter
			.getIssueRepositoryCache()
			.set(issueId, [repository.id]);

		log.debug(
			`Initializing agent runner after repository selection: ${agentSession.issue.identifier} -> ${repository.name}`,
		);

		// The created webhook returned early to ask for a repository, so the
		// parent-issue link has not been established yet for this session.
		await this.linkChildSessionToParentIssueSession(
			agentSessionId,
			agentSession.issue,
			webhook.organizationId,
		);

		// Initialize agent runner with the selected repository (wrapped in array)
		// routingMethod="user-selected" will be included in the combined routing activity
		// Use organizationId from webhook as the Linear-native workspace ID source
		await this.initializeAgentRunner(
			agentSession,
			[repository],
			webhook.organizationId,
			guidance,
			commentBody,
			undefined,
			"user-selected",
		);
	}

	/**
	 * Handle AskUserQuestion response from prompted webhook
	 * Branch 2.5: User response to a question posed via AskUserQuestion tool
	 *
	 * @param webhook The prompted webhook containing user's response
	 */
	private async handleAskUserQuestionResponse(
		webhook: AgentSessionPromptedWebhook,
	): Promise<void> {
		const { agentSession, agentActivity } = webhook;
		const agentSessionId = agentSession.id;

		if (!agentActivity) {
			this.logger.warn(
				"Cannot handle AskUserQuestion response without agentActivity",
			);
			// Resolve with a denial to unblock the waiting promise
			this.askUserQuestionHandler.cancelPendingQuestion(
				agentSessionId,
				"No agent activity in webhook",
			);
			return;
		}

		// Extract the user's response from the activity body
		const userResponse = agentActivity.content?.body || "";

		this.logger.debug(
			`Processing AskUserQuestion response for session ${agentSessionId}: "${userResponse}"`,
		);

		// Pass the response to the handler to resolve the waiting promise
		const handled = this.askUserQuestionHandler.handleUserResponse(
			agentSessionId,
			userResponse,
		);

		if (!handled) {
			this.logger.warn(
				`AskUserQuestion response not handled for session ${agentSessionId} (no pending question)`,
			);
		} else {
			this.logger.debug(
				`AskUserQuestion response handled for session ${agentSessionId}`,
			);
		}
	}

	/**
	 * Handle normal prompted activity (existing session continuation)
	 * Branch 3 of agentSessionPrompted (see packages/CLAUDE.md)
	 */
	private async handleNormalPromptedActivity(
		webhook: AgentSessionPromptedWebhook,
		repositories: RepositoryConfig[],
	): Promise<void> {
		const repository = repositories[0]!;
		const { agentSession } = webhook;
		const sessionId = agentSession.id;
		const { issue } = agentSession;
		// Use organizationId from webhook as the Linear-native workspace ID source
		const linearWorkspaceId = webhook.organizationId;

		if (!issue) {
			this.logger.warn("Cannot handle prompted activity without issue");
			return;
		}

		if (!webhook.agentActivity) {
			this.logger.warn("Cannot handle prompted activity without agentActivity");
			return;
		}

		const commentId = webhook.agentActivity.sourceCommentId;

		const agentSessionManager = this.agentSessionManager;

		const session = agentSessionManager.getSession(sessionId);
		const isNewSession = false;

		if (!session) {
			throw new Error(
				"Accepted session context disappeared during reply delivery; no replacement workflow was launched",
			);
		} else {
			this.logger.debug(
				`Found existing session ${sessionId} for new user prompt`,
			);

			// Post instant acknowledgment for existing session BEFORE any async work
			// Check if runner is currently running (streaming is Claude-specific, use isRunning for both)
			const isCurrentlyStreaming = session?.agentRunner?.isRunning() || false;

			await this.postInstantPromptedAcknowledgment(
				sessionId,
				linearWorkspaceId,
				isCurrentlyStreaming,
			);
		}

		// Note: Streaming check happens later in handlePromptWithStreamingCheck
		// after attachments are processed

		// Ensure session is not null after creation/retrieval
		if (!session) {
			throw new Error(
				`Failed to get or create session for agent activity session ${sessionId}`,
			);
		}

		// Acknowledgment already posted above for both new and existing sessions
		// (before any async routing work to ensure instant user feedback)

		// Get issue tracker using workspace ID from webhook context
		const issueTracker = this.issueTrackers.get(linearWorkspaceId);
		if (!issueTracker) {
			this.logger.error(
				"Unexpected: There was no IssueTrackerService for workspace",
				linearWorkspaceId,
			);
			return;
		}

		// Always set up attachments directory, even if no attachments in current comment
		const workspaceFolderName = basename(session.workspace.path);
		const attachmentsDir = join(
			this.factoryHome,
			workspaceFolderName,
			"attachments",
		);
		// Ensure directory exists
		await mkdir(attachmentsDir, { recursive: true });

		let attachmentManifest = "";
		let commentAuthor: string | undefined;
		let commentTimestamp: string | undefined;

		if (!commentId) {
			this.logger.warn("No comment ID provided for attachment handling");
		}

		try {
			const comment = commentId
				? await issueTracker.fetchComment(commentId)
				: null;

			// Extract comment metadata for multi-player context
			if (comment) {
				const user = await comment.user;
				commentAuthor =
					user?.displayName || user?.name || user?.email || "Unknown";
				commentTimestamp = comment.createdAt
					? comment.createdAt.toISOString()
					: new Date().toISOString();
			}

			// Count existing attachments
			const existingFiles = await readdir(attachmentsDir).catch(() => []);
			const existingAttachmentCount = existingFiles.filter(
				(file) => file.startsWith("attachment_") || file.startsWith("image_"),
			).length;

			// Download new attachments from the comment
			const linearTokenForAttachments =
				this.getLinearTokenForWorkspace(linearWorkspaceId);
			const downloadResult = comment
				? await this.downloadCommentAttachments(
						comment.body,
						attachmentsDir,
						linearTokenForAttachments,
						existingAttachmentCount,
					)
				: {
						totalNewAttachments: 0,
						newAttachmentMap: {},
						newImageMap: {},
						failedCount: 0,
					};

			if (downloadResult.totalNewAttachments > 0) {
				attachmentManifest = this.generateNewAttachmentManifest(downloadResult);
			}
		} catch (error) {
			this.logger.error("Failed to fetch comments for attachments:", error);
		}

		const promptBody = webhook.agentActivity.content.body;

		// Recheck after attachment IO. A rejected steer must never interrupt
		// active work by falling through to the legacy stop/resume path.
		try {
			const chat = this.factoryChatState(sessionId);
			if (!chat.available) throw new Error(chat.reason ?? "Chat unavailable");
			if (chat.mode === "steer") {
				session.agentRunner!.addStreamMessage!(
					attachmentManifest
						? `${promptBody}\n\n${attachmentManifest}`
						: promptBody,
				);
				return;
			}
			await this.handlePromptWithStreamingCheck(
				session,
				repository,
				sessionId,
				agentSessionManager,
				promptBody,
				attachmentManifest,
				isNewSession,
				[], // No additional allowed directories for regular continuation
				`prompted webhook (${isNewSession ? "new" : "existing"} session)`,
				linearWorkspaceId,
				commentAuthor,
				commentTimestamp,
			);
		} catch (error) {
			this.logger.error("Failed to handle prompted webhook:", error);
			throw error;
		}
	}

	/**
	 * Handle user-prompted agent activity webhook
	 * Implements three-branch architecture from packages/CLAUDE.md:
	 *   1. Stop signal - terminate existing runner
	 *   2. Repository selection response - initialize Claude runner for first time
	 *   3. Normal prompted activity - continue existing session or create new one
	 *
	 * @param webhook The prompted webhook containing user's message
	 */
	private async handleUserPromptedAgentActivity(
		webhook: AgentSessionPromptedWebhook,
	): Promise<void> {
		const body = webhook.agentActivity?.content?.body ?? "";
		const isStop =
			webhook.agentActivity?.signal === "stop" ||
			/^\s*stop(\s+session|\s+working)?[\s.!?]*$/i.test(body);
		const { organizationId: workspace, agentSession } = webhook;
		const receipt = this.getLaunchAdmission().get(workspace, agentSession.id);
		if (receipt && receipt.origin.ticket!.issueId !== agentSession.issue?.id) {
			await this.ticketLaunchFeedback(
				webhook,
				"Reply rejected: the session and issue identities do not match.",
			);
			return;
		}
		const id =
			webhook.agentActivity?.id ?? webhook.agentActivity?.sourceCommentId;
		if (!id && !isStop && this.config.platform !== "cli") {
			await this.ticketLaunchFeedback(
				webhook,
				"Reply cannot be delivered safely: no native activity or source comment identity was supplied. Send a new reply in the original Linear session.",
			);
			return;
		}
		if (id) {
			const status = this.getLaunchAdmission().beginPrompt(
				workspace,
				agentSession.id,
				id,
			);
			if (status !== "new") {
				if (status === "pending")
					await this.ticketLaunchFeedback(
						webhook,
						"This reply is already being delivered, or delivery was interrupted. Inspect the existing session; if no answer arrived, send a new reply. It will not be applied twice.",
					);
				return;
			}
		}
		let resuming = false;
		try {
			// Native redeliveries are one stop. Distinct activities still retain
			// the warm runner's interrupt-then-double-stop behavior.
			if (isStop) {
				await this.handleStopSignal(webhook);
				if (id)
					this.getLaunchAdmission().finishPrompt(
						workspace,
						agentSession.id,
						id,
					);
				return;
			}
			const session = this.agentSessionManager.getSession(agentSession.id);
			if (receipt && session?.status === AgentSessionStatus.Complete) {
				const owner =
					this.activeTicketRun(
						workspace,
						receipt.origin.ticket!.issueId,
						agentSession.id,
					) ??
					this.getLaunchAdmission()
						.values()
						.find(
							(item) =>
								item.key !== receipt.key &&
								item.issueKey === receipt.issueKey &&
								this.ticketReceiptIsActive(item),
						)?.sessionId;
				if (owner)
					throw new Error(
						`This issue is owned by active run ${owner}; reply there instead`,
					);
				if (receipt.phase === "starting")
					throw new Error("The existing conversation is already resuming");
				this.getLaunchAdmission().update(receipt, { phase: "starting" });
				resuming = true;
			}
			await this.deliverUserPromptedAgentActivity(webhook);
			if (
				receipt &&
				this.getLaunchAdmission().get(workspace, agentSession.id)?.phase !==
					"settled" &&
				session
			)
				this.getLaunchAdmission().update(receipt, { phase: "started" });
			if (id)
				this.getLaunchAdmission().finishPrompt(workspace, agentSession.id, id);
		} catch (error) {
			if (resuming && receipt && receipt.phase !== "settled") {
				// A rejected reply must not turn a completed conversation into a
				// permanently reserved launch. Retain recovery ownership only if
				// delivery actually moved the session out of its completed state.
				this.getLaunchAdmission().update(receipt, {
					phase:
						this.agentSessionManager.getSession(agentSession.id)?.status ===
						AgentSessionStatus.Complete
							? "started"
							: "recovery",
				});
			}
			await this.ticketLaunchFeedback(
				webhook,
				`Reply delivery failed: ${error instanceof Error ? error.message : String(error)}. Inspect the existing run and resend as a new reply after recovery; no replacement workflow was launched.`,
			);
		}
	}

	private async deliverUserPromptedAgentActivity(
		webhook: AgentSessionPromptedWebhook,
	): Promise<void> {
		const agentSessionId = webhook.agentSession.id;
		const activityBody = webhook.agentActivity?.content?.body || "";
		// Branch 1.5: Handle re-prompt for parked (blocked-by) sessions
		const direct = this.getFactoryRuntime().runs.get(agentSessionId);
		if (
			direct &&
			(direct.workspaceId !== webhook.organizationId ||
				direct.issueId !== webhook.agentSession.issue?.id)
		)
			throw new Error("Session belongs to another workspace or issue");
		const candidates = direct
			? [direct]
			: [...this.getFactoryRuntime().runs.values()].filter(
					(run) =>
						run.id.startsWith("manual-") &&
						run.issueId === webhook.agentSession.issue?.id &&
						run.workspaceId === webhook.organizationId &&
						run.status === "waiting",
				);
		if (candidates.length > 1)
			throw new Error(
				"More than one run is waiting on this issue. Answer the specific run in the Factory UI",
			);
		const factoryRun = candidates[0];
		if (factoryRun) {
			if (
				factoryRun.status === "waiting" &&
				factoryRun.reviewGate?.status !== "pending"
			)
				this.factoryRuntime!.answer(factoryRun.id, activityBody);
			else {
				if (factoryRun.reviewGate?.status === "pending")
					throw new Error(
						"This run needs explicit human review in the Factory UI; a reply cannot approve it",
					);
				this.sendFactoryChat(factoryRun.id, activityBody);
			}
			return;
		}
		// When a user re-prompts and the session is parked, re-check blocking status.
		// If blockers are resolved, wake the session immediately.
		const issueIdForParkedCheck = webhook.agentSession?.issue?.id;
		if (
			issueIdForParkedCheck &&
			this.parkedSessions.get(issueIdForParkedCheck)?.agentSession.id ===
				agentSessionId &&
			this.parkedSessions.get(issueIdForParkedCheck)?.linearWorkspaceId ===
				webhook.organizationId
		) {
			await this.handleParkedSessionReprompt(webhook, issueIdForParkedCheck);
			return;
		}

		// Branch 2: Handle repository selection response
		// This is the first Claude runner initialization after user selects a repository.
		// The selection handler extracts the choice from the response (or uses fallback)
		// and caches the repository for future use.
		if (this.repositoryRouter.hasPendingSelection(agentSessionId)) {
			await this.handleRepositorySelectionResponse(webhook);
			return;
		}

		// Branch 2.5: Handle AskUserQuestion response
		// This handles responses to questions posed via the AskUserQuestion tool.
		// The response is passed to the pending promise resolver.
		if (this.askUserQuestionHandler.hasPendingQuestion(agentSessionId)) {
			await this.handleAskUserQuestionResponse(webhook);
			return;
		}
		if (!this.agentSessionManager.getSession(agentSessionId)) {
			const receipt = this.getLaunchAdmission().get(
				webhook.organizationId,
				agentSessionId,
			);
			throw new Error(
				receipt
					? "The accepted launch is waiting for setup or needs startup recovery. Send stop to settle an interrupted launch before starting a new session"
					: "No accepted session is associated with this reply. Start a new assignment or mention on an inactive issue",
			);
		}
		const acceptedSession =
			this.agentSessionManager.getSession(agentSessionId)!;
		const acceptedWorkspace =
			acceptedSession.triggerOrigin?.ticket?.workspaceId ??
			this.repositories.get(
				this.sessionRepositories.get(agentSessionId) ??
					acceptedSession.repositories?.[0]?.repositoryId ??
					"",
			)?.linearWorkspaceId;
		if (
			(acceptedSession.issueContext?.issueId ?? acceptedSession.issueId) !==
				webhook.agentSession.issue?.id ||
			(acceptedWorkspace && acceptedWorkspace !== webhook.organizationId)
		)
			throw new Error("Session belongs to another workspace or issue");
		const chat = this.factoryChatState(agentSessionId);
		if (!chat.available)
			throw new Error(
				chat.reason ??
					(acceptedSession.workflowChat === false
						? "Chat was disabled in this session's accepted recipe. Use the existing run's question or recovery controls"
						: "Chat unavailable"),
			);
		const otherRun =
			this.activeTicketRun(
				webhook.organizationId,
				webhook.agentSession.issue?.id ?? "",
				agentSessionId,
			) ??
			this.getLaunchAdmission()
				.values()
				.find(
					(item) =>
						item.sessionId !== agentSessionId &&
						item.issueKey ===
							LaunchAdmission.issueKey(
								this.config.platform === "cli" ? "cli" : "linear",
								webhook.organizationId,
								webhook.agentSession.issue?.id ?? "",
							) &&
						this.ticketReceiptIsActive(item),
				)?.sessionId;
		if (otherRun)
			throw new Error(
				`This issue is owned by active run ${otherRun}; reply there instead`,
			);

		// Branch 3: Handle normal prompted activity (existing session continuation)
		// Per CLAUDE.md: "an agentSession MUST exist and a repository MUST already
		// be associated with the Linear issue. The repository will be retrieved from
		// the issue-to-repository cache - no new routing logic is performed."
		const issueId = webhook.agentSession?.issue?.id;
		if (!issueId) {
			this.logger.error(
				`No issue ID found in prompted webhook ${agentSessionId}`,
			);
			return;
		}

		// Resolve ALL cached repositories for this issue (not just the first).
		// Multi-repo sessions need the full set for workspace recreation.
		let repositories = this.getCachedRepositories(issueId);
		if (!repositories || repositories.length === 0) {
			// Fallback: attempt to recover repository for legacy/restarted sessions
			this.logger.info(
				`No cached repository for prompted webhook ${agentSessionId}, attempting fallback resolution`,
			);

			// First, check if the session manager already has this session
			const session = this.agentSessionManager.getSession(agentSessionId);
			if (session) {
				const repoId = this.sessionRepositories.get(agentSessionId);
				if (repoId) {
					const repo = this.repositories.get(repoId) ?? null;
					if (repo) {
						repositories = [repo];
						this.repositoryRouter
							.getIssueRepositoryCache()
							.set(issueId, [repoId]);
						this.logger.info(
							`Recovered repository ${repoId} for issue ${issueId} from session manager`,
						);
					}
				}
			}

			// Second fallback: re-route via repository router
			if (!repositories || repositories.length === 0) {
				try {
					const repos = Array.from(this.repositories.values());
					const routingResult =
						await this.repositoryRouter.determineRepositoryForWebhook(
							webhook,
							repos,
						);

					if (routingResult.type === "selected") {
						repositories = routingResult.repositories;
						this.repositoryRouter.getIssueRepositoryCache().set(
							issueId,
							routingResult.repositories.map((r) => r.id),
						);
						this.logger.info(
							`Recovered repositories [${repositories.map((r) => r.name).join(", ")}] for issue ${issueId} via fallback routing (${routingResult.routingMethod})`,
						);
					}
				} catch (error) {
					this.logger.warn(
						`Fallback repository routing failed for prompted webhook ${agentSessionId}`,
						error,
					);
				}
			}

			if (!repositories || repositories.length === 0) {
				// All recovery attempts failed - post visible feedback
				await this.agentSessionManager.createResponseActivity(
					agentSessionId,
					"I couldn't process your message because the session configuration was lost. Please create a new session by mentioning me (@cyrus) in a new comment with your prompt.",
				);
				this.logger.warn(
					`Failed to recover repository for prompted webhook ${agentSessionId} - all fallback methods exhausted`,
				);
				return;
			}
		}

		// User access control check for mid-session prompts (use primary repo)
		const primaryRepo = repositories[0]!;
		const accessResult = this.checkUserAccess(webhook, primaryRepo);
		if (!accessResult.allowed) {
			this.logger.info(
				`User ${accessResult.userName} blocked from prompting: ${accessResult.reason}`,
			);
			await this.handleBlockedUser(webhook, primaryRepo, accessResult.reason);
			return;
		}

		await this.handleNormalPromptedActivity(webhook, repositories);
	}

	/**
	 * Handle issue unassignment
	 * @param issue Linear issue object from webhook data
	 * @param linearWorkspaceId Linear workspace ID (from webhook.organizationId)
	 */
	private async handleIssueUnassigned(
		issue: WebhookIssue,
		linearWorkspaceId: string,
	): Promise<void> {
		const sessions = this.agentSessionManager.getSessionsByIssueId(issue.id);
		const activeThreadCount = sessions.length;

		// Settle reservations too: unassignment can arrive during repository
		// selection, a blocker wait, or asynchronous startup without a session.
		for (const receipt of this.getLaunchAdmission().values()) {
			if (
				receipt.origin.ticket?.workspaceId === linearWorkspaceId &&
				receipt.origin.ticket.issueId === issue.id
			)
				this.settleTicketLaunch(receipt.sessionId);
		}
		// Stop all agent runners for this issue
		for (const session of sessions) {
			this.logger.info(`Stopping agent runner for issue ${issue.identifier}`);
			if (this.factoryRuntime?.runs.has(session.id))
				this.factoryRuntime.stop(session.id);
			this.cancelRunTitle(session.id);
			this.agentSessionManager.requestSessionStop(session.id);
			session.agentRunner?.stop();
		}

		await this.savePersistedState();

		// Post ONE farewell comment on the issue (not in any thread) if there were active sessions
		if (activeThreadCount > 0) {
			await this.postComment(
				issue.id,
				"I've been unassigned and am stopping work now.",
				linearWorkspaceId,
				// No parentId - post as a new comment on the issue
			);
		}

		// Emit events
		this.logger.info(
			`Stopped ${activeThreadCount} sessions for unassigned issue ${issue.identifier}`,
		);
	}

	/**
	 * Handle Claude messages
	 */
	private async handleClaudeMessage(
		sessionId: string,
		message: SDKMessage,
		_repositoryId: string,
	): Promise<void> {
		if (this.stopping && message.type === "result") return;
		await this.agentSessionManager.handleClaudeMessage(sessionId, message);
		const session = this.agentSessionManager.getSession(sessionId);
		const workspaceId = session?.triggerOrigin?.ticket?.workspaceId;
		if (workspaceId && message.type === "result") {
			const receipt = this.getLaunchAdmission().get(workspaceId, sessionId);
			if (receipt && receipt.phase !== "settled")
				this.getLaunchAdmission().update(receipt, { phase: "started" });
		}
		const run = this.factoryRuntime?.runs.get(sessionId);
		if (run) {
			this.saveFactorySession(run);
			this.factoryRuntime!.save(run);
		}
		if (
			message.type === "result" ||
			(message.type === "system" && message.subtype === "init")
		)
			await this.savePersistedState();
	}

	/**
	 * Handle Claude session error
	 * Silently ignores AbortError (user-initiated stop), logs other errors
	 */
	private async handleClaudeError(error: Error): Promise<void> {
		// AbortError is expected when user stops Claude process, don't log it
		// Check by name since the SDK's AbortError class may not match our imported definition
		const isAbortError =
			error.name === "AbortError" || error.message.includes("aborted by user");

		// Also check for SIGTERM (exit code 143), which indicates graceful termination
		const isSigterm = error.message.includes(
			"Claude Code process exited with code 143",
		);

		if (isAbortError || isSigterm) {
			return;
		}
		this.logger.error("Unhandled claude error:", error);
	}

	/**
	 * Fetch issue labels for a given issue
	 */
	private async fetchIssueLabels(issue: Issue): Promise<string[]> {
		return this.promptBuilder.fetchIssueLabels(issue);
	}

	/**
	 * Build the session context used to evaluate per-skill scope restrictions.
	 *
	 * Skill scopes (persisted in `scope.json` sidecars by the config-updater)
	 * match against:
	 * - the active repository's Bob’s Factory config ID,
	 * - the Linear team that owns the issue, and
	 * - the Linear label IDs attached to the issue.
	 *
	 * The session's repo working-tree path(s) are also captured so that
	 * repo-local skills (`<repoPath>/.claude/skills/*`) get unioned into the
	 * resolved whitelist. When a `session` is provided its workspace is used to
	 * resolve those paths (covering multi-repo sessions); otherwise the active
	 * repository's path is used.
	 */
	private buildSkillSessionContext(
		repository: RepositoryConfig,
		fullIssue?: Issue,
		session?: CyrusAgentSession,
	): SkillSessionContext {
		const context: SkillSessionContext = {
			repositoryId: repository.id,
			repoPaths: this.resolveSkillRepoPaths(repository, session),
		};
		if (fullIssue?.teamId) {
			context.linearTeamId = fullIssue.teamId;
		}
		if (
			Array.isArray(fullIssue?.labelIds) &&
			(fullIssue?.labelIds?.length ?? 0) > 0
		) {
			context.linearLabelIds = [...(fullIssue?.labelIds ?? [])];
		}
		return context;
	}

	/**
	 * Resolve the repo working-tree path(s) whose `.claude/skills/` directories
	 * should contribute to the skill whitelist for a session.
	 *
	 * - Multi-repo sessions: every sub-worktree in `workspace.repoPaths`.
	 * - Single-repo / GitHub-mention sessions: the active repository's path.
	 */
	private resolveSkillRepoPaths(
		repository: RepositoryConfig,
		session?: CyrusAgentSession,
	): string[] {
		const repoPaths = session?.workspace?.repoPaths;
		if (repoPaths) {
			const paths = Object.values(repoPaths).filter(
				(p): p is string => typeof p === "string" && p.length > 0,
			);
			if (paths.length > 0) {
				return [...new Set(paths)];
			}
		}
		return [repository.repositoryPath];
	}

	/**
	 * Resolve default model for a given runner from config with sensible built-in defaults.
	 * Supports legacy config keys for backwards compatibility.
	 */
	private getDefaultModelForRunner(runnerType: RunnerType): string | undefined {
		return this.runnerSelectionService.getDefaultModelForRunner(runnerType);
	}

	/**
	 * Resolve default fallback model for a given runner from config with sensible built-in defaults.
	 * Supports legacy Claude fallback key for backwards compatibility.
	 */
	private getDefaultFallbackModelForRunner(
		runnerType: RunnerType,
	): string | undefined {
		return this.runnerSelectionService.getDefaultFallbackModelForRunner(
			runnerType,
		);
	}

	/**
	 * Instantiate the appropriate runner for the given type.
	 *
	 * Every runner is wrapped so its `start()`/`startStreaming()` hold a
	 * instance concurrency slot for the session's lifetime — this is the single
	 * choke point that makes `maxConcurrentSessions` cover Linear, GitHub,
	 * GitLab, and chat sessions alike.
	 */
	private createRunnerForType(
		runnerType: RunnerType,
		config: AgentRunnerConfig,
		signal?: AbortSignal,
		sessionId = config.workspaceName ?? config.workingDirectory ?? randomUUID(),
	): IAgentRunner {
		return capRunnerStarts(
			this.buildRunnerForType(runnerType, config),
			this.runnerSlots,
			signal,
			{
				identity: `${this.factoryHome}:session:${sessionId}`,
				recoverable: true,
				preserveOnShutdown: () =>
					this.titleSession(sessionId)?.status !== AgentSessionStatus.Error,
				remote: runnerType === "cursor",
				onChange: () => this.emit("chatSessionChanged", sessionId),
			},
		);
	}

	private getExecutionResolver(): ExecutionEnvironmentResolver {
		this.executionResolver ??= new ExecutionEnvironmentResolver(
			join(this.factoryHome, "factory"),
		);
		return this.executionResolver;
	}
	/** Check every reachable provider and naming job before worktree hooks or ticket mutation. */
	private async preflightExecution(
		run: FactoryRun,
		workflow: Workflow,
		definitions: Workflow[],
	): Promise<void> {
		if (!run.executionSnapshot) return;
		const fallback = (run.runner ??
			this.runnerSelectionService.getDefaultRunner()) as RunnerType;
		const requests: [RunnerType, string | undefined][] = [
			[fallback, run.model ?? this.getDefaultModelForRunner(fallback)],
		];
		const visited = new Set<string>();
		const scan = (steps: WorkflowStep[]) => {
			for (const step of steps) {
				if (step.type === "agent")
					requests.push([
						step.runner ?? fallback,
						step.model ??
							(step.runner && step.runner !== fallback
								? this.getDefaultModelForRunner(step.runner)
								: (run.model ?? this.getDefaultModelForRunner(fallback))),
					]);
				if (step.groups) for (const group of step.groups) scan(group);
				if (step.workflow && !visited.has(step.workflow)) {
					visited.add(step.workflow);
					const nested = definitions.find((item) => item.id === step.workflow);
					if (nested) scan(nested.steps);
				}
			}
		};
		scan(workflow.steps);
		const title = this.getFactoryRuntime().resolveTitleSettings();
		requests.push([title.runner, title.model]);
		const checked = new Set<RunnerType>();
		for (const [runner, model] of requests) {
			validateProfileRunner(
				{ factoryHome: this.factoryHome, model },
				run.executionSnapshot,
				runner,
			);
			if (!checked.has(runner)) await this.resolveRunExecution(run, runner);
			checked.add(runner);
		}
	}
	private async resolveRunExecution(
		run: FactoryRun,
		runner?: string,
		job = "main",
	): Promise<ResolvedExecutionEnvironment | undefined> {
		if (!run.executionSnapshot) return undefined;
		const repository = this.repositories.get(run.repositoryId);
		if (!repository) throw new Error("Execution repository unavailable");
		const type = (runner ??
			run.runner ??
			this.runnerSelectionService.getDefaultRunner()) as RunnerType;
		const capability = executionCapabilities(type);
		const resolved = await this.getExecutionResolver().resolve(
			run.executionSnapshot,
			run.id,
			run.workspace && existsSync(run.workspace)
				? run.workspace
				: repository.repositoryPath,
			type,
			job,
		);
		run.executionDiagnostics = {
			accounts: resolved.accounts,
			git: resolved.git,
			mcp: Object.keys(resolved.mcp),
			runner: type,
			binary: capability.binary,
			version: capability.version,
			tracking: !run.ticketReference
				? "No associated ticket"
				: run.ticketReference.provider === "native"
					? "Service integration (control plane)"
					: "Selected MCP credentials",
		};
		return resolved;
	}
	private async applyRunExecution(
		run: FactoryRun,
		runner: RunnerType,
		config: AgentRunnerConfig,
		job = "main",
	) {
		const resolved = await this.resolveRunExecution(run, runner, job);
		if (resolved) {
			validateProfileRunner(config, run.executionSnapshot!, runner);
			this.getExecutionResolver().apply(
				config,
				run.executionSnapshot!,
				resolved,
			);
		}
		return resolved;
	}

	private getFactoryRuntime(): WorkflowRuntime {
		if (!this.factoryRuntime) {
			const tools = new FactoryTools({
				postComment: (id, body) =>
					this.postFactoryComment(this.getFactoryRuntime().get(id), body),
				mcp: (context, server, tool) =>
					this.executeFactoryMcpTool(context, server, tool),
			});
			this.factoryRuntime = new WorkflowRuntime(this.factoryHome, {
				execution: (run, runner) => this.resolveRunExecution(run, runner),
				cleanupExecution: (run) => {
					if (run.executionSnapshot)
						this.getExecutionResolver().cleanupCredentials(run.id);
				},
				capacity: this.runnerSlots,
				track: (run, milestone) =>
					this.getTicketTracking().record(run, milestone),
				retryTracking: async (run) => {
					await this.syncFactoryTicketTracking(run, true);
				},
				titleDefaults: (
					runner = this.runnerSelectionService.getDefaultRunner(),
				) => ({ runner, model: this.getDefaultModelForRunner(runner) }),
				stopTitle: (id) => this.cancelRunTitle(id),
				prepare: (run, signal) =>
					setupExecutionScope.run(
						{
							signal,
							capacity: this.getFactoryRuntime().capacityOptions(run, "setup"),
						},
						() => this.prepareFactoryRun(run, signal),
					),
				simple: (run, signal) => this.executeSimpleFactoryRun(run, signal),
				agent: (context) => this.executeFactoryAgent(context),
				script: (context) => {
					this.startRunTitle(context.run.id);
					return tools.script(context);
				},
				tool: (context) => {
					this.startRunTitle(context.run.id);
					return tools.tool(context);
				},
				question: async (run) => {
					const body = `## Factory clarification\n\n${questionNotification(run.questions, run.questionRecommendations)}`;
					if (!run.ticketReference) await this.postFactoryComment(run, body);
					await this.agentSessionManager.createResponseActivity(run.id, body);
				},
			});
			this.factoryRuntime.subscribe(({ id }) => {
				const run = id ? this.factoryRuntime?.runs.get(id) : undefined;
				if (run && run.status !== "running") this.startRunTitle(run.id);
			});
		}
		return this.factoryRuntime;
	}

	private titleSession(id: string): CyrusAgentSession | undefined {
		return (
			this.agentSessionManager.getSession(id) ??
			this.activeChatSessionHandlers
				.flatMap((handler) => handler.getAllChatSessions())
				.find((session) => session.id === id)
		);
	}
	private chatHandlerForSession(id: string) {
		return this.activeChatSessionHandlers.find((handler) =>
			handler.getAllChatSessions().some((session) => session.id === id),
		);
	}
	private restoreChatSessionOwnership(): void {
		const state = this.agentSessionManager.serializeState();
		for (const handler of this.activeChatSessionHandlers) {
			const sessions = Object.fromEntries(
				Object.entries(state.sessions).filter(
					([, session]) =>
						(session.metadata?.chatPlatform ??
							session.titleGeneration?.platform) === handler.platformName,
				),
			);
			if (!Object.keys(sessions).length) continue;
			const current = handler.serializeState();
			handler.restoreState(
				{ ...current.sessions, ...sessions },
				{
					...current.entries,
					...Object.fromEntries(
						Object.keys(sessions).map((id) => [id, state.entries[id] ?? []]),
					),
				},
			);
			for (const id of Object.keys(sessions))
				this.agentSessionManager.removeSession(id);
		}
	}

	private prepareRunTitle(
		id: string,
		repository: RepositoryConfig | undefined,
		context: TitleContext,
		platform = "linear",
		mcpPaths?: readonly string[],
	): void {
		const runtime = this.getFactoryRuntime();
		const run = runtime.runs.get(id);
		const session = this.titleSession(id);
		const existing = run?.titleGeneration ?? session?.titleGeneration;
		// Historical runtime runs have no naming job. Recovery/retry must not
		// enroll them in automatic naming; new runtime runs already own a job.
		if (run && !run.titleGeneration) return;
		if (existing && (existing.state !== "pending" || existing.prepared)) return;
		const packet = buildTitleContext(context);
		const job: RunTitleJob = {
			...(existing ?? runtime.createTitleJob(packet)),
			prepared: true,
			context: packet,
			repositoryId: repository?.id,
			platform,
			platformMcpConfigOverrides: mcpPaths ? [...mcpPaths] : undefined,
		};
		if (session) {
			session.displayTitle = run?.title ?? session.displayTitle ?? id;
			session.titleGeneration = structuredClone(job);
		}
		if (run) runtime.updateTitle(id, job);
		void this.savePersistedState();
	}
	private updateRunTitle(id: string, job: RunTitleJob, title?: string): void {
		const run = this.factoryRuntime?.runs.get(id);
		const session = this.titleSession(id);
		if (session) {
			session.titleGeneration = structuredClone(job);
			session.displayTitle = title ?? run?.title ?? session.displayTitle ?? id;
			this.agentSessionManager.updateDisplayTitle(
				id,
				session.displayTitle,
				session.titleGeneration,
			);
			for (const handler of this.activeChatSessionHandlers)
				handler.updateDisplayTitle(
					id,
					session.displayTitle,
					session.titleGeneration,
				);
		}
		if (run) this.factoryRuntime!.updateTitle(id, job, title);
		if (job.state === "failed")
			this.logger.warn(`Run title generation failed for ${id}: ${job.error}`);
		void this.savePersistedState();
	}
	private retryRunTitle(id: string): void {
		const runtime = this.getFactoryRuntime();
		const previous =
			runtime.runs.get(id)?.titleGeneration ??
			this.titleSession(id)?.titleGeneration;
		if (previous?.state !== "failed")
			throw new Error("Only failed title generation can be retried");
		const fresh = runtime.createTitleJob(previous.context);
		if (fresh.state !== "pending") throw new Error(fresh.error);
		const job: RunTitleJob = {
			...previous,
			...fresh,
			prepared: true,
			error: undefined,
			retries: 0,
		};
		this.titleStarted.delete(id);
		this.updateRunTitle(id, job);
		this.startRunTitle(id);
	}
	private cancelRunTitle(id: string): void {
		const job =
			this.factoryRuntime?.runs.get(id)?.titleGeneration ??
			this.titleSession(id)?.titleGeneration;
		if (job?.state === "pending")
			this.updateRunTitle(id, { ...job, state: "cancelled" });
		this.titleGenerator?.cancel(id);
	}
	private startRunTitle(id: string): void {
		if (this.stopping) return;
		const run = this.factoryRuntime?.runs.get(id);
		if (run && !run.titleGeneration) return;
		const job = run?.titleGeneration ?? this.titleSession(id)?.titleGeneration;
		if (job?.state !== "pending" || !job.prepared || this.titleStarted.has(id))
			return;
		this.titleStarted.add(id);
		this.titleGenerator ??= new RunTitleGenerator(
			this.factoryHome,
			this.runnerSlots,
			{
				update: (runId, result, title) => {
					const current =
						this.factoryRuntime?.runs.get(runId)?.titleGeneration ??
						this.titleSession(runId)?.titleGeneration;
					if (current?.state === "pending")
						this.updateRunTitle(runId, result, title);
				},
				buildConfig: async (snapshot, directory, jobId) => {
					const configuredRepository = this.repositories.get(
						snapshot.repositoryId ?? "",
					);
					if (snapshot.repositoryId && !configuredRepository)
						throw new Error("Title repository unavailable");
					const repository: RepositoryConfig = configuredRepository ?? {
						id: "title-chat",
						name: "Run titles",
						repositoryPath: directory,
						workspaceBaseDir: directory,
						baseBranch: "main",
						isActive: true,
					};
					if (repository.linearWorkspaceId)
						await this.ensureLinearTokenFresh(repository.linearWorkspaceId);
					const source = this.titleSession(jobId);
					const sourcePaths = [
						repository.repositoryPath,
						...(source ? [source.workspace.path] : []),
					];
					const platform = snapshot.platform;
					const synthetic: CyrusAgentSession = {
						id: `title-${jobId}`,
						type: AgentSessionType.CommentThread,
						context: AgentSessionType.CommentThread,
						status: AgentSessionStatus.Active,
						createdAt: Date.now(),
						updatedAt: Date.now(),
						repositories: [],
						workspace: { path: directory, isGitWorktree: false },
					};
					const titleConfig = this.runnerConfigBuilder.buildTitleConfig(
						{
							session: synthetic,
							repository:
								platform === "slack" || platform === "zulip"
									? { ...repository, allowedTools: undefined }
									: repository,
							sessionId: synthetic.id,
							systemPrompt: titleSystemPrompt,
							allowedTools:
								platform === "github" || platform === "gitlab"
									? this.toolPermissionResolver.buildGithubAllowedTools(
											repository,
										)
									: platform === "slack" || platform === "zulip"
										? this.toolPermissionResolver.buildChatAllowedTools()
										: this.buildAllowedTools([repository]),
							disallowedTools: this.buildDisallowedTools([repository]),
							allowedDirectories: sourcePaths,
							platformMcpConfigOverrides:
								snapshot.platformMcpConfigOverrides ??
								(platform === "github" || platform === "gitlab"
									? this.config.githubMcpConfigs
									: this.config.linearMcpConfigs),
							linearWorkspaceId: repository.linearWorkspaceId ?? "",
							requireLinearWorkspaceId,
							factoryHome: this.factoryHome,
							logger: this.logger,
							onMessage: () => {},
							onError: () => {},
							strictMcpConfig: this.config.strictMcpConfig,
							sandboxSettings: this.sdkSandboxSettings ?? undefined,
							egressCaCertPath: this.egressCaCertPath ?? undefined,
							githubToken: repository.githubUrl
								? this.githubTokenStore.getTokenForRepoUrl(repository.githubUrl)
								: undefined,
							opencodeGlobalConfig: this.config.opencode?.config,
							opencodeGlobalStateScope: this.config.opencode?.stateScope,
						},
						snapshot.settings,
						source?.workspace.path ??
							this.factoryRuntime?.runs.get(jobId)?.workspace ??
							repository.repositoryPath,
					);
					const sourceRun =
						this.factoryRuntime?.runs.get(jobId) ??
						(source?.metadata?.executionSnapshot
							? ({
									id: jobId,
									repositoryId: repository.id,
									workspace: source.workspace.path,
									executionSnapshot: ExecutionSnapshotSchema.parse(
										source.metadata.executionSnapshot,
									),
								} as FactoryRun)
							: undefined);
					if (sourceRun?.executionSnapshot) {
						await this.applyRunExecution(
							sourceRun,
							snapshot.settings.runner,
							titleConfig,
							"title",
						);
						titleConfig.mcpConfig = titleMcpConfig(
							titleConfig,
							snapshot.settings.runner,
							sourceRun.workspace,
							this.logger,
						);
					}
					return titleConfig;
				},
				createRunner: (snapshot, config) =>
					this.buildRunnerForType(snapshot.settings.runner, config, true),
			},
		);
		this.titleGenerator.start(id, job);
	}

	private getTicketTracking(): TicketTracking {
		this.ticketTracking ??= new TicketTracking(
			(run) => this.factoryTicketAdapter(run),
			(run) => this.getFactoryRuntime().save(run),
			(run, message) =>
				this.getFactoryRuntime().log(run, "ticket-sync", message),
		);
		return this.ticketTracking;
	}
	private async factoryMcpConfig(run: FactoryRun) {
		const repository = this.repositories.get(run.repositoryId);
		const session =
			this.agentSessionManager.getSession(run.id) ??
			(run.sessionSnapshot as CyrusAgentSession | undefined);
		if (!repository || !session)
			throw new Error(
				"Ticket transport requires the saved run session and repository configuration",
			);
		const built = await this.buildAgentRunnerConfig(
			session,
			repository,
			run.id,
			undefined,
			this.buildAllowedTools([repository]),
			[repository.repositoryPath],
			this.buildDisallowedTools([repository]),
			undefined,
			[],
			undefined,
			undefined,
			run.workspaceId ?? repository.linearWorkspaceId,
		);
		const runnerType =
			(run.runner as RunnerType | undefined) ?? built.runnerType;
		const execution = await this.applyRunExecution(
			run,
			runnerType,
			built.config,
			"mcp",
		);
		const servers = titleMcpConfig(
			built.config,
			runnerType,
			run.workspace || repository.repositoryPath,
			this.logger,
		);
		return {
			built,
			servers,
			callTool: async (
				serverName: string,
				tool: string,
				args: Record<string, unknown>,
				signal: AbortSignal,
			) => {
				assertFactoryToolAllowed(
					`mcp__${serverName}__${tool}`,
					built.config.allowedTools,
					built.config.disallowedTools,
				);
				const server = servers[serverName];
				if (!server || server.type === "sdk")
					throw new Error(
						`MCP server ${serverName} is not configured as a process/HTTP transport`,
					);
				try {
					const result =
						runnerType === "codex" && "url" in server
							? await callCodexMcpTool(
									{ ...built.config, workingDirectory: run.workspace },
									serverName,
									server,
									tool,
									args,
									signal,
								)
							: await callConfiguredTool(
									"command" in server
										? {
												...server,
												env: { ...server.env, ...executionEnvironment() },
											}
										: server,
									tool,
									args,
									signal,
									run.workspace || repository.repositoryPath,
									built.config.childEnvironment,
								);
					return execution
						? JSON.parse(execution.redact(JSON.stringify(result)))
						: result;
				} catch (error) {
					throw new Error(
						execution ? execution.redact(String(error)) : String(error),
					);
				}
			},
		};
	}
	private async factoryTicketAdapter(run: FactoryRun): Promise<TicketAdapter> {
		const ref = TicketReferenceSchema.parse(run.ticketReference);
		if (ref.provider === "native") {
			const tracker = this.issueTrackers.get(ref.workspaceId);
			if (!tracker || tracker.getPlatformType() !== ref.platform)
				throw new Error(
					"Originating ticket tracker unavailable; restore its workspace configuration",
				);
			return nativeAdapter(ref, tracker);
		}
		const { servers, callTool } = await this.factoryMcpConfig(run);
		if (taskbotServer(ref.instance, servers) !== ref.server)
			throw new Error(
				"Originating Taskbot transport identity changed; restore its configured server",
			);
		const server = servers[ref.server]!;
		if (server.type === "sdk")
			throw new Error("Taskbot needs a configured HTTP/SSE transport");
		return taskbotAdapter(ref, (tool, args) =>
			callTool(ref.server, tool, args, AbortSignal.timeout(60000)),
		);
	}
	private async resolveFactoryTicket(
		run: FactoryRun,
		signal: AbortSignal,
		ancestors = new Set<string>(),
	): Promise<void> {
		if (ancestors.has(run.id))
			throw new Error(
				"Ticket inheritance contains a cycle; restore a valid source run",
			);
		ancestors.add(run.id);
		if (run.workflow.id === "simple") return;
		if (!run.ticketReference) {
			const parent = run.triggerOrigin?.manual?.sourceRunId;
			const parentRun = parent
				? this.getFactoryRuntime().runs.get(parent)
				: undefined;
			if (parentRun && !parentRun.ticketReference)
				await this.resolveFactoryTicket(parentRun, signal, ancestors);
			const inherited = parentRun?.ticketReference;
			if (inherited) run.ticketReference = structuredClone(inherited);
			else if (run.issueId && run.workspaceId) {
				const tracker = this.issueTrackers.get(run.workspaceId);
				if (!tracker) throw new Error("Originating ticket tracker unavailable");
				const issue = await tracker.fetchIssue(run.issueId);
				run.ticketReference = {
					provider: "native",
					platform: tracker.getPlatformType(),
					workspaceId: run.workspaceId,
					id: issue.id,
					url: issue.url,
				};
			} else {
				const source = originatingTicket(
					run.launchRequest?.prompt ?? run.input,
					run.source,
				);
				if (!source) return;
				const taskbot = taskbotSource(source);
				if (taskbot) {
					const { servers } = await this.factoryMcpConfig(run);
					run.ticketReference = {
						...taskbot,
						server: taskbotServer(taskbot.instance, servers),
					};
				} else {
					const workspaceId = this.repositories.get(
						run.repositoryId,
					)?.linearWorkspaceId;
					const tracker = workspaceId
						? this.issueTrackers.get(workspaceId)
						: undefined;
					if (!tracker)
						throw new Error(
							"Explicit ticket source cannot be tracked; configure the originating ticket workspace",
						);
					const issue = await tracker.fetchIssue(ticketIdentifier(source));
					assertNativeTicketSource(source, issue.url);
					run.ticketReference = {
						provider: "native",
						platform: tracker.getPlatformType(),
						workspaceId: workspaceId!,
						id: issue.id,
						url: issue.url,
					};
					run.issueId = issue.id;
					run.workspaceId = workspaceId;
				}
			}
		}
		signal.throwIfAborted();
		if (!run.outputs.ticket)
			run.outputs.ticket = await (await this.factoryTicketAdapter(run)).read();
		this.getFactoryRuntime().save(run);
	}

	private async postFactoryComment(
		run: FactoryRun,
		body: string,
	): Promise<void> {
		if (run.ticketReference) {
			await this.getTicketTracking().record(run, {
				key: `comment:${body}`,
				body,
			});
			return;
		}
		if (!run.issueId || !run.workspaceId) return;
		const tracker = this.issueTrackers.get(run.workspaceId);
		if (!tracker)
			throw new Error(
				"Ticket tracker unavailable; cannot persist decision records",
			);
		await tracker.createComment(run.issueId, { body });
	}

	private factoryChatState(id: string): ChatState {
		const chatHandler = this.chatHandlerForSession(id);
		if (chatHandler) return chatHandler.chatState(id);
		const runtime = this.getFactoryRuntime();
		const run = runtime.runs.get(id);
		const session = this.agentSessionManager.getSession(id);
		if (!session)
			return {
				enabled: Boolean(run?.workflow.chat),
				available: false,
				reason: "Session is being prepared.",
			};
		if (run && run.workflow.id !== "simple") {
			if (run.status !== "running")
				return {
					enabled: run.workflow.chat ?? false,
					available: false,
					reason:
						"Use the question, review or recovery action for this workflow.",
				};
			return this.factoryChat.state(id, run.workflow.chat ?? false);
		}
		if (this.ticketStartupIsIncomplete(session))
			return {
				enabled: session.workflowChat ?? false,
				available: false,
				reason:
					"Startup was interrupted before the accepted workflow was ready. Send stop to settle this launch, then start a new session.",
			};
		const enabled =
			session.workflowChat ??
			(
				run?.workflow ??
				runtime.listWorkflows().find((item) => item.id === "simple")
			)?.chat ??
			false;
		if (!enabled) return { enabled: false, available: false };
		if (
			(run && !["running", "completed"].includes(run.status)) ||
			session.status === AgentSessionStatus.Error
		)
			return {
				enabled,
				available: false,
				reason:
					"This session has stopped or needs recovery. Retry failed runs before chatting.",
			};
		if (this.askUserQuestionHandler.hasPendingQuestion(id))
			return { enabled, available: true, mode: "steer", step: "simple" };
		if (session.agentRunner?.isRunning())
			return { ...steeringState(session.agentRunner), step: "simple" };
		if (this.chatContinuations.has(id))
			return {
				enabled,
				available: false,
				reason: "The conversation is resuming.",
			};
		if (
			run
				? run.status === "completed" && !runtime.isExecuting(id)
				: session.status === AgentSessionStatus.Complete
		) {
			return { enabled, available: true, mode: "continue", step: "simple" };
		}
		return {
			enabled,
			available: false,
			reason:
				"The session is starting, stopping or needs recovery. Retry failed runs before chatting.",
		};
	}

	private sendFactoryChat(
		id: string,
		text: string,
		messageId?: string,
	): void | Promise<void> {
		const state = this.factoryChatState(id);
		if (!state.available) throw new Error(state.reason ?? "Chat unavailable");
		const chatHandler = this.chatHandlerForSession(id);
		if (chatHandler) {
			this.getFactoryRuntime().updateViewState(id, { keptOpen: true });
			return chatHandler.sendMessage(id, text, messageId);
		}
		if (this.askUserQuestionHandler.hasPendingQuestion(id)) {
			this.askUserQuestionHandler.handleUserResponse(id, text);
			return;
		}
		const runtime = this.getFactoryRuntime();
		const run = runtime.runs.get(id);
		if (run && run.workflow.id !== "simple") {
			this.factoryChat.send(id, text);
			return;
		}
		const session = this.agentSessionManager.getSession(id)!;
		if (state.mode === "steer") {
			session.agentRunner!.addStreamMessage!(text);
			return;
		}
		if (run) {
			runtime.continueSimple(id, text);
			return;
		}
		const repositoryId =
			this.sessionRepositories.get(id) ?? session.repositories[0]?.repositoryId;
		const repository = repositoryId
			? this.repositories.get(repositoryId)
			: undefined;
		if (!repository?.isActive)
			throw new Error("Session repository unavailable");
		this.chatContinuations.add(id);
		runtime.updateViewState(id, { keptOpen: true });
		session.status = AgentSessionStatus.Active;
		void this.resumeAgentSession(
			session,
			repository,
			id,
			this.agentSessionManager,
			text,
			"",
			false,
			[],
			repository.linearWorkspaceId,
		)
			.catch(async (error) => {
				session.status = AgentSessionStatus.Error;
				await this.agentSessionManager.createResponseActivity(
					id,
					`Chat continuation failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				await this.savePersistedState();
			})
			.finally(() => this.chatContinuations.delete(id));
	}

	private async executeFactoryAgent(
		context: ExecutionContext,
	): Promise<unknown> {
		if (
			context.resumeAgent?.rejected?.exhausted &&
			context.resumeAgent.rejected.revision?.headSha ===
				(await roleProgress(context)).currentRevision?.headSha
		)
			throw new Error(
				`Output correction exhausted at ${context.step.id}; inspect persisted rejected output/issues. A new revision is required before further automatic correction.`,
			);
		const checkpoint = context.checkpointAgent;
		context.checkpointAgent = (agent) => {
			context.resumeAgent = agent;
			checkpoint?.(agent);
		};
		try {
			while (true) {
				try {
					const output = await this.executeFactoryAgentAttempt(context);
					if (
						context.resumeAgent?.rejected ||
						context.resumeAgent?.result?.finalizing
					) {
						const { rejected: _rejected, ...agent } = context.resumeAgent;
						if (agent.result) {
							const { finalizing: _finalizing, ...result } = agent.result;
							agent.result = result;
						}
						context.checkpointAgent(agent);
					}
					return output;
				} catch (error) {
					context.signal.throwIfAborted();
					if (
						error instanceof Error &&
						/^Agent step failed:.*codex app-server produced no activity for \d+ms/.test(
							error.message,
						) &&
						context.resumeAgent?.runner === "codex" &&
						(context.resumeAgent.idleRetries ?? 0) < 1
					) {
						context.checkpointAgent({ ...context.resumeAgent, idleRetries: 1 });
						context.log(
							"Codex turn went silent; resuming the saved conversation once. Completed role work and checkpoints are retained.",
						);
						continue;
					}
					const capture = error instanceof CaptureReuseError;
					if (!(error instanceof OutputValidationError) && !capture)
						throw error;
					const previous = context.resumeAgent?.rejected;
					const revision = (await roleProgress(context)).currentRevision;
					const attempts =
						previous?.revision?.headSha === revision?.headSha
							? (previous?.attempts ?? 0)
							: 0;
					const rejection = {
						output:
							error instanceof OutputValidationError
								? error.output
								: context.resumeAgent?.result?.output,
						issues:
							error instanceof OutputValidationError
								? error.issues
								: [{ path: "/screenshots", message: (error as Error).message }],
						revision,
						attempts,
						...(capture ? { screenshots: error.screenshots } : {}),
					};
					if (!context.resumeAgent) throw error;
					context.checkpointAgent({
						...context.resumeAgent,
						...(context.resumeAgent.result
							? { result: { ...context.resumeAgent.result, finalizing: false } }
							: {}),
						rejected: rejection,
					});
					context.log(
						`Output validation rejected ${context.step.id}: ${error.message}`,
					);
					if (attempts >= 2) {
						context.checkpointAgent({
							...context.resumeAgent,
							rejected: { ...rejection, exhausted: true },
						});
						throw new Error(
							`Output correction exhausted after 2 attempts at ${context.step.id}: ${error.message}. Inspect the persisted rejected output/issues before retrying.`,
						);
					}
					// Increment before launching so process restarts cannot reset the budget.
					context.checkpointAgent({
						...context.resumeAgent,
						rejected: { ...rejection, attempts: attempts + 1 },
					});
				}
			}
		} finally {
			context.checkpointAgent = checkpoint;
		}
	}

	private async executeFactoryAgentAttempt(
		context: ExecutionContext,
	): Promise<unknown> {
		const { run, step } = context;
		const session = this.agentSessionManager.getSession(run.id);
		const repository = this.repositories.get(run.repositoryId);
		if (!session || !repository)
			throw new Error("Run session/repository unavailable");
		const outputCorrection = context.resumeAgent?.rejected;
		const recovered =
			outputCorrection && !context.resumeAgent?.result?.finalizing
				? undefined
				: await completedAgentResult(context);
		if (recovered) {
			context.progress = await roleProgress(context);
			if (context.resumeAgent?.result?.reviewScope)
				context.progress.reviewScope = context.resumeAgent.result.reviewScope;
			return this.finalizeFactoryAgentOutput(context, recovered.output);
		}
		const captureCorrection = outputCorrection?.screenshots
			? {
					rejectedOutput: outputCorrection.output,
					screenshots: outputCorrection.screenshots,
				}
			: undefined;

		// Review fixers and QA roles can request assistance without askQuestions;
		// saved recipes must receive the same question guidance as new ones.
		const instruction = `You are executing one software-factory step: ${step.name}. Execute ONLY this role. Other pipeline steps handle planning, review, publishing and handoff. Do not execute a full-development/verify-and-ship workflow unless explicitly requested by this role. Do not merge or mark a PR ready.\n${step.prompt}\nGit provider: ${JSON.stringify(run.gitProvider ?? { gitProvider: repository.gitProvider, githubUrl: repository.githubUrl, gitlabUrl: repository.gitlabUrl })}. Use the selected provider for review, discussion resolution and CI tooling; do not assume GitHub or use gh for another provider. Runtime publication and merge retain the accepted provider. ${run.gitProvider?.type === "custom" ? (run.gitProvider.instructions ?? "") : repository.gitProvider?.type === "custom" ? (repository.gitProvider.instructions ?? "") : ""}\nOriginating ticket: ${run.ticketReference ? JSON.stringify(run.ticketReference) : "none"}. The runtime tracking service owns built-in ticket status, PR links and lifecycle comments. Supply meaningful summaries and blockers; do not duplicate these mutations or mark coding tickets Done before confirmed merge. Retain ticket synchronization gaps as limitations.\n${questionInstructions(run.id)}\n${workflowTriggerInstructions}\n${incrementalInstructions}\n${incrementalRoleInstructions[step.id] ?? ""}\n${step.json === false ? "" : "Your final response MUST be a single JSON object matching the requested shape, with no prose outside it."}`;
		const built = await this.buildAgentRunnerConfig(
			session,
			repository,
			run.id,
			instruction,
			this.buildAllowedTools([repository]),
			[
				repository.repositoryPath,
				context.evidenceDir,
				...[
					join(this.factoryHome, basename(run.workspace), "attachments"),
				].filter(existsSync),
			],
			this.buildDisallowedTools([repository]),
			undefined,
			[],
			undefined,
			undefined,
			run.workspaceId ?? repository.linearWorkspaceId,
		);
		const runRunnerType =
			(run.runner as RunnerType | undefined) ?? built.runnerType;
		const runnerType = step.runner ?? runRunnerType;
		built.config.model =
			step.model ??
			(step.runner && step.runner !== runRunnerType
				? this.getDefaultModelForRunner(runnerType)
				: run.model) ??
			(runnerType === built.runnerType
				? built.config.model
				: this.getDefaultModelForRunner(runnerType));
		built.config.fallbackModel =
			this.getDefaultFallbackModelForRunner(runnerType);
		Object.assign(
			built.config,
			resolveAgentSettings(runnerType, step, {
				runner: (run.runner as RunnerType | undefined) ?? built.runnerType,
				reasoningEffort: run.reasoningEffort,
				modelVariant: run.modelVariant,
				serviceTier: run.serviceTier,
			}),
		);
		await this.applyRunExecution(
			run,
			runnerType,
			built.config,
			createHash("sha256")
				.update(context.stepKey ?? step.id)
				.digest("hex"),
		);
		built.config.resumeSessionId = context.resumeAgent?.sessionId;
		built.config.additionalDirectories = [
			...(built.config.additionalDirectories ?? []),
			context.evidenceDir,
		];
		built.config.onAskUserQuestion = undefined; // Clarification uses the persisted workflow checkpoint.
		built.config.allowedTools = [
			...(step.id === "question-explanation"
				? []
				: (built.config.allowedTools ?? [])),
			"mcp__factory-context__list_context",
			"mcp__factory-context__read_context",
		];
		const originalMessage = built.config.onMessage;
		let agentCheckpoint = context.resumeAgent;
		built.config.onMessage = (message) => {
			if (
				message.type === "system" &&
				message.subtype === "init" &&
				message.session_id &&
				message.session_id !== "pending"
			) {
				agentCheckpoint = {
					runner: runnerType,
					sessionId: message.session_id,
					idleRetries: context.resumeAgent?.idleRetries,
					...(context.resumeAgent?.result
						? { result: context.resumeAgent.result }
						: {}),
					...(context.resumeAgent?.rejected
						? { rejected: context.resumeAgent.rejected }
						: {}),
				};
				context.checkpointAgent?.(agentCheckpoint);
			}
			this.saveFactorySession(run);
			void originalMessage?.(message);
			if (
				message.type === "assistant" ||
				message.type === "user" ||
				message.type === "result"
			)
				context.log(JSON.stringify(message), "agent");
		};
		context.progress = await roleProgress(context);
		this.refreshFactoryFeedbackContext(context);
		const factoryContext = prepareFactoryContext({
			...(context.input && typeof context.input === "object"
				? context.input
				: { input: context.input }),
			progress: context.progress,
			...(step.id === "ci-fix"
				? { feedback: factoryFeedbackContext(context) }
				: {}),
			...(["code-fix", "visual-fix"].includes(step.id)
				? { reviewFix: factoryReviewFixContext(context) }
				: {}),
			...(captureCorrection ? { captureCorrection } : {}),
			...(outputCorrection ? { outputCorrection } : {}),
		});
		try {
			built.config.mcpConfig = {
				...built.config.mcpConfig,
				"factory-context": factoryContext.config,
			};
			const runner = capRunnerStarts(
				this.buildRunnerForType(runnerType, built.config, true),
				this.runnerSlots,
				context.signal,
				{ ...context.capacity, remote: runnerType === "cursor" },
			);
			this.agentSessionManager.addAgentRunner(run.id, runner);
			this.factoryChat ??= new SessionChat();
			const unregisterChat = this.factoryChat.register(
				run.id,
				runner,
				context.chat ?? false,
				context.stepKey ?? run.step ?? step.id,
			);
			const stop = () => runner.stop();
			context.signal.addEventListener("abort", stop, { once: true });
			try {
				context.signal.throwIfAborted();
				const start =
					context.chat && runner.supportsStreamingInput && runner.startStreaming
						? runner.startStreaming.bind(runner)
						: runner.start.bind(runner);
				await start(
					`${outputCorrection && !captureCorrection ? "Your previous output failed validation. Read /outputCorrection from the NEW factory-context connection: it contains the rejected candidate, precise issues, and revision. Correct those issues and return the COMPLETE result for this role. Preserve accepted evidence and completed work; correct only this role output and, for capture, invalid states. Do not replay other pipeline roles. This is an output correction, not a process restart.\n\n" : captureCorrection ? "Your completed capture failed screenshot-reuse validation. Read /captureCorrection through the new factory-context tools: rejectedOutput contains your complete saved inventory, and screenshots lists every rejected state. Replace those images with fresh filenames; preserve the other valid captures and return the COMPLETE corrected inventory. Do not repeat completed setup or unrelated captures. The old factory-context connection is gone.\n\n" : context.resumeAgent ? "Continue this role from your existing conversation and worktree. Read the latest answers through the new factory-context connection and inspect current files and past tool results before repeating actions. The old factory-context connection is gone; use the new factory-context tools below.\n\n" : ""}${factoryContextInstructions}\n\nEvidence directory: ${context.evidenceDir}`,
				);
				context.signal.throwIfAborted();
				const messages = runner.getMessages();
				const result = messages
					.filter((message) => message.type === "result")
					.at(-1);
				if (result?.type === "result" && result.is_error)
					throw new Error(`Agent step failed: ${JSON.stringify(result)}`);
				const assistant = messages
					.filter((message) => message.type === "assistant")
					.at(-1);
				const text =
					result?.type === "result" && "result" in result
						? result.result
						: assistant?.type === "assistant"
							? assistant.message.content
									.filter((block) => block.type === "text")
									.map((block) => (block.type === "text" ? block.text : ""))
									.join("\n")
							: "";
				let output: unknown;
				try {
					output = step.json === false ? { text } : parseAgentOutput(text);
				} catch (error) {
					throw outputValidationError(text, error);
				}
				const authoredScope = context.progress?.reviewScope;
				context.progress = await roleProgress(context);
				if (step.id === "guide") context.progress.reviewScope = authoredScope;
				output = this.validateFactoryAgentOutput(context, output);
				const completed = (await roleProgress(context)).currentRevision;
				if (agentCheckpoint && completed)
					context.checkpointAgent?.({
						runner: agentCheckpoint.runner,
						sessionId: agentCheckpoint.sessionId,
						idleRetries: context.resumeAgent?.idleRetries,
						...(context.resumeAgent?.rejected
							? { rejected: context.resumeAgent.rejected }
							: {}),
						result: {
							output,
							revision: completed,
							finalizing: true,
							reviewScope: context.progress?.reviewScope,
						},
					});
				return this.finalizeFactoryAgentOutput(context, output);
			} finally {
				context.signal.removeEventListener("abort", stop);
				unregisterChat();
			}
		} finally {
			factoryContext.cleanup();
		}
	}

	private validateFactoryAgentOutput(
		context: ExecutionContext,
		value: unknown,
	): unknown {
		const { run, step } = context;
		try {
			let output = step.askQuestions ? normalizeQuestionResult(value) : value;
			if (
				step.qaContract ||
				["factory", "takeover"].includes(run.workflow.id) ||
				run.workflowDefinitions
					?.find((item) => item.id === "factory-pipeline")
					?.steps.includes(step)
			)
				output = validateFactoryResult(step.id, output, step.qaContract);
			if (step.id === "visual-scope" && step.qaContract) {
				const issues = qaRequirementIssues(
					output as QaScope,
					run.outputs,
					run.answers,
				);
				if (issues.length) throw new Error(issues.join("; "));
			}
			if (step.id === "guide") {
				validateGuideGeneration(output);
				validateGuideCoverage(context, output);
			}
			if (step.id === "ci-fix") {
				this.refreshFactoryFeedbackContext(context);
				output = validateFactoryResult(step.id, output);
				output = recordFeedbackAssessment(context, output);
			}
			if (["code-fix", "visual-fix"].includes(step.id)) {
				this.refreshFactoryFeedbackContext(context);
				output = validateFactoryResult(step.id, output);
				validateReviewFix(context, output);
			}
			return output;
		} catch (error) {
			throw outputValidationError(value, error);
		}
	}

	private refreshFactoryFeedbackContext(context: ExecutionContext): void {
		if (!["ci-fix", "code-fix", "visual-fix"].includes(context.step.id)) return;
		if (this.factoryRuntime) {
			context.chatMessages = this.factoryRuntime.chatMessages(context.run.id);
			context.input = {
				...(context.input as Record<string, unknown>),
				chatMessages: context.chatMessages,
			};
		}
		if (context.step.id === "ci-fix") {
			const receipt = (context.run.outputs["merge-readiness"] ??
				context.run.outputs.ci) as MergeReadiness | undefined;
			// Runs paused before feedback recovery was installed retain legacy
			// receipts. Derive the exact pending versions before exposing context
			// or validating a recovered result, without inventing assessments.
			if (receipt && receipt.unassessedComments === undefined)
				assessFeedback(context, receipt);
		}
	}

	private async finalizeFactoryAgentOutput(
		context: ExecutionContext,
		value: unknown,
	): Promise<unknown> {
		const { run, step } = context;
		let output = this.validateFactoryAgentOutput(context, value);
		if (step.id === "guide") output = await finalizeGuideFiles(context, output);
		if (step.id === "capture") output = captureEvidence(context, output);
		const completed = (await roleProgress(context)).currentRevision;
		if (["code-fix", "visual-fix"].includes(step.id))
			output = recordReviewFix(context, output, completed);
		if (completed && step.id === "visual-review" && step.qaContract) {
			output = {
				...(output as Record<string, unknown>),
				qaReviewStamp: {
					headSha: completed.headSha,
					dirty: completed.dirty,
					captureHash: qaDigest(run.outputs.capture),
					scopeHash: qaDigest(run.outputs["visual-scope"]),
				},
			};
		}
		if (completed) {
			run.roleRevisions ??= {};
			completed.historyLength = run.history.length + 1;
			run.roleRevisions[context.stepKey ?? run.step ?? step.id] = completed;
		}
		return output;
	}

	private async executeFactoryMcpTool(
		context: ExecutionContext,
		serverName: string,
		toolName: string,
	): Promise<unknown> {
		const { callTool } = await this.factoryMcpConfig(context.run);
		return callTool(
			serverName,
			toolName,
			toolArguments(context, context.step.arguments ?? {}) as Record<
				string,
				unknown
			>,
			context.signal,
		);
	}

	private async startFactoryFollowup(
		id: string,
		feedback: string,
	): Promise<FactoryRun> {
		const runtime = this.getFactoryRuntime();
		const run = runtime.runs.get(id);
		const session = this.titleSession(id);
		const repositoryId =
			run?.repositoryId ??
			this.sessionRepositories.get(id) ??
			session?.repositories[0]?.repositoryId ??
			session?.metadata?.chatRepositoryId ??
			session?.titleGeneration?.repositoryId;
		if (typeof repositoryId !== "string")
			throw new Error("Run repository unavailable");
		const source =
			readFactoryPath(run?.outputs, "draft-pr.url") ??
			run?.source ??
			session?.issue?.identifier;
		const workflow = runtime.selectWorkflow(
			[],
			"manual",
			source ? "takeover" : "factory",
		);
		return this.startManualFactoryRun(
			resolveLaunchRequest(workflow, {
				repositoryId,
				workflow: workflow.id,
				inputs: source
					? { source: String(source), prompt: feedback }
					: { prompt: feedback },
				runner: run?.runner as RunnerType | undefined,
				model: run?.model,
			}),
			id,
		);
	}

	private async startManualFactoryRun(
		input: ResolvedLaunchRequest,
		sourceRunId?: string,
	): Promise<FactoryRun> {
		const repository = this.repositories.get(input.repositoryId);
		if (!repository?.isActive) throw new Error("Select an active repository");
		const runtime = this.getFactoryRuntime();
		const { workflow, workflowDefinitions, selectionMethod } =
			runtime.selectLaunch([], "manual", input.workflow);
		if (workflow.id === "takeover" && !input.source)
			throw new Error(
				"Takeover needs an existing PR URL or ticket identifier/URL",
			);
		let prompt =
			input.prompt ||
			(workflow.id === "takeover"
				? "Continue the existing work described by this PR or ticket."
				: `Execute ${workflow.name}.`);
		const customInputs = Object.fromEntries(
			Object.entries(input.inputs).filter(
				([name]) => !["title", "prompt", "source"].includes(name),
			),
		);
		if (workflow.id === "simple" && Object.keys(customInputs).length)
			prompt += `\n\nWorkflow launch inputs:\n${JSON.stringify(customInputs, null, 2)}`;
		const id = `manual-${randomUUID()}`;
		const parent = sourceRunId ? runtime.runs.get(sourceRunId) : undefined;
		const inherited = sourceRunId
			? this.titleSession(sourceRunId)?.metadata?.executionSnapshot
			: undefined;
		const executionSnapshot = sourceRunId
			? structuredClone(
					parent?.executionSnapshot ??
						(inherited ? ExecutionSnapshotSchema.parse(inherited) : undefined),
				)
			: runtime.executionProfiles.select(repository.id, input.execution);
		if (executionSnapshot) {
			// Admission has no session yet. Resolve against the source repository before fetch/hooks.
			const temporary = {
				id,
				repositoryId: repository.id,
				workspace: "",
				runner: input.runner,
				model: input.model,
				executionSnapshot,
			} as FactoryRun;
			await this.preflightExecution(temporary, workflow, workflowDefinitions);
			if (Object.keys(executionSnapshot.identity?.runners ?? {}).length === 0)
				throw new Error(
					"Execution identity needs runner authentication bindings",
				);
		}
		const run = runtime.create({
			executionSnapshot,
			triggerOrigin: {
				type: "manual",
				workflowId: workflow.id,
				selectionMethod,
				selection: { source: "manual" },
				at: new Date().toISOString(),
				manual: {
					method: sourceRunId ? "follow-up" : "composer-api",
					sourceRunId,
				},
			},
			workflowDefinitions,
			id,
			repositoryId: repository.id,
			workflow,
			source: input.source,
			workspace: "",
			input: prompt,
			launchInputs: input.inputs,
			runner: input.runner,
			model: input.model,
			reasoningEffort: input.reasoningEffort,
			modelVariant: input.modelVariant,
			serviceTier: input.serviceTier,
		});
		if (parent?.ticketReference)
			run.ticketReference = structuredClone(parent.ticketReference);
		run.launchRequest = structuredClone(input);
		run.setupComplete = false;
		runtime.save(run);
		void runtime.launch(run);
		return run;
	}

	private async prepareManualFactoryRun(
		run: FactoryRun,
		input: ResolvedLaunchRequest,
		signal: AbortSignal,
	): Promise<void> {
		const runtime = this.getFactoryRuntime();
		const repository = this.repositories.get(run.repositoryId)!;
		const workflow = run.workflow;
		run.outputs.repository = {
			...(run.outputs.repository as Record<string, unknown>),
			githubUrl: repository.githubUrl,
			gitlabUrl: repository.gitlabUrl,
			gitProvider: repository.gitProvider,
		};
		const execution = await this.resolveRunExecution(run);
		const gitService = execution
			? this.gitService.withEnvironment(execution.environment)
			: this.gitService;
		const prompt =
			workflow.id === "takeover"
				? input.prompt ||
					"Continue the existing work described by this PR or ticket."
				: run.input;
		{
			const tracker = new CLIIssueTrackerService();
			tracker.seedDefaultData();
			const created = await tracker.createIssue({
				teamId: "team-default",
				title: run.id,
				description: prompt,
			});
			let fullIssue: Issue = {
				...created,
				identifier: `MANUAL-${run.id.slice(-8)}`,
				branchName: `factory/${run.id}`,
			};
			let takeoverPr: TakeoverPullRequest | undefined;
			let baseBranchOverrides: Map<string, string> | undefined;
			const ticketSource =
				run.ticketReference?.url ?? originatingTicket(prompt, input.source);
			const nativeSource =
				ticketSource && !taskbotSource(ticketSource) ? ticketSource : undefined;
			if (
				(workflow.id === "takeover" && isPullRequestSource(input.source)) ||
				nativeSource
			) {
				if (input.source && isPullRequestSource(input.source)) {
					const setupContext: ExecutionContext = {
						execution,
						run: { ...run, workspace: repository.repositoryPath },
						step: workflow.steps[0]!,
						input: {},
						signal,
						log: (text) => runtime.log(run, "setup", text),
						evidenceDir: join(runtime.directory, "evidence", run.id),
					};
					const command = (exe: string, args: string[]) =>
						executeCommand(setupContext, exe, args, 60000);
					const provider = await resolveGitProvider(
						setupContext,
						command,
						input.source,
					);
					run.gitProvider = setupContext.run.gitProvider;
					takeoverPr = await inspectPullRequest(
						command,
						input.source,
						provider,
					);
					const ref = `refs/factory/takeover/${takeoverPr.number}`;
					await command("git", [
						"fetch",
						"origin",
						`+refs/heads/${takeoverPr.headRefName}:${ref}`,
					]);
					fullIssue = { ...fullIssue, branchName: takeoverPr.headRefName };
					baseBranchOverrides = new Map([[repository.id, ref]]);
					run.outputs.source = takeoverPr;
				} else {
					const existingTracker = this.issueTrackers.get(
						(run.ticketReference?.provider === "native"
							? run.ticketReference.workspaceId
							: repository.linearWorkspaceId) ?? "",
					);
					if (!existingTracker)
						throw new Error(
							"Ticket tracker unavailable; configure the ticket workspace before taking over a ticket",
						);
					fullIssue = await existingTracker.fetchIssue(
						run.ticketReference?.provider === "native"
							? run.ticketReference.id
							: ticketIdentifier(nativeSource!),
					);
					assertNativeTicketSource(nativeSource!, fullIssue.url);
					run.issueId = fullIssue.id;
					run.workspaceId =
						run.ticketReference?.provider === "native"
							? run.ticketReference.workspaceId
							: repository.linearWorkspaceId;
					run.ticketReference ??= {
						provider: "native",
						platform: existingTracker.getPlatformType(),
						workspaceId: run.workspaceId!,
						id: fullIssue.id,
						url: fullIssue.url,
					};
					run.outputs.ticket = await issueSnapshot(
						fullIssue,
						await this.fetchIssueLabels(fullIssue),
						existingTracker,
					);
					if (workflow.id === "takeover")
						baseBranchOverrides = new Map([
							[repository.id, fullIssue.branchName ?? repository.baseBranch],
						]);
					run.input = `${prompt}\n\nComplete existing ticket snapshot:\n${JSON.stringify(run.outputs.ticket, null, 2)}`;
				}
			}
			if (ticketSource && taskbotSource(ticketSource)) {
				// Resolve the explicit source before worktree/agent work. This temporary
				// session supplies the existing runner config path, not a second transport.
				this.agentSessionManager.createChatSession(
					run.id,
					{ path: repository.repositoryPath, isGitWorktree: false },
					"manual",
					[
						{
							repositoryId: repository.id,
							baseBranchName: repository.baseBranch,
						},
					],
				);
				await this.resolveFactoryTicket(run, signal);
				if (workflow.id === "takeover") {
					const snapshot = run.outputs.ticket as {
						attachments?: { kind?: string; url: string }[];
					};
					const links = [
						...new Set(
							(snapshot.attachments ?? [])
								.filter((a) => a.kind === "pr" && isPullRequestSource(a.url))
								.map((a) => a.url),
						),
					];
					if (links.length > 1)
						throw new Error(
							"Taskbot ticket has multiple PR attachments; start Takeover with an explicit PR URL and confirmed originating ticket.",
						);
					if (links[0]) {
						const context: ExecutionContext = {
							execution,
							run: { ...run, workspace: repository.repositoryPath },
							step: workflow.steps[0]!,
							input: {},
							signal,
							log: (text) => runtime.log(run, "setup", text),
							evidenceDir: join(runtime.directory, "evidence", run.id),
						};
						const command = (exe: string, args: string[]) =>
							executeCommand(context, exe, args, 60000);
						const provider = await resolveGitProvider(
							context,
							command,
							links[0],
						);
						run.gitProvider = context.run.gitProvider;
						takeoverPr = await inspectPullRequest(command, links[0], provider);
						const ref = `refs/factory/takeover/${takeoverPr.number}`;
						await command("git", [
							"fetch",
							"origin",
							`+refs/heads/${takeoverPr.headRefName}:${ref}`,
						]);
						fullIssue = { ...fullIssue, branchName: takeoverPr.headRefName };
						baseBranchOverrides = new Map([[repository.id, ref]]);
						run.outputs.source = takeoverPr;
					}
				}
			}
			if (run.status === "stopped") return;
			const workspace = await gitService.createGitWorktree(
				fullIssue,
				[repository],
				{ baseBranchOverrides },
			);
			if (
				[...runtime.runs.values()].some(
					(other) =>
						other.id !== run.id &&
						["running", "waiting"].includes(other.status) &&
						other.workspace === workspace.path,
				)
			)
				throw new Error(
					"Another run is using this worktree; terminate it before taking over",
				);
			run.workspace = workspace.path;
			const session = this.agentSessionManager.createChatSession(
				run.id,
				workspace,
				"manual",
				[
					{
						repositoryId: repository.id,
						branchName: fullIssue.branchName,
						baseBranchName: takeoverPr?.baseRefName ?? repository.baseBranch,
					},
				],
			);
			this.sessionRepositories.set(run.id, repository.id);
			run.outputs.repository = {
				name: repository.name,
				githubUrl: repository.githubUrl,
				gitlabUrl: repository.gitlabUrl,
				gitProvider: repository.gitProvider,
				baseBranch:
					takeoverPr?.baseRefName ??
					(workflow.id === "takeover"
						? repository.baseBranch
						: workspace.resolvedBaseBranches?.[repository.id]?.branch) ??
					repository.baseBranch,
			};
			if (runtime.get(run.id).status === "stopped") return;
			if (run.workflow.id === "simple") {
				const assembly = await this.assemblePrompt({
					session,
					fullIssue,
					repository,
					repositories: [repository],
					userComment: prompt,
					isNewSession: true,
					isStreaming: false,
					labels: [],
				});
				run.simpleExecution = {
					userPrompt: assembly.userPrompt,
					systemPrompt: assembly.systemPrompt,
					runner:
						input.runner ?? this.runnerSelectionService.getDefaultRunner(),
				};
			}
			signal.throwIfAborted();
			run.setupComplete = true;
			this.saveFactorySession(run);
			runtime.save(run);
		}
	}

	private saveFactorySession(run: FactoryRun): void {
		const session = this.agentSessionManager.getSession(run.id);
		if (session) {
			if (run.executionSnapshot)
				session.metadata = {
					...session.metadata,
					executionSnapshot: run.executionSnapshot,
				};
			const { agentRunner: _runner, ...snapshot } = session;
			run.sessionSnapshot = structuredClone(snapshot);
		}
	}

	private async prepareFactoryRun(
		run: FactoryRun,
		signal: AbortSignal,
	): Promise<void> {
		const repository = this.repositories.get(run.repositoryId);
		if (!repository?.isActive)
			throw new Error(
				"Run repository is unavailable; restore its configuration before continuing",
			);
		if (
			!run.gitProvider &&
			(repository.githubUrl || repository.gitlabUrl || repository.gitProvider)
		)
			run.outputs.repository = {
				...(run.outputs.repository as Record<string, unknown>),
				githubUrl: repository.githubUrl,
				gitlabUrl: repository.gitlabUrl,
				gitProvider: repository.gitProvider,
			};
		await this.resolveRunExecution(run);
		if ((!run.workspace || run.setupComplete === false) && run.launchRequest)
			await this.prepareManualFactoryRun(run, run.launchRequest, signal);
		signal.throwIfAborted();
		if (!run.workspace || !existsSync(run.workspace)) {
			const pending = pendingMergeConfirmation(run);
			const url = readFactoryPath(run.outputs, "draft-pr.url");
			if (
				pending &&
				run.humanDecisions?.at(-1)?.decision === "approve" &&
				typeof url === "string" &&
				isPullRequestSource(url)
			) {
				const evidenceDir = join(
					this.getFactoryRuntime().directory,
					"evidence",
					run.id,
				);
				await mkdir(evidenceDir, { recursive: true });
				const context: ExecutionContext = {
					execution: await this.resolveRunExecution(run),
					run: { ...run, workspace: repository.repositoryPath },
					step: pending.step,
					input: {},
					signal,
					evidenceDir,
					log: () => {},
				};
				const command = (exe: string, args: string[]) =>
					executeCommand(context, exe, args, 60000);
				const provider = await resolveGitProvider(context, command, url);
				run.gitProvider = context.run.gitProvider;
				const pr = await provider.view(url, "state,headRefOid");
				const output = confirmedMerge(run, {
					state: pr.state,
					headSha: pr.headRefOid,
				});
				if (output && pendingMergeConfirmation(run, output)) {
					run.outputs[pending.step.id] = output;
					if (pending.checkpoint.active!.phase === "executing")
						run.history.push({
							step: pending.key,
							output,
							at: new Date().toISOString(),
						});
					pending.checkpoint.active!.phase = "result";
					this.getFactoryRuntime().log(
						run,
						pending.key,
						"Confirmed the approved PR revision was merged after worktree cleanup.",
					);
					return;
				}
			}
			throw new Error(
				"Saved worktree is unavailable; recovery cannot recreate unfinished work",
			);
		}
		let session = this.agentSessionManager.getSession(run.id);
		if (!session) {
			session = this.agentSessionManager.createChatSession(
				run.id,
				{ path: run.workspace, isGitWorktree: true },
				"manual",
				[
					{
						repositoryId: run.repositoryId,
						baseBranchName: String(
							(run.outputs.repository as { baseBranch?: string })?.baseBranch ??
								repository.baseBranch,
						),
					},
				],
			);
		}
		// The per-run checkpoint may be newer than the global session snapshot.
		if (run.sessionSnapshot)
			Object.assign(session, structuredClone(run.sessionSnapshot));
		session.displayTitle = run.title;
		this.sessionRepositories.set(run.id, run.repositoryId);
		const sink = this.getActivitySinkForRepo(run.repositoryId);
		if (session.externalSessionId && sink)
			this.agentSessionManager.setActivitySink(run.id, sink);
		this.prepareRunTitle(run.id, repository, {
			workflow: run.workflow.name,
			instructions:
				run.launchRequest?.prompt ??
				session.issue?.description ??
				run.titleGeneration?.context,
			inputs: run.launchInputs,
			source: run.source,
			ticket: (run.outputs.ticket ??
				run.outputs.source ??
				session.issue) as TitleContext["ticket"],
			followup: run.triggerOrigin?.manual?.sourceRunId
				? {
						sourceRunId: run.triggerOrigin.manual.sourceRunId,
						title: this.getFactoryRuntime().runs.get(
							run.triggerOrigin.manual.sourceRunId,
						)?.title,
						feedback: run.launchRequest?.prompt,
					}
				: undefined,
		});
		await this.resolveFactoryTicket(run, signal);
		await this.getTicketTracking().flush(run);
		this.saveFactorySession(run);
		this.getFactoryRuntime().save(run);
	}

	private async recoverIntegrationSession(
		session: CyrusAgentSession,
		repository: RepositoryConfig,
	): Promise<void> {
		const pending = session.metadata?.pendingExecution;
		if (!pending)
			throw new Error(
				"No saved integration execution input; manual recovery required",
			);
		const platform = session.issueContext!.trackerId as "github" | "gitlab";
		const githubKey =
			platform === "github"
				? pending.replyEvent
					? extractSessionKey(pending.replyEvent as GitHubCommentWebhookEvent)
					: session.issue?.id
				: undefined;
		if (githubKey && this.activeGitHubPrSessions.has(githubKey))
			throw new Error(
				"This PR already has an active execution; manual recovery required",
			);
		// Reserve before configuration loading so incoming webhooks cannot start
		// another writer in the recovered worktree.
		if (githubKey) this.activeGitHubPrSessions.add(githubKey);
		let githubSlotReleased = false;
		const releaseGitHubSlot = () => {
			if (githubKey && !githubSlotReleased) {
				githubSlotReleased = true;
				this.advanceGitHubPrQueue(githubKey);
			}
		};
		const preparation = new AbortController();
		this.preparationStarts.set(session.id, preparation);
		const signal = AbortSignal.any([
			preparation.signal,
			this.recoveryAbort.signal,
		]);
		const cancelQueuedRecovery = () =>
			this.runnerSlots.reconcileQueue(
				(identity) => identity === `${this.factoryHome}:session:${session.id}`,
			);
		const stopped = () => {
			void cancelQueuedRecovery().catch((error) =>
				this.logger.error(
					"Failed to cancel queued integration recovery",
					error,
				),
			);
		};
		// A saved queue entry can still be parked while configuration loads.
		// Explicit stop removes it immediately; shutdown must preserve it.
		preparation.signal.addEventListener("abort", stopped, { once: true });
		const ensureActive = () => {
			signal.throwIfAborted();
			if (session.status !== AgentSessionStatus.Active)
				throw new Error("Integration recovery was stopped");
		};
		try {
			ensureActive();
			const nativeId =
				session.claudeSessionId ??
				session.codexSessionId ??
				session.geminiSessionId ??
				session.cursorSessionId ??
				session.opencodeSessionId;
			const built = await this.buildAgentRunnerConfig(
				session,
				repository,
				session.id,
				pending.systemPrompt,
				this.toolPermissionResolver.buildGithubAllowedTools(repository),
				[repository.repositoryPath],
				this.buildDisallowedTools(repository),
				nativeId,
				undefined,
				undefined,
				200,
				undefined,
				this.buildSkillSessionContext(repository, undefined, session),
				platform,
				{ runnerType: pending.runner, modelOverride: pending.model },
			);
			ensureActive();
			built.config.fallbackModel = this.getDefaultFallbackModelForRunner(
				built.runnerType,
			);
			let replyPosted = false;
			let runner: IAgentRunner;
			const postReply = async () => {
				if (replyPosted || !pending.replyEvent) return;
				replyPosted = true;
				if (platform === "github")
					await this.postGitHubReply(
						pending.replyEvent as GitHubCommentWebhookEvent,
						runner,
						repository,
					);
				else
					await this.postGitLabReply(
						pending.replyEvent as GitLabWebhookEvent,
						runner,
						repository,
					);
			};
			if (githubKey) {
				const onMessage = built.config.onMessage;
				built.config.onMessage = async (message: SDKMessage) => {
					try {
						await onMessage?.(message);
					} finally {
						if (message.type === "result") {
							void postReply().catch((error) =>
								this.logger.error(
									"Failed to post recovered GitHub reply",
									error,
								),
							);
							runner.completeStream?.();
							releaseGitHubSlot();
						}
					}
				};
			}
			runner = this.createRunnerForType(
				built.runnerType,
				built.config,
				signal,
				session.id,
			);
			this.agentSessionManager.addAgentRunner(session.id, runner);
			await this.savePersistedState();
			ensureActive();
			await runner.start(pending.prompt);
			await postReply();
			await this.savePersistedState();
		} finally {
			preparation.signal.removeEventListener("abort", stopped);
			if (this.preparationStarts.get(session.id) === preparation)
				this.preparationStarts.delete(session.id);
			releaseGitHubSlot();
			if (
				preparation.signal.aborted ||
				session.status === AgentSessionStatus.Error
			)
				await cancelQueuedRecovery();
		}
	}

	private async syncFactoryTicketTracking(
		run: FactoryRun,
		reassess = false,
	): Promise<void> {
		if (run.workflow.id === "simple") return;
		await this.resolveFactoryTicket(run, new AbortController().signal);
		if (!run.ticketReference) return;
		if (run.ticketSync) {
			await this.getTicketTracking().flush(run, reassess);
			return;
		}
		const merged = readFactoryPath(run.outputs, "merge.merged") === true;
		const pr =
			readFactoryPath(run.outputs, "merge.url") ??
			readFactoryPath(run.outputs, "draft-pr.url");
		const review =
			run.reviewGate?.status === "pending" ||
			(/(?:human-review|merge)$/.test(run.step ?? "") &&
				!["failed", "stopped"].includes(run.status));
		const active = ["running", "waiting", "failed", "interrupted"].includes(
			run.status,
		);
		await this.getTicketTracking().record(run, {
			key: `legacy-current:${run.history.length}`,
			body: merged
				? `Recovered confirmed merge receipt for ${pr}. Run ${run.id}.`
				: `Recovered ticket tracking for run ${run.id}: ${run.status} at ${run.step ?? "setup"}. ${run.error ?? "Inspect the retained results and checkpoints in Factory."}`,
			...(merged
				? { stage: "done" as const, merged: true }
				: review
					? { stage: "in_review" as const }
					: active
						? { stage: "in_progress" as const }
						: {}),
			...(typeof pr === "string" ? { pr } : {}),
		});
	}

	private async recoverFactoryTicketTracking(run: FactoryRun): Promise<void> {
		if (run.workflow.id === "simple") return;
		if (run.ticketSync) {
			if (
				!run.ticketSync.receipts.some(
					(receipt) =>
						!receipt.delivered && !receipt.superseded && !receipt.conflict,
				)
			)
				return;
		} else if (
			!["running", "waiting"].includes(run.status) &&
			readFactoryPath(run.outputs, "merge.merged") !== true
		) {
			// Historical attempts are not new work. Only recover active legacy runs
			// or confirmed merges; explicit tracking retry can reconcile older runs.
			return;
		}
		try {
			await this.syncFactoryTicketTracking(run);
		} catch (error) {
			this.getFactoryRuntime().log(
				run,
				"ticket-sync",
				`Ticket tracking recovery requires assistance: ${String(error)}. Restore source access, then retry ticket synchronization; checkpoints are retained.`,
			);
		}
	}

	private recoverFactoryRuns(): void {
		const runtime = this.getFactoryRuntime();
		for (const run of runtime.runs.values()) {
			void this.recoverFactoryTicketTracking(run);
		}
		const admission = this.getLaunchAdmission();
		const resumingSessions = new Set<string>();
		// Original Simple issue sessions retain Bob’s Factory's continuation path and timeline.
		// Factory/manual Simple runs use their own checkpoint below.
		for (const session of this.agentSessionManager.getActiveSessions()) {
			if (
				runtime.runs.has(session.id) ||
				this.ticketStartupIsIncomplete(session) ||
				admission
					.values()
					.some(
						(receipt) =>
							receipt.sessionId === session.id && receipt.phase === "settled",
					) ||
				!session.issue ||
				!session.workspace?.path ||
				(session.issueContext?.trackerId &&
					!["linear", "cli", "github", "gitlab"].includes(
						session.issueContext.trackerId,
					))
			)
				continue;
			const repositoryId =
				this.sessionRepositories.get(session.id) ??
				session.repositories[0]?.repositoryId;
			const repository = repositoryId
				? this.repositories.get(repositoryId)
				: undefined;
			if (!repository?.isActive) continue;
			resumingSessions.add(session.id);
			void (
				session.issueContext?.trackerId === "github" ||
				session.issueContext?.trackerId === "gitlab"
					? this.recoverIntegrationSession(session, repository)
					: this.resumeAgentSession(
							session,
							repository,
							session.id,
							this.agentSessionManager,
							"Bob’s Factory restarted while this task was in progress. Continue the current task from the existing conversation and worktree. Inspect current files and prior tool results before repeating any action.",
							"",
							false,
							[],
							repository.linearWorkspaceId,
							undefined,
							undefined,
							undefined,
							this.recoveryAbort.signal,
						)
			).catch(async (error) => {
				if (this.stopping || session.status !== AgentSessionStatus.Active)
					return;
				session.status = AgentSessionStatus.Error;
				this.logger.error(`Session recovery failed for ${session.id}:`, error);
				// Failed recovery may leave a saved request parked before admission.
				// Shutdown returns above so recoverable requests retain their order.
				await this.runnerSlots.reconcileQueue(
					(identity) =>
						identity === `${this.factoryHome}:session:${session.id}`,
				);
				await this.savePersistedState();
				await this.agentSessionManager.createResponseActivity(
					session.id,
					`Automatic recovery failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
		}
		for (const handler of this.activeChatSessionHandlers)
			void handler.recoverQueuedSessions();
		// Persist legacy role's conversation on the migrated unfinished leaf before
		// the runtime upgrades its history to a graph checkpoint.
		for (const run of runtime.runs.values()) {
			if (!["running", "waiting"].includes(run.status)) continue;
			if (!run.sessionSnapshot) this.saveFactorySession(run);
		}
		runtime.resumeAll();
		for (const run of runtime.runs.values())
			if (!["running"].includes(run.status)) this.startRunTitle(run.id);
		for (const session of this.getAllKnownSessions())
			if (
				!runtime.runs.has(session.id) &&
				!resumingSessions.has(session.id) &&
				session.titleGeneration?.state === "pending"
			)
				this.startRunTitle(session.id);
	}

	private async executeSimpleFactoryRun(
		run: FactoryRun,
		signal: AbortSignal,
	): Promise<void> {
		const session = this.agentSessionManager.getSession(run.id)!;
		const repository = this.repositories.get(run.repositoryId)!;
		const execution = run.simpleExecution;
		if (!execution) {
			const stop = () =>
				this.agentSessionManager.getAgentRunner(run.id)?.stop();
			signal.addEventListener("abort", stop, { once: true });
			try {
				await this.resumeAgentSession(
					session,
					repository,
					run.id,
					this.agentSessionManager,
					run.simplePrompt ??
						"Bob’s Factory restarted while this task was in progress. Continue the current task from the existing conversation and worktree. Inspect current files and prior tool results before repeating any action.",
					"",
					false,
					[],
					run.workspaceId,
					undefined,
					undefined,
					undefined,
					signal,
				);
				signal.throwIfAborted();
			} finally {
				signal.removeEventListener("abort", stop);
			}
			delete run.simplePrompt;
			return;
		}
		const built = await this.buildAgentRunnerConfig(
			session,
			repository,
			run.id,
			execution.systemPrompt,
			this.buildAllowedTools([repository]),
			[repository.repositoryPath],
			this.buildDisallowedTools([repository]),
			execution.agent?.sessionId,
			[],
			undefined,
			undefined,
			repository.linearWorkspaceId,
		);
		const runnerType = execution.runner;
		built.config.model =
			run.model ??
			(runnerType === built.runnerType
				? built.config.model
				: this.getDefaultModelForRunner(runnerType));
		built.config.fallbackModel =
			this.getDefaultFallbackModelForRunner(runnerType);
		Object.assign(built.config, resolveAgentSettings(runnerType, run));
		await this.applyRunExecution(run, runnerType, built.config);
		const originalMessage = built.config.onMessage;
		built.config.onMessage = (message) => {
			if (
				message.type === "system" &&
				message.subtype === "init" &&
				message.session_id &&
				message.session_id !== "pending"
			) {
				execution.agent = { runner: runnerType, sessionId: message.session_id };
				this.saveFactorySession(run);
				this.getFactoryRuntime().save(run);
			}
			void originalMessage?.(message);
		};
		const runner = capRunnerStarts(
			this.buildRunnerForType(runnerType, built.config),
			this.runnerSlots,
			signal,
			{
				...this.getFactoryRuntime().capacityOptions(run, "simple"),
				remote: runnerType === "cursor",
			},
		);
		this.agentSessionManager.addAgentRunner(run.id, runner);
		const stop = () => runner.stop();
		signal.addEventListener("abort", stop, { once: true });
		try {
			signal.throwIfAborted();
			const start =
				run.workflow.chat &&
				runner.supportsStreamingInput &&
				runner.startStreaming
					? runner.startStreaming.bind(runner)
					: runner.start.bind(runner);
			await start(
				run.simplePrompt ??
					(execution.agent
						? "The process restarted. Continue the interrupted task from this conversation and worktree; inspect previous results before repeating actions."
						: execution.userPrompt),
			);
			signal.throwIfAborted();
			const result = runner
				.getMessages()
				.filter((message) => message.type === "result")
				.at(-1);
			if (result?.type === "result" && result.is_error)
				throw new Error(`Agent failed: ${JSON.stringify(result)}`);
			delete run.simplePrompt;
		} finally {
			signal.removeEventListener("abort", stop);
		}
	}

	private managedRunnerConfig(config: AgentRunnerConfig): AgentRunnerConfig {
		return {
			...config,
			appendSystemPrompt: `${config.appendSystemPrompt ?? ""}\n${capacityInstructions}`,
			onAskUserQuestion: undefined,
			disallowedTools: [
				...(config.disallowedTools ?? []),
				"Agent",
				"Task",
				"AskUserQuestion",
			],
		};
	}
	private buildRunnerForType(
		runnerType: RunnerType,
		config: AgentRunnerConfig,
		coldClaude = false,
	): IAgentRunner {
		config = this.managedRunnerConfig(config);
		if (this.config.handlers?.createAgentRunner)
			return this.config.handlers.createAgentRunner(runnerType, config);
		switch (runnerType) {
			case "claude": {
				// Inject the hosted SessionStore at the last moment so it only
				// attaches to Claude runners (the field is Claude-specific).
				const claudeConfig =
					!coldClaude && this.claudeSessionStore
						? { ...config, sessionStore: this.claudeSessionStore }
						: config;
				return new ClaudeRunner(
					claudeConfig,
					coldClaude ? false : this.isWarmSessionsEnabled(),
				);
			}
			case "gemini":
				return new GeminiRunner(config);
			case "codex":
				return new CodexRunner({
					...config,
					configOverrides: { features: { multi_agent: false } },
					sandbox: this.config.codexSandboxMode ?? "workspace-write",
				});
			case "cursor":
				return new CursorRunner(config);
			case "opencode":
				return new OpenCodeRunner(config);
			default:
				throw new Error(`Unknown runner type: ${runnerType satisfies never}`);
		}
	}

	/**
	 * Determine system prompt based on issue labels and repository configuration
	 */
	private async determineSystemPromptFromLabels(
		labels: string[],
		repository: RepositoryConfig,
	): Promise<
		| {
				prompt: string;
				version?: string;
				type?:
					| "debugger"
					| "builder"
					| "scoper"
					| "orchestrator"
					| "graphite-orchestrator";
		  }
		| undefined
	> {
		return this.promptBuilder.determineSystemPromptFromLabels(labels, [
			repository,
		]);
	}

	/**
	 * Build prompt for mention-triggered sessions
	 * @param issue Full Linear issue object
	 * @param repository Repository configuration
	 * @param agentSession The agent session containing the mention
	 * @param attachmentManifest Optional attachment manifest to append
	 * @param guidance Optional agent guidance rules from Linear
	 * @returns The constructed prompt and optional version tag
	 */
	private async buildMentionPrompt(
		issue: Issue,
		agentSession: WebhookAgentSession,
		attachmentManifest: string = "",
		guidance?: GuidanceRule[],
	): Promise<{ prompt: string; version?: string }> {
		return this.promptBuilder.buildMentionPrompt(
			issue,
			agentSession,
			attachmentManifest,
			guidance,
		);
	}

	/**
	 * Convert full Linear SDK issue to CoreIssue interface for Session creation
	 */
	private convertLinearIssueToCore(issue: Issue): IssueMinimal {
		return this.promptBuilder.convertLinearIssueToCore(issue);
	}

	/**
	 * Get connection status by repository ID
	 */
	getConnectionStatus(): Map<string, boolean> {
		const status = new Map<string, boolean>();
		// Single event transport is "connected" if it exists
		if (this.linearEventTransport) {
			// Mark all repositories as connected since they share the single transport
			for (const repoId of this.repositories.keys()) {
				status.set(repoId, true);
			}
		}
		return status;
	}

	/**
	 * Get event transport (for testing purposes)
	 * @internal
	 */
	_getClientByToken(_token: string): any {
		// Return the single shared event transport
		return this.linearEventTransport;
	}

	/**
	 * Start OAuth flow using the shared application server
	 */
	async startOAuthFlow(proxyUrl?: string): Promise<{
		linearToken: string;
		linearWorkspaceId: string;
		linearWorkspaceName: string;
	}> {
		const oauthProxyUrl = proxyUrl || this.config.proxyUrl || DEFAULT_PROXY_URL;
		return this.sharedApplicationServer.startOAuthFlow(oauthProxyUrl);
	}

	/**
	 * Get the server port
	 */
	getServerPort(): number {
		return this.config.serverPort || this.config.webhookPort || 3456;
	}

	/**
	 * Get the OAuth callback URL
	 */
	getOAuthCallbackUrl(): string {
		return this.sharedApplicationServer.getOAuthCallbackUrl();
	}

	/**
	 * Move issue to started state when assigned
	 * @param issue Full Linear issue object from Linear SDK
	 * @param linearWorkspaceId Workspace ID for issue tracker lookup
	 */

	private async moveIssueToStartedState(
		issue: Issue,
		linearWorkspaceId: string,
	): Promise<void> {
		try {
			const issueTracker = this.issueTrackers.get(linearWorkspaceId);
			if (!issueTracker) {
				this.logger.warn(
					`No issue tracker found for workspace ${linearWorkspaceId}, skipping state update`,
				);
				return;
			}

			// Check if issue is already in a started state
			const currentState = await issue.state;
			if (currentState?.type === "started") {
				this.logger.debug(
					`Issue ${issue.identifier} is already in started state (${currentState.name})`,
				);
				return;
			}

			// Get team for the issue
			const team = await issue.team;
			if (!team) {
				this.logger.warn(
					`No team found for issue ${issue.identifier}, skipping state update`,
				);
				return;
			}

			// Get available workflow states for the issue's team
			const teamStates = await issueTracker.fetchWorkflowStates(team.id);

			const states = teamStates;

			// Find all states with type "started" and pick the one with lowest position
			// This ensures we pick "In Progress" over "In Review" when both have type "started"
			// Linear uses standardized state types: triage, backlog, unstarted, started, completed, canceled
			const startedStates = states.nodes.filter(
				(state) => state.type === "started",
			);
			const startedState = startedStates.sort(
				(a, b) => a.position - b.position,
			)[0];

			if (!startedState) {
				throw new Error(
					'Could not find a state with type "started" for this team',
				);
			}

			// Update the issue state
			this.logger.debug(
				`Moving issue ${issue.identifier} to started state: ${startedState.name}`,
			);
			if (!issue.id) {
				this.logger.warn(
					`Issue ${issue.identifier} has no ID, skipping state update`,
				);
				return;
			}

			await issueTracker.updateIssue(issue.id, {
				stateId: startedState.id,
			});

			this.logger.debug(
				`✅ Successfully moved issue ${issue.identifier} to ${startedState.name} state`,
			);
		} catch (error) {
			this.logger.error(
				`Failed to move issue ${issue.identifier} to started state:`,
				error,
			);
			// Don't throw - we don't want to fail the entire assignment process due to state update failure
		}
	}

	/**
	 * Post initial comment when assigned to issue
	 */
	// private async postInitialComment(issueId: string, repositoryId: string): Promise<void> {
	//   const body = "I'm getting started right away."
	//   // Get the issue tracker for this repository
	//   const issueTracker = this.issueTrackers.get(repositoryId)
	//   if (!issueTracker) {
	//     throw new Error(`No issue tracker found for repository ${repositoryId}`)
	//   }
	//   const commentData = {

	//     body
	//   }
	//   await issueTracker.createComment(commentData)
	// }

	/**
	 * Post a comment to Linear
	 */
	private async postComment(
		issueId: string,
		body: string,
		linearWorkspaceId: string,
		parentId?: string,
	): Promise<void> {
		return this.activityPoster.postComment(
			issueId,
			body,
			linearWorkspaceId,
			parentId,
		);
	}

	/**
	 * Format todos as Linear checklist markdown
	 */
	// private formatTodosAsChecklist(todos: Array<{id: string, content: string, status: string, priority: string}>): string {
	//   return todos.map(todo => {
	//     const checkbox = todo.status === 'completed' ? '[x]' : '[ ]'
	//     const statusEmoji = todo.status === 'in_progress' ? ' 🔄' : ''
	//     return `- ${checkbox} ${todo.content}${statusEmoji}`
	//   }).join('\n')
	// }

	/**
	 * Download attachments from Linear issue
	 * @param issue Linear issue object from webhook data
	 * @param repository Repository configuration
	 * @param workspacePath Path to workspace directory
	 */
	private async downloadIssueAttachments(
		issue: Issue,
		linearWorkspaceId: string,
		workspacePath: string,
	): Promise<{ manifest: string; attachmentsDir: string | null }> {
		const issueTracker = this.issueTrackers.get(linearWorkspaceId);
		return this.attachmentService.downloadIssueAttachments(
			issue,
			linearWorkspaceId,
			workspacePath,
			issueTracker,
		);
	}

	/**
	 * Download attachments from a specific comment
	 * @param commentBody The body text of the comment
	 * @param attachmentsDir Directory where attachments should be saved
	 * @param linearToken Linear API token
	 * @param existingAttachmentCount Current number of attachments already downloaded
	 */
	private async downloadCommentAttachments(
		commentBody: string,
		attachmentsDir: string,
		linearToken: string | null,
		existingAttachmentCount: number,
	): Promise<{
		newAttachmentMap: Record<string, string>;
		newImageMap: Record<string, string>;
		totalNewAttachments: number;
		failedCount: number;
	}> {
		return this.attachmentService.downloadCommentAttachments(
			commentBody,
			attachmentsDir,
			linearToken,
			existingAttachmentCount,
		);
	}

	/**
	 * Generate attachment manifest for new comment attachments
	 */
	private generateNewAttachmentManifest(result: {
		newAttachmentMap: Record<string, string>;
		newImageMap: Record<string, string>;
		totalNewAttachments: number;
		failedCount: number;
	}): string {
		return this.attachmentService.generateNewAttachmentManifest(result);
	}

	private async registerCyrusToolsMcpEndpoint(): Promise<void> {
		if (this.factoryToolsMcpRegistered) {
			return;
		}

		const fastify = this.sharedApplicationServer.getFastifyInstance() as any;
		if (
			typeof fastify.register !== "function" ||
			typeof fastify.addHook !== "function"
		) {
			console.warn(
				"[EdgeWorker] Skipping bobs-factory-tools MCP endpoint registration: Fastify instance does not support register/addHook",
			);
			return;
		}

		fastify.addHook("onRequest", (request: any, _reply: any, done: any) => {
			const rawUrl =
				typeof request?.raw?.url === "string"
					? request.raw.url
					: typeof request?.url === "string"
						? request.url
						: "";
			const requestPath = rawUrl.split("?")[0];

			if (requestPath !== this.factoryToolsMcpEndpoint) {
				done();
				return;
			}

			if (
				!this.mcpConfigService.isAuthorizationValid(
					request.headers?.authorization,
				)
			) {
				_reply.code(401).send({
					error: "Unauthorized bobs-factory-tools MCP request",
				});
				done();
				return;
			}

			const rawContextHeader = request.headers?.["x-cyrus-mcp-context-id"];
			const contextId = Array.isArray(rawContextHeader)
				? rawContextHeader[0]
				: rawContextHeader;

			this.factoryToolsMcpRequestContext.run({ contextId }, () => {
				done();
			});
		});

		this.factoryToolsMcpSessions.on("connected", (sessionId) => {
			console.log(
				`[EdgeWorker] bobs-factory-tools MCP session connected: ${sessionId}`,
			);
		});

		this.factoryToolsMcpSessions.on("terminated", (sessionId) => {
			console.log(
				`[EdgeWorker] bobs-factory-tools MCP session terminated: ${sessionId}`,
			);
		});

		this.factoryToolsMcpSessions.on("error", (error) => {
			console.error(
				"[EdgeWorker] bobs-factory-tools MCP session error:",
				error,
			);
		});

		await fastify.register(streamableHttp, {
			stateful: true,
			mcpEndpoint: this.factoryToolsMcpEndpoint,
			sessions: this.factoryToolsMcpSessions,
			createServer: async () => {
				const contextId =
					this.factoryToolsMcpRequestContext.getStore()?.contextId;
				if (!contextId) {
					throw new Error(
						"Missing x-cyrus-mcp-context-id header for bobs-factory-tools MCP request",
					);
				}

				const context = this.mcpConfigService.getContext(contextId);
				if (!context) {
					throw new Error(
						`Unknown bobs-factory-tools MCP context '${contextId}'. Build MCP config before connecting.`,
					);
				}

				const sdkServer =
					context.prebuiltServer ||
					createCyrusToolsServer(
						context.linearClient,
						this.createCyrusToolsOptions(context.parentSessionId),
					);
				this.mcpConfigService.clearPrebuiltServer(contextId);

				return sdkServer.server;
			},
		});

		this.factoryToolsMcpRegistered = true;
		console.log(
			`✅ Bob’s Factory tools MCP endpoint registered at ${this.factoryToolsMcpEndpoint}`,
		);
	}

	private failureModesClient: FailureModesHttpClient | null = null;

	/**
	 * Lazily build the HTTP client used by `log_failure_mode` to POST to
	 * cyrus-hosted. Uses `BOBS_FACTORY_APP_URL` (the same env var the remote
	 * session-store client reads, see top of this file) so preview
	 * environments and prod share a single way to point at a control
	 * plane. Returns null when either the URL or the `BOBS_FACTORY_API_KEY` are
	 * missing — in that mode the tool is simply not registered, so
	 * customer-mode CLI users without a control plane don't see a broken
	 * tool.
	 */
	private getFailureModesClient(): FailureModesHttpClient | null {
		if (this.failureModesClient) return this.failureModesClient;
		const apiKey = process.env.BOBS_FACTORY_API_KEY?.trim();
		if (!apiKey) return null;
		const baseUrl = process.env.BOBS_FACTORY_APP_URL?.trim();
		if (!baseUrl) return null;
		this.failureModesClient = createFetchFailureModesClient({
			baseUrl,
			apiKey,
		});
		return this.failureModesClient;
	}

	/**
	 * Resolve a working-directory string to the agent session id that owns
	 * that workspace. The `log_failure_mode` MCP tool calls this with the
	 * agent's reported `cwd`. We normalize and compare against each known
	 * session's `workspace.path` (and any sub-repo paths the session opens).
	 */
	/**
	 * Resolve a working-directory string to the rich session bundle a
	 * Bob’s Factory team member needs to triage a failure-mode report: the
	 * internal session id (for dedup), the runner session id + runner
	 * type (so triage can pull the Claude/Gemini/Codex/Cursor transcript),
	 * the Linear AgentSession + source-issue identifiers (so triage can
	 * jump to the customer thread), and the workspace path (for repro).
	 *
	 * Returns null only when no session matches. We prefer an exact
	 * workspace-path or sub-repo-path match; if neither hits, we fall
	 * back to a prefix match for nested cwds (e.g. shells in a subdir).
	 */
	/**
	 * Aggregator over every place active sessions live in this process.
	 * Today: the primary AgentSessionManager (issue sessions) and the
	 * ChatSessionHandler's private one (Slack / GitHub-PR-chat / future
	 * chat platforms). New session origins should be added here so
	 * downstream consumers (currently just resolveSessionFromCwd) keep
	 * working without modification — single open extension point (OCP),
	 * single responsibility (SRP: this method's only job is "where do
	 * sessions live?", separate from "how do we match one by cwd?").
	 */
	private getAllKnownSessions(): CyrusAgentSession[] {
		return [
			...this.agentSessionManager.getAllSessions(),
			...this.activeChatSessionHandlers.flatMap((handler) =>
				handler.getAllChatSessions(),
			),
		];
	}

	private resolveSessionFromCwd(cwd: string): ResolvedSession | null {
		if (!cwd) return null;
		const normalize = (p: string) => p.replace(/\/+$/, "");
		const target = normalize(cwd);

		const sessions = this.getAllKnownSessions();

		const exact = sessions.find((session) => {
			if (normalize(session.workspace?.path ?? "") === target) return true;
			const repoPaths = session.workspace?.repoPaths;
			if (repoPaths) {
				for (const p of Object.values(repoPaths)) {
					if (typeof p === "string" && normalize(p) === target) return true;
				}
			}
			return false;
		});

		const prefix = exact
			? undefined
			: sessions.find((session) => {
					const root = normalize(session.workspace?.path ?? "");
					return root && target.startsWith(`${root}/`);
				});

		const session = exact ?? prefix;
		if (!session) return null;

		const runnerType = session.claudeSessionId
			? "claude"
			: session.geminiSessionId
				? "gemini"
				: session.codexSessionId
					? "codex"
					: session.cursorSessionId
						? "cursor"
						: session.opencodeSessionId
							? "opencode"
							: null;
		const runnerSessionId =
			session.claudeSessionId ??
			session.geminiSessionId ??
			session.codexSessionId ??
			session.cursorSessionId ??
			session.opencodeSessionId ??
			null;

		const sessionSource = session.id.startsWith("github-")
			? "github"
			: session.id.startsWith("gitlab-")
				? "gitlab"
				: session.id.startsWith("slack-")
					? "slack"
					: (session.issueContext?.trackerId ?? "linear");

		// For Linear-source sessions, `session.id` is already the Linear
		// AgentSession id (they're literally the same UUID — the v3 rename
		// from `linearAgentActivitySessionId` to `id` kept the value). So we
		// don't surface a separate `linearAgentSessionId` — the server keys
		// dedup on `session_id` and that *is* the Linear AgentSession id when
		// `session_source === 'linear'`.
		return {
			sessionId: session.id,
			runnerSessionId,
			runnerType,
			sourceIssueIdentifier:
				session.issueContext?.issueIdentifier ??
				session.issue?.identifier ??
				null,
			workspacePath: session.workspace?.path ?? null,
			sessionSource,
		};
	}

	private createCyrusToolsOptions(parentSessionId?: string): CyrusToolsOptions {
		const failureModesClient = this.getFailureModesClient();
		const options: CyrusToolsOptions = {
			parentSessionId,
			onSessionCreated: (childSessionId: string, parentId: string) => {
				this.handleChildSessionMapping(childSessionId, parentId);
			},
			onFeedbackDelivery: async (childSessionId: string, message: string) => {
				return this.handleFeedbackDeliveryToChildSession(
					childSessionId,
					message,
				);
			},
		};
		if (failureModesClient) {
			options.failureModes = {
				resolveSessionFromCwd: (cwd: string) => this.resolveSessionFromCwd(cwd),
				httpClient: failureModesClient,
			};
		}
		return options;
	}

	private handleChildSessionMapping(
		childSessionId: string,
		parentSessionId: string,
	): void {
		console.log(
			`[EdgeWorker] Agent session created: ${childSessionId}, mapping to parent ${parentSessionId}`,
		);
		this.globalSessionRegistry.setParentSession(
			childSessionId,
			parentSessionId,
		);
		console.log(
			`[EdgeWorker] Parent-child mapping registered in GlobalSessionRegistry`,
		);
	}

	/**
	 * Link a newly created agent session to the most recent Bob’s Factory session on its
	 * parent issue, so that when this (child) session completes, the parent
	 * session is resumed with the child's result.
	 *
	 * Parent-child *issue* relationships are the channel for child completion
	 * messages. Any issue whose parent has a Bob’s Factory session is linked, regardless
	 * of whether that parent session is currently running: an orchestrator that
	 * has halted to wait for its sub-issue has status "complete" and is exactly
	 * the parent that must be woken, so this deliberately does not filter to
	 * active sessions. The resume path handles both a still-running parent
	 * (streams the message in) and an exited one (resumes from its stored
	 * runner session id).
	 *
	 * This replaces the mapping that used to be established by the removed
	 * `linear_agent_session_create*` bobs-factory-tools. Linear delegation creates
	 * exactly one session per issue, so deriving the link from the issue
	 * hierarchy does not reintroduce concurrent child sessions on one issue.
	 *
	 * Never throws: a failed lookup only means the parent is not notified.
	 */
	private async linkChildSessionToParentIssueSession(
		agentSessionId: string,
		issue: { id: string; identifier: string } | null | undefined,
		linearWorkspaceId: string,
	): Promise<void> {
		if (!issue) {
			return;
		}

		// Already mapped (e.g. restored from persisted state) — leave it alone.
		if (this.globalSessionRegistry.getParentSessionId(agentSessionId)) {
			return;
		}

		const log = this.logger.withContext({
			sessionId: agentSessionId,
			issueIdentifier: issue.identifier,
		});

		try {
			// The webhook's issue payload does not carry the parent, so fetch it.
			const fullIssue = await this.fetchFullIssueDetails(
				issue.id,
				linearWorkspaceId,
			);
			const parentIssue = await fullIssue?.parent;
			const parentIssueId = parentIssue?.id;
			if (!parentIssueId) {
				return;
			}

			const parentSessions =
				this.agentSessionManager.getSessionsByIssueId(parentIssueId);
			if (parentSessions.length === 0) {
				log.debug(
					`Parent issue ${parentIssueId} has no Bob’s Factory session; no parent callback will be sent`,
				);
				return;
			}

			const parentSession = parentSessions.reduce((latest, candidate) =>
				candidate.updatedAt > latest.updatedAt ? candidate : latest,
			);

			this.globalSessionRegistry.setParentSession(
				agentSessionId,
				parentSession.id,
			);
			log.info(
				`Linked to parent session ${parentSession.id} via parent issue ${parentIssueId}; parent will be resumed when this session completes`,
			);
		} catch (error) {
			log.warn(
				`Failed to link session to a parent issue session; continuing without parent callback`,
				error,
			);
		}
	}

	private async handleFeedbackDeliveryToChildSession(
		childSessionId: string,
		message: string,
	): Promise<boolean> {
		console.log(
			`[EdgeWorker] Processing feedback delivery to child session ${childSessionId}`,
		);

		// Find the parent session ID for context
		const parentSessionId =
			this.globalSessionRegistry.getParentSessionId(childSessionId);

		// Find the repository containing the child session
		const childRepoId = this.sessionRepositories.get(childSessionId);
		const childRepo = childRepoId
			? this.repositories.get(childRepoId)
			: undefined;

		if (
			!childRepo ||
			!this.agentSessionManager.hasAgentRunner(childSessionId)
		) {
			console.error(
				`[EdgeWorker] Child session ${childSessionId} not found in any repository`,
			);
			return false;
		}

		// Get the child session
		const childSession = this.agentSessionManager.getSession(childSessionId);
		if (!childSession) {
			console.error(`[EdgeWorker] Child session ${childSessionId} not found`);
			return false;
		}

		console.log(
			`[EdgeWorker] Found child session - Issue: ${childSession.issueId}`,
		);

		// Get parent session info for better context in the thought
		let parentIssueId: string | undefined;
		if (parentSessionId) {
			const parentSession =
				this.agentSessionManager.getSession(parentSessionId);
			if (parentSession) {
				parentIssueId =
					parentSession.issue?.identifier || parentSession.issueId;
			}
		}

		// Extract workspace ID once for all operations
		const childWorkspaceId = requireLinearWorkspaceId(childRepo);

		// Post thought to Linear showing feedback receipt
		const issueTracker = this.issueTrackers.get(childWorkspaceId);
		if (issueTracker) {
			const feedbackThought = parentIssueId
				? `Received feedback from orchestrator (${parentIssueId}):\n\n---\n\n${message}\n\n---`
				: `Received feedback from orchestrator:\n\n---\n\n${message}\n\n---`;

			try {
				const result = await issueTracker.createAgentActivity({
					agentSessionId: childSessionId,
					content: {
						type: "thought",
						body: feedbackThought,
					},
				});

				if (result.success) {
					console.log(
						`[EdgeWorker] Posted feedback receipt thought for child session ${childSessionId}`,
					);
				} else {
					console.error(
						`[EdgeWorker] Failed to post feedback receipt thought:`,
						result,
					);
				}
			} catch (error) {
				console.error(
					`[EdgeWorker] Error posting feedback receipt thought:`,
					error,
				);
			}
		}

		const feedbackPrompt = `## Received feedback from orchestrator\n\n---\n\n${message}\n\n---`;

		console.log(
			`[EdgeWorker] Handling feedback delivery to child session ${childSessionId}`,
		);

		this.handlePromptWithStreamingCheck(
			childSession,
			childRepo,
			childSessionId,
			this.agentSessionManager,
			feedbackPrompt,
			"",
			false,
			[],
			"give feedback to child",
			childWorkspaceId,
		)
			.then(() => {
				console.log(
					`[EdgeWorker] Child session ${childSessionId} completed processing feedback`,
				);
			})
			.catch((error) => {
				console.error(
					`[EdgeWorker] Failed to process feedback in child session:`,
					error,
				);
			});

		console.log(
			`[EdgeWorker] Feedback delivered successfully to child session ${childSessionId}`,
		);
		return true;
	}

	private getCyrusToolsMcpUrl(): string {
		const server = this.sharedApplicationServer as {
			getPort?: () => number;
		};
		const port =
			typeof server.getPort === "function"
				? server.getPort()
				: this.config.serverPort || this.config.webhookPort || 3456;
		return `http://127.0.0.1:${port}${this.factoryToolsMcpEndpoint}`;
	}

	/**
	 * Build the complete prompt for a session - shows full prompt assembly in one place
	 *
	 * New session prompt structure:
	 * 1. Issue context (from buildIssueContextPrompt)
	 * 2. User comment
	 *
	 * Existing session prompt structure:
	 * 1. User comment
	 * 2. Attachment manifest (if present)
	 */
	private async buildSessionPrompt(
		isNewSession: boolean,
		session: CyrusAgentSession,
		fullIssue: Issue,
		repository: RepositoryConfig,
		promptBody: string,
		attachmentManifest?: string,
		commentAuthor?: string,
		commentTimestamp?: string,
	): Promise<string> {
		// Fetch labels for system prompt determination
		const labels = await this.fetchIssueLabels(fullIssue);

		// Create input for unified prompt assembly
		const input: PromptAssemblyInput = {
			session,
			fullIssue,
			repositories: [repository],
			repository,
			userComment: promptBody,
			commentAuthor,
			commentTimestamp,
			attachmentManifest,
			isNewSession,
			isStreaming: false, // This path is only for non-streaming prompts
			labels,
		};

		// Use unified prompt assembly
		const assembly = await this.assemblePrompt(input);

		// Log metadata for debugging
		this.logger.debug(
			`Built prompt - components: ${assembly.metadata.components.join(", ")}, type: ${assembly.metadata.promptType}`,
		);

		return assembly.userPrompt;
	}

	/**
	 * Assemble a complete prompt - unified entry point for all prompt building
	 * This method contains all prompt assembly logic in one place
	 */
	private async assemblePrompt(
		input: PromptAssemblyInput,
	): Promise<PromptAssembly> {
		// If actively streaming, just pass through the comment
		if (input.isStreaming) {
			return this.buildStreamingPrompt(input);
		}

		// If new session, build full prompt with all components
		if (input.isNewSession) {
			return this.buildNewSessionPrompt(input);
		}

		// Existing session continuation - just user comment + attachments
		return this.buildContinuationPrompt(input);
	}

	/**
	 * Build prompt for actively streaming session - pass through user comment as-is
	 */
	private buildStreamingPrompt(input: PromptAssemblyInput): PromptAssembly {
		const components: PromptComponent[] = ["user-comment"];
		if (input.attachmentManifest) {
			components.push("attachment-manifest");
		}

		const parts: string[] = [input.userComment];
		if (input.attachmentManifest) {
			parts.push(input.attachmentManifest);
		}

		return {
			systemPrompt: undefined,
			userPrompt: parts.join("\n\n"),
			metadata: {
				components,
				promptType: "continuation",
				isNewSession: false,
				isStreaming: true,
			},
		};
	}

	/**
	 * Build prompt for new session - includes issue context and user comment
	 */
	private async buildNewSessionPrompt(
		input: PromptAssemblyInput,
	): Promise<PromptAssembly> {
		const components: PromptComponent[] = [];
		const parts: string[] = [];

		// 1. Determine system prompt from labels
		// Only for delegation (not mentions) or when /label-based-prompt is requested
		const repositories = input.repositories ?? [input.repository];
		let labelBasedSystemPrompt: string | undefined;
		if (!input.isMentionTriggered || input.isLabelBasedPromptRequested) {
			const result = await this.promptBuilder.determineSystemPromptFromLabels(
				input.labels || [],
				repositories,
			);
			labelBasedSystemPrompt = result?.prompt;
		}

		// 2. Determine system prompt based on prompt type
		// Label-based: Use only the label-based system prompt
		// Fallback: Use scenarios system prompt (shared instructions)
		let systemPrompt: string;
		if (labelBasedSystemPrompt) {
			// Use label-based system prompt as-is (no shared instructions)
			systemPrompt = labelBasedSystemPrompt;
		} else {
			// Use scenarios system prompt for fallback cases
			const sharedInstructions = await this.loadSharedInstructions();
			systemPrompt = sharedInstructions;
		}

		// 3. Append skills guidance — instruct the agent to use skills based on context.
		// Skills hidden by per-skill scope (repo / Linear team / Linear label) are
		// omitted from the guidance so the model doesn't reference skills it
		// cannot invoke.
		const skillsContext = this.buildSkillSessionContext(
			repositories[0]!,
			input.fullIssue,
			input.session,
		);
		systemPrompt += await this.skillsPluginResolver.buildSkillsGuidance(
			undefined,
			skillsContext,
		);

		// 4. Append agent context — dynamic values for skills to reference
		systemPrompt += this.buildAgentContextBlock();

		// 5. Build issue context using appropriate builder
		// Use label-based prompt ONLY if we have a label-based system prompt
		const promptType = this.determinePromptType(
			input,
			!!labelBasedSystemPrompt,
		);
		// Build workspace repo paths map for prompt context.
		// For multi-repo sessions, workspace.repoPaths maps each repo ID to its worktree.
		// For single-repo sessions, use workspace.path as the worktree for the primary repo.
		const workspaceRepoPaths =
			input.session.workspace.repoPaths ??
			(repositories.length === 1
				? { [repositories[0]!.id]: input.session.workspace.path }
				: undefined);
		const issueContext = await this.buildIssueContextForPromptAssembly(
			input.fullIssue,
			repositories,
			promptType,
			input.attachmentManifest,
			input.guidance,
			input.agentSession,
			input.resolvedBaseBranches,
			workspaceRepoPaths,
		);

		parts.push(issueContext.prompt);
		components.push("issue-context");

		// 4. Add user comment (if present)
		// Skip for mention-triggered prompts since the comment is already in the mention block
		if (input.userComment.trim() && !input.isMentionTriggered) {
			// If we have author/timestamp metadata, include it for multi-player context
			if (input.commentAuthor || input.commentTimestamp) {
				const author = input.commentAuthor || "Unknown";
				const timestamp = input.commentTimestamp || new Date().toISOString();
				parts.push(`<user_comment>
  <author>${author}</author>
  <timestamp>${timestamp}</timestamp>
  <content>
${input.userComment}
  </content>
</user_comment>`);
			} else {
				// Legacy format without metadata
				parts.push(`<user_comment>\n${input.userComment}\n</user_comment>`);
			}
			components.push("user-comment");
		}

		// 6. Add guidance rules (if present)
		if (input.guidance && input.guidance.length > 0) {
			components.push("guidance-rules");
		}

		return {
			systemPrompt,
			userPrompt: parts.join("\n\n"),
			metadata: {
				components,
				promptType,
				isNewSession: true,
				isStreaming: false,
			},
		};
	}

	/**
	 * Build an <agent_context> block with dynamic values that skills can reference.
	 *
	 * Provides bot usernames so skills (e.g. verify-and-ship) can refer to the
	 * correct bot account without hardcoding.
	 */
	private buildAgentContextBlock(): string {
		const githubBot = process.env.GITHUB_BOT_USERNAME || "";
		const gitlabBot = process.env.GITLAB_BOT_USERNAME || "";

		if (!githubBot && !gitlabBot) {
			return "";
		}

		const lines: string[] = ["\n\n<agent_context>"];
		if (githubBot) {
			lines.push(`  <github_bot_username>${githubBot}</github_bot_username>`);
		}
		if (gitlabBot) {
			lines.push(`  <gitlab_bot_username>${gitlabBot}</gitlab_bot_username>`);
		}
		lines.push("</agent_context>");

		return lines.join("\n");
	}

	/**
	 * Build prompt for existing session continuation - user comment and attachments only
	 */
	private buildContinuationPrompt(input: PromptAssemblyInput): PromptAssembly {
		const components: PromptComponent[] = ["user-comment"];
		if (input.attachmentManifest) {
			components.push("attachment-manifest");
		}

		// Wrap comment in XML with author and timestamp for multi-player context
		const author = input.commentAuthor || "Unknown";
		const timestamp = input.commentTimestamp || new Date().toISOString();

		const commentXml = `<new_comment>
  <author>${author}</author>
  <timestamp>${timestamp}</timestamp>
  <content>
${input.userComment}
  </content>
</new_comment>`;

		const parts: string[] = [commentXml];
		if (input.attachmentManifest) {
			parts.push(input.attachmentManifest);
		}

		return {
			systemPrompt: undefined,
			userPrompt: parts.join("\n\n"),
			metadata: {
				components,
				promptType: "continuation",
				isNewSession: false,
				isStreaming: false,
			},
		};
	}

	/**
	 * Determine the prompt type based on input flags and system prompt availability
	 */
	private determinePromptType(
		input: PromptAssemblyInput,
		hasSystemPrompt: boolean,
	): PromptType {
		if (input.isMentionTriggered && input.isLabelBasedPromptRequested) {
			return "label-based-prompt-command";
		}
		if (input.isMentionTriggered) {
			return "mention";
		}
		if (hasSystemPrompt) {
			return "label-based";
		}
		return "fallback";
	}

	/**
	 * Load shared instructions that get appended to all system prompts
	 */
	private async loadSharedInstructions(): Promise<string> {
		return this.promptBuilder.loadSharedInstructions();
	}

	/**
	 * Adapter method for prompt assembly - routes to appropriate issue context builder
	 */
	private async buildIssueContextForPromptAssembly(
		issue: Issue,
		repositories: RepositoryConfig[],
		promptType: PromptType,
		attachmentManifest?: string,
		guidance?: GuidanceRule[],
		agentSession?: WebhookAgentSession,
		resolvedBaseBranches?: Record<string, BaseBranchResolution>,
		workspaceRepoPaths?: Record<string, string>,
	): Promise<IssueContextResult> {
		// Delegate to appropriate builder based on promptType
		if (promptType === "mention") {
			if (!agentSession) {
				throw new Error(
					"agentSession is required for mention-triggered prompts",
				);
			}
			return this.buildMentionPrompt(
				issue,
				agentSession,
				attachmentManifest,
				guidance,
			);
		}
		if (
			promptType === "label-based" ||
			promptType === "label-based-prompt-command"
		) {
			return this.promptBuilder.buildLabelBasedPrompt(
				issue,
				repositories,
				attachmentManifest,
				guidance,
				resolvedBaseBranches,
			);
		}
		// Fallback to standard issue context
		return this.promptBuilder.buildIssueContextPrompt(
			issue,
			repositories,
			undefined, // No new comment for initial prompt assembly
			attachmentManifest,
			guidance,
			resolvedBaseBranches,
			workspaceRepoPaths,
		);
	}

	/**
	 * Resolve the default runner type for SimpleRunner (classification) use.
	 * Uses config.defaultRunner if set, otherwise auto-detects from API keys,
	 * falling back to "claude".
	 */
	/**
	 * Build agent runner configuration with common settings.
	 * Delegates to RunnerConfigBuilder for shared config assembly.
	 * @returns Object containing the runner config and runner type to use
	 */
	private async buildAgentRunnerConfig(
		session: CyrusAgentSession,
		repository: RepositoryConfig,
		sessionId: string,
		systemPrompt: string | undefined,
		allowedTools: string[],
		allowedDirectories: string[],
		disallowedTools: string[],
		resumeSessionId?: string,
		labels?: string[],
		issueDescription?: string,
		maxTurns?: number,
		linearWorkspaceId?: string,
		skillContext?: SkillSessionContext,
		/**
		 * Which platform initiated the session — drives which
		 * `EdgeWorkerConfig.<platform>McpConfigs` override list applies.
		 * Defaults to `"linear"` (the pre-platform-aware behavior).
		 */
		sessionPlatform: "linear" | "github" | "gitlab" = "linear",
		runnerSelection?: { runnerType: RunnerType; modelOverride?: string },
	): Promise<{ config: AgentRunnerConfig; runnerType: RunnerType }> {
		const log = this.logger.withContext({
			sessionId,
			platform: session.issueContext?.trackerId,
			issueIdentifier: session.issueContext?.issueIdentifier,
		});

		// Resolve plugins once so we can also derive the per-session scoped
		// skill allow-list from the same filesystem snapshot.
		const plugins = await this.skillsPluginResolver.resolve();
		const resolvedSkillContext: SkillSessionContext = skillContext ?? {
			repositoryId: repository.id,
			repoPaths: this.resolveSkillRepoPaths(repository, session),
		};
		const allowedSkillNames =
			await this.skillsPluginResolver.discoverSkillNames(
				plugins,
				resolvedSkillContext,
			);

		const result = this.runnerConfigBuilder.buildIssueConfig({
			session,
			repository,
			sessionId,
			systemPrompt,
			allowedTools,
			allowedDirectories,
			disallowedTools,
			resumeSessionId,
			additionalWritableDirectories:
				this.config.sandbox?.additionalWritableDirectories,
			labels,
			issueDescription,
			runnerSelection,
			maxTurns,
			// Per-platform MCP config paths — GitHub + GitLab share the
			// `githubMcpConfigs` knob (single-repo PR contexts both); Linear
			// gets `linearMcpConfigs`. Not a blanket override: the builder
			// uses `repository.mcpConfigPath` when this repo has its own
			// `allowedTools` override (so the repo's permission rules and
			// MCP server set travel as a unit), and only falls through to
			// this list when the repo inherits the platform allow-list.
			platformMcpConfigOverrides:
				sessionPlatform === "linear"
					? this.config.linearMcpConfigs
					: this.config.githubMcpConfigs,
			strictMcpConfig: this.config.strictMcpConfig,
			linearWorkspaceId,
			factoryHome: this.factoryHome,
			// Org-matched GitHub App installation token (pushed by cyrus-hosted):
			// exposed to the session as GH_TOKEN / BOBS_FACTORY_GH_TOKEN so `gh` and
			// other tools authenticate against this repo's org. Undefined when
			// no token store entry matches — zero behavior change for self-host
			// users without the token file.
			githubToken: repository.githubUrl
				? this.githubTokenStore.getTokenForRepoUrl(repository.githubUrl)
				: undefined,
			logger: log,
			plugins,
			opencodeGlobalConfig: this.config.opencode?.config,
			opencodeGlobalStateScope: this.config.opencode?.stateScope,
			skills: allowedSkillNames,
			sandboxSettings: this.sdkSandboxSettings ?? undefined,
			egressCaCertPath: this.egressCaCertPath ?? undefined,
			onMessage: (message: SDKMessage) => {
				this.startRunTitle(sessionId);
				this.handleClaudeMessage(sessionId, message, repository.id);
			},
			onError: (error: Error) => {
				this.startRunTitle(sessionId);
				this.handleClaudeError(error);
			},
			createAskUserQuestionCallback: (sid, wid) =>
				this.createAskUserQuestionCallback(sid, wid)!,
			requireLinearWorkspaceId,
		});

		// Attach pre-warmed session if available (only for Claude runner).
		// Skipped entirely when warm sessions are not enabled.
		if (result.runnerType === "claude" && this.isWarmSessionsEnabled()) {
			const warmSession = this.warmInstances.get(sessionId);
			if (warmSession) {
				this.warmInstances.delete(sessionId);
				(
					result.config as AgentRunnerConfig & { warmSession?: WarmQuery }
				).warmSession = warmSession;
				log.debug("Attaching pre-warmed session to runner config");
			}
		}

		if (
			!this.factoryRuntime?.runs.has(sessionId) &&
			session.metadata?.executionSnapshot
		) {
			const snapshot = ExecutionSnapshotSchema.parse(
				session.metadata.executionSnapshot,
			);
			const resolved = await this.getExecutionResolver().resolve(
				snapshot,
				sessionId,
				session.workspace.path,
				result.runnerType,
			);
			executionCapabilities(result.runnerType);
			validateProfileRunner(result.config, snapshot, result.runnerType);
			this.getExecutionResolver().apply(result.config, snapshot, resolved);
			delete (result.config as AgentRunnerConfig & { warmSession?: WarmQuery })
				.warmSession;
		}
		return result;
	}

	/**
	 * Create an onAskUserQuestion callback for the ClaudeRunner.
	 * This callback delegates to the AskUserQuestionHandler which posts
	 * elicitations to Linear and waits for user responses.
	 *
	 * @param linearAgentSessionId - Linear agent session ID for tracking
	 * @param organizationId - Linear organization/workspace ID
	 */
	private createAskUserQuestionCallback(
		linearAgentSessionId: string,
		organizationId: string,
	): AgentRunnerConfig["onAskUserQuestion"] {
		return async (input, _sessionId, signal) => {
			// Note: We use linearAgentSessionId (from closure) instead of the passed sessionId
			// because the passed sessionId is the Claude session ID, not the Linear agent session ID
			return this.askUserQuestionHandler.handleAskUserQuestion(
				input,
				linearAgentSessionId,
				organizationId,
				signal,
			);
		};
	}

	/**
	 * Build disallowed tools list following the same hierarchy as allowed tools.
	 * Accepts single or multiple repositories (intersection for multi-repo).
	 */
	private buildDisallowedTools(
		repositories: RepositoryConfig | RepositoryConfig[],
		promptType?:
			| "debugger"
			| "builder"
			| "scoper"
			| "orchestrator"
			| "graphite-orchestrator",
	): string[] {
		return this.toolPermissionResolver.buildDisallowedTools(
			repositories,
			promptType,
		);
	}

	/**
	 * Build allowed tools list with Linear MCP tools automatically included.
	 * Accepts single or multiple repositories (union for multi-repo).
	 */
	private buildAllowedTools(
		repositories: RepositoryConfig | RepositoryConfig[],
		promptType?:
			| "debugger"
			| "builder"
			| "scoper"
			| "orchestrator"
			| "graphite-orchestrator",
	): string[] {
		return this.toolPermissionResolver.buildAllowedTools(
			repositories,
			promptType,
		);
	}

	/**
	 * Get Agent Sessions for an issue
	 */
	public getAgentSessionsForIssue(
		issueId: string,
		_repositoryId: string,
	): any[] {
		return this.agentSessionManager.getSessionsByIssueId(issueId);
	}

	// ========================================================================
	// User Access Control
	// ========================================================================

	/**
	 * Check if the user who triggered the webhook is allowed to interact.
	 * @param webhook The webhook containing user information
	 * @param repository The repository configuration
	 * @returns Access check result with allowed status and user name
	 */
	private checkUserAccess(
		webhook: AgentSessionCreatedWebhook | AgentSessionPromptedWebhook,
		repository: RepositoryConfig,
	): { allowed: true } | { allowed: false; reason: string; userName: string } {
		const creator = webhook.agentSession.creator;
		const userId = creator?.id;
		const userEmail = creator?.email;
		const userName = creator?.name || userId || "Unknown";

		const result = this.userAccessControl.checkAccess(
			userId,
			userEmail,
			repository.id,
		);

		if (!result.allowed) {
			return { allowed: false, reason: result.reason, userName };
		}
		return { allowed: true };
	}

	/**
	 * Handle blocked user according to configured behavior.
	 * Posts a response activity to end the session.
	 * @param webhook The webhook that triggered the blocked access
	 * @param repository The repository configuration
	 * @param _reason The reason for blocking (for logging)
	 */
	private async handleBlockedUser(
		webhook: AgentSessionCreatedWebhook | AgentSessionPromptedWebhook,
		repository: RepositoryConfig,
		_reason: string,
	): Promise<void> {
		// Use organizationId from webhook as the Linear-native workspace ID source
		const issueTracker = this.issueTrackers.get(webhook.organizationId);
		const agentSessionId = webhook.agentSession.id;
		const behavior = this.userAccessControl.getBlockBehavior(repository.id);

		if (!issueTracker) {
			return;
		}

		if (behavior === "comment") {
			// Get user info for templating
			const creator = webhook.agentSession.creator;
			const userName = creator?.name || "User";
			const userId = creator?.id || "";

			// Get the message template and replace variables
			// Supported variables:
			// - {{userName}} - The user's display name
			// - {{userId}} - The user's Linear ID
			let message = this.userAccessControl.getBlockMessage(repository.id);
			message = message
				.replace(/\{\{userName\}\}/g, userName)
				.replace(/\{\{userId\}\}/g, userId);

			await this.postActivityDirect(
				issueTracker,
				{
					agentSessionId,
					content: { type: "response", body: message },
				},
				"blocked user message",
			);
		}
		// For "silent" behavior, we don't post any activity.
		// The session will remain in "Working" state until manually stopped or timed out.
	}

	/**
	 * Load persisted EdgeWorker state for all repositories
	 */
	private async loadPersistedState(): Promise<void> {
		try {
			const state = await this.persistenceManager.loadEdgeWorkerState();
			if (state) {
				this.restoreMappings(state);
				this.logger.debug(
					`✅ Loaded persisted EdgeWorker state with ${Object.keys(state.agentSessions || {}).length} sessions`,
				);
			}
		} catch (error) {
			this.logger.error(`Failed to load persisted EdgeWorker state:`, error);
		}
	}

	/**
	 * Whether the warm-session feature is enabled.
	 *
	 * Managed workers disable idle streams and prewarming until providers can
	 * enforce admission at each turn boundary, including streamed follow-ups.
	 */
	private isWarmSessionsEnabled(): boolean {
		// Warm queries cannot await admission before each follow-up; resume the
		// saved conversation through a fresh gated start instead.
		return false;
	}

	/**
	 * Pre-warm the N most recently updated Claude sessions so the first query
	 * after a CLI restart has near-zero cold-start latency (~20x faster).
	 *
	 * Uses startup() from @anthropic-ai/claude-agent-sdk with MCP_CONNECTION_NONBLOCKING=true
	 * so the warm instances are ready in ~500ms rather than ~4s.
	 * Warm instances are stored in this.warmInstances keyed by agentSessionId and
	 * consumed by buildAgentRunnerConfig() when the first message arrives.
	 *
	 * Gated by `isWarmSessionsEnabled()` — callers should check before invoking.
	 */
	private async warmupRecentSessions(count = 30): Promise<void> {
		const allSessions = this.agentSessionManager.getAllSessions();

		// Only warm Claude sessions that have a persisted session ID and a workspace path
		const candidates = allSessions
			.filter((s) => s.claudeSessionId && s.workspace?.path)
			.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
			.slice(0, count);

		if (candidates.length === 0) {
			this.logger.debug("No Claude sessions to pre-warm");
			return;
		}

		this.logger.info(
			`Pre-warming ${candidates.length} most recent Claude sessions...`,
		);

		const { startup } = await import("@anthropic-ai/claude-agent-sdk");

		await Promise.all(
			candidates.map(async (session) => {
				try {
					const repoId = this.sessionRepositories.get(session.id);
					const repo = repoId ? this.repositories.get(repoId) : undefined;
					if (!repo) {
						this.logger.debug(
							`No repo for session ${session.id}, skipping warmup`,
						);
						return;
					}

					// Build MCP config for this session (same as the live runner would use)
					const linearWorkspaceId = requireLinearWorkspaceId(repo);
					const mcpConfig = this.mcpConfigService.buildMcpConfig(
						repo.id,
						linearWorkspaceId,
						session.id,
					);

					// Merge any file-based MCP configs (reuses shared normalization).
					// Warmup paths reconstruct Linear-triggered issue sessions:
					// if the repo has its own `allowedTools` override its
					// mcpConfigPath stays scoped to that repo, otherwise the
					// team-level `linearMcpConfigs` list applies. Same coupling
					// the live `buildIssueConfig` path uses.
					const mcpConfigPath = resolveIssueMcpConfigPath(
						repo,
						this.config.linearMcpConfigs,
						this.mcpConfigService.buildMergedMcpConfigPath.bind(
							this.mcpConfigService,
						),
					);
					let mcpServers: Record<string, McpServerConfig> = { ...mcpConfig };
					if (mcpConfigPath) {
						const paths = Array.isArray(mcpConfigPath)
							? mcpConfigPath
							: [mcpConfigPath];
						for (const filePath of paths) {
							try {
								if (existsSync(filePath)) {
									const fileContent = JSON.parse(
										readFileSync(filePath, "utf8"),
									);
									const servers = fileContent.mcpServers || {};
									normalizeMcpHttpTransport(servers);
									mcpServers = { ...mcpServers, ...servers };
								}
							} catch {
								// Ignore unreadable MCP config files
							}
						}
					}

					const repoConfig = repo as unknown as Record<string, unknown>;
					const model =
						(session.metadata?.model as string | undefined) ||
						(repoConfig.claudeDefaultModel as string | undefined) ||
						(repoConfig.model as string | undefined) ||
						"claude-opus-4-6";

					// Build allowed/disallowed tools — same as what buildAgentRunnerConfig() uses.
					// Without these, startup() inherits the user's defaultMode ("default"),
					// which causes macOS permission prompts for file writes.
					const allowedTools = this.buildAllowedTools(repo);
					const disallowedTools = this.buildDisallowedTools(repo);

					const warm = await startup({
						options: {
							resume: session.claudeSessionId,
							model,
							cwd: session.workspace.path,
							...(Object.keys(mcpServers).length > 0 && { mcpServers }),
							...(allowedTools.length > 0 && { allowedTools }),
							...(disallowedTools.length > 0 && { disallowedTools }),
							settingSources: ["user", "project", "local"],
							strictMcpConfig: this.config.strictMcpConfig ?? true,
							// CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is intentionally not set here;
							// see CYPACK-1108 and ClaudeRunner.start() for context.
							env: buildBaseSessionEnv(),
						},
					});

					this.warmInstances.set(session.id, warm);
					this.logger.info(
						`Pre-warmed session ${session.id} (${session.issueContext?.issueIdentifier ?? "unknown"})`,
					);
				} catch (err) {
					this.logger.debug(`Failed to pre-warm session ${session.id}:`, err);
				}
			}),
		);

		this.logger.info(
			`Session pre-warm complete: ${this.warmInstances.size} sessions ready`,
		);
	}

	/**
	 * Save current EdgeWorker state for all repositories
	 */
	private savePersistedState(
		requireSuccess = false,
		update?: () => () => void,
	): Promise<void> {
		const coalescible = !requireSuccess && !update;
		if (coalescible && this.pendingStateSave) return this.pendingStateSave;
		// Transactional admission is a barrier: later lifecycle saves must wait
		// for this mutation rather than reusing an earlier pending snapshot.
		this.pendingStateSave = undefined;
		const save = this.stateSaveQueue.then(async () => {
			if (this.pendingStateSave === save) this.pendingStateSave = undefined;
			const rollback = update?.();
			try {
				const state = this.serializeMappings();
				await this.persistenceManager.saveEdgeWorkerState(state);
				this.logger.debug(
					`✅ Saved EdgeWorker state for ${Object.keys(state.agentSessions || {}).length} sessions`,
				);
			} catch (error) {
				// Roll back before the next queued mutation or lifecycle snapshot.
				rollback?.();
				this.logger.error(`Failed to save persisted EdgeWorker state:`, error);
				if (requireSuccess) throw error;
			}
		});
		// A failed strict save must not poison later lifecycle saves.
		this.stateSaveQueue = save.catch(() => {});
		if (coalescible) this.pendingStateSave = save;
		return save;
	}

	/**
	 * Serialize EdgeWorker mappings to a serializable format (v4.0 flat format)
	 */
	public serializeMappings(): SerializableEdgeWorkerState {
		// Serialize Agent Session state - flat structure from single ASM
		const serializedState = this.agentSessionManager.serializeState();
		for (const handler of this.activeChatSessionHandlers) {
			const chatState = handler.serializeState();
			Object.assign(serializedState.sessions, chatState.sessions);
			Object.assign(serializedState.entries, chatState.entries);
		}

		// Serialize child to parent agent session mapping from GlobalSessionRegistry
		const registryState = this.globalSessionRegistry.serializeState();
		const childToParentAgentSession = registryState.childToParentMap;

		// Serialize issue to repository cache from RepositoryRouter
		const issueRepositoryCache = Object.fromEntries(
			this.repositoryRouter.getIssueRepositoryCache().entries(),
		);

		return {
			pendingTriggerMessages: Object.fromEntries(this.pendingTriggerMessages),
			pendingTriggerOrigins: Object.fromEntries(this.pendingTriggerOrigins),
			agentSessions: serializedState.sessions,
			agentSessionEntries: serializedState.entries,
			childToParentAgentSession,
			issueRepositoryCache,
		};
	}

	/**
	 * Restore EdgeWorker mappings from serialized state (v4.0 flat format)
	 */
	public restoreMappings(state: SerializableEdgeWorkerState): void {
		this.pendingTriggerMessages = new Map(
			Object.entries(state.pendingTriggerMessages ?? {}),
		);
		this.pendingTriggerOrigins = new Map(
			Object.entries(state.pendingTriggerOrigins ?? {}),
		);
		// Restore Agent Session state from flat format
		if (state.agentSessions && state.agentSessionEntries) {
			this.agentSessionManager.restoreState(
				state.agentSessions,
				state.agentSessionEntries,
			);

			// Rebuild session-to-repo mapping from issueRepositoryCache
			// For each restored session, look up its issue in the cache to find the repo
			if (state.issueRepositoryCache) {
				for (const [sessionId, session] of Object.entries(
					state.agentSessions,
				)) {
					const issueId =
						(session as any).issueContext?.issueId ?? (session as any).issueId;
					if (issueId && state.issueRepositoryCache[issueId]) {
						const cachedRepoIds = state.issueRepositoryCache[issueId];
						// Use first repo ID for session-to-repo mapping (primary repo)
						const repoId = cachedRepoIds[0];
						if (repoId) {
							this.sessionRepositories.set(sessionId, repoId);
							// Also register the activity sink for this restored session
							const activitySink = this.getActivitySinkForRepo(repoId);
							if (activitySink) {
								this.agentSessionManager.setActivitySink(
									sessionId,
									activitySink,
								);
							}
						}
					}
				}
			}

			this.logger.debug(
				`Restored ${Object.keys(state.agentSessions).length} sessions`,
			);
		}

		// Restore child to parent agent session mapping into GlobalSessionRegistry
		if (state.childToParentAgentSession) {
			const entries = Object.entries(state.childToParentAgentSession);
			for (const [childId, parentId] of entries) {
				this.globalSessionRegistry.setParentSession(childId, parentId);
			}
			this.logger.debug(
				`Restored ${entries.length} child-to-parent agent session mappings`,
			);
		}

		// Restore issue to repository cache in RepositoryRouter
		// Handles migration from old Record<string, string> to Record<string, string[]>
		if (state.issueRepositoryCache) {
			const cache = new Map(
				Object.entries(state.issueRepositoryCache) as [
					string,
					string | string[],
				][],
			);
			this.repositoryRouter.restoreIssueRepositoryCache(cache);
			this.logger.debug(
				`Restored ${cache.size} issue-to-repository cache mappings`,
			);
		}
	}

	/**
	 * Post an activity directly via an issue tracker instance.
	 * Consolidates try/catch and success/error logging for EdgeWorker call sites
	 * that already have the issueTracker and agentSessionId resolved.
	 *
	 * @returns The activity ID when resolved, `null` otherwise.
	 */
	private async postActivityDirect(
		issueTracker: IIssueTrackerService,
		input: AgentActivityCreateInput,
		label: string,
	): Promise<string | null> {
		return this.activityPoster.postActivityDirect(issueTracker, input, label);
	}

	/**
	 * Post instant acknowledgment thought when agent session is created
	 */
	private async postInstantAcknowledgment(
		sessionId: string,
		linearWorkspaceId: string,
	): Promise<void> {
		return this.activityPoster.postInstantAcknowledgment(
			sessionId,
			linearWorkspaceId,
		);
	}

	/**
	 * Post parent resume acknowledgment thought when parent session is resumed from child
	 */
	private async postParentResumeAcknowledgment(
		sessionId: string,
		linearWorkspaceId: string,
	): Promise<void> {
		return this.activityPoster.postParentResumeAcknowledgment(
			sessionId,
			linearWorkspaceId,
		);
	}

	/**
	 * Post combined routing activity showing repos selected + base branches resolved
	 */
	private async postRoutingActivity(
		sessionId: string,
		linearWorkspaceId: string,
		repoLines: string[],
		routingMethod?: string,
	): Promise<void> {
		return this.activityPoster.postRoutingActivity(
			sessionId,
			linearWorkspaceId,
			repoLines,
			routingMethod,
		);
	}

	/**
	 * Handle prompt with streaming check - centralized logic for all input types
	 *
	 * This method implements the unified pattern for handling prompts:
	 * 1. Check if runner is actively streaming
	 * 2. Add to stream if streaming, OR resume session if not
	 *
	 * @param session The Bob’s Factory agent session
	 * @param repository Repository configuration
	 * @param sessionId Linear agent activity session ID
	 * @param agentSessionManager Agent session manager instance
	 * @param promptBody The prompt text to send
	 * @param attachmentManifest Optional attachment manifest to append
	 * @param isNewSession Whether this is a new session
	 * @param additionalAllowedDirs Additional directories to allow access to
	 * @param logContext Context string for logging (e.g., "prompted webhook", "parent resume")
	 * @returns true if message was added to stream, false if session was resumed
	 */
	private async handlePromptWithStreamingCheck(
		session: CyrusAgentSession,
		repository: RepositoryConfig,
		sessionId: string,
		agentSessionManager: AgentSessionManager,
		promptBody: string,
		attachmentManifest: string,
		isNewSession: boolean,
		additionalAllowedDirs: string[],
		logContext: string,
		linearWorkspaceId: string,
		commentAuthor?: string,
		commentTimestamp?: string,
	): Promise<boolean> {
		const log = this.logger.withContext({ sessionId });
		const existingRunner = session.agentRunner;

		// Handle running case - add message to existing stream (if supported)
		if (
			existingRunner?.isRunning() &&
			existingRunner.supportsStreamingInput &&
			existingRunner.addStreamMessage
		) {
			log.debug(
				`Adding prompt to existing stream for ${sessionId} (${logContext})`,
			);

			// Append attachment manifest to the prompt if we have one
			let fullPrompt = promptBody;
			if (attachmentManifest) {
				fullPrompt = `${promptBody}\n\n${attachmentManifest}`;
			}

			// `addStreamMessage` can reject the message if the turn ended in the
			// race window between "still running" and "turn finished" (e.g. the
			// Codex app-server backend, which only steers an active turn). Fall
			// through to the resume path so the comment is never dropped. Claude's
			// streaming input never throws here, so this is a no-op for Claude.
			try {
				existingRunner.addStreamMessage(fullPrompt);
				return true; // Message added to stream
			} catch (error) {
				log.warn(
					`Streaming message rejected for ${sessionId}; falling back to resume (${logContext})`,
					{ error: error instanceof Error ? error.message : String(error) },
				);
			}
		}

		// Not streaming (or streaming was rejected) - resume/start session
		log.debug(`Resuming Claude session for ${sessionId} (${logContext})`);

		await this.resumeAgentSession(
			session,
			repository,
			sessionId,
			agentSessionManager,
			promptBody,
			attachmentManifest,
			isNewSession,
			additionalAllowedDirs,
			linearWorkspaceId,
			undefined, // maxTurns
			commentAuthor,
			commentTimestamp,
		);

		return false; // Session was resumed
	}

	/**
	 * Post thought about system prompt selection based on labels
	 */
	private async postSystemPromptSelectionThought(
		sessionId: string,
		labels: string[],
		linearWorkspaceId: string,
		repositoryId: string,
	): Promise<void> {
		return this.activityPoster.postSystemPromptSelectionThought(
			sessionId,
			labels,
			linearWorkspaceId,
			repositoryId,
		);
	}

	/**
	 * Resume or create an Agent session with the given prompt
	 * This is the core logic for handling prompted agent activities
	 * @param session The Bob’s Factory agent session
	 * @param repository The repository configuration
	 * @param sessionId The Linear agent session ID
	 * @param agentSessionManager The agent session manager
	 * @param promptBody The prompt text to send
	 * @param attachmentManifest Optional attachment manifest
	 * @param isNewSession Whether this is a new session
	 */
	async resumeAgentSession(
		session: CyrusAgentSession,
		repository: RepositoryConfig,
		sessionId: string,
		agentSessionManager: AgentSessionManager,
		promptBody: string,
		attachmentManifest: string = "",
		isNewSession: boolean = false,
		additionalAllowedDirectories: string[] = [],
		linearWorkspaceId?: string,
		maxTurns?: number,
		commentAuthor?: string,
		commentTimestamp?: string,
		recoverySignal?: AbortSignal,
	): Promise<void> {
		const log = this.logger.withContext({ sessionId });
		// Check for existing runner
		const existingRunner = session.agentRunner;

		// If there's an existing running runner that supports streaming, add to it
		if (
			existingRunner?.isRunning() &&
			existingRunner.supportsStreamingInput &&
			existingRunner.addStreamMessage
		) {
			let fullPrompt = promptBody;
			if (attachmentManifest) {
				fullPrompt = `${promptBody}\n\n${attachmentManifest}`;
			}
			// See handlePromptWithStreamingCheck: a steer-only backend can reject
			// the message if the turn just ended. Fall through to a fresh resume
			// turn rather than dropping the comment. No-op for Claude.
			try {
				existingRunner.addStreamMessage(fullPrompt);
				return;
			} catch (error) {
				log.warn(
					`Streaming message rejected for ${sessionId}; falling back to resume`,
					{ error: error instanceof Error ? error.message : String(error) },
				);
			}
		}

		// Stop existing runner if it's not running
		if (existingRunner) {
			existingRunner.stop();
		}

		// Get issueId from issueContext (preferred) or deprecated issueId field
		const issueIdForResume = session.issueContext?.issueId ?? session.issueId;
		if (!issueIdForResume) {
			log.error(`No issue ID found for session ${session.id}`);
			throw new Error(`No issue ID found for session ${session.id}`);
		}

		// Fetch full issue details using workspace ID (from webhook context or repo fallback)
		const resolvedWorkspaceId =
			linearWorkspaceId ?? requireLinearWorkspaceId(repository);
		const fullIssue = await this.fetchFullIssueDetails(
			issueIdForResume,
			resolvedWorkspaceId,
		);
		if (!fullIssue) {
			log.error(`Failed to fetch full issue details for ${issueIdForResume}`);
			throw new Error(
				`Failed to fetch full issue details for ${issueIdForResume}`,
			);
		}

		// Fetch issue labels early to determine runner type
		const labels = await this.fetchIssueLabels(fullIssue);

		// Determine which runner to use based on existing session IDs
		const hasClaudeSession = !isNewSession && Boolean(session.claudeSessionId);
		const hasGeminiSession = !isNewSession && Boolean(session.geminiSessionId);
		const hasCodexSession = !isNewSession && Boolean(session.codexSessionId);
		const hasCursorSession = !isNewSession && Boolean(session.cursorSessionId);
		const hasOpenCodeSession =
			!isNewSession && Boolean(session.opencodeSessionId);
		const needsNewSession =
			isNewSession ||
			(!hasClaudeSession &&
				!hasGeminiSession &&
				!hasCodexSession &&
				!hasCursorSession &&
				!hasOpenCodeSession);

		// Fetch system prompt based on labels

		const systemPromptResult = await this.determineSystemPromptFromLabels(
			labels,
			repository,
		);
		const systemPrompt = systemPromptResult?.prompt;
		const promptType = systemPromptResult?.type;

		// Build allowed and disallowed tools lists
		const allowedTools = this.buildAllowedTools(repository, promptType);
		const disallowedTools = this.buildDisallowedTools(repository, promptType);

		// Set up attachments directory
		const workspaceFolderName = basename(session.workspace.path);
		const attachmentsDir = join(
			this.factoryHome,
			workspaceFolderName,
			"attachments",
		);
		await mkdir(attachmentsDir, { recursive: true });

		const allowedDirectories = [
			...new Set([
				attachmentsDir,
				repository.repositoryPath,
				...additionalAllowedDirectories,
				...this.gitService.getGitMetadataDirectoriesForWorkspace(
					session.workspace,
				),
			]),
		];

		const resumeSessionId = needsNewSession
			? undefined
			: session.claudeSessionId
				? session.claudeSessionId
				: session.geminiSessionId
					? session.geminiSessionId
					: session.codexSessionId
						? session.codexSessionId
						: session.cursorSessionId
							? session.cursorSessionId
							: session.opencodeSessionId;

		console.log(
			`[resumeAgentSession] needsNewSession=${needsNewSession}, resumeSessionId=${resumeSessionId ?? "none"}`,
		);

		// Create runner configuration
		// buildAgentRunnerConfig determines runner type from labels for new sessions
		// For existing sessions, we still need labels for model override but ignore runner type
		const { config: runnerConfig, runnerType } =
			await this.buildAgentRunnerConfig(
				session,
				repository,
				sessionId,
				systemPrompt,
				allowedTools,
				allowedDirectories,
				disallowedTools,
				resumeSessionId,
				labels, // Always pass labels to preserve model override
				fullIssue.description || undefined, // Description tags can override label selectors
				maxTurns, // Pass maxTurns if specified
				resolvedWorkspaceId,
				this.buildSkillSessionContext(repository, fullIssue, session),
			);

		recoverySignal?.throwIfAborted();
		// Create the appropriate runner based on session state
		const runner = recoverySignal
			? capRunnerStarts(
					this.buildRunnerForType(runnerType, runnerConfig),
					this.runnerSlots,
					recoverySignal,
					{
						identity: `${this.factoryHome}:session:${sessionId}`,
						recoverable: true,
						remote: runnerType === "cursor",
						onChange: () => this.emit("chatSessionChanged", sessionId),
					},
				)
			: this.createRunnerForType(
					runnerType,
					runnerConfig,
					undefined,
					sessionId,
				);

		// Store runner
		agentSessionManager.addAgentRunner(sessionId, runner);

		// Save state
		await this.savePersistedState();

		// Prepare the full prompt
		const fullPrompt = await this.buildSessionPrompt(
			isNewSession,
			session,
			fullIssue,
			repository,
			promptBody,
			attachmentManifest,
			commentAuthor,
			commentTimestamp,
		);

		// Start session - use streaming mode if supported for ability to add messages later
		const stopOnRestart = () => runner.stop();
		recoverySignal?.addEventListener("abort", stopOnRestart, { once: true });
		try {
			recoverySignal?.throwIfAborted();
			if (runner.supportsStreamingInput && runner.startStreaming) {
				await runner.startStreaming(fullPrompt);
			} else {
				await runner.start(fullPrompt);
			}
		} catch (error) {
			log.error(`Failed to start streaming session for ${sessionId}:`, error);
			throw error;
		} finally {
			recoverySignal?.removeEventListener("abort", stopOnRestart);
		}
	}

	/**
	 * Post instant acknowledgment thought when receiving prompted webhook
	 */
	private async postInstantPromptedAcknowledgment(
		sessionId: string,
		linearWorkspaceId: string,
		isStreaming: boolean,
	): Promise<void> {
		return this.activityPoster.postInstantPromptedAcknowledgment(
			sessionId,
			linearWorkspaceId,
			isStreaming,
		);
	}

	/**
	 * Get the platform type for a workspace's issue tracker.
	 */
	private getRepositoryPlatform(linearWorkspaceId: string): string | undefined {
		try {
			return this.issueTrackers.get(linearWorkspaceId)?.getPlatformType();
		} catch {
			return undefined;
		}
	}

	/**
	 * Fetch complete issue details from Linear API
	 */
	public async fetchFullIssueDetails(
		issueId: string,
		linearWorkspaceId: string,
	): Promise<Issue | null> {
		const issueTracker = this.issueTrackers.get(linearWorkspaceId);
		if (!issueTracker) {
			this.logger.warn(
				`No issue tracker found for workspace ${linearWorkspaceId}`,
			);
			return null;
		}

		try {
			this.logger.debug(`Fetching full issue details for ${issueId}`);
			const fullIssue = await issueTracker.fetchIssue(issueId);
			this.logger.debug(`Successfully fetched issue details for ${issueId}`);

			// Check if issue has a parent
			try {
				const parent = await fullIssue.parent;
				if (parent) {
					this.logger.debug(
						`Issue ${issueId} has parent: ${parent.identifier}`,
					);
				}
			} catch (_error) {
				// Parent field might not exist, ignore error
			}

			return fullIssue;
		} catch (error) {
			this.logger.error(`Failed to fetch issue details for ${issueId}:`, error);
			return null;
		}
	}

	// ========================================================================
	// OAuth Token Refresh
	// ========================================================================

	/**
	 * Build OAuth config for LinearIssueTrackerService.
	 * Uses workspace-level token storage.
	 * Returns undefined if OAuth credentials are not available.
	 */
	private buildOAuthConfig(
		linearWorkspaceId: string,
	): LinearOAuthConfig | undefined {
		const clientId = process.env.LINEAR_CLIENT_ID;
		const clientSecret = process.env.LINEAR_CLIENT_SECRET;

		if (!clientId || !clientSecret) {
			this.logger.warn(
				"LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET not set, token refresh disabled",
			);
			return undefined;
		}

		const workspaceConfig = this.config.linearWorkspaces?.[linearWorkspaceId];
		if (!workspaceConfig?.linearRefreshToken) {
			this.logger.warn(
				`No refresh token for workspace ${linearWorkspaceId}, token refresh disabled`,
			);
			return undefined;
		}

		// Get workspace name from workspace-level config
		const workspaceName =
			this.config.linearWorkspaces?.[linearWorkspaceId]?.linearWorkspaceName ||
			linearWorkspaceId;

		return {
			clientId,
			clientSecret,
			refreshToken: workspaceConfig.linearRefreshToken,
			workspaceId: linearWorkspaceId,
			onTokenRefresh: async (tokens) => {
				// Update workspace config in memory
				if (this.config.linearWorkspaces?.[linearWorkspaceId]) {
					this.config.linearWorkspaces[linearWorkspaceId].linearToken =
						tokens.accessToken;
					this.config.linearWorkspaces[linearWorkspaceId].linearRefreshToken =
						tokens.refreshToken;
				}

				// Persist tokens to config.json
				await this.saveOAuthTokens({
					linearToken: tokens.accessToken,
					linearRefreshToken: tokens.refreshToken,
					linearWorkspaceId: linearWorkspaceId,
					linearWorkspaceName: workspaceName,
				});
			},
		};
	}

	/**
	 * Save OAuth tokens to config.json (workspace-level storage)
	 */
	private async saveOAuthTokens(tokens: {
		linearToken: string;
		linearRefreshToken?: string;
		linearWorkspaceId: string;
		linearWorkspaceName?: string;
	}): Promise<void> {
		if (!this.configPath) {
			this.logger.warn("No config path set, cannot save OAuth tokens");
			return;
		}

		try {
			const configContent = await readFile(this.configPath, "utf-8");
			const config = JSON.parse(configContent);

			// Ensure linearWorkspaces exists
			if (!config.linearWorkspaces) {
				config.linearWorkspaces = {};
			}

			// Update workspace-level token storage
			config.linearWorkspaces[tokens.linearWorkspaceId] = {
				linearToken: tokens.linearToken,
				...(tokens.linearRefreshToken
					? { linearRefreshToken: tokens.linearRefreshToken }
					: config.linearWorkspaces[tokens.linearWorkspaceId]
								?.linearRefreshToken
						? {
								linearRefreshToken:
									config.linearWorkspaces[tokens.linearWorkspaceId]
										.linearRefreshToken,
							}
						: {}),
				...(tokens.linearWorkspaceName
					? { linearWorkspaceName: tokens.linearWorkspaceName }
					: config.linearWorkspaces[tokens.linearWorkspaceId]
								?.linearWorkspaceName
						? {
								linearWorkspaceName:
									config.linearWorkspaces[tokens.linearWorkspaceId]
										.linearWorkspaceName,
							}
						: {}),
			};

			await writeFile(this.configPath, JSON.stringify(config, null, "\t"));
			this.logger.debug(
				`OAuth tokens saved to config for workspace ${tokens.linearWorkspaceId}`,
			);
		} catch (error) {
			this.logger.error("Failed to save OAuth tokens:", error);
		}
	}
}

/** Factory transports use the same configured restrictions as agent tools. */
export function assertFactoryToolAllowed(
	name: string,
	allowed?: string[],
	denied?: string[],
): void {
	const matches = (pattern: string) => {
		if (pattern === `mcp__${name.split("__")[1]}`) return true;
		return new RegExp(
			"^" +
				pattern
					.split("*")
					.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
					.join(".*") +
				"$",
		).test(name);
	};
	if (denied?.some(matches) || (allowed?.length && !allowed.some(matches)))
		throw new Error(
			`Ticket tracking tool ${name} is restricted by configured tool permissions. Enable the required tool before retrying ticket synchronization.`,
		);
}

function assertNativeTicketSource(source: string, verified: string): void {
	if (!source.startsWith("https://")) return;
	const identity = (value: string) => {
		const url = new URL(value);
		return `${url.origin}/${url.pathname.split("/").filter(Boolean).slice(0, 3).join("/")}`.toLowerCase();
	};
	if (identity(source) !== identity(verified))
		throw new Error(
			"Configured native tracker returned another ticket workspace. Configure the originating URL’s workspace before starting work.",
		);
}
