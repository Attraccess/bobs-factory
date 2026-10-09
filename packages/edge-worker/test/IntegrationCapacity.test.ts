import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionStatus, type RepositoryConfig } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { GitService, setupExecutionScope } from "../src/GitService.js";
import { MachineCapacity } from "../src/MachineCapacity.js";
import { RunnerConfigBuilder } from "../src/RunnerConfigBuilder.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "integration-capacity-"));
	roots.push(home);
	return { home, slots: new MachineCapacity(1, join(home, "pool")) };
}
const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

it("gates constructor-unconfigured GitService hooks using the launch scope", async () => {
	const { home, slots } = fixture();
	const blocker = await slots.acquireLease();
	const marker = join(home, "executed");
	const script = join(home, "setup.sh");
	writeFileSync(script, `touch '${marker}'\n`, { mode: 0o755 });
	const service = new GitService({ factoryHome: home });
	const pending = setupExecutionScope.run(
		{
			signal: new AbortController().signal,
			service: slots,
			capacity: {
				workflowRun: {
					identity: "setup-run",
					createdAt: "2026-10-09T00:00:00Z",
				},
			},
		},
		() =>
			service.createGitWorktree(
				{ id: "issue", identifier: "ISSUE-1", title: "Test" } as any,
				[],
				{ workspaceBaseDir: home, globalSetupScript: script },
			),
	);
	await vi.waitFor(async () => expect((await slots.snapshot()).queued).toBe(1));
	expect(existsSync(marker)).toBe(false);
	expect(
		(await slots.snapshot()).requests.find((r) => r.phase === "queued")
			?.workflowRun,
	).toEqual({ identity: "setup-run", createdAt: "2026-10-09T00:00:00Z" });
	await blocker.release();
	await pending;
	expect(existsSync(marker)).toBe(true);
	expect((await slots.snapshot()).requests).toEqual([]);
});

it("settling an integration launch cancels setup queued in the production custom-handler path", async () => {
	const { home, slots } = fixture();
	const blocker = await slots.acquireLease();
	const marker = join(home, "executed");
	const script = join(home, "setup.sh");
	writeFileSync(script, `touch '${marker}'\n`, { mode: 0o755 });
	// WorkerService's custom handler owns a GitService without constructor capacity.
	const service = new GitService({ factoryHome: home });
	const receipt: any = {
		sessionId: "launch",
		phase: "starting",
		origin: { ticket: { issueId: "issue" } },
	};
	const worker: any = Object.create(EdgeWorker.prototype);
	Object.assign(worker, {
		factoryHome: home,
		runnerSlots: slots,
		recoveryAbort: new AbortController(),
		preparationStarts: new Map(),
		logger,
		parkedSessions: new Map(),
		repositoryRouter: { cancelPendingSelection: vi.fn() },
		fetchFullIssueDetails: async () => ({
			id: "issue",
			identifier: "ISSUE-1",
			title: "Test",
		}),
		selectTicketLaunch: async () => ({ workflow: { id: "simple" } }),
		moveIssueToStartedState: vi.fn(),
		getLaunchAdmission: () => ({
			get: () => receipt,
			values: () => [receipt],
			update: (_: any, changes: any) => Object.assign(receipt, changes),
		}),
		config: {
			handlers: {
				createWorkspace: (issue: any, _repos: any, options: any) =>
					service.createGitWorktree(issue, [], {
						...options,
						workspaceBaseDir: home,
						globalSetupScript: script,
					}),
			},
		},
	});
	const pending = worker.createCyrusAgentSession(
		"launch",
		{ id: "issue" },
		[{ id: "repo" }],
		{},
		"workspace",
	);
	const rejected = expect(pending).rejects.toThrow();
	await vi.waitFor(async () => expect((await slots.snapshot()).queued).toBe(1));
	worker.settleTicketLaunch("launch");
	await rejected;
	expect((await slots.snapshot()).queued).toBe(0);
	await blocker.release();
	expect(existsSync(marker)).toBe(false);
	expect(worker.preparationStarts.size).toBe(0);
});

it.each([
	"github",
	"gitlab",
])("recovers queued %s execution with its original order, native conversation and reply context", async (platform) => {
	const { home, slots: old } = fixture();
	const blocker = await old.acquireLease();
	const identity = `${home}:session:${platform}-saved`;
	const queued = old.acquireLease(undefined, { identity, recoverable: true });
	const rejected = expect(queued).rejects.toThrow(/shutting down/);
	await vi.waitFor(async () => expect((await old.snapshot()).queued).toBe(1));
	const original = (await old.snapshot()).requests.find(
		(r) => r.identity === identity,
	)!;
	await old.shutdown();
	await rejected;
	const slots = new MachineCapacity(undefined, old.directory);
	const session: any = {
		id: `${platform}-saved`,
		status: AgentSessionStatus.Active,
		issue: { id: "pr" },
		issueContext: { trackerId: platform },
		workspace: { path: home },
		repositories: [{ repositoryId: "repo" }],
		codexSessionId: "native-thread",
		metadata: {
			pendingExecution: {
				prompt: "Apply the review",
				systemPrompt: "PR instructions",
				runner: "codex",
				model: "saved-model",
				replyEvent:
					platform === "github"
						? githubEvent("saved-delivery")
						: { deliveryId: "saved-delivery" },
			},
		},
	};
	const invoke = vi.fn(async () => ({ sessionId: "native-thread" }));
	const provider = { start: invoke, stop: vi.fn() };
	const repository = {
		id: "repo",
		isActive: true,
		repositoryPath: home,
		linearWorkspaceId: "test-workspace",
	} as RepositoryConfig;
	const worker: any = Object.create(EdgeWorker.prototype);
	const runtime = { runs: new Map(), resumeAll: vi.fn() };
	Object.assign(worker, {
		factoryHome: home,
		runnerSlots: slots,
		recoveryAbort: new AbortController(),
		preparationStarts: new Map(),
		activeGitHubPrSessions: new Set(),
		queuedGitHubPrEvents: new Map(),
		chatSessionHandler: null,
		zulipChatSessionHandler: null,
		logger,
		repositories: new Map([["repo", repository]]),
		sessionRepositories: new Map(),
		getFactoryRuntime: () => runtime,
		getLaunchAdmission: () => ({ values: () => [] }),
		ticketStartupIsIncomplete: () => false,
		getAllKnownSessions: () => [session],
		agentSessionManager: {
			getActiveSessions: () => [session],
			createResponseActivity: vi.fn(),
			addAgentRunner: (_id: string, runner: any) => {
				session.agentRunner = runner;
			},
		},
		toolPermissionResolver: { buildGithubAllowedTools: () => ["Read"] },
		buildDisallowedTools: () => [],
		getDefaultFallbackModelForRunner: () => undefined,
		buildSkillSessionContext: () => ({}),
		buildAgentRunnerConfig: vi.fn(async () => ({
			config: {},
			runnerType: "codex",
		})),
		buildRunnerForType: () => provider,
		savePersistedState: vi.fn(),
		postGitHubReply: vi.fn(),
		postGitLabReply: vi.fn(),
	});
	worker.recoverFactoryRuns();
	await vi.waitFor(async () => {
		const current = (await slots.snapshot()).requests.find(
			(r) => r.identity === identity,
		)!;
		expect(current.parked).toBe(false);
		expect(current.sequence).toBe(original.sequence);
		expect(current.id).toBe(original.id);
	});
	expect(invoke).not.toHaveBeenCalled();
	expect(worker.buildAgentRunnerConfig.mock.calls[0][7]).toBe("native-thread");
	await blocker.release();
	await vi.waitFor(() =>
		expect(
			platform === "github" ? worker.postGitHubReply : worker.postGitLabReply,
		).toHaveBeenCalledWith(
			session.metadata.pendingExecution.replyEvent,
			expect.anything(),
			repository,
		),
	);
	expect(invoke).toHaveBeenCalledWith("Apply the review");
	expect((await slots.snapshot()).requests).toEqual([]);
});

function githubEvent(deliveryId = "saved-delivery") {
	return {
		deliveryId,
		eventType: "issue_comment",
		payload: {
			action: "created",
			repository: {
				full_name: "test/repo",
				name: "repo",
				owner: { login: "test" },
			},
			issue: {
				number: 7,
				title: "Test PR",
				pull_request: { url: "https://api.github.com/repos/test/repo/pulls/7" },
			},
			comment: {
				id: 42,
				body: "@cyrusagent apply review",
				user: { login: "reviewer" },
			},
		},
	};
}

function recoveryFixture(platform = "github", runnerType = "cursor") {
	const { home, slots } = fixture();
	const repository = {
		id: "repo",
		isActive: true,
		repositoryPath: home,
		linearWorkspaceId: "test-workspace",
	} as RepositoryConfig;
	const session: any = {
		id: "saved",
		status: AgentSessionStatus.Active,
		issue: { id: "github:test/repo#7", identifier: "repo#7" },
		issueContext: { trackerId: platform },
		workspace: { path: home },
		repositories: [{ repositoryId: "repo" }],
		metadata: {
			pendingExecution: {
				runner: runnerType,
				model: "saved-model",
				prompt: "Apply review",
				systemPrompt: "Saved instructions",
				replyEvent: platform === "github" ? githubEvent() : undefined,
			},
		},
	};
	const provider = {
		start: vi.fn(async () => ({})),
		stop: vi.fn(),
		completeStream: vi.fn(),
	};
	const scopedLogger = { ...logger, withContext: () => scopedLogger };
	const worker: any = Object.create(EdgeWorker.prototype);
	Object.assign(worker, {
		factoryHome: home,
		runnerSlots: slots,
		recoveryAbort: new AbortController(),
		preparationStarts: new Map(),
		activeGitHubPrSessions: new Set(),
		queuedGitHubPrEvents: new Map(),
		activeWebhookCount: 0,
		logger: scopedLogger,
		config: {},
		sdkSandboxSettings: { enabled: true },
		egressCaCertPath: "/test/ca.pem",
		skillsPluginResolver: {
			resolve: async () => [],
			discoverSkillNames: async () => [],
		},
		githubTokenStore: { getTokenForRepoUrl: () => undefined },
		getLaunchAdmission: () => ({ values: () => [] }),
		agentSessionManager: {
			addAgentRunner: (_id: string, runner: any) => {
				session.agentRunner = runner;
			},
		},
		toolPermissionResolver: { buildGithubAllowedTools: () => ["Read"] },
		buildDisallowedTools: () => [],
		buildSkillSessionContext: () => ({}),
		getDefaultFallbackModelForRunner: () => "fallback",
		isWarmSessionsEnabled: () => false,
		buildRunnerForType: vi.fn(() => provider),
		savePersistedState: vi.fn(),
		postGitHubReply: vi.fn(),
		postGitLabReply: vi.fn(),
		startRunTitle: vi.fn(),
		handleClaudeMessage: vi.fn(),
		findRepositoryByGitHubUrl: () => repository,
		resolveGitHubToken: async () => undefined,
		createGitHubWorkspace: vi.fn(),
	});
	worker.runnerConfigBuilder = new RunnerConfigBuilder(
		{ buildChatAllowedTools: () => [] },
		{ buildMcpConfig: () => ({}), buildMergedMcpConfigPath: () => undefined },
		{
			getDefaultRunner: () => "claude",
			determineRunnerSelection: () => ({ runnerType: "claude" }),
			getDefaultModelForRunner: () => "current-model",
			getDefaultFallbackModelForRunner: () => "fallback",
		},
	);
	return { worker, session, repository, provider, slots };
}

it.each([
	"github",
	"gitlab",
])("restores queued %s Cursor configuration before a native conversation exists", async (platform) => {
	const { worker, session, repository } = recoveryFixture(platform);
	await worker.recoverIntegrationSession(session, repository);
	const [runnerType, config] = worker.buildRunnerForType.mock.calls[0];
	expect(runnerType).toBe("cursor");
	expect(config.model).toBe("saved-model");
	expect(config.sandboxSettings).toEqual({ enabled: true });
	expect(config.egressCaCertPath).toBe("/test/ca.pem");
});

it.each([
	"github",
	"gitlab",
])("stopping %s recovery during configuration loading prevents execution", async (platform) => {
	const { worker, session, repository, provider, slots } =
		recoveryFixture(platform);
	let finishConfig!: () => void;
	worker.skillsPluginResolver.resolve = vi.fn(
		() =>
			new Promise<[]>((resolve) => {
				finishConfig = () => resolve([]);
			}),
	);
	const recovering = worker.recoverIntegrationSession(session, repository);
	const rejected = expect(recovering).rejects.toThrow();
	expect(worker.preparationStarts.has(session.id)).toBe(true);
	worker.settleTicketLaunch(session.id);
	session.status = AgentSessionStatus.Error;
	finishConfig();
	await rejected;
	expect(provider.start).not.toHaveBeenCalled();
	expect(worker.buildRunnerForType).not.toHaveBeenCalled();
	expect((await slots.snapshot()).requests).toEqual([]);
	expect(worker.preparationStarts.size).toBe(0);
	expect(worker.activeGitHubPrSessions.size).toBe(0);
});

it("rechecks a terminal stop before starting the registered recovered runner", async () => {
	const { worker, session, repository, provider } = recoveryFixture();
	worker.savePersistedState.mockImplementationOnce(async () => {
		session.status = AgentSessionStatus.Error;
	});
	await expect(
		worker.recoverIntegrationSession(session, repository),
	).rejects.toThrow(/stopped/);
	expect(provider.start).not.toHaveBeenCalled();
	expect(worker.preparationStarts.size).toBe(0);
	expect(worker.activeGitHubPrSessions.size).toBe(0);
});

it.each([
	"completion",
	"failure",
	"result",
])("serializes incoming GitHub work during recovery and advances the queue on %s", async (outcome) => {
	const { worker, session, repository, provider } = recoveryFixture();
	let finish!: () => void;
	let fail!: (error: Error) => void;
	provider.start.mockImplementationOnce(
		() =>
			new Promise((resolve, reject) => {
				finish = () => resolve({});
				fail = reject;
			}),
	);
	let finishConfig!: () => void;
	worker.skillsPluginResolver.resolve = () =>
		new Promise<[]>((resolve) => {
			finishConfig = () => resolve([]);
		});
	const recovering = worker.recoverIntegrationSession(session, repository);
	const done =
		outcome === "failure"
			? expect(recovering).rejects.toThrow("provider failed")
			: recovering;
	const event = githubEvent("next-delivery");
	// The PR reservation must precede the asynchronous config load.
	await worker.handleGitHubWebhook(event);
	expect(worker.queuedGitHubPrEvents.get("github:test/repo#7")).toEqual([
		event,
	]);
	expect(worker.createGitHubWorkspace).not.toHaveBeenCalled();
	finishConfig();
	await vi.waitFor(() => expect(provider.start).toHaveBeenCalled());
	await worker.handleGitHubWebhook(githubEvent("third-delivery"));
	expect(worker.queuedGitHubPrEvents.get("github:test/repo#7")).toHaveLength(2);
	expect(worker.createGitHubWorkspace).not.toHaveBeenCalled();
	const processNext = vi
		.spyOn(worker, "handleGitHubWebhook")
		.mockResolvedValue(undefined);
	if (outcome === "result") {
		const config = worker.buildRunnerForType.mock.calls[0][1];
		await config.onMessage({ type: "result" });
		expect(provider.completeStream).toHaveBeenCalledOnce();
		expect(processNext).toHaveBeenCalledWith(event, true);
		finish();
	} else if (outcome === "failure") fail(new Error("provider failed"));
	else finish();
	await done;
	expect(processNext).toHaveBeenCalledOnce();
	expect(processNext).toHaveBeenCalledWith(event, true);
	if (outcome !== "failure")
		expect(worker.postGitHubReply).toHaveBeenCalledOnce();
});

it("removes the parked pre-restart queue immediately when configuration recovery is stopped", async () => {
	const {
		worker,
		session,
		repository,
		provider,
		slots: old,
	} = recoveryFixture();
	const blocker = await old.acquireLease();
	const identity = `${worker.factoryHome}:session:${session.id}`;
	const queued = old.acquireLease(undefined, { identity, recoverable: true });
	const rejectedQueue = expect(queued).rejects.toThrow(/shutting down/);
	await vi.waitFor(async () => expect((await old.snapshot()).queued).toBe(1));
	await old.shutdown();
	await rejectedQueue;
	const slots = new MachineCapacity(undefined, old.directory);
	worker.runnerSlots = slots;
	let finishConfig!: () => void;
	worker.skillsPluginResolver.resolve = () =>
		new Promise<[]>((resolve) => {
			finishConfig = () => resolve([]);
		});
	const recovering = worker.recoverIntegrationSession(session, repository);
	const rejected = expect(recovering).rejects.toThrow();
	worker.settleTicketLaunch(session.id);
	session.status = AgentSessionStatus.Error;
	// Do not release configuration until cancellation has removed the saved queue.
	await vi.waitFor(async () => expect((await slots.snapshot()).queued).toBe(0));
	finishConfig();
	await rejected;
	await blocker.release();
	expect(provider.start).not.toHaveBeenCalled();
	expect((await slots.snapshot()).requests).toEqual([]);
});

it.each([
	"github",
	"gitlab",
])("removes failed %s recovery from the saved queue while preserving shutdown recovery", async (platform) => {
	const {
		worker,
		session,
		repository,
		provider,
		slots: old,
	} = recoveryFixture(platform);
	const identity = `${worker.factoryHome}:session:${session.id}`;
	const otherIdentity = `${worker.factoryHome}:session:other`;
	const blocker = await old.acquireLease();
	const queued = [identity, otherIdentity].map((identity) =>
		old.acquireLease(undefined, { identity, recoverable: true }),
	);
	const rejectedQueues = queued.map((request) =>
		expect(request).rejects.toThrow(/shutting down/),
	);
	await vi.waitFor(async () => expect((await old.snapshot()).queued).toBe(2));
	await old.shutdown();
	await Promise.all(rejectedQueues);
	const slots = new MachineCapacity(undefined, old.directory);
	worker.runnerSlots = slots;
	const original = (await slots.snapshot()).requests.filter(
		(request) => request.phase === "queued",
	);
	Object.assign(worker, {
		repositories: new Map([[repository.id, repository]]),
		sessionRepositories: new Map(),
		chatSessionHandler: null,
		zulipChatSessionHandler: null,
		getFactoryRuntime: () => ({ runs: new Map(), resumeAll: vi.fn() }),
		ticketStartupIsIncomplete: () => false,
		getAllKnownSessions: () => [session],
	});
	worker.agentSessionManager.getActiveSessions = () => [session];
	worker.agentSessionManager.createResponseActivity = vi.fn();
	let failConfig!: (error: Error) => void;
	worker.skillsPluginResolver.resolve = () =>
		new Promise((_, reject) => {
			failConfig = reject;
		});
	// Shutdown interrupts preparation but keeps both parked requests for restart.
	worker.recoverFactoryRuns();
	worker.stopping = true;
	worker.recoveryAbort.abort();
	failConfig(new Error("configuration interrupted"));
	await vi.waitFor(() => expect(worker.preparationStarts.size).toBe(0));
	expect(session.status).toBe(AgentSessionStatus.Active);
	expect(
		(await slots.snapshot()).requests.filter((r) => r.phase === "queued"),
	).toEqual(original);
	expect(
		worker.agentSessionManager.createResponseActivity,
	).not.toHaveBeenCalled();
	// A subsequent startup configuration failure must remove only its request.
	worker.stopping = false;
	worker.recoveryAbort = new AbortController();
	worker.recoverFactoryRuns();
	failConfig(new Error("configuration failed"));
	await vi.waitFor(() =>
		expect(
			worker.agentSessionManager.createResponseActivity,
		).toHaveBeenCalledWith(
			session.id,
			"Automatic recovery failed: configuration failed",
		),
	);
	expect(session.status).toBe(AgentSessionStatus.Error);
	expect((await slots.snapshot()).queued).toBe(1);
	expect(
		(await slots.snapshot()).requests.filter((r) => r.phase === "queued"),
	).toEqual(original.filter((r) => r.identity === otherIdentity));
	expect(provider.start).not.toHaveBeenCalled();
	expect(worker.buildRunnerForType).not.toHaveBeenCalled();
	expect(worker.activeGitHubPrSessions.size).toBe(0);
	await slots.reconcileQueue(
		(requestIdentity) => requestIdentity === otherIdentity,
	);
	await blocker.release();
	expect((await slots.snapshot()).requests).toEqual([]);
});
