import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionStatus } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "native-recovery-"));
	homes.push(home);
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		tool: async () => ({}),
		script: async () => ({}),
	});
	const session: any = {
		id: "native",
		status: AgentSessionStatus.Error,
		codexSessionId: "saved-thread",
		triggerOrigin: { workflowId: "simple" },
		repositories: [{ repositoryId: "repo" }],
		metadata: {
			workflowPendingPrompt: {
				body: "Continue saved work",
				attachmentManifest: "note.txt",
				commentAuthor: "Author",
				commentTimestamp: "2026-10-10T00:00:00Z",
			},
		},
	};
	const receipt: any = {
		key: "receipt",
		sessionId: session.id,
		phase: "recovery",
		webhook: {
			organizationId: "workspace",
			agentSession: { id: session.id, issue: { id: "issue" } },
		},
		origin: { ticket: { issueId: "issue" } },
		launch: {
			workflow: runtime.selectWorkflow([], "manual", "simple"),
			workflowDefinitions: runtime.listWorkflows(),
		},
	};
	const admission = {
		values: () => [receipt],
		get: () => receipt,
		update: (_: any, patch: any) => Object.assign(receipt, patch),
	};
	const block = {
		workflowIds: ["simple"],
		at: "2026-10-10T00:00:00Z",
		priorStatus: "active",
		reason: "Workflow disabled; Resume individually",
	};
	runtime.catalog.block(session.id, block);
	const repository = { id: "repo", linearWorkspaceId: "workspace" };
	const worker: any = Object.create(EdgeWorker.prototype);
	Object.assign(worker, {
		factoryRuntime: runtime,
		launchAdmission: admission,
		getFactoryRuntime: () => runtime,
		getLaunchAdmission: () => admission,
		titleSession: () => session,
		chatHandlerForSession: () => undefined,
		agentSessionManager: { getSession: () => session },
		repositories: new Map([["repo", repository]]),
		sessionRepositories: new Map([[session.id, "repo"]]),
		preparationStarts: new Map(),
		inFlightTicketStarts: new Set(),
		pendingTriggerOrigins: new Map(),
		savePersistedState: vi.fn(async () => {}),
		emit: vi.fn(),
		ticketLaunchFeedback: vi.fn(async () => {}),
		preflightTicketLaunch: vi.fn(async () => {}),
		routeAcceptedTicketLaunch: vi.fn(async () => {}),
		resumeAgentSession: vi.fn(async () => {}),
	});
	return { worker, runtime, session, receipt, repository, block };
}
it.each([
	"claudeSessionId",
	"codexSessionId",
	"geminiSessionId",
	"cursorSessionId",
	"opencodeSessionId",
])("resumes retained %s and pending attachments instead of replaying startup", async (key) => {
	const { worker, session, receipt, repository, runtime } = fixture();
	delete session.codexSessionId;
	session[key] = "saved-thread";
	expect(worker.ticketStartupIsIncomplete(session)).toBe(false);
	await worker.resumeNativeWorkflow(session.id);
	expect(worker.routeAcceptedTicketLaunch).not.toHaveBeenCalled();
	expect(worker.resumeAgentSession).toHaveBeenCalledWith(
		session,
		repository,
		session.id,
		worker.agentSessionManager,
		"Continue saved work",
		"note.txt",
		false,
		[],
		"workspace",
		undefined,
		"Author",
		"2026-10-10T00:00:00Z",
	);
	expect(session[key]).toBe("saved-thread");
	expect(receipt.phase).toBe("recovery");
	expect(runtime.catalog.getBlock(session.id)).toBeUndefined();
});
it("keeps block, pending input and admission ownership when the saved repository is missing", async () => {
	const { worker, runtime, session, receipt, block } = fixture();
	worker.repositories.clear();
	const pending = structuredClone(session.metadata.workflowPendingPrompt);
	await expect(worker.resumeNativeWorkflow(session.id)).rejects.toThrow(
		"Session repository is unavailable",
	);
	expect(runtime.catalog.getBlock(session.id)).toEqual(block);
	expect(receipt.phase).toBe("recovery");
	expect(session.metadata.workflowPendingPrompt).toEqual(pending);
	expect(worker.resumeAgentSession).not.toHaveBeenCalled();
});
it.each([
	"preflight",
	"routing",
	"incomplete",
])("propagates %s startup failure and restores the block", async (stage) => {
	const { worker, runtime, session, receipt, block } = fixture();
	delete session.codexSessionId;
	if (stage === "preflight")
		worker.preflightTicketLaunch.mockRejectedValue(
			new Error("Ticket unavailable"),
		);
	if (stage === "routing")
		worker.routeAcceptedTicketLaunch.mockRejectedValue(
			new Error("Repository unavailable"),
		);
	await expect(worker.resumeNativeWorkflow(session.id)).rejects.toThrow(
		stage === "incomplete" ? "Ticket startup did not complete" : "unavailable",
	);
	expect(runtime.catalog.getBlock(session.id)).toEqual(block);
	expect(receipt.phase).toBe("recovery");
	expect(worker.inFlightTicketStarts.size).toBe(0);
	expect(worker.resumeAgentSession).not.toHaveBeenCalled();
});
it("does not report interrupted continuation as unfinished startup after restoration", () => {
	const { worker, runtime, session } = fixture();
	runtime.catalog.clearBlock(session.id);
	worker.recoverPendingTicketLaunches();
	expect(worker.ticketLaunchFeedback).not.toHaveBeenCalled();
	expect(worker.routeAcceptedTicketLaunch).not.toHaveBeenCalled();
});
it("rejects unmatched repository routing during startup recovery without settling ownership", async () => {
	const { worker, runtime, session, receipt, block } = fixture();
	delete session.codexSessionId;
	worker.getCachedRepositories = () => undefined;
	worker.repositoryRouter = {
		determineRepositoryForWebhook: async () => ({ type: "none" }),
	};
	worker.settleTicketLaunch = vi.fn();
	worker.routeAcceptedTicketLaunch = (
		EdgeWorker.prototype as any
	).routeAcceptedTicketLaunch.bind(worker);
	await expect(worker.resumeNativeWorkflow(session.id)).rejects.toThrow(
		"Session repository is unavailable",
	);
	expect(worker.settleTicketLaunch).not.toHaveBeenCalled();
	expect(runtime.catalog.getBlock(session.id)).toEqual(block);
	expect(receipt.phase).toBe("recovery");
});
