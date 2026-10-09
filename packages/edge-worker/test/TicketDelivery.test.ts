import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IIssueTrackerService } from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import {
	type DeliveryContract,
	DeliveryContractSchema,
	digest,
	externalCompletionProven,
	freezeDelivery,
	TicketDelivery,
	type TicketDeliveryAdapter,
	type TicketState,
} from "../src/factory/Delivery.js";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import {
	linearDeliveryAdapter,
	taskbotDeliveryAdapter,
} from "../src/factory/TicketDeliveryAdapters.js";
import {
	type TicketAdapter,
	TicketTracking,
} from "../src/factory/TicketTracking.js";
import {
	type FactoryRun,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";
import { legacyReviewWorkflows } from "./fixtures/legacy-review.js";

const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function setup() {
	const home = mkdtempSync(join(tmpdir(), "ticket-delivery-"));
	homes.push(home);
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const workflow = defaultWorkflows.find((w) => w.id === "factory")!;
	const run = runtime.create({
		repositoryId: "repo",
		workspace: home,
		input: "Edit ticket descriptions only",
		workflow,
		triggerOrigin: { type: "manual", workflowId: workflow.id },
		executionSnapshot: undefined,
	});
	const contract: DeliveryContract = {
		format: "delivery-v1",
		version: 1,
		mode: "external",
		authorization: { status: "authorized", reference: "input" },
		executionReference: digest({
			runner: run.runner,
			repositoryId: run.repositoryId,
		}),
		targets: [
			{
				key: "ticket",
				resource: {
					provider: "taskbot",
					server: "taskbot",
					instance: "https://tasks.example.com",
					project: "project",
					id: "1",
					url: "https://tasks.example.com/p/project/t/1",
				},
				capabilities: ["read", "content", "relationships"],
				baseline: {
					fields: { description: "before" },
					relationships: [{ type: "related", from: "1", to: "3" }],
				},
				operations: [
					{
						id: "description",
						kind: "content",
						fields: { description: "after" },
					},
					{
						id: "blocker",
						kind: "add",
						relationship: { type: "blocks", from: "2", to: "1" },
					},
				],
				criteria: [
					{
						id: "content",
						requirementRef: "requirements/0",
						description: "Description updated and blocker retained",
						fields: { description: "after" },
						relationships: [{ type: "blocks", from: "2", to: "1" }],
						absentRelationships: [],
					},
				],
				preservedRelationships: [{ type: "related", from: "1", to: "3" }],
			},
		],
	};
	let state: TicketState = {
		resource: contract.targets[0]!.resource,
		...structuredClone(contract.targets[0]!.baseline),
		complete: true,
	};
	const content = vi.fn(async (fields: TicketState["fields"]) => {
		Object.assign(state.fields, fields);
	});
	const relationship = vi.fn(
		async (
			kind: "add" | "remove",
			value: TicketState["relationships"][number],
		) => {
			if (kind === "add") state.relationships.push(value);
			else
				state.relationships = state.relationships.filter(
					(r) => digest(r) !== digest(value),
				);
		},
	);
	const adapter: TicketDeliveryAdapter = {
		capabilities: ["read", "content", "relationships"],
		read: vi.fn(async () => structuredClone(state)),
		content,
		relationship,
		limitation: "No conditional writes",
	};
	const service = new TicketDelivery(
		async () => adapter,
		(r) => runtime.save(r),
	);
	freezeDelivery(run, contract);
	runtime.save(run);
	return {
		home,
		runtime,
		run,
		contract,
		adapter,
		content,
		relationship,
		service,
		state: () => state,
		replace: (next: TicketState) => {
			state = next;
		},
	};
}
function accept(run: FactoryRun) {
	run.reviewGate = {
		id: "review",
		status: "approve",
		mode: "external",
		headSha: "",
		url: "",
		externalDigest: run.delivery!.verification!.digest,
	};
	run.humanDecisions = [
		{
			reviewId: "review",
			headSha: "",
			mode: "external",
			externalDigest: run.delivery!.verification!.digest,
			decision: "approve",
			at: new Date().toISOString(),
		},
	];
}
it("persists intents before writes and reconciles without duplicate mutations across restart", async () => {
	const f = setup();
	f.content.mockImplementationOnce(async (fields) => {
		expect(f.run.delivery!.receipts[0]).toMatchObject({
			status: "pending",
			attempts: 1,
			before: { fields: { description: "before" } },
		});
		Object.assign(f.state().fields, fields);
		throw new Error("Response lost after dispatch");
	});
	await expect(f.service.apply(f.run)).rejects.toThrow("Response lost");
	expect(f.run.delivery!.receipts[0]!.status).toBe("uncertain");
	const restored = new WorkflowRuntime(f.home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	}).get(f.run.id);
	await f.service.apply(restored);
	expect(f.content).toHaveBeenCalledTimes(1);
	expect(f.relationship).toHaveBeenCalledTimes(1);
	await f.service.apply(restored);
	expect(f.relationship).toHaveBeenCalledTimes(1);
	await f.service.verify(restored);
	accept(restored);
	expect(await f.service.finalCheck(restored)).toBe(true);
	expect(externalCompletionProven(restored)).toBe(true);
});
it("blocks intervening edits without overwriting them", async () => {
	const f = setup();
	f.state().fields.description = "human edit";
	await expect(f.service.apply(f.run)).rejects.toThrow(
		"Relevant state changed",
	);
	expect(f.content).not.toHaveBeenCalled();
	expect(f.run.delivery!.receipts[0]!.status).toBe("conflicted");
});
it("executor claims cannot replace independent reads and preserved relationship criteria", async () => {
	const f = setup();
	f.run.outputs.implement = { status: "completed" };
	await expect(f.service.verify(f.run)).rejects.toThrow("outcome not achieved");
	await f.service.apply(f.run);
	f.state().relationships = [{ type: "blocks", from: "2", to: "1" }];
	await expect(f.service.verify(f.run)).rejects.toThrow("criteria failed");
	expect(f.run.delivery!.verification).toBeUndefined();
});
it("binds acceptance to actual content and relationships while ignoring lifecycle metadata", async () => {
	const f = setup();
	await f.service.apply(f.run);
	await f.service.verify(f.run);
	accept(f.run);
	expect(await f.service.finalCheck(f.run)).toBe(true);
	f.state().relationships.reverse();
	expect(await f.service.finalCheck(f.run)).toBe(true);
	f.state().fields.description = "drift";
	expect(await f.service.finalCheck(f.run)).toBe(false);
	expect(externalCompletionProven(f.run)).toBe(false);
});
it("rejects missing access, partial reads, execution deferral and contradictory coordinates", async () => {
	const f = setup();
	f.adapter.capabilities = ["read"];
	await expect(f.service.apply(f.run)).rejects.toThrow("capability");
	expect(f.content).not.toHaveBeenCalled();
	f.adapter.capabilities = ["read", "content", "relationships"];
	f.state().complete = false;
	await expect(f.service.apply(f.run)).rejects.toThrow("Incomplete");
	expect(() =>
		freezeDelivery(f.run, {
			...f.contract,
			authorization: { status: "deferred", reference: "do not execute yet" },
		}),
	).toThrow("deferred");
	expect(
		DeliveryContractSchema.safeParse({
			...f.contract,
			targets: [
				{
					...f.contract.targets[0],
					resource: {
						...f.contract.targets[0]!.resource,
						url: "https://other.example.com/p/project/t/1",
					},
				},
			],
		}).success,
	).toBe(false);
});
it("detects changes during multi-resource collection", async () => {
	const f = setup();
	await f.service.apply(f.run);
	let calls = 0;
	f.adapter.read = async () => {
		calls++;
		if (calls === 2) f.state().fields.description = "changed";
		return structuredClone(f.state());
	};
	await expect(f.service.verify(f.run)).rejects.toThrow("during verification");
});
it("routes the standard Factory through independent external verification and a snapshot-bound human gate without Git", async () => {
	const f = setup(),
		invoked: string[] = [];
	const tools = new FactoryTools({
		postComment: async () => {},
		ticketDelivery: f.service,
		command: async () => {
			throw new Error("External delivery must not invoke Git/forge commands");
		},
	});
	const runtime = new WorkflowRuntime(f.home, {
		agent: async (ctx) => {
			if (ctx.step.id === "clarify")
				return {
					questions: [],
					decisions: [],
					requirements: ["Edit descriptions only"],
					deliveryMode: "external",
				};
			if (ctx.step.id === "plan")
				return {
					plan: "Ticket content changes",
					assets: [],
					deliveryContract: f.contract,
				};
			if (ctx.step.id === "plan-review")
				return {
					approved: true,
					feedback: [],
					deliveryContractDigest: digest(f.contract),
				};
			throw new Error(`Unexpected agent ${ctx.step.id}`);
		},
		script: async () => {
			throw new Error("Unexpected script");
		},
		tool: async (ctx) => {
			invoked.push(ctx.step.tool!);
			return tools.tool(ctx);
		},
	});
	const run = runtime.get(f.run.id);
	delete run.delivery;
	const executing = runtime.launch(run);
	await vi.waitFor(() => {
		if (run.status === "failed") throw new Error(run.error);
		expect(run.reviewGate?.status).toBe("pending");
	});
	expect(run.reviewGate).toMatchObject({
		mode: "external",
		headSha: "",
		url: "",
		externalDigest: run.delivery!.verification!.digest,
	});
	expect(() =>
		runtime.decide(run.id, {
			reviewId: run.reviewGate!.id,
			headSha: "",
			externalDigest: "stale",
			decision: "approve",
		}),
	).toThrow("revision changed");
	runtime.decide(run.id, {
		reviewId: run.reviewGate!.id,
		headSha: "",
		externalDigest: run.reviewGate!.externalDigest,
		decision: "approve",
	});
	await executing;
	expect(run.status).toBe("completed");
	expect(invoked).toEqual([
		"record-decisions",
		"delivery-route",
		"external-apply",
		"external-verify",
		"delivery-mode",
		"external-guide",
		"human-review",
		"external-final",
	]);
});
it("retains partial writes and retries only the remaining relationship", async () => {
	const f = setup();
	f.relationship.mockImplementationOnce(async () => {
		throw new Error("Write forbidden");
	});
	await expect(f.service.apply(f.run)).rejects.toThrow("Write forbidden");
	expect(f.run.delivery!.receipts.map((r) => r.status)).toEqual([
		"applied",
		"uncertain",
	]);
	await f.service.apply(f.run);
	expect(f.content).toHaveBeenCalledTimes(1);
	expect(f.relationship).toHaveBeenCalledTimes(2);
	await f.service.verify(f.run);
});
it("invalidates final proof on a failed fresh read and rejects corrupted evidence", async () => {
	const f = setup();
	await f.service.apply(f.run);
	await f.service.verify(f.run);
	accept(f.run);
	await f.service.finalCheck(f.run);
	f.adapter.read = async () => {
		throw new Error("Read access lost");
	};
	await expect(f.service.finalCheck(f.run)).rejects.toThrow("Read access lost");
	expect(externalCompletionProven(f.run)).toBe(false);
	f.run.delivery!.verification!.criteria = [];
	expect(externalCompletionProven(f.run)).toBe(false);
});
it("tracking-only retries recheck external state and never replay task mutations", async () => {
	const f = setup();
	await f.service.apply(f.run);
	await f.service.verify(f.run);
	accept(f.run);
	await f.service.finalCheck(f.run);
	f.run.ticketReference = {
		provider: "taskbot",
		server: "taskbot",
		instance: "https://tasks.example.com",
		project: "project",
		id: 1,
		url: f.contract.targets[0]!.resource.url,
	};
	let online = false;
	const stage = vi.fn(async () => undefined),
		comment = vi.fn(async () => {});
	const tracker: TicketAdapter = {
		read: async () => {
			if (!online) throw new Error("Network unavailable");
			return { status: "in_review", comments: [], attachments: [] };
		},
		stage,
		comment,
		link: async () => {},
	};
	const tracking = new TicketTracking(
		async () => tracker,
		(r) => f.runtime.save(r),
		() => {},
		(r) => f.service.finalCheck(r),
	);
	await tracking.record(f.run, {
		key: "external-done",
		stage: "done",
		body: "Accepted completed work",
		completion: {
			mode: "external",
			digest: f.run.delivery!.verification!.digest,
			reviewId: "review",
		},
	});
	expect(f.run.ticketSync?.error).toContain("Network unavailable");
	f.state().relationships.push({ type: "related", from: "1", to: "4" });
	online = true;
	await tracking.flush(f.run, true);
	expect(stage).not.toHaveBeenCalled();
	expect(f.run.ticketSync?.error).toContain("external state changed");
	expect(f.content).toHaveBeenCalledTimes(1);
	expect(f.relationship).toHaveBeenCalledTimes(1);
	tracking.stop();
});
it("recovers already-applied external work without replaying mutations and preserves the original frozen definition", async () => {
	const f = setup();
	delete f.run.delivery;
	f.state().fields.description = "after";
	f.state().relationships.push({ type: "blocks", from: "2", to: "1" });
	f.run.status = "failed";
	f.run.step = "pipeline/draft-pr";
	f.run.workflowDefinitions = legacyReviewWorkflows();
	f.run.checkpoint = {
		current: "pipeline",
		visits: { pipeline: 1 },
		active: {
			phase: "executing",
			children: [{ current: "draft-pr", visits: { implement: 1 } }],
		},
	};
	f.run.history.push({
		step: "pipeline/implement",
		output: { summary: "Historical edits applied" },
		at: new Date().toISOString(),
	});
	f.run.ticketReference = {
		provider: "taskbot",
		server: "taskbot",
		instance: "https://tasks.example.com",
		project: "project",
		id: 1,
		url: f.contract.targets[0]!.resource.url,
	};
	f.runtime.save(f.run);
	const original = structuredClone(f.run.workflow),
		history = structuredClone(f.run.history),
		checkpoint = structuredClone(f.run.checkpoint);
	const tools = new FactoryTools({
		postComment: async () => {},
		ticketDelivery: f.service,
		command: async () => {
			throw new Error("No Git during external recovery");
		},
	});
	const runtime = new WorkflowRuntime(f.home, {
		agent: async () => {
			throw new Error("Recovery must not replay implementation");
		},
		script: async () => ({}),
		tool: (ctx) => tools.tool(ctx),
	});
	const recovered = runtime.recoverExternal(
		f.run.id,
		"request",
		f.contract,
		digest(f.contract),
		"operator-passkey",
	);
	await vi.waitFor(() => {
		if (recovered.status === "failed") throw new Error(recovered.error);
		expect(recovered.reviewGate?.status).toBe("pending");
	});
	expect(recovered.workflow).toEqual(original);
	expect(recovered.deliveryRecovery?.previousCheckpoint).toEqual(checkpoint);
	expect(recovered.history.slice(0, history.length)).toEqual(history);
	expect(f.content).not.toHaveBeenCalled();
	expect(f.relationship).not.toHaveBeenCalled();
	expect(
		runtime.recoverExternal(
			f.run.id,
			"request",
			f.contract,
			digest(f.contract),
			"operator-passkey",
		),
	).toBe(recovered);
	await runtime.shutdown();
	const restoredRuntime = new WorkflowRuntime(f.home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: (ctx) => tools.tool(ctx),
	});
	const restored = restoredRuntime.get(f.run.id);
	const executing = restoredRuntime.launch(restored);
	await vi.waitFor(() => expect(restored.status).toBe("waiting"));
	restoredRuntime.decide(restored.id, {
		reviewId: restored.reviewGate!.id,
		headSha: "",
		externalDigest: restored.reviewGate!.externalDigest,
		decision: "approve",
	});
	await executing;
	expect(restored.status).toBe("completed");
	expect(f.content).not.toHaveBeenCalled();
	expect(f.relationship).not.toHaveBeenCalled();
});
it("rejects recovery for active work or an unreviewed/contradictory contract", () => {
	const f = setup();
	expect(() =>
		f.runtime.recoverExternal(
			f.run.id,
			"x",
			f.contract,
			digest(f.contract),
			"operator",
		),
	).toThrow("idle failed");
	f.run.status = "failed";
	f.run.step = "pipeline/draft-pr";
	expect(() =>
		f.runtime.recoverExternal(f.run.id, "x", f.contract, "wrong", "operator"),
	).toThrow("reviewed authorized");
});
it("maps Taskbot full content and both relationship directions without lifecycle mutations", async () => {
	const f = setup(),
		resource = f.contract.targets[0]!.resource;
	if (resource.provider !== "taskbot") throw new Error("Fixture identity");
	const calls: string[] = [];
	const adapter = taskbotDeliveryAdapter(
		resource,
		async (tool, args) => {
			calls.push(tool);
			expect(args.project).toBe("project");
			return {
				structuredContent:
					tool === "get_ticket"
						? {
								id: 1,
								title: "Title",
								body: "Content",
								links: { blocks: [{ id: 5 }], blocked_by: [2], related: [3] },
							}
						: {},
			};
		},
		["read", "content", "relationships"],
	);
	const read = await adapter.read();
	expect(read.relationships).toEqual([
		{ type: "blocks", from: "1", to: "5" },
		{ type: "blocks", from: "2", to: "1" },
		{ type: "related", from: "1", to: "3" },
	]);
	await adapter.content({ description: "Updated" });
	await adapter.relationship("add", { type: "blocks", from: "2", to: "1" });
	expect(calls).toEqual(["get_ticket", "update_ticket", "link"]);
});
it("maps the configured native Linear interface and rejects another project", async () => {
	const tracker = mockDeep<IIssueTrackerService>();
	tracker.getPlatformType.mockReturnValue("linear");
	const resource = {
		provider: "linear" as const,
		workspaceId: "workspace",
		instance: "https://linear.app" as const,
		project: "team",
		id: "91d6cfad-82c3-44a6-96e8-aa60d1869dc4",
		url: "https://linear.app/example/issue/EX-1/example",
	};
	tracker.fetchDeliveryTicket!.mockResolvedValue({
		id: resource.id,
		url: resource.url,
		project: "team",
		title: "Title",
		description: "Content",
		relationships: [{ type: "duplicate", from: resource.id, to: "other" }],
	});
	const adapter = linearDeliveryAdapter(resource, tracker);
	expect((await adapter.read()).relationships[0]?.type).toBe("duplicate");
	await adapter.content({ description: "Updated" });
	expect(tracker.updateIssue).toHaveBeenCalledWith(resource.id, {
		description: "Updated",
	});
	tracker.fetchDeliveryTicket!.mockResolvedValue({
		id: resource.id,
		url: resource.url,
		project: "another",
		title: "Title",
		description: null,
		relationships: [],
	});
	await expect(adapter.read()).rejects.toThrow("identity/project");
});

it("requires both accepted ticket state and the exact confirmed repository revision for mixed completion", async () => {
	const f = setup();
	freezeDelivery(f.run, { ...f.contract, version: 2, mode: "mixed" });
	await f.service.apply(f.run);
	await f.service.verify(f.run);
	accept(f.run);
	f.run.humanDecisions![0]!.mode = "mixed";
	f.run.humanDecisions![0]!.headSha = "approved-head";
	f.run.reviewGate!.mode = "mixed";
	await f.service.finalCheck(f.run);
	expect(externalCompletionProven(f.run)).toBe(false);
	f.run.outputs["draft-pr"] = {
		url: "https://github.com/example/repo/pull/1",
		headSha: "approved-head",
	};
	f.run.outputs.merge = {
		merged: true,
		url: "https://github.com/example/repo/pull/1",
		headSha: "other-head",
	};
	expect(externalCompletionProven(f.run)).toBe(false);
	f.run.outputs.merge = {
		merged: true,
		url: "https://github.com/example/repo/pull/1",
		headSha: "approved-head",
	};
	expect(externalCompletionProven(f.run)).toBe(true);
	f.state().fields.description = "edited after acceptance";
	expect(await f.service.finalCheck(f.run)).toBe(false);
	expect(externalCompletionProven(f.run)).toBe(false);
	expect(f.run.outputs.merge).toMatchObject({
		merged: true,
		headSha: "approved-head",
	});
});

it("renews verification after delayed completion drift without replaying ticket mutations", async () => {
	const f = setup();
	await f.service.apply(f.run);
	await f.service.verify(f.run);
	accept(f.run);
	await f.service.finalCheck(f.run);
	f.state().relationships.push({ type: "related", from: "1", to: "4" });
	expect(await f.service.finalCheck(f.run)).toBe(false);
	f.run.status = "completed";
	f.run.ticketSync = {
		receipts: [
			{
				key: "old-completion",
				stage: "done",
				body: "Old accepted completion",
				completion: {
					mode: "external",
					digest: f.run.delivery!.verification!.digest,
					reviewId: "review",
				},
				delivered: false,
				error: "External state changed",
				at: new Date().toISOString(),
			},
		],
		error: "External state changed",
	};
	f.runtime.save(f.run);
	const tools = new FactoryTools({
		postComment: async () => {},
		ticketDelivery: f.service,
		command: async () => {
			throw new Error("Reverification must not invoke Git");
		},
	});
	const runtime = new WorkflowRuntime(f.home, {
		agent: async () => {
			throw new Error("No mutation agent allowed");
		},
		script: async () => {
			throw new Error("No scripts allowed");
		},
		tool: (ctx) => tools.tool(ctx),
	});
	const run = runtime.get(f.run.id);
	runtime.updateViewState(run.id, { settledAt: new Date().toISOString() });
	runtime.reverifyExternal(run.id, "authenticated-operator");
	expect(runtime.viewState(run.id)).toEqual({ keptOpen: true });
	await vi.waitFor(() => {
		if (run.status === "failed") throw new Error(run.error);
		expect(run.reviewGate?.status).toBe("pending");
	});
	expect(run.externalReverifications?.[0]?.actor).toBe(
		"authenticated-operator",
	);
	expect(run.ticketSync!.receipts[0]!.superseded).toBe(true);
	expect(run.reviewGate!.externalDigest).not.toBe(
		f.run.humanDecisions![0]!.externalDigest,
	);
	expect(f.content).toHaveBeenCalledTimes(1);
	expect(f.relationship).toHaveBeenCalledTimes(1);
	runtime.decide(run.id, {
		reviewId: run.reviewGate!.id,
		headSha: "",
		externalDigest: run.reviewGate!.externalDigest,
		decision: "approve",
	});
	await vi.waitFor(() => expect(run.status).toBe("completed"));
	expect(externalCompletionProven(run)).toBe(true);
	await runtime.shutdown();
});

it("corrects mixed external feedback after merge without repeating repository implementation or merge", async () => {
	const f = setup();
	freezeDelivery(f.run, { ...f.contract, version: 2, mode: "mixed" });
	await f.service.apply(f.run);
	await f.service.verify(f.run);
	accept(f.run);
	f.run.humanDecisions![0]!.mode = "mixed";
	f.run.humanDecisions![0]!.headSha = "confirmed-head";
	f.run.outputs["draft-pr"] = {
		url: "https://github.com/example/repo/pull/1",
		headSha: "confirmed-head",
	};
	f.run.outputs.merge = {
		merged: true,
		...(f.run.outputs["draft-pr"] as object),
	};
	f.run.outputs.guide = { summary: "Repository already merged" };
	f.run.outputs.clarify = { deliveryMode: "mixed" };
	f.run.humanDecisions!.push({
		...f.run.humanDecisions![0]!,
		reviewId: "external-rejected",
		decision: "reject",
		feedback: "Correct the external description",
	});
	const revised = {
		...f.contract,
		version: 3,
		mode: "mixed" as const,
		targets: f.contract.targets.map((t) => ({
			...t,
			baseline: {
				fields: structuredClone(f.state().fields),
				relationships: structuredClone(f.state().relationships),
			},
			preservedRelationships: structuredClone(f.state().relationships),
			operations: [
				{
					id: "corrected-description",
					kind: "content" as const,
					fields: { description: "corrected" },
				},
				t.operations[1]!,
			],
			criteria: t.criteria.map((c) => ({
				...c,
				fields: { description: "corrected" },
			})),
		})),
	};
	f.run.recoveryWorkflow = structuredClone(
		defaultWorkflows.find((w) => w.id === "factory-pipeline")!,
	);
	f.run.checkpoint = { current: "external-correction", visits: {} };
	f.runtime.save(f.run);
	const tools = new FactoryTools({
		postComment: async () => {},
		ticketDelivery: f.service,
		command: async () => {
			throw new Error("Must retain the confirmed repository delivery");
		},
	});
	const runtime = new WorkflowRuntime(f.home, {
		agent: async (ctx) => {
			switch (ctx.step.id) {
				case "external-correction":
					return { summary: "Correct the ticket" };
				case "plan":
					return {
						plan: "Correct the ticket",
						assets: [],
						deliveryContract: revised,
					};
				case "plan-review":
					return {
						approved: true,
						feedback: [],
						deliveryContractDigest: digest(revised),
					};
				default:
					throw new Error("Repository implementation must not repeat");
			}
		},
		script: async () => {
			throw new Error("No repository scripts");
		},
		tool: (ctx) => tools.tool(ctx),
	});
	const run = runtime.get(f.run.id);
	const executing = runtime.launch(run);
	await vi.waitFor(() => {
		if (run.status === "failed") throw new Error(run.error);
		expect(run.reviewGate?.status).toBe("pending");
	});
	expect(run.reviewGate).toMatchObject({
		mode: "mixed",
		headSha: "confirmed-head",
	});
	expect(run.outputs.guide).toMatchObject({
		summary: "Repository already merged",
	});
	runtime.decide(run.id, {
		reviewId: run.reviewGate!.id,
		headSha: "confirmed-head",
		externalDigest: run.reviewGate!.externalDigest,
		decision: "approve",
	});
	await executing;
	expect(run.status).toBe("completed");
	expect(run.outputs.merge).toMatchObject({
		merged: true,
		headSha: "confirmed-head",
	});
	expect(f.relationship).toHaveBeenCalledTimes(1);
	await runtime.shutdown();
});
