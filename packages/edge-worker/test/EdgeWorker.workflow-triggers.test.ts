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
