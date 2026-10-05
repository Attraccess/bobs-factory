import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { resolveLaunchRequest } from "../src/factory/LaunchFields.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
	vi.restoreAllMocks();
});
function setup() {
	const home = mkdtempSync(join(tmpdir(), "workflow-trigger-edge-"));
	const workspace = join(home, "workspace");
	const createWorkspace = vi.fn(async () => ({
		path: workspace,
		isGitWorktree: false,
	}));
	const repository = {
		id: "repo",
		name: "Repo",
		repositoryPath: home,
		workspaceBaseDir: home,
		baseBranch: "main",
		linearWorkspaceId: "cli-workspace",
		isActive: true,
	};
	const worker = new EdgeWorker({
		platform: "cli",
		cyrusHome: home,
		repositories: [repository],
		handlers: { createWorkspace },
	});
	// Exercise actual launch/session code; stub only network/attachment boundaries.
	const edge = worker as any;
	const runtime = edge.getFactoryRuntime();
	const fullIssue = {
		id: "issue",
		identifier: "TEST-1",
		title: "Ticket",
		description: "Instructions",
		branchName: "ticket-branch",
		url: "https://linear.app/test/issue/TEST-1",
	};
	vi.spyOn(edge, "fetchFullIssueDetails").mockResolvedValue(fullIssue);
	vi.spyOn(edge, "fetchIssueLabels").mockResolvedValue([]);
	const move = vi
		.spyOn(edge, "moveIssueToStartedState")
		.mockResolvedValue(undefined);
	const download = vi
		.spyOn(edge, "downloadIssueAttachments")
		.mockResolvedValue({ manifest: "", attachmentsDir: null });
	vi.spyOn(edge, "postRoutingActivity").mockResolvedValue(undefined);
	vi.spyOn(edge, "postInstantAcknowledgment").mockResolvedValue(undefined);
	const activity = vi.fn(async () => ({ success: true }));
	edge.issueTrackers.set("cli-workspace", { createAgentActivity: activity });
	cleanups.push(async () => {
		await runtime.shutdown();
		await edge.stateSaveQueue;
		rmSync(home, { recursive: true, force: true });
	});
	return {
		edge,
		worker,
		home,
		runtime,
		repository,
		createWorkspace,
		move,
		download,
		activity,
		fullIssue,
	};
}
function webhook(body: string) {
	return {
		type: "AgentSessionEvent",
		action: "created",
		createdAt: "2026-10-05T10:00:00Z",
		organizationId: "cli-workspace",
		agentSession: {
			id: "session",
			issue: { id: "issue", identifier: "TEST-1", title: "Ticket" },
			comment: { id: "comment", body },
		},
	};
}
it.each([
	"This thread is for an agent session",
	"@Bob please help",
])("rejects Simple ticket startup before worktree, state change or download: %s", async (body) => {
	const {
		edge,
		runtime,
		repository,
		createWorkspace,
		move,
		download,
		activity,
	} = setup();
	runtime.updateWorkflows(
		defaultWorkflows.map((w) =>
			w.id === "simple" ? { ...w, allowedTriggers: ["manual"] } : w,
		),
	);
	const event = webhook(body);
	edge.captureTicketOrigin(event, true);
	await expect(
		edge.initializeAgentRunner(
			event.agentSession,
			[repository],
			event.organizationId,
			undefined,
			body,
		),
	).rejects.toThrow(/simple.*ticket-assignment.*Recipes/);
	expect(createWorkspace).not.toHaveBeenCalled();
	expect(move).not.toHaveBeenCalled();
	expect(download).not.toHaveBeenCalled();
	expect(edge.agentSessionManager.getSession("session")).toBeUndefined();
	expect(runtime.runs.size).toBe(0);
	expect(activity).toHaveBeenCalledWith(
		expect.objectContaining({
			agentSessionId: "session",
			content: {
				type: "response",
				body: expect.stringMatching(/ticket-assignment.*Recipes/),
			},
		}),
	);
});
it.each([
	false,
	true,
])("retains original ticket context across delayed replies and Simple serialization (scalar comment ID: %s)", async (scalarCommentId) => {
	const { edge, worker, repository } = setup();
	const event = webhook("@Bob implement this");
	const original = {
		...event,
		agentSession: {
			...event.agentSession,
			comment: scalarCommentId ? undefined : event.agentSession.comment,
			commentId: scalarCommentId ? "comment" : "fallback-comment",
		},
	};
	edge.captureTicketOrigin(original, true);
	const state = worker.serializeMappings();
	worker.restoreMappings(state);
	edge.captureTicketOrigin(
		{
			...original,
			action: "prompted",
			createdAt: "2026-10-05T11:00:00Z",
			agentSession: {
				...original.agentSession,
				comment: { id: "answer", body: "Choose repo" },
			},
		},
		false,
	);
	const data = await edge.createCyrusAgentSession(
		"session",
		original.agentSession.issue,
		[repository],
		edge.agentSessionManager,
		"cli-workspace",
	);
	expect(data.launch.workflow.id).toBe("simple");
	const origin = data.session.triggerOrigin;
	expect(origin).toMatchObject({
		type: "ticket-assignment",
		workflowId: "simple",
		selectionMethod: "default",
		ticket: {
			provider: "cli",
			subtype: scalarCommentId ? "assignment" : "mention",
			commentId: "comment",
			sourceTimestamp: "2026-10-05T10:00:00Z",
			identifier: "TEST-1",
		},
	});
	const serialized = edge.agentSessionManager.serializeState();
	const restored = new AgentSessionManager();
	restored.restoreState(serialized.sessions, serialized.entries);
	expect(restored.getSession("session")!.triggerOrigin).toEqual(origin);
});
it("selects Takeover once and retains that snapshot if permissions change during workspace preparation", async () => {
	const { edge, runtime, repository, createWorkspace } = setup();
	const labels = edge.fetchIssueLabels.mockResolvedValue(["workflow:takeover"]);
	createWorkspace.mockImplementation(async () => {
		runtime.updateWorkflows(
			defaultWorkflows.map((w) =>
				w.id === "takeover" ? { ...w, allowedTriggers: [] } : w,
			),
		);
		return { path: join(edge.cyrusHome, "workspace"), isGitWorktree: false };
	});
	const event = webhook("This thread is for an agent session");
	edge.captureTicketOrigin(event, true);
	const data = await edge.createCyrusAgentSession(
		"session",
		event.agentSession.issue,
		[repository],
		edge.agentSessionManager,
		"cli-workspace",
	);
	expect(labels).toHaveBeenCalledOnce();
	expect(createWorkspace.mock.calls[0]![2]).toMatchObject({
		baseBranchOverrides: new Map([["repo", "ticket-branch"]]),
	});
	expect(data.launch.workflow.id).toBe("takeover");
	expect(data.launch.workflow.allowedTriggers).toContain("ticket-assignment");
	expect(data.session.triggerOrigin.ticket.subtype).toBe("assignment");
	expect(() =>
		runtime.selectWorkflow([], "ticket-assignment", "takeover"),
	).toThrow("ticket-assignment");
});
it("rechecks manual and follow-up starts at the backend boundary before run creation", async () => {
	const { edge, runtime } = setup();
	const factory = defaultWorkflows.find((w) => w.id === "factory")!;
	const input = resolveLaunchRequest(factory, {
		repositoryId: "repo",
		workflow: "factory",
		inputs: { prompt: "Work" },
	});
	runtime.updateWorkflows(
		defaultWorkflows.map((w) =>
			w.id === "factory"
				? { ...w, allowedTriggers: ["workflow", "ticket-assignment"] }
				: w,
		),
	);
	await expect(
		edge.startManualFactoryRun({
			...input,
			triggerOrigin: { type: "ticket-assignment" },
		}),
	).rejects.toThrow(/factory.*manual.*Recipes/);
	await expect(edge.startManualFactoryRun(input, "source-run")).rejects.toThrow(
		/factory.*manual.*Recipes/,
	);
	expect(runtime.runs.size).toBe(0);
});

it("starts ticket Simple execution with its ID while independent title work is unresolved", async () => {
	const { edge, repository, fullIssue, runtime, home } = setup();
	const titleStart = vi.fn();
	edge.titleGenerator = {
		start: titleStart,
		cancel: vi.fn(),
		shutdown: async () => {},
	};
	runtime.updateTitleSettings({ runner: "gemini", model: "cheap-title" });
	vi.spyOn(edge, "assemblePrompt").mockResolvedValue({
		userPrompt: "Do work",
		systemPrompt: undefined,
		metadata: { components: [] },
	});
	let runnerConfig: any;
	let finish!: () => void;
	const runner = {
		supportsStreamingInput: false,
		start: vi.fn(async () => {
			runnerConfig.onMessage({
				type: "system",
				subtype: "init",
				session_id: "primary-native",
				model: "primary-model",
				tools: [],
			});
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
			return { sessionId: "primary-native" };
		}),
		stop: vi.fn(),
		isRunning: () => true,
		getMessages: () => [],
	};
	vi.spyOn(edge, "buildRunnerForType").mockImplementation(
		(_type: unknown, config: unknown) => {
			runnerConfig = config;
			return runner;
		},
	);
	const event = webhook("@Bob implement this");
	edge.captureTicketOrigin(event, true);
	const execution = edge.initializeAgentRunner(
		event.agentSession,
		[repository],
		"cli-workspace",
		undefined,
		"@Bob implement this",
	);
	await vi.waitFor(() => expect(titleStart).toHaveBeenCalledOnce());
	const session = edge.agentSessionManager.getSession("session");
	expect(session.displayTitle).toBe("session");
	expect(session.issue.title).toBe(fullIssue.title);
	expect(session.titleGeneration.settings).toEqual({
		runner: "gemini",
		model: "cheap-title",
	});
	expect(JSON.parse(session.titleGeneration.context)).toMatchObject({
		ticketTitle: "Ticket",
		initiatingComment: "@Bob implement this",
	});
	expect(session.agentRunner).toBeDefined();
	expect(session.claudeSessionId).toBe("primary-native");
	const originalRunner = session.agentRunner;
	edge.updateRunTitle(
		"session",
		{ ...session.titleGeneration, state: "completed" },
		"Implement ticket work",
	);
	expect(session.agentRunner).toBe(originalRunner);
	expect(session.claudeSessionId).toBe("primary-native");
	expect(session.issue.title).toBe("Ticket");
	expect(session.metadata.model).toBe("primary-model");
	finish();
	await execution;
	await edge.stateSaveQueue;
	const restored = new AgentSessionManager(null, null, undefined, home);
	const state = edge.serializeMappings();
	restored.restoreState(state.agentSessions, state.agentSessionEntries);
	expect(restored.getSession("session")?.displayTitle).toBe(
		"Implement ticket work",
	);
	expect(restored.getSession("session")?.titleGeneration?.state).toBe(
		"completed",
	);
});

it("returns a manual launch immediately, preserves source naming data and mirrors completion before title", async () => {
	const { edge, runtime, home } = setup();
	const workflow = {
		id: "custom-title",
		name: "Custom title",
		allowedTriggers: ["manual"],
		steps: [{ id: "work", name: "Work", type: "script", script: "true" }],
	};
	runtime.updateWorkflows([...runtime.listWorkflows(), workflow]);
	vi.spyOn(edge.gitService, "createGitWorktree").mockResolvedValue({
		path: home,
		isGitWorktree: false,
	});
	const titleStart = vi.fn();
	edge.titleGenerator = {
		start: titleStart,
		cancel: vi.fn(),
		shutdown: async () => {},
	};
	const run = await edge.startManualFactoryRun(
		resolveLaunchRequest(runtime.selectWorkflow([], "manual", "custom-title"), {
			repositoryId: "repo",
			workflow: "custom-title",
			inputs: { prompt: "https://taskbot.apps.janjaap.de/p/test/t/68" },
			title: "Ignored",
		}),
	);
	expect(run.title).toBe(run.id);
	expect(run.status).toBe("running");
	await vi.waitFor(() => expect(run.status).toBe("completed"));
	expect(titleStart).toHaveBeenCalledOnce();
	expect(JSON.parse(titleStart.mock.calls[0][1].context).instructions).toBe(
		"https://taskbot.apps.janjaap.de/p/test/t/68",
	);
	const before = {
		status: run.status,
		history: structuredClone(run.history),
		outputs: structuredClone(run.outputs),
		workspace: run.workspace,
	};
	edge.updateRunTitle(
		run.id,
		{ ...run.titleGeneration, state: "completed" },
		"Stabilize inventory counters",
	);
	expect(run).toMatchObject(before);
	expect(run.title).toBe("Stabilize inventory counters");
	expect(run.sessionSnapshot.displayTitle).toBe(run.title);
	expect(edge.agentSessionManager.getSession(run.id).displayTitle).toBe(
		run.title,
	);
	expect(run.sessionSnapshot.titleGeneration.state).toBe("completed");
});

it("cancels pending naming even when a user stop only interrupts a warm turn", async () => {
	const { edge, home } = setup();
	const session = edge.agentSessionManager.createCyrusAgentSession(
		"warm-stop",
		"issue",
		{ id: "issue", identifier: "TEST-1", title: "Ticket" },
		{ path: home, isGitWorktree: false },
		"linear",
	);
	session.titleGeneration = {
		state: "pending",
		prepared: true,
		context: "Task",
		settings: { runner: "claude" },
	};
	const interrupt = vi.fn(async () => {});
	session.agentRunner = { interrupt, isWarm: () => true, stop: vi.fn() };
	const cancel = vi.fn();
	edge.titleGenerator = { cancel, shutdown: async () => {} };
	vi.spyOn(
		edge.agentSessionManager,
		"createResponseActivity",
	).mockResolvedValue(undefined);
	await edge.handleStopSignal({
		agentSession: { id: session.id, issue: session.issue },
	});
	expect(interrupt).toHaveBeenCalledOnce();
	expect(cancel).toHaveBeenCalledWith(session.id);
	expect(session.titleGeneration.state).toBe("cancelled");
});

it("accepts standalone chat/view changes without treating the session as a runtime run", () => {
	const { edge, runtime, home } = setup();
	const session = edge.agentSessionManager.createChatSession(
		"standalone-chat",
		{ path: home, isGitWorktree: false },
		"slack",
	);
	expect(runtime.updateViewState(session.id, { keptOpen: true })).toEqual({
		keptOpen: true,
	});
	expect(
		runtime.recordChatMessage(session.id, "Check reconnects", "simple").text,
	).toBe("Check reconnects");
	expect(runtime.runs.has(session.id)).toBe(false);
});

it("recovers pending titles for active non-ticket sessions without renaming historical sessions", () => {
	const { edge, home } = setup();
	const pending = edge.agentSessionManager.createChatSession(
		"chat-pending",
		{ path: home, isGitWorktree: false },
		"slack",
	);
	pending.titleGeneration = {
		state: "pending",
		prepared: true,
		context: "Chat task",
		settings: { runner: "claude" },
	};
	edge.agentSessionManager.createChatSession(
		"old-chat",
		{ path: home, isGitWorktree: false },
		"slack",
	);
	const start = vi.fn();
	edge.titleGenerator = { start, shutdown: async () => {} };
	edge.recoverFactoryRuns();
	expect(start).toHaveBeenCalledOnce();
	expect(start).toHaveBeenCalledWith(pending.id, pending.titleGeneration);
});

it.each([
	"running",
	"failed",
])("preserves a historical %s run's title during recovery or retry", async (status) => {
	const { edge, runtime, home } = setup();
	runtime.updateWorkflows(
		defaultWorkflows.map((workflow) =>
			workflow.id === "factory"
				? {
						...workflow,
						steps: [
							{ id: "work", name: "Work", type: "script", script: "true" },
						],
					}
				: workflow,
		),
	);
	const workflow = runtime.selectWorkflow([], "manual", "factory");
	const run = runtime.create({
		id: `historical-${status}`,
		triggerOrigin: {
			type: "manual",
			workflowId: "factory",
			selectionMethod: "explicit",
			at: new Date().toISOString(),
			manual: { method: "composer-api" },
		},
		repositoryId: "repo",
		workflow,
		workspace: home,
		input: "Original task",
	});
	run.title = "Original historical title";
	delete run.titleGeneration;
	run.status = status;
	runtime.save(run);
	const start = vi.fn();
	edge.titleGenerator = { start, shutdown: async () => {} };
	if (status === "running") edge.recoverFactoryRuns();
	else runtime.retry(run.id);
	await vi.waitFor(() => expect(run.status).toBe("completed"));
	expect(start).not.toHaveBeenCalled();
	expect(run.titleGeneration).toBeUndefined();
	expect(run.title).toBe("Original historical title");
	expect(run.sessionSnapshot.displayTitle).toBe(run.title);

	// A second retry must also preserve the saved historical identity.
	run.status = "failed";
	runtime.retry(run.id);
	await vi.waitFor(() => expect(run.status).toBe("completed"));
	expect(start).not.toHaveBeenCalled();
	expect(run.titleGeneration).toBeUndefined();
});

it.each([
	"factory",
	"takeover",
])("names a ticket-driven %s root once without waiting for title completion", async (workflowId) => {
	const { edge, runtime, repository } = setup();
	edge.issueTrackers.get("cli-workspace").fetchComments = vi.fn(async () => ({
		nodes: [],
		pageInfo: { hasNextPage: false },
	}));
	edge.issueTrackers.get("cli-workspace").fetchIssueAttachments = vi.fn(
		async () => [],
	);
	runtime.updateWorkflows(
		defaultWorkflows.map((workflow) =>
			workflow.id === workflowId
				? {
						...workflow,
						steps: [
							{ id: "work", name: "Work", type: "script", script: "true" },
						],
					}
				: workflow,
		),
	);
	edge.fetchIssueLabels.mockResolvedValue([`workflow:${workflowId}`]);
	vi.spyOn(edge, "assemblePrompt").mockResolvedValue({
		userPrompt: "Full primary execution prompt",
		systemPrompt: "Primary instructions",
		metadata: { components: [], promptType: "initial" },
	});
	const start = vi.fn();
	edge.titleGenerator = { start, shutdown: async () => {} };
	const event = webhook("Check scanner totals");
	edge.captureTicketOrigin(event, true);
	await edge.initializeAgentRunner(
		event.agentSession,
		[repository],
		"cli-workspace",
		undefined,
		"Check scanner totals",
	);
	const run = runtime.get("session");
	expect(run.title).toBe("session");
	await vi.waitFor(() => expect(run.status).toBe("completed"));
	expect(start).toHaveBeenCalledOnce();
	expect(JSON.parse(start.mock.calls[0][1].context)).toMatchObject({
		ticketTitle: "Ticket",
		ticketBody: "Instructions",
		initiatingComment: "Check scanner totals",
	});
	expect(start.mock.calls[0][1].context).not.toContain(
		"Full primary execution prompt",
	);
	expect(run.sessionSnapshot.titleGeneration.state).toBe("pending");
});
