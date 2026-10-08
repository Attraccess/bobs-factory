import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIIssueTrackerService } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { TakeoverSourceSchema } from "../src/factory/Takeover.js";
import {
	ensureTicketTranscript,
	nativeAdapter,
	originatingTicket,
	type TicketSnapshot,
	TicketTracking,
	taskbotAdapter,
	taskbotServer,
	taskbotSource,
} from "../src/factory/TicketTracking.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
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
it.each([
	"question",
	"answer",
	"reason",
	"removed",
	"unchanged",
	"legacy",
] as const)("delivers restored assistance once per question batch (%s)", async (changed) => {
	const f = fixture();
	const output = {
		approved: false,
		qaBlocked: true,
		questions: ["Which fixture account is ready?"],
		questionRecommendations: [
			{ questionIndex: 0, answer: "Restore access", reason: "QA needs access" },
		],
	};
	let trackedWaits = 0;
	const hooks = {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => structuredClone(output),
		track: async (
			run: FactoryRun,
			milestone: Parameters<TicketTracking["record"]>[1],
		) => {
			await f.service.record(run, milestone);
			if (milestone.key.startsWith("questions:")) trackedWaits++;
		},
	};
	let runtime = new WorkflowRuntime(f.home, hooks);
	const definition = validateWorkflows([
		...defaultWorkflows,
		{
			id: "qa-assistance",
			name: "QA assistance",
			steps: [
				{ id: "capture", name: "Capture", type: "agent", prompt: "Mock" },
				{ id: "visual-review", name: "Review", type: "agent", prompt: "Mock" },
				{
					id: "visual-gate",
					name: "Gate",
					type: "tool",
					tool: "visual-gate",
					qaContract: "qa-v1",
					next: "end",
				},
			],
		},
	]).at(-1)!;
	const run = runtime.create({
		repositoryId: "repo",
		workspace: f.home,
		input: source,
		workflow: definition,
		triggerOrigin: {
			type: "manual",
			workflowId: definition.id,
			at: new Date().toISOString(),
		},
	});
	run.ticketReference = ref;
	const comments = () =>
		f.ticket.comments.filter((c) =>
			c.body.startsWith("Factory needs assistance:"),
		);
	const wait = (count: number) =>
		vi.waitFor(() => {
			expect(runtime.get(run.id).status).toBe("waiting");
			expect(trackedWaits).toBe(count);
			expect(
				runtime.get(run.id).ticketSync?.receipts.every((r) => r.delivered),
			).toBe(true);
		});
	try {
		void runtime.launch(run);
		await wait(1);
		expect(comments()).toHaveLength(1);
		const original = run.questionBatchId;
		await runtime.shutdown();
		if (changed === "legacy") {
			run.ticketSync!.receipts.find((r) =>
				r.key.startsWith("questions:"),
			)!.key = `questions:${run.step}:${run.answers.length}`;
			runtime.save(run);
		} else if (changed === "question")
			output.questions[0] = "Which replacement account is ready?";
		else if (changed === "removed") output.questionRecommendations = [];
		else if (changed !== "unchanged")
			output.questionRecommendations[0]![changed] = "Updated guidance";
		for (let restart = 0; restart < 2; restart++) {
			runtime = new WorkflowRuntime(f.home, hooks);
			runtime.resumeAll();
			await wait(restart + 2);
			const replaced = !["unchanged", "legacy"].includes(changed);
			expect(comments()).toHaveLength(replaced ? 2 : 1);
			if (replaced) {
				expect(runtime.get(run.id).questionBatchId).not.toBe(original);
				expect(comments().at(-1)!.body).not.toBe(comments()[0]!.body);
			} else expect(runtime.get(run.id).questionBatchId).toBe(original);
			expect(runtime.get(run.id).answers).toEqual([]);
			await runtime.shutdown();
		}
	} finally {
		await runtime.shutdown();
	}
});
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
it("resolves uploaded Taskbot files and retains metadata through lifecycle synchronization", async () => {
	const f = fixture();
	const file = {
		id: 100,
		ticket_id: 77,
		kind: "file",
		url: null,
		filename: "screenshot.png",
		mime: "image/png",
		size: 1471794,
		title: "Screenshot",
	};
	const original = f.call.getMockImplementation()!;
	f.call.mockImplementation(async (tool, args) => {
		if (tool === "get_ticket")
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							...f.ticket,
							attachments: [file, ...f.ticket.attachments],
						}),
					},
				],
			};
		return original(tool, args);
	});
	expect(await f.adapter.read()).toEqual({
		...f.ticket,
		url: source,
		attachments: [
			{ ...file, url: "https://taskbot.example/api/project-a/files/100" },
		],
	});
	const pr = "https://github.com/org/repo/pull/1";
	await f.service.record(f.run, {
		key: "start",
		body: "Started",
		stage: "in_progress",
		pr,
	});
	await f.service.record(f.run, {
		key: "review",
		body: "Review underway",
		stage: "in_review",
		pr,
	});
	expect(f.ticket.status).toBe("in_review");
	expect(f.run.ticketSync?.error).toBeUndefined();
	expect((await f.adapter.read()).attachments).toEqual([
		{ ...file, url: "https://taskbot.example/api/project-a/files/100" },
		{ url: pr },
	]);
	expect(f.calls.filter((c) => c.tool === "add_attachment")).toHaveLength(1);
});
it.each([
	{ kind: "link", url: null },
	{ kind: "pr", url: null },
	{ kind: "file", id: 0, url: null },
	{ kind: "file", url: null },
])("rejects attachments without a resolvable URL: %j", async (attachment) => {
	const f = fixture();
	f.call.mockResolvedValue({
		content: [
			{
				type: "text",
				text: JSON.stringify({ ...f.ticket, attachments: [attachment] }),
			},
		],
	});
	await expect(f.adapter.read()).rejects.toThrow();
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
	expect(f.ticket.comments).toHaveLength(0);
	f.ticket.project = "another";
	await expect(f.adapter.read()).rejects.toThrow(/another project/);
	f.ticket.project = "project-a";
	f.ticket.nextOffset = 50;
	await expect(f.adapter.read()).rejects.toThrow(/partial/);
});
it.each([
	"done",
	"cancelled",
])("discards pending stale progress after a ticket becomes %s, including across restarts", async (status) => {
	const f = fixture();
	const original = f.call.getMockImplementation()!;
	f.call.mockRejectedValue(new Error("offline"));
	await f.service.record(f.run, {
		key: "review",
		body: "Waiting for review",
		stage: "in_review",
		pr: "https://github.com/org/repo/pull/1",
	});
	await f.service.record(f.run, {
		key: "outcome:failed",
		body: "Saved worktree is unavailable; recovery cannot recreate unfinished work",
	});
	expect(f.run.ticketSync?.error).toBe("offline");
	f.service.stop();
	f.ticket.status = status;
	f.call.mockImplementation(original);
	f.calls.splice(0);
	const runtime = new WorkflowRuntime(f.home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const run = runtime.get(f.run.id);
	const service = new TicketTracking(
		async () => f.adapter,
		(r) => runtime.save(r),
		() => {},
	);
	services.push(service);
	await service.flush(run);
	expect(f.ticket.status).toBe(status);
	expect(f.ticket.comments).toHaveLength(0);
	expect(f.ticket.attachments).toHaveLength(0);
	expect(f.calls.every((call) => call.tool === "get_ticket")).toBe(true);
	expect(run.ticketSync?.receipts.every((r) => r.superseded)).toBe(true);
	expect(run.ticketSync?.error).toBeUndefined();
	const reads = f.calls.length;
	const restored = new WorkflowRuntime(f.home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	}).get(run.id);
	await service.flush(restored);
	expect(f.calls).toHaveLength(reads);
});

it("still delivers confirmed merge evidence and its PR link to an already Done ticket", async () => {
	const f = fixture();
	f.ticket.status = "done";
	await f.service.record(f.run, {
		key: "merged",
		body: "Confirmed merge",
		stage: "done",
		merged: true,
		pr: "https://github.com/org/repo/pull/1",
	});
	expect(f.ticket.status).toBe("done");
	expect(f.ticket.comments).toHaveLength(1);
	expect(f.ticket.attachments).toHaveLength(1);
	expect(f.run.ticketSync?.receipts[0]?.delivered).toBe(true);
	await f.service.flush(f.run);
	expect(f.ticket.comments).toHaveLength(1);
	expect(f.ticket.attachments).toHaveLength(1);
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

it("retains an offline confirmed merge ahead of late work milestones across restart", async () => {
	const f = fixture();
	const original = f.call.getMockImplementation()!;
	f.call.mockImplementation(async () => {
		throw new Error("offline");
	});
	await f.service.record(f.run, {
		key: "merged",
		body: "Merged",
		stage: "done",
		merged: true,
	});
	await f.service.record(f.run, {
		key: "late-work",
		body: "Late work",
		stage: "in_progress",
	});
	expect(
		f.run.ticketSync?.receipts.find((r) => r.key === "merged")?.superseded,
	).not.toBe(true);
	const restored = new WorkflowRuntime(f.home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	}).get(f.run.id);
	f.call.mockImplementation(original);
	await f.service.flush(restored);
	expect(f.ticket.status).toBe("done");
	expect(
		restored.ticketSync?.receipts.find((r) => r.key === "merged")?.delivered,
	).toBe(true);
	expect(
		f.calls.filter((c) => c.tool === "set_status").map((c) => c.args.to),
	).toEqual(["done"]);
});

it.each([
	false,
	true,
])("recovers native status response loss without reassessment (reread unavailable: %s)", async (rereadUnavailable) => {
	const f = fixture();
	const tracker = new CLIIssueTrackerService();
	tracker.seedDefaultData();
	const states = tracker.getState().workflowStates;
	states.set("state-review", {
		...states.get("state-in-progress")!,
		id: "state-review",
		name: "Awaiting Review",
	});
	const issue = await tracker.createIssue({
		teamId: "team-default",
		title: "Native response loss",
	});
	const reference = {
		provider: "native" as const,
		platform: "cli",
		workspaceId: "cli",
		id: issue.id,
		url: issue.url,
	};
	f.run.ticketReference = reference;
	const adapter = nativeAdapter(reference, tracker);
	const service = new TicketTracking(
		async () => adapter,
		(r) => f.runtime.save(r),
		() => {},
	);
	services.push(service);
	await service.record(f.run, {
		key: "start",
		body: "Started",
		stage: "in_progress",
	});
	const update = tracker.updateIssue.bind(tracker);
	const fetch = tracker.fetchIssue.bind(tracker);
	let failRead = false;
	vi.spyOn(tracker, "fetchIssue").mockImplementation(async (id) => {
		if (failRead) {
			failRead = false;
			throw new Error("reread offline");
		}
		return fetch(id);
	});
	const mutation = vi
		.spyOn(tracker, "updateIssue")
		.mockImplementation(async (id, changes) => {
			await update(id, changes);
			failRead = rereadUnavailable;
			throw new Error("response lost");
		});
	await service.record(f.run, {
		key: "review",
		body: "Review requested",
		stage: "in_review",
	});
	await service.flush(f.run);
	expect((await (await tracker.fetchIssue(issue.id)).state)?.id).toBe(
		"state-review",
	);
	expect(mutation).toHaveBeenCalledOnce();
	expect(f.run.ticketSync?.error).toBeUndefined();
	expect(f.run.ticketSync?.receipts.at(-1)?.delivered).toBe(true);
	expect((await adapter.read()).comments).toHaveLength(2);
	// A real outside-run change still requires reassessment.
	await update(issue.id, { stateId: "state-todo" });
	await service.record(f.run, {
		key: "review-again",
		body: "Another review",
		stage: "in_review",
	});
	expect(f.run.ticketSync?.receipts.at(-1)?.conflict).toBe(true);
	expect((await (await tracker.fetchIssue(issue.id)).state)?.id).toBe(
		"state-todo",
	);
});

it("routes native Linear questions to one transcript event while linking PRs and moving status independently", async () => {
	const tracker = new CLIIssueTrackerService();
	tracker.seedDefaultData();
	const issue = await tracker.createIssue({
		teamId: "team-default",
		title: "Question delivery",
	});
	const session = await (
		await tracker.createAgentSessionOnIssue({ issueId: issue.id })
	).agentSession;
	const f = fixture();
	f.run.ticketReference = {
		provider: "native",
		platform: "linear",
		workspaceId: "ticket-transcript",
		id: issue.id,
		url: issue.url,
	};
	const adapter = nativeAdapter(f.run.ticketReference, tracker, {
		getTranscriptSession: async () => session!.id,
	});
	const service = new TicketTracking(
		async () => adapter,
		(run) => f.runtime.save(run),
		() => {},
	);
	services.push(service);
	await service.record(f.run, {
		key: "questions:clarify:0:batch",
		body: "Which target?",
		stage: "in_progress",
		pr: "https://github.com/org/repo/pull/1",
	});
	await service.flush(f.run);
	expect(f.run.ticketSync?.error).toBeUndefined();
	expect((await tracker.fetchComments(issue.id)).nodes).toEqual([]);
	const activities = tracker.listAgentActivities(session!.id);
	expect(activities).toHaveLength(1);
	expect(activities[0]).toMatchObject({
		type: "elicitation",
		content: "Which target?",
	});
	expect(
		(await tracker.fetchIssueAttachments(issue.id)).map((link) => link.url),
	).toEqual(["https://github.com/org/repo/pull/1"]);
	expect((await (await tracker.fetchIssue(issue.id)).state)?.type).toBe(
		"started",
	);
	expect(f.run.ticketSync?.receipts[0]?.delivered).toBe(true);
});

it("reconciles a manual transcript creation response lost in transit without creating another session", async () => {
	const { LinearClient } = await import("@linear/sdk");
	const { LinearIssueTrackerService } = await import(
		"bobs-factory-linear-event-transport"
	);
	const client = new LinearClient({ accessToken: "manual-transcript-test" });
	const f = fixture();
	f.run.ticketReference = {
		provider: "native",
		platform: "linear",
		workspaceId: "manual",
		id: "issue",
		url: "https://linear.app/example/issue/EX-1/example",
	};
	const link = `https://factory.example/#/runs/${f.run.id}`;
	let remote: any;
	let creates = 0;
	client.client.request = vi.fn(async (_doc, variables: any) => {
		if (variables.input) {
			creates++;
			remote = {
				id: "transcript",
				externalLink: variables.input.externalLink,
				issue: { id: "issue" },
			};
			throw new Error("lost session response");
		}
		return {
			agentSessions: {
				nodes: remote ? [remote] : [],
				pageInfo: { hasNextPage: false },
			},
		};
	}) as any;
	const tracker = new LinearIssueTrackerService(client, undefined, undefined, {
		workspaceId: "manual",
		requestIntervalMs: 0,
	});
	await expect(
		ensureTicketTranscript(
			f.run,
			tracker,
			(run) => f.runtime.save(run),
			undefined,
			link,
		),
	).rejects.toThrow();
	expect(
		await ensureTicketTranscript(
			f.run,
			tracker,
			(run) => f.runtime.save(run),
			undefined,
			link,
		),
	).toBe("transcript");
	expect(
		await ensureTicketTranscript(
			f.run,
			tracker,
			(run) => f.runtime.save(run),
			undefined,
			link,
		),
	).toBe("transcript");
	expect(creates).toBe(1);
});

it("keeps an ambiguous transcript creation identity when a later reconciliation lookup is throttled", async () => {
	const { LinearClient } = await import("@linear/sdk");
	const { LinearIssueTrackerService } = await import(
		"bobs-factory-linear-event-transport"
	);
	const client = new LinearClient({
		accessToken: "manual-transcript-lookup-throttle",
	});
	const f = fixture();
	f.run.ticketReference = {
		provider: "native",
		platform: "linear",
		workspaceId: "manual-throttle",
		id: "issue",
		url: "https://linear.app/example/issue/EX-1/example",
	};
	const link = `https://factory.example/#/runs/${f.run.id}`;
	let creates = 0;
	let lookupFails = false;
	client.client.request = vi.fn(async (_doc, variables: any) => {
		if (variables.input) {
			creates++;
			throw new Error("lost session response");
		}
		if (lookupFails)
			throw {
				response: {
					status: 400,
					errors: [
						{ extensions: { code: "RATELIMITED", type: "ratelimited" } },
					],
				},
			};
		return { agentSessions: { nodes: [], pageInfo: { hasNextPage: false } } };
	}) as any;
	const tracker = new LinearIssueTrackerService(client, undefined, undefined, {
		workspaceId: "manual-throttle",
		requestIntervalMs: 0,
	});
	await expect(
		ensureTicketTranscript(
			f.run,
			tracker,
			(run) => f.runtime.save(run),
			undefined,
			link,
		),
	).rejects.toThrow();
	lookupFails = true;
	await expect(
		ensureTicketTranscript(
			f.run,
			tracker,
			(run) => f.runtime.save(run),
			undefined,
			link,
		),
	).rejects.toThrow();
	expect(f.run.ticketSync?.transcript?.createAttempted).toBe(true);
	lookupFails = false;
	vi.useFakeTimers();
	await vi.advanceTimersByTimeAsync(30_000);
	await expect(
		ensureTicketTranscript(
			f.run,
			tracker,
			(run) => f.runtime.save(run),
			undefined,
			link,
		),
	).rejects.toThrow("unconfirmed");
	expect(creates).toBe(1);
});
