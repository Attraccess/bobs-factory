// Re-export useful types from dependencies
export type { SDKMessage } from "bobs-factory-claude-runner";
export { getAllTools, readOnlyTools } from "bobs-factory-claude-runner";
export type {
	EdgeConfig,
	EdgeWorkerConfig,
	OAuthCallbackHandler,
	RepositoryConfig,
	UserAccessControlConfig,
	UserIdentifier,
	Workspace,
} from "bobs-factory-core";
export { AgentSessionManager } from "./AgentSessionManager.js";
export type {
	AskUserQuestionHandlerConfig,
	AskUserQuestionHandlerDeps,
} from "./AskUserQuestionHandler.js";
export { AskUserQuestionHandler } from "./AskUserQuestionHandler.js";
export type { ChatRepositoryProvider } from "./ChatRepositoryProvider.js";
export { LiveChatRepositoryProvider } from "./ChatRepositoryProvider.js";
export type {
	ChatPlatformAdapter,
	ChatPlatformName,
	ChatSessionHandlerDeps,
} from "./ChatSessionHandler.js";
export { ChatSessionHandler } from "./ChatSessionHandler.js";
export { DefaultSkillsDeployer } from "./DefaultSkillsDeployer.js";
export { EdgeWorker } from "./EdgeWorker.js";
export { EgressProxy } from "./EgressProxy.js";
export {
	authorizeFactoryEnrollment,
	requestFactoryAuthRecovery,
	requestFactoryTerminalSession,
} from "./factory/FactoryAuthOperator.js";
export type { FactoryOnboarding } from "./factory/FactoryOnboarding.js";
export type {
	GithubApiRequest,
	GithubAuthBinding,
} from "./factory/GithubApi.js";
export {
	executeGithubApi,
	GITHUB_AUTH_FILENAME,
	githubRuntimeCredentials,
	readGithubAuth,
} from "./factory/GithubApi.js";
export {
	OperatorGrants,
	serveOperatorClient,
} from "./factory/OperatorGrants.js";
export {
	type Recommendation,
	resolveAnswers,
	serializeAnswers,
} from "./factory/QuestionAnswers.js";
export {
	type Attention,
	active,
	attention,
	finished,
	type RunSummary,
	settleReason,
	workingLabel,
} from "./factory/RunAttention.js";
export type { CreateGitWorktreeOptions } from "./GitService.js";
export { GitService } from "./GitService.js";
export type { SerializedGlobalRegistryState } from "./GlobalSessionRegistry.js";
export { GlobalSessionRegistry } from "./GlobalSessionRegistry.js";
export { preflightFactoryState } from "./lifecycle/PreflightState.js";
export type { McpConfigServiceDeps } from "./McpConfigService.js";
export { McpConfigService } from "./McpConfigService.js";
export { RepositoryRouter } from "./RepositoryRouter.js";
export type {
	ChatRunnerConfigInput,
	IChatToolResolver,
	IMcpConfigProvider,
	IRunnerSelector,
	IssueRunnerConfigInput,
} from "./RunnerConfigBuilder.js";
export { RunnerConfigBuilder } from "./RunnerConfigBuilder.js";
export { SharedApplicationServer } from "./SharedApplicationServer.js";
export { SkillsPluginResolver } from "./SkillsPluginResolver.js";
export { SlackChatAdapter } from "./SlackChatAdapter.js";
export type {
	ActivityPostOptions,
	ActivityPostResult,
	ActivitySignal,
	IActivitySink,
} from "./sinks/index.js";
export { LinearActivitySink } from "./sinks/index.js";
export type { PromptType } from "./ToolPermissionResolver.js";
export { ToolPermissionResolver } from "./ToolPermissionResolver.js";
export type { EdgeWorkerEvents } from "./types.js";
// User access control
export {
	type AccessCheckResult,
	DEFAULT_BLOCK_MESSAGE,
	UserAccessControl,
} from "./UserAccessControl.js";
export { PublishedUpdateSource } from "./updates/PublishedUpdateSource.js";
export type {
	InstalledUpdate,
	StagedUpdate,
	UpdateCandidate,
	UpdateLifecycle,
	UpdateSettings,
	UpdateSettingsPatch,
	UpdateSource,
	UpdateState,
	UpdateTransaction,
} from "./updates/UpdateManager.js";

export {
	candidateKey,
	effectiveUpdatePolicy,
	UpdateManager,
} from "./updates/UpdateManager.js";
export { WorktreeIncludeService } from "./WorktreeIncludeService.js";
export { ZulipChatAdapter } from "./ZulipChatAdapter.js";
