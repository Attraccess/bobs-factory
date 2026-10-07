import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIIssueTrackerService } from "cyrus-core";
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
	edge.issueTrackers.set("cli-workspace", {
		createAgentActivity: activity,
		getPlatformType: () => "cli",
	});
	cleanups.push(async () => {
		await runtime.shutdown();
		edge.ticketTracking?.stop();
		await edge.stateSaveQueue;
		await edge.runnerSlots.ready();
		await edge.runnerSlots.shutdown();
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

it.each([
	[
		"@Bob [workflow=takeover]",
		"[workflow=factory]",
		"takeover",
		"comment-selector",
	],
	[
		"This thread is for an agent session",
		"[workflow=factory]",
		"factory",
		"description-selector",
	],
	[
		'@Bob "[workflow=takeover]"',
		"[workflow=simple]",
		"simple",
		"description-selector",
	],
	[
		"@Bob \\[workflow=factory\\]",
		"[workflow=simple] [workflow=takeover]",
		"factory",
		"comment-selector",
	],
])("selects at the actual ticket startup boundary: %s", async (body, description, expected, source) => {
	const { edge, fullIssue, repository, createWorkspace } = setup();
	fullIssue.description = description;
	const event = webhook(body);
	edge.captureTicketOrigin(event, true);
	const result = await edge.createCyrusAgentSession(
		"session",
		event.agentSession.issue,
		[repository],
		edge.agentSessionManager,
		"cli-workspace",
	);
	expect(result.launch.workflow.id).toBe(expected);
	expect(result.session.triggerOrigin.selection.source).toBe(source);
	expect(createWorkspace).toHaveBeenCalledOnce();
});
it.each([
	"[workflow=unknown]",
	"[workflow=factory] [workflow=takeover]",
	"[workflow=]",
	"[workflow=factory-pipeline]",
])("rejects winning selectors before routing/setup: %s", async (selector) => {
	const { edge, createWorkspace, move, download, activity } = setup();
	const route = vi.spyOn(edge, "routeAcceptedTicketLaunch");
	await edge.handleAgentSessionCreatedWebhook(webhook(`@Bob ${selector}`), []);
	expect(route).not.toHaveBeenCalled();
	expect(createWorkspace).not.toHaveBeenCalled();
	expect(move).not.toHaveBeenCalled();
	expect(download).not.toHaveBeenCalled();
	expect(activity).toHaveBeenCalledWith(
		expect.objectContaining({
			content: expect.objectContaining({
				type: "response",
				body: expect.stringMatching(/workflow|Workflow/),
			}),
		}),
	);
});
it("durably reserves concurrent arrivals, keeps original selection through restart, and deduplicates completed sessions", async () => {
	const { edge, worker, runtime, repository, createWorkspace } = setup();
	const first = webhook("@Bob [workflow=takeover] Continue this");
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const route = vi
		.spyOn(edge, "routeAcceptedTicketLaunch")
		.mockImplementation(async () => {
			await gate;
		});
	const accepted = edge.handleAgentSessionCreatedWebhook(first, [repository]);
	await vi.waitFor(() => expect(route).toHaveBeenCalledOnce());
	const competing = {
		...first,
		agentSession: { ...first.agentSession, id: "competing-session" },
	};
	await edge.handleAgentSessionCreatedWebhook(competing, [repository]);
	expect(route).toHaveBeenCalledOnce();
	release();
	await accepted;
	const receipt = edge.getLaunchAdmission().get("cli-workspace", "session");
	expect(receipt.launch.workflow.id).toBe("takeover");
	worker.restoreMappings(worker.serializeMappings());
	edge.launchAdmission = undefined; // Reload the actual on-disk journal.
	runtime.updateWorkflows(
		defaultWorkflows.map((w) =>
			w.id === "takeover" ? { ...w, allowedTriggers: [] } : w,
		),
	);
	const result = await edge.createCyrusAgentSession(
		"session",
		first.agentSession.issue,
		[repository],
		edge.agentSessionManager,
		"cli-workspace",
	);
	expect(result.launch.workflow.id).toBe("takeover");
	expect(result.session.triggerOrigin.selection.source).toBe(
		"comment-selector",
	);
	edge
		.getLaunchAdmission()
		.update(edge.getLaunchAdmission().get("cli-workspace", "session"), {
			phase: "started",
		});
	result.session.status = "complete";
	await edge.handleAgentSessionCreatedWebhook(first, [repository]);
	expect(createWorkspace).toHaveBeenCalledOnce();
	expect(route).toHaveBeenCalledOnce();
	const later = {
		...webhook("@Bob [workflow=simple] Later task"),
		agentSession: {
			...first.agentSession,
			id: "later-session",
			comment: {
				id: "later-comment",
				body: "@Bob [workflow=simple] Later task",
			},
		},
	};
	await edge.handleAgentSessionCreatedWebhook(later, [repository]);
	expect(route).toHaveBeenCalledTimes(2);
});
it("holds interrupted startup ownership until stop and permits a later distinct launch", async () => {
	const { edge, repository, activity } = setup();
	const route = vi
		.spyOn(edge, "routeAcceptedTicketLaunch")
		.mockImplementation(async () => {
			const receipt = edge.getLaunchAdmission().get("cli-workspace", "session");
			if (receipt)
				edge.getLaunchAdmission().update(receipt, { phase: "starting" });
			throw new Error("setup hook failed");
		});
	const first = webhook("@Bob [workflow=simple]");
	await edge.handleAgentSessionCreatedWebhook(first, [repository]);
	expect(edge.getLaunchAdmission().get("cli-workspace", "session").phase).toBe(
		"recovery",
	);
	const later = {
		...first,
		agentSession: { ...first.agentSession, id: "later-session" },
	};
	await edge.handleAgentSessionCreatedWebhook(later, [repository]);
	expect(route).toHaveBeenCalledOnce();
	expect(
		activity.mock.calls.some(([input]: any[]) =>
			input.content.body.includes("active run session"),
		),
	).toBe(true);
	await edge.handleUserPromptedAgentActivity({
		...first,
		action: "prompted",
		agentActivity: {
			id: "stop-activity",
			signal: "stop",
			content: { body: "stop" },
		},
	});
	await edge.handleAgentSessionCreatedWebhook(later, [repository]);
	expect(route).toHaveBeenCalledOnce(); // Redelivery of a rejected session stays rejected.
	await edge.handleAgentSessionCreatedWebhook(
		{ ...later, agentSession: { ...later.agentSession, id: "fresh-session" } },
		[repository],
	);
	expect(route).toHaveBeenCalledTimes(2);
});
it("applies prompted activities and stops once across restart", async () => {
	const { edge } = setup();
	const deliver = vi
		.spyOn(edge, "deliverUserPromptedAgentActivity")
		.mockResolvedValue(undefined);
	const event = {
		...webhook("@Bob original"),
		action: "prompted",
		agentActivity: { id: "activity", content: { body: "Answer" } },
	};
	await edge.handleUserPromptedAgentActivity(event);
	edge.launchAdmission = undefined;
	await edge.handleUserPromptedAgentActivity(event);
	expect(deliver).toHaveBeenCalledOnce();
	await edge.handleUserPromptedAgentActivity({
		...event,
		agentActivity: { id: "different", content: { body: "New answer" } },
	});
	expect(deliver).toHaveBeenCalledTimes(2);
	const stop = vi.spyOn(edge, "handleStopSignal").mockResolvedValue(undefined);
	const stopped = {
		...event,
		agentActivity: { id: "stop", signal: "stop", content: { body: "" } },
	};
	await edge.handleUserPromptedAgentActivity(stopped);
	await edge.handleUserPromptedAgentActivity(stopped);
	expect(stop).toHaveBeenCalledOnce();
});
it("releases completed-session ownership when a reply is rejected by its saved chat setting", async () => {
	const { edge, repository, activity } = setup();
	const route = vi
		.spyOn(edge, "routeAcceptedTicketLaunch")
		.mockResolvedValue(undefined);
	const original = webhook("@Bob [workflow=simple]");
	await edge.handleAgentSessionCreatedWebhook(original, [repository]);
	const { session } = await edge.createCyrusAgentSession(
		"session",
		original.agentSession.issue,
		[repository],
		edge.agentSessionManager,
		"cli-workspace",
	);
	session.status = "complete";
	session.workflowChat = false;
	const receipt = edge.getLaunchAdmission().get("cli-workspace", "session");
	edge.getLaunchAdmission().update(receipt, { phase: "started" });
	await edge.handleUserPromptedAgentActivity({
		...original,
		action: "prompted",
		agentActivity: { id: "disabled-chat", content: { body: "Continue" } },
	});
	expect(receipt.phase).toBe("started");
	expect(activity).toHaveBeenLastCalledWith(
		expect.objectContaining({
			content: expect.objectContaining({
				body: expect.stringMatching(/Chat was disabled/),
			}),
		}),
	);
	await edge.handleAgentSessionCreatedWebhook(
		{
			...original,
			agentSession: { ...original.agentSession, id: "new-session" },
		},
		[repository],
	);
	expect(route).toHaveBeenCalledTimes(2);
});
it("uses the graph's terminal state instead of its retained native session's active status", async () => {
	const { edge, runtime, repository } = setup();
	const route = vi
		.spyOn(edge, "routeAcceptedTicketLaunch")
		.mockResolvedValue(undefined);
	const original = webhook("@Bob [workflow=factory]");
	await edge.handleAgentSessionCreatedWebhook(original, [repository]);
	const { session, launch } = await edge.createCyrusAgentSession(
		"session",
		original.agentSession.issue,
		[repository],
		edge.agentSessionManager,
		"cli-workspace",
	);
	const run = runtime.create({
		id: "session",
		title: "Completed graph",
		repositoryId: "repo",
		workflow: launch.workflow,
		workflowDefinitions: launch.workflowDefinitions,
		triggerOrigin: session.triggerOrigin,
		workspace: session.workspace.path,
		input: "Original task",
		issueId: "issue",
		workspaceId: "cli-workspace",
	});
	run.status = "completed";
	runtime.save(run);
	expect(session.status).toBe("active");
	edge
		.getLaunchAdmission()
		.update(edge.getLaunchAdmission().get("cli-workspace", "session"), {
			phase: "started",
		});
	await edge.handleAgentSessionCreatedWebhook(
		{
			...original,
			agentSession: { ...original.agentSession, id: "new-session" },
		},
		[repository],
	);
	expect(route).toHaveBeenCalledTimes(2);
});

it.each([
	"recovery",
	"starting",
])("quarantines partial Factory startup after restoration (%s receipt)", async (phase) => {
	const { edge, worker, runtime, repository, activity } = setup();
	const event = webhook("@Bob [workflow=factory]");
	vi.spyOn(edge, "assemblePrompt").mockResolvedValue({
		userPrompt: "Original instructions",
	});
	edge.issueTrackers.get("cli-workspace").fetchComments = vi.fn(async () => {
		throw new Error("comments API unavailable");
	});
	vi.spyOn(edge, "routeAcceptedTicketLaunch").mockImplementation(async () => {
		await edge.initializeAgentRunner(
			event.agentSession,
			[repository],
			event.organizationId,
		);
	});
	await edge.handleAgentSessionCreatedWebhook(event, [repository]);
	const receipt = edge.getLaunchAdmission().get("cli-workspace", "session");
	expect(receipt.phase).toBe("recovery");
	expect(runtime.runs.has("session")).toBe(false);
	expect(
		edge.agentSessionManager.getSession("session").triggerOrigin.workflowId,
	).toBe("factory");
	edge.getLaunchAdmission().update(receipt, { phase });
	const saved = edge.agentSessionManager.serializeState();
	edge.agentSessionManager = new AgentSessionManager();
	edge.agentSessionManager.restoreState(saved.sessions, saved.entries);
	worker.restoreMappings(worker.serializeMappings());
	edge.launchAdmission = undefined;
	const resume = vi
		.spyOn(edge, "resumeAgentSession")
		.mockResolvedValue(undefined);
	edge.recoverFactoryRuns();
	edge.recoverPendingTicketLaunches();
	await vi.waitFor(() =>
		expect(activity).toHaveBeenLastCalledWith(
			expect.objectContaining({
				content: {
					type: "response",
					body: expect.stringMatching(/accepted workflow.*Send stop/),
				},
			}),
		),
	);
	expect(resume).not.toHaveBeenCalled();
	expect(edge.getLaunchAdmission().get("cli-workspace", "session").phase).toBe(
		"recovery",
	);
	await edge.handleUserPromptedAgentActivity({
		...event,
		action: "prompted",
		agentActivity: { id: "reply-after-restart", content: { body: "Continue" } },
	});
	expect(resume).not.toHaveBeenCalled();
	expect(activity).toHaveBeenLastCalledWith(
		expect.objectContaining({
			content: {
				type: "response",
				body: expect.stringMatching(/accepted workflow.*Send stop/),
			},
		}),
	);
	expect(runtime.runs.size).toBe(0);
	await edge.handleUserPromptedAgentActivity({
		...event,
		action: "prompted",
		agentActivity: {
			id: "stop-partial",
			signal: "stop",
			content: { body: "stop" },
		},
	});
	expect(edge.getLaunchAdmission().get("cli-workspace", "session").phase).toBe(
		"settled",
	);
});

it("settles Simple and pending launch ownership on unassignment, durably allowing a new assignment", async () => {
	const { edge, repository, fullIssue } = setup();
	const route = vi
		.spyOn(edge, "routeAcceptedTicketLaunch")
		.mockResolvedValue(undefined);
	const original = webhook("This thread is for an agent session");
	await edge.handleAgentSessionCreatedWebhook(original, [repository]);
	const { session } = await edge.createCyrusAgentSession(
		"session",
		original.agentSession.issue,
		[repository],
		edge.agentSessionManager,
		"cli-workspace",
	);
	const stop = vi.fn();
	session.agentRunner = { stop, isRunning: () => true };
	edge
		.getLaunchAdmission()
		.update(edge.getLaunchAdmission().get("cli-workspace", "session"), {
			phase: "started",
		});
	vi.spyOn(edge, "postComment").mockResolvedValue(undefined);
	await edge.handleIssueUnassigned(fullIssue, "cli-workspace");
	expect(stop).toHaveBeenCalledOnce();
	expect(session.status).toBe("error");
	edge.launchAdmission = undefined;
	expect(edge.getLaunchAdmission().get("cli-workspace", "session").phase).toBe(
		"settled",
	);
	await edge.handleAgentSessionCreatedWebhook(
		{ ...original, agentSession: { ...original.agentSession, id: "fresh" } },
		[repository],
	);
	expect(route).toHaveBeenCalledTimes(2);
	await edge.handleIssueUnassigned(fullIssue, "cli-workspace");
	edge.launchAdmission = undefined;
	edge.recoverPendingTicketLaunches();
	expect(edge.getLaunchAdmission().get("cli-workspace", "fresh").phase).toBe(
		"settled",
	);
	expect(route).toHaveBeenCalledTimes(2);
});

it.each([
	false,
	true,
])("does not start a cancelled Simple runner after persistence (streaming: %s)", async (streaming) => {
	const { edge, repository, fullIssue } = setup();
	const event = webhook("@Bob [workflow=simple]");
	vi.spyOn(edge, "assemblePrompt").mockResolvedValue({
		userPrompt: "Original instructions",
		metadata: { components: [], promptType: "initial" },
	});
	edge.issueTrackers.get("cli-workspace").fetchComments = vi.fn(async () => ({
		nodes: [],
	}));
	edge.issueTrackers.get("cli-workspace").fetchIssueAttachments = vi.fn(
		async () => [],
	);
	vi.spyOn(edge, "buildAgentRunnerConfig").mockResolvedValue({
		config: {},
		runnerType: "claude",
	});
	let running = false;
	const start = vi.fn(async () => {
		running = true;
		return { sessionId: "conversation" };
	});
	const stop = vi.fn(() => {
		running = false;
	});
	const runner = {
		supportsStreamingInput: streaming,
		isRunning: () => running,
		start,
		startStreaming: start,
		stop,
	};
	vi.spyOn(edge, "createRunnerForType").mockReturnValue(runner);
	vi.spyOn(edge, "postComment").mockResolvedValue(undefined);
	const route = vi
		.spyOn(edge, "routeAcceptedTicketLaunch")
		.mockImplementation(async () =>
			edge.initializeAgentRunner(
				event.agentSession,
				[repository],
				"cli-workspace",
			),
		);
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const save = edge.savePersistedState.bind(edge);
	let paused = false;
	vi.spyOn(edge, "savePersistedState").mockImplementation(async () => {
		if (
			!paused &&
			edge.agentSessionManager.getSession("session")?.agentRunner === runner
		) {
			paused = true;
			await gate;
		}
		await save();
	});
	const launch = edge.handleAgentSessionCreatedWebhook(event, [repository]);
	await vi.waitFor(() => expect(paused).toBe(true));
	await edge.handleIssueUnassigned(fullIssue, "cli-workspace");
	expect(stop).toHaveBeenCalledOnce();
	release();
	await launch;
	expect(start).not.toHaveBeenCalled();
	expect(running).toBe(false);
	edge.launchAdmission = undefined;
	expect(edge.getLaunchAdmission().get("cli-workspace", "session").phase).toBe(
		"settled",
	);
	await edge.handleAgentSessionCreatedWebhook(event, [repository]);
	expect(route).toHaveBeenCalledOnce();
	route.mockResolvedValue(undefined);
	await edge.handleAgentSessionCreatedWebhook(
		{ ...event, agentSession: { ...event.agentSession, id: "fresh-session" } },
		[repository],
	);
	expect(route).toHaveBeenCalledTimes(2);
});

it("deduplicates warm-runner stop redelivery while distinct stops still fully terminate", async () => {
	const { edge, repository } = setup();
	const event = webhook("@Bob [workflow=simple]");
	edge.captureTicketOrigin(event, true);
	const { session } = await edge.createCyrusAgentSession(
		"session",
		event.agentSession.issue,
		[repository],
		edge.agentSessionManager,
		"cli-workspace",
	);
	const interrupt = vi.fn(async () => {});
	const stop = vi.fn();
	session.agentRunner = {
		interrupt,
		stop,
		isWarm: () => true,
		isRunning: () => true,
	};
	const first = {
		...event,
		action: "prompted",
		agentActivity: {
			id: "first-stop",
			signal: "stop",
			content: { body: "stop" },
		},
	};
	await edge.handleUserPromptedAgentActivity(first);
	edge.launchAdmission = undefined;
	await edge.handleUserPromptedAgentActivity(first);
	expect(interrupt).toHaveBeenCalledOnce();
	expect(stop).not.toHaveBeenCalled();
	await edge.handleUserPromptedAgentActivity({
		...first,
		agentActivity: { ...first.agentActivity, id: "second-stop" },
	});
	expect(stop).toHaveBeenCalledOnce();
	expect(session.status).toBe("error");
});

it.each([
	"no-streaming",
	"no-input-method",
	"finishing",
	"stream-rejected",
])("rejects unsupported Simple steering without stopping active work: %s", async (kind) => {
	const { edge, repository, activity } = setup();
	const event = webhook("@Bob [workflow=simple]");
	edge.captureTicketOrigin(event, true);
	const { session } = await edge.createCyrusAgentSession(
		"session",
		event.agentSession.issue,
		[repository],
		edge.agentSessionManager,
		"cli-workspace",
	);
	const stop = vi.fn();
	const add = vi.fn(() => {
		if (kind === "stream-rejected")
			throw new Error("Turn no longer accepts steering");
	});
	session.agentRunner = {
		stop,
		isRunning: () => true,
		isStreaming: () => kind !== "finishing",
		supportsStreamingInput: kind !== "no-streaming",
		addStreamMessage: kind === "no-input-method" ? undefined : add,
	};
	vi.spyOn(edge, "postInstantPromptedAcknowledgment").mockResolvedValue(
		undefined,
	);
	edge.repositoryRouter.getIssueRepositoryCache().set("issue", [repository.id]);
	const resume = vi
		.spyOn(edge, "resumeAgentSession")
		.mockResolvedValue(undefined);
	await edge.handleUserPromptedAgentActivity({
		...event,
		action: "prompted",
		agentActivity: {
			id: "unsupported-reply",
			content: { body: "Change direction" },
		},
	});
	expect(stop).not.toHaveBeenCalled();
	expect(resume).not.toHaveBeenCalled();
	expect(activity).toHaveBeenLastCalledWith(
		expect.objectContaining({
			content: {
				type: "response",
				body: expect.stringMatching(
					/cannot receive|finishing|no longer accepts/,
				),
			},
		}),
	);
});

it("keeps supported steering and completed Simple continuation available", async () => {
	const { edge, repository } = setup();
	const event = webhook("@Bob [workflow=simple]");
	edge.captureTicketOrigin(event, true);
	const { session } = await edge.createCyrusAgentSession(
		"session",
		event.agentSession.issue,
		[repository],
		edge.agentSessionManager,
		"cli-workspace",
	);
	let running = true;
	const stop = vi.fn();
	const add = vi.fn();
	session.agentRunner = {
		stop,
		isRunning: () => running,
		isStreaming: () => true,
		supportsStreamingInput: true,
		addStreamMessage: add,
	};
	vi.spyOn(edge, "postInstantPromptedAcknowledgment").mockResolvedValue(
		undefined,
	);
	edge.repositoryRouter.getIssueRepositoryCache().set("issue", [repository.id]);
	const resume = vi
		.spyOn(edge, "resumeAgentSession")
		.mockResolvedValue(undefined);
	const reply = {
		...event,
		action: "prompted",
		agentActivity: {
			id: "supported-reply",
			content: { body: "Change direction" },
		},
	};
	await edge.handleUserPromptedAgentActivity(reply);
	expect(add).toHaveBeenCalledExactlyOnceWith("Change direction");
	expect(stop).not.toHaveBeenCalled();
	expect(resume).not.toHaveBeenCalled();
	running = false;
	session.status = "complete";
	await edge.handleUserPromptedAgentActivity({
		...reply,
		agentActivity: { ...reply.agentActivity, id: "completed-reply" },
	});
	expect(resume).toHaveBeenCalledOnce();
});

it("starts ticket Simple execution with its ID while independent title work is unresolved", async () => {
	const { edge, repository, fullIssue, runtime, home } = setup();
	edge.issueTrackers.get("cli-workspace").fetchComments = vi.fn(async () => ({
		nodes: [],
		pageInfo: { hasNextPage: false },
	}));
	edge.issueTrackers.get("cli-workspace").fetchIssueAttachments = vi.fn(
		async () => [],
	);
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
	// Naming is independent of origin transport; ticket access is covered separately.
	vi.spyOn(edge, "resolveFactoryTicket").mockResolvedValue(undefined);
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
	await vi.waitFor(() => expect(run.status).toBe("completed"), {
		timeout: 10000,
	});
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

it("retries only failed naming with current settings without restarting execution", () => {
	const { edge, runtime, home } = setup();
	const session = edge.agentSessionManager.createChatSession(
		"retry-title",
		{ path: home, isGitWorktree: false },
		"slack",
	);
	const primary = { isRunning: () => true, stop: vi.fn() };
	session.agentRunner = primary;
	session.titleGeneration = {
		state: "failed",
		prepared: true,
		retries: 1,
		error: "Title generation timed out",
		context: "Original task",
		platform: "slack",
		settings: { runner: "claude" },
	};
	edge.titleStarted.add(session.id);
	const start = vi.fn();
	edge.titleGenerator = { start, shutdown: async () => {} };
	runtime.updateTitleSettings({
		runner: "codex",
		model: "current-title-model",
		reasoningEffort: "low",
	});
	edge.retryRunTitle(session.id);
	expect(start).toHaveBeenCalledExactlyOnceWith(session.id, {
		state: "pending",
		prepared: true,
		retries: 0,
		error: undefined,
		context: "Original task",
		platform: "slack",
		settings: {
			runner: "codex",
			model: "current-title-model",
			modelReasoningEffort: "low",
		},
	});
	expect(session.agentRunner).toBe(primary);
	expect(primary.stop).not.toHaveBeenCalled();
	expect(() => edge.retryRunTitle(session.id)).toThrow(
		"Only failed title generation",
	);
	expect(start).toHaveBeenCalledOnce();
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
	await vi.waitFor(() => expect(run.status).toBe("completed"), {
		timeout: 10000,
	});
	expect(start).not.toHaveBeenCalled();
	expect(run.titleGeneration).toBeUndefined();
	expect(run.title).toBe("Original historical title");
	expect(run.sessionSnapshot.displayTitle).toBe(run.title);

	// A second retry must also preserve the saved historical identity.
	run.status = "failed";
	runtime.retry(run.id);
	await vi.waitFor(() => expect(run.status).toBe("completed"), {
		timeout: 10000,
	});
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
	await vi.waitFor(() => expect(run.status).toBe("completed"), {
		timeout: 10000,
	});
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

async function nativeManualFixture() {
	const f = setup();
	const tracker = new CLIIssueTrackerService();
	tracker.seedDefaultData();
	const issue = await tracker.createIssue({
		teamId: "team-default",
		title: "Native ticket",
	});
	const data = tracker.getState().issues.get(issue.id)!;
	data.url = `https://linear.app/test/issue/${issue.identifier}`;
	data.branchName = "not-yet-created-ticket-head";
	f.edge.issueTrackers.set("cli-workspace", tracker);
	const workflow = {
		id: "native-fixture",
		name: "Native fixture",
		allowedTriggers: ["manual"],
		steps: [{ id: "work", name: "Work", type: "script", script: "true" }],
	};
	f.runtime.updateWorkflows([...f.runtime.listWorkflows(), workflow]);
	f.edge.titleGenerator = { start() {}, cancel() {}, async shutdown() {} };
	const worktree = vi
		.spyOn(f.edge.gitService, "createGitWorktree")
		.mockImplementation(
			async (_issue: unknown, _repos: unknown, options: any) => ({
				path: f.home,
				isGitWorktree: false,
				resolvedBaseBranches: {
					repo: { branch: options.baseBranchOverrides?.get("repo") ?? "main" },
				},
			}),
		);
	return {
		...f,
		tracker,
		issue: await tracker.fetchIssue(issue.id),
		workflow,
		worktree,
	};
}

it.each([
	"native-fixture",
	"takeover",
])("uses native ticket heads only for Takeover base selection: %s", async (workflowId) => {
	const f = await nativeManualFixture();
	// Only preparation is needed; the stock Takeover agent must not execute.
	const workflow = f.runtime.selectWorkflow([], "manual", workflowId);
	const input = resolveLaunchRequest(workflow, {
		repositoryId: "repo",
		workflow: workflowId,
		...(workflowId === "takeover"
			? { source: f.issue.url }
			: { inputs: { prompt: f.issue.url } }),
	});
	const run = f.runtime.create({
		triggerOrigin: {
			type: "manual",
			workflowId,
			at: new Date().toISOString(),
		},
		repositoryId: "repo",
		workflow,
		workspace: "",
		input: f.issue.url,
	});
	await f.edge.prepareManualFactoryRun(
		run,
		input,
		new AbortController().signal,
	);
	expect(f.worktree.mock.calls[0][2].baseBranchOverrides?.get("repo")).toBe(
		workflowId === "takeover" ? f.issue.branchName : undefined,
	);
	expect(run.outputs.repository.baseBranch).toBe("main");
});

it("retains the parent's native origin when follow-up instructions name another ticket before a PR exists", async () => {
	const f = await nativeManualFixture();
	const other = await f.tracker.createIssue({
		teamId: "team-default",
		title: "Unrelated",
		stateId: "state-todo",
	});
	f.tracker
		.getState()
		.issues.get(
			other.id,
		)!.url = `https://linear.app/test/issue/${other.identifier}`;
	const parent = f.runtime.create({
		triggerOrigin: {
			type: "manual",
			workflowId: "native-fixture",
			at: new Date().toISOString(),
		},
		repositoryId: "repo",
		workflow: f.workflow,
		workspace: f.home,
		input: f.issue.url,
	});
	parent.status = "completed";
	parent.ticketReference = {
		provider: "native",
		platform: "cli",
		workspaceId: "cli-workspace",
		id: f.issue.id,
		url: f.issue.url,
	};
	f.runtime.save(parent);
	const run = await f.edge.startManualFactoryRun(
		resolveLaunchRequest(f.workflow, {
			repositoryId: "repo",
			workflow: f.workflow.id,
			inputs: {
				prompt: `Ticket: https://linear.app/test/issue/${other.identifier}`,
			},
		}),
		parent.id,
	);
	await vi.waitFor(
		() => expect(["completed", "failed"]).toContain(run.status),
		{ timeout: 10000 },
	);
	expect(run.error).toBeUndefined();
	expect(run.status).toBe("completed");
	expect(run.ticketReference).toEqual(parent.ticketReference);
	expect(run.issueId).toBe(f.issue.id);
	expect(run.outputs.ticket.id).toBe(f.issue.id);
	expect((await (await f.tracker.fetchIssue(f.issue.id)).state)?.type).toBe(
		"started",
	);
	expect((await f.tracker.fetchComments(other.id)).nodes).toHaveLength(0);
	expect((await (await f.tracker.fetchIssue(other.id)).state)?.type).toBe(
		"unstarted",
	);
});

it("discovers Taskbot from the accepted Cursor runner despite the default Claude runner", async () => {
	const f = setup();
	mkdirSync(join(f.home, ".cursor"));
	writeFileSync(
		join(f.home, ".cursor", "mcp.json"),
		JSON.stringify({
			mcpServers: {
				taskbot: { type: "http", url: "https://taskbot.example/mcp" },
			},
		}),
	);
	const run = f.runtime.create({
		triggerOrigin: {
			type: "manual",
			workflowId: "factory",
			at: new Date().toISOString(),
		},
		repositoryId: "repo",
		workflow: defaultWorkflows.find((w) => w.id === "factory")!,
		workspace: f.home,
		input: "https://taskbot.example/p/fixture/t/77",
		runner: "cursor",
	});
	f.edge.agentSessionManager.createChatSession(
		run.id,
		{ path: f.home, isGitWorktree: false },
		"manual",
		[],
	);
	vi.spyOn(f.edge, "buildAgentRunnerConfig").mockResolvedValue({
		runnerType: "claude",
		config: {},
	});
	expect((await f.edge.factoryMcpConfig(run)).servers.taskbot).toEqual({
		type: "http",
		url: "https://taskbot.example/mcp",
	});
});

it("reconstructs missing legacy merged receipts during tracking-only retry after source access recovers", async () => {
	const f = await nativeManualFixture();
	const run = f.runtime.create({
		triggerOrigin: {
			type: "manual",
			workflowId: "native-fixture",
			at: new Date().toISOString(),
		},
		repositoryId: "repo",
		workflow: f.workflow,
		workspace: f.home,
		input: f.issue.url,
	});
	run.status = "completed";
	run.outputs.merge = {
		merged: true,
		url: "https://github.com/org/repo/pull/1",
	};
	const history = structuredClone(run.history);
	const fetch = f.tracker.fetchIssue.bind(f.tracker);
	const unavailable = vi
		.spyOn(f.tracker, "fetchIssue")
		.mockRejectedValue(new Error("offline"));
	await f.edge.recoverFactoryTicketTracking(run);
	expect(run.ticketSync).toBeUndefined();
	unavailable.mockImplementation(fetch);
	await f.runtime.retryTracking(run.id);
	expect(run.ticketSync?.receipts[0]?.delivered).toBe(true);
	expect((await (await f.tracker.fetchIssue(f.issue.id)).state)?.type).toBe(
		"completed",
	);
	expect(run.history).toEqual(history);
	expect(f.worktree).not.toHaveBeenCalled();
	const comments = (await f.tracker.fetchComments(f.issue.id)).nodes.length;
	await f.runtime.retryTracking(run.id);
	expect((await f.tracker.fetchComments(f.issue.id)).nodes).toHaveLength(
		comments,
	);
	expect(await f.tracker.fetchIssueAttachments(f.issue.id)).toHaveLength(1);
});

it.each([
	"failed",
	"stopped",
	"completed",
	"interrupted",
] as const)("does not manufacture restart comments for historical %s runs", async (status) => {
	const f = await nativeManualFixture();
	await f.tracker.updateIssue(f.issue.id, { stateId: "state-done" });
	const run = f.runtime.create({
		repositoryId: "repo",
		workflow: f.workflow,
		workspace: join(f.home, "removed-worktree"),
		input: f.issue.url,
		triggerOrigin: {
			type: "manual",
			workflowId: f.workflow.id,
			at: new Date().toISOString(),
		},
	});
	run.status = status;
	run.step = "assess-existing";
	run.error =
		"Saved worktree is unavailable; recovery cannot recreate unfinished work";
	f.runtime.save(run);
	const fetch = vi.spyOn(f.tracker, "fetchIssue");
	await f.edge.recoverFactoryTicketTracking(run);
	await f.edge.recoverFactoryTicketTracking(run);
	expect((await f.tracker.fetchComments(f.issue.id)).nodes).toHaveLength(0);
	fetch.mockClear();
	await f.edge.recoverFactoryTicketTracking(run);
	expect(fetch).not.toHaveBeenCalled();
	expect(run.ticketSync).toBeUndefined();
	expect((await (await f.tracker.fetchIssue(f.issue.id)).state)?.type).toBe(
		"completed",
	);
	expect(f.worktree).not.toHaveBeenCalled();
});

it.each([
	"state-done",
	"state-canceled",
])("suppresses pending native progress on %s tickets and leaves subsequent recovery idle", async (stateId) => {
	const f = await nativeManualFixture();
	await f.tracker.updateIssue(f.issue.id, { stateId });
	const run = f.runtime.create({
		repositoryId: "repo",
		workflow: f.workflow,
		workspace: f.home,
		input: f.issue.url,
		triggerOrigin: {
			type: "manual",
			workflowId: f.workflow.id,
			at: new Date().toISOString(),
		},
	});
	run.status = "failed";
	run.ticketSync = {
		receipts: [
			{
				key: "legacy-current:1",
				body: "Recovered ticket tracking",
				stage: "in_progress",
			},
		],
	};
	await f.edge.recoverFactoryTicketTracking(run);
	expect((await f.tracker.fetchComments(f.issue.id)).nodes).toHaveLength(0);
	expect((await (await f.tracker.fetchIssue(f.issue.id)).state)?.id).toBe(
		stateId,
	);
	expect(run.ticketSync.receipts[0].superseded).toBe(true);
	const fetch = vi.spyOn(f.tracker, "fetchIssue");
	await f.edge.recoverFactoryTicketTracking(run);
	expect(fetch).not.toHaveBeenCalled();
});
