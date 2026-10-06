import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIIssueTrackerService } from "cyrus-core";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { TakeoverSourceSchema } from "../src/factory/Takeover.js";
import {
	nativeAdapter,
	originatingTicket,
	type TicketSnapshot,
	TicketTracking,
	taskbotAdapter,
	taskbotServer,
	taskbotSource,
} from "../src/factory/TicketTracking.js";
import {
	type FactoryRun,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";

const homes: string[] = [];
const services: TicketTracking[] = [];
afterEach(() => {
	for (const s of services.splice(0)) s.stop();
	for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
const source = "https://taskbot.example/p/project-a/t/77";
const ref = { ...taskbotSource(source)!, server: "taskbot" };
function fixture() {
	let ticket: TicketSnapshot = {
		id: 77,
		project: "project-a",
		status: "backlog",
		body: "Scope",
		comments: [],
		attachments: [],
	};
	const calls: { tool: string; args: Record<string, unknown> }[] = [];
	const call = vi.fn(async (tool: string, args: Record<string, unknown>) => {
		calls.push({ tool, args });
		if (tool === "set_status") {
			if (args.from !== ticket.status) throw new Error("conflict");
			ticket.status = args.to;
		}
		if (tool === "comment") ticket.comments.push({ body: String(args.body) });
		if (tool === "add_attachment")
			ticket.attachments.push({ url: String(args.url) });
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(tool === "get_ticket" ? ticket : { ok: true }),
				},
			],
		};
	});
	const adapter = taskbotAdapter(ref, call);
	const home = mkdtempSync(join(tmpdir(), "factory-ticket-"));
	homes.push(home);
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const run = runtime.create({
		repositoryId: "repo",
		workflow: defaultWorkflows.find((w) => w.id === "factory")!,
		workspace: home,
		input: source,
		triggerOrigin: {
			type: "manual",
			workflowId: "factory",
			at: new Date().toISOString(),
		},
	});
	run.ticketReference = ref;
	const service = new TicketTracking(
		async () => adapter,
		(r) => runtime.save(r),
		(r, m) => runtime.log(r, "ticket-sync", m),
	);
	services.push(service);
	return {
		get ticket() {
			return ticket;
		},
		set ticket(t) {
			ticket = t;
		},
		call,
		calls,
		adapter,
		service,
		run,
		runtime,
		home,
	};
}
it("resolves only designated origins, preserves instance/project, and rejects ambiguity", () => {
	expect(originatingTicket(source)).toBe(source);
	expect(originatingTicket(`Task source: ${source}`)).toBe(source);
	expect(
		originatingTicket(
			`Example:\n> ${source}\n\`\`\`\n${source}\n\`\`\`\nHistorical discussion linked ${source}`,
		),
	).toBeUndefined();
	expect(() =>
		originatingTicket(`${source}\nhttps://taskbot.example/p/project-b/t/77`),
	).toThrow(/Multiple/);
	expect(originatingTicket(source, "TEST-1")).toBe("TEST-1");
	expect(originatingTicket("Ticket: http://unsupported.example/ticket/1")).toBe(
		"http://unsupported.example/ticket/1",
	);
	expect(taskbotSource(source)).toEqual({
		provider: "taskbot",
		instance: "https://taskbot.example",
		project: "project-a",
		id: 77,
		url: source,
	});
	expect(TakeoverSourceSchema.parse(source)).toBe(source);
	expect(
		taskbotServer(ref.instance, {
			other: { type: "http", url: "https://other.example/mcp" },
			taskbot: { type: "http", url: "https://taskbot.example/mcp" },
		}),
	).toBe("taskbot");
	expect(() =>
		taskbotServer(ref.instance, {
			taskbot: { type: "http", url: "https://other.example/mcp" },
		}),
	).toThrow(/found 0/);
});
it("delivers progress and one canonical PR attachment; only confirmed merge establishes Done", async () => {
	const f = fixture();
	await f.service.record(f.run, {
		key: "start",
		body: "Started",
		stage: "in_progress",
	});
	await f.service.record(f.run, {
		key: "pr",
		body: "Review underway",
		stage: "in_progress",
		pr: "https://github.com/org/repo/pull/1",
	});
	await f.service.record(f.run, {
		key: "review",
		body: "Approve in Factory",
		stage: "in_review",
		pr: "https://github.com/org/repo/pull/1/",
	});
	await f.service.record(f.run, {
		key: "queued",
		body: "Queue pending",
		stage: "in_review",
	});
	expect(f.ticket.status).toBe("in_review");
	await expect(
		f.service.record(f.run, { key: "bad", body: "Completed", stage: "done" }),
	).rejects.toThrow(/confirmed merge/);
	await f.service.record(f.run, {
		key: "merged",
		body: "Provider confirmed merge",
		stage: "done",
		merged: true,
	});
	await f.service.record(f.run, {
		key: "old",
		body: "Late start",
		stage: "in_progress",
	});
	expect(f.ticket.status).toBe("done");
	expect(f.ticket.attachments).toHaveLength(1);
	expect(
		f.calls
			.filter((c) => ["set_status", "comment"].includes(c.tool))
			.every((c) => c.args.author === "bobs-factory"),
	).toBe(true);
});
it("recovers ambiguous comments after restart without duplicate comments or stage regression", async () => {
	const f = fixture();
	const original = f.call.getMockImplementation()!;
	let lost = false;
	f.call.mockImplementation(async (tool, args) => {
		const result = await original(tool, args);
		if (tool === "comment" && !lost) {
			lost = true;
			throw new Error("response lost");
		}
		return result;
	});
	await f.service.record(f.run, {
		key: "start",
		body: "Started",
		stage: "in_progress",
	});
	expect(f.run.ticketSync?.error).toMatch(/response lost/);
	expect(f.ticket.comments).toHaveLength(1);
	const restored = new WorkflowRuntime(f.home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	}).get(f.run.id);
	await f.service.flush(restored);
	expect(restored.ticketSync?.error).toBeUndefined();
	expect(f.ticket.comments).toHaveLength(1);
	f.call.mockImplementation(async () => {
		throw new Error("offline");
	});
	await f.service.record(restored, {
		key: "old-review",
		body: "Review",
		stage: "in_review",
	});
	f.call.mockImplementation(original);
	await f.service.record(restored, {
		key: "merged",
		body: "Merged",
		stage: "done",
		merged: true,
	});
	expect(
		restored.ticketSync?.receipts.find((r) => r.key === "old-review")
			?.superseded,
	).toBe(true);
	expect(f.ticket.status).toBe("done");
});
it("rereads status conflicts and does not blindly retry, accepting verified already-applied state", async () => {
	const f = fixture();
	const original = f.call.getMockImplementation()!;
	f.call.mockImplementation(async (tool, args) => {
		if (tool === "set_status") {
			f.ticket.status = "todo";
			throw new Error("conflict");
		}
		return original(tool, args);
	});
	await f.service.record(f.run, {
		key: "start",
		body: "Started",
		stage: "in_progress",
	});
	expect(f.run.ticketSync?.receipts[0]?.conflict).toBe(true);
	const n = f.calls.length;
	await f.service.flush(f.run);
	expect(f.calls).toHaveLength(n);
	f.call.mockImplementation(async (tool, args) => {
		if (tool === "set_status") {
			f.ticket.status = args.to;
			throw new Error("response lost");
		}
		return original(tool, args);
	});
	await f.service.flush(f.run, true);
	expect(f.run.ticketSync?.receipts[0]?.delivered).toBe(true);
});
it("retains cancelled tickets and fails closed for mismatched/partial context", async () => {
	const f = fixture();
	f.ticket.status = "cancelled";
	await f.service.record(f.run, {
		key: "start",
		body: "Started",
		stage: "in_progress",
	});
	expect(f.ticket.status).toBe("cancelled");
	expect(f.run.ticketSync?.receipts[0]?.limitation).toMatch(/Terminal/);
	f.ticket.project = "another";
	await expect(f.adapter.read()).rejects.toThrow(/another project/);
	f.ticket.project = "project-a";
	f.ticket.nextOffset = 50;
	await expect(f.adapter.read()).rejects.toThrow(/partial/);
});
it("uses ticket team states, native links and a nonterminal fallback when Review is unavailable", async () => {
	const tracker = new CLIIssueTrackerService();
	tracker.seedDefaultData();
	const issue = await tracker.createIssue({
		teamId: "team-default",
		title: "Native",
	});
	const adapter = nativeAdapter(
		{
			provider: "native",
			platform: "cli",
			workspaceId: "cli",
			id: issue.id,
			url: issue.url,
		},
		tracker,
	);
	await adapter.stage("in_progress", await adapter.read());
	const limitation = await adapter.stage("in_review", await adapter.read());
	expect(limitation).toMatch(/no in_review/);
	expect((await (await tracker.fetchIssue(issue.id)).state)?.type).toBe(
		"started",
	);
	await adapter.link("https://github.com/org/repo/pull/1");
	await adapter.link("https://github.com/org/repo/pull/1");
	expect((await adapter.read()).attachments).toHaveLength(1);
	await adapter.stage("done", await adapter.read());
	expect((await (await tracker.fetchIssue(issue.id)).state)?.type).toBe(
		"completed",
	);
});
it("serializes concurrent updates to the same provider ticket", async () => {
	const f = fixture();
	const other = { ...f.run, id: "other", ticketSync: undefined } as FactoryRun;
	await Promise.all([
		f.service.record(f.run, {
			key: "start",
			body: "Started",
			stage: "in_progress",
		}),
		f.service.record(other, {
			key: "review",
			body: "Review",
			stage: "in_review",
		}),
	]);
	expect(f.ticket.status).toBe("in_review");
	expect(f.ticket.comments).toHaveLength(2);
});

it("classifies historical merge, pending, partial, deferred and ambiguous outcomes", async () => {
	const { classifyTicketRepair } = await import(
		"../src/factory/TicketTracking.js"
	);
	expect(
		classifyTicketRepair({
			associated: true,
			pr: { state: "MERGED", mergedAt: "2026-10-06" },
		}).stage,
	).toBe("done");
	expect(
		classifyTicketRepair({
			associated: true,
			runStatus: "completed",
			pr: { state: "OPEN" },
			step: "pipeline/merge",
		}).stage,
	).toBe("in_review");
	expect(
		classifyTicketRepair({
			associated: true,
			runStatus: "failed",
			pr: { state: "OPEN" },
			step: "pipeline/implement",
		}).stage,
	).toBe("in_progress");
	expect(
		classifyTicketRepair({
			associated: true,
			deferred: true,
			runStatus: "completed",
		}).stage,
	).toBeUndefined();
	expect(
		classifyTicketRepair({
			associated: false,
			pr: { state: "MERGED", mergedAt: "2026-10-06" },
		}).stage,
	).toBeUndefined();
	expect(
		classifyTicketRepair({
			associated: true,
			runStatus: "completed",
			pr: { state: "CLOSED" },
		}).stage,
	).toBeUndefined();
});

it("applies the configured MCP allow and deny restrictions", async () => {
	const { assertFactoryToolAllowed } = await import("../src/EdgeWorker.js");
	expect(() =>
		assertFactoryToolAllowed(
			"mcp__taskbot__get_ticket",
			["mcp__taskbot__*"],
			[],
		),
	).not.toThrow();
	expect(() =>
		assertFactoryToolAllowed(
			"mcp__taskbot__comment",
			["mcp__taskbot__get_ticket"],
			[],
		),
	).toThrow(/restricted/);
	expect(() =>
		assertFactoryToolAllowed(
			"mcp__taskbot__comment",
			["mcp__taskbot__*"],
			["mcp__taskbot__comment"],
		),
	).toThrow(/restricted/);
});

it("preserves a status changed outside the run until ownership is reassessed", async () => {
	const f = fixture();
	await f.service.record(f.run, {
		key: "start",
		body: "Started",
		stage: "in_progress",
	});
	f.ticket.status = "todo";
	await f.service.record(f.run, {
		key: "review",
		body: "Review",
		stage: "in_review",
	});
	expect(f.ticket.status).toBe("todo");
	expect(f.run.ticketSync?.receipts.at(-1)?.conflict).toBe(true);
	await f.service.flush(f.run, true);
	expect(f.ticket.status).toBe("in_review");
});
