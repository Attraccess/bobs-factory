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
it("retains original mention context across delayed replies and original Simple serialization", async () => {
	const { edge, worker, repository } = setup();
	const original = webhook("@Bob implement this");
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
			subtype: "mention",
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
