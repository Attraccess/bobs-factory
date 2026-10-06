import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionStatus, type RepositoryConfig } from "cyrus-core";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { GitService, setupExecutionScope } from "../src/GitService.js";
import { MachineCapacity } from "../src/MachineCapacity.js";

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
	const service = new GitService({ cyrusHome: home });
	const pending = setupExecutionScope.run(
		{ signal: new AbortController().signal, service: slots },
		() =>
			service.createGitWorktree(
				{ id: "issue", identifier: "ISSUE-1", title: "Test" } as any,
				[],
				{ workspaceBaseDir: home, globalSetupScript: script },
			),
	);
	await vi.waitFor(async () => expect((await slots.snapshot()).queued).toBe(1));
	expect(existsSync(marker)).toBe(false);
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
	const service = new GitService({ cyrusHome: home });
	const receipt: any = {
		sessionId: "launch",
		phase: "starting",
		origin: { ticket: { issueId: "issue" } },
	};
	const worker: any = Object.create(EdgeWorker.prototype);
	Object.assign(worker, {
		cyrusHome: home,
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
				replyEvent: { deliveryId: "saved-delivery" },
			},
		},
	};
	const invoke = vi.fn(async () => ({ sessionId: "native-thread" }));
	const provider = { start: invoke, stop: vi.fn() };
	const repository = {
		id: "repo",
		isActive: true,
		repositoryPath: home,
	} as RepositoryConfig;
	const worker: any = Object.create(EdgeWorker.prototype);
	const runtime = { runs: new Map(), resumeAll: vi.fn() };
	Object.assign(worker, {
		cyrusHome: home,
		runnerSlots: slots,
		recoveryAbort: new AbortController(),
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
			{ deliveryId: "saved-delivery" },
			expect.anything(),
			repository,
		),
	);
	expect(invoke).toHaveBeenCalledWith("Apply the review");
	expect((await slots.snapshot()).requests).toEqual([]);
});
