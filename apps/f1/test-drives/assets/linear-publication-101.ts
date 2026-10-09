import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CLIIssueTrackerService,
	presentLinearPublication,
} from "bobs-factory-core";
import { AgentSessionManager } from "../../../../packages/edge-worker/src/AgentSessionManager.ts";
import { validateFactoryResult } from "../../../../packages/edge-worker/src/factory/FactoryResults.ts";
import { FactoryTools } from "../../../../packages/edge-worker/src/factory/FactoryTools.ts";
import {
	nativeAdapter,
	TicketTracking,
} from "../../../../packages/edge-worker/src/factory/TicketTracking.ts";
import { WorkflowSchema } from "../../../../packages/edge-worker/src/factory/Workflow.ts";
import { WorkflowRuntime } from "../../../../packages/edge-worker/src/factory/WorkflowRuntime.ts";
import { LinearActivitySink } from "../../../../packages/edge-worker/src/sinks/LinearActivitySink.ts";
import { LinearIssueTrackerService } from "../../../../packages/linear-event-transport/src/LinearIssueTrackerService.ts";
import { MockAgentRunner } from "../../src/MockAgentRunner.ts";

// Real SDK and local HTTP. Agent, ticket reads/status, Git and provider rendering are simulated.
// Model Linear's automatic threaded comments for response/elicitation/error activities.
const require = createRequire(
	new URL(
		"../../../../packages/linear-event-transport/package.json",
		import.meta.url,
	),
);
const { LinearClient } = require("@linear/sdk");
const server = require("fastify")();
const home = mkdtempSync(join(tmpdir(), "f1-linear-publication-101-"));
const activities: any[] = [];
const comments: any[] = [];
const remote = new Map<string, any>();
const rawMessages: unknown[] = [];
const unhandled: unknown[] = [];
const onUnhandled = (error: unknown) => unhandled.push(error);
process.on("unhandledRejection", onUnhandled);
let wire: LinearIssueTrackerService;
let tracking: TicketTracking;
try {
	server.post("/graphql", async (request: any) => {
		const { input, id } = request.body.variables;
		if (!input)
			return {
				data: { comment: remote.get(id), agentActivity: remote.get(id) },
			};
		const previous = remote.get(input.id);
		if (previous)
			return {
				data: input.content
					? { agentActivityCreate: { success: true, agentActivity: previous } }
					: { commentCreate: { success: true, comment: previous } },
			};
		const value = input.content
			? {
					...input,
					content: input.content,
					agentSession: { id: input.agentSessionId },
				}
			: { ...input, issue: { id: input.issueId }, reactions: [] };
		remote.set(input.id, value);
		(input.content ? activities : comments).push(input);
		if (["response", "elicitation", "error"].includes(input.content?.type))
			comments.push({ body: input.content.body, implicit: true });
		return {
			data: input.content
				? { agentActivityCreate: { success: true, agentActivity: value } }
				: { commentCreate: { success: true, comment: value } },
		};
	});
	const url = await server.listen({ host: "127.0.0.1", port: 0 });
	const options = {
		factoryHome: home,
		workspaceId: "fixture",
		requestIntervalMs: 0,
	};
	const makeWire = () =>
		new LinearIssueTrackerService(
			new LinearClient({
				accessToken: "isolated-publication-fixture",
				apiUrl: `${url}/graphql`,
			}),
			undefined,
			undefined,
			options,
		);
	wire = makeWire();
	const ticketStore = new CLIIssueTrackerService();
	ticketStore.seedDefaultData();
	const issue = await ticketStore.createIssue({
		teamId: "team-default",
		title: "Readable Linear publication",
	});
	const sessionId = randomUUID();
	const manager = new AgentSessionManager();
	manager.createCyrusAgentSession(
		sessionId,
		issue.id,
		{
			id: issue.id,
			identifier: "F1-101",
			title: issue.title,
			description: "",
			branchName: "fixture",
		},
		{ path: home, isGitWorktree: false },
	);
	manager.setActivitySink(sessionId, new LinearActivitySink(wire, "fixture"));
	const tracker = new Proxy(ticketStore, {
		get(target, key) {
			if (key === "createAgentActivity")
				return (input: any) => wire.createAgentActivity(input);
			if (key === "createComment")
				return async (id: string, input: any) => {
					const result = await wire.createComment(id, input);
					await ticketStore.createComment(id, input);
					return result;
				};
			const value = Reflect.get(target, key);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	let runtime: WorkflowRuntime;
	const tools = new FactoryTools({
		postComment: async (_id, body) =>
			tracking.record(run, {
				key: `comment:${body}`,
				purpose: "documentation",
				body,
			}),
		mcp: async () => ({}),
	});
	const decision = {
		question: "Which default?",
		answer: "English",
		reason: "Shared readers",
	};
	const agent = (id: string, askQuestions = false) => ({
		id,
		name: id,
		type: "agent",
		prompt: "Fixture",
		askQuestions,
	});
	const child = WorkflowSchema.parse({
		id: "child",
		name: "Nested review",
		internal: true,
		allowedTriggers: ["workflow"],
		steps: [agent("nested-review")],
	});
	const workflow = WorkflowSchema.parse({
		id: "fixture",
		name: "Publication fixture",
		allowedTriggers: ["manual"],
		steps: [
			agent("clarify", true),
			{
				id: "decisions",
				name: "Decisions",
				type: "tool",
				tool: "record-decisions",
			},
			agent("plan"),
			agent("implement"),
			{
				id: "reviews",
				name: "Parallel reviews",
				type: "fanout",
				groups: [
					[agent("review-a")],
					[
						{
							id: "nested",
							name: "Nested",
							type: "workflow",
							workflow: "child",
						},
					],
				],
			},
			{ id: "handoff", name: "Handoff", type: "tool", tool: "handoff" },
			{ id: "merge", name: "Merge", type: "tool", tool: "merge" },
		],
	});
	const hooks: any = {
		track: (run: any, receipt: any) => tracking.record(run, receipt),
		agent: async (context: any) => {
			const id = context.step.id;
			const output =
				id === "clarify"
					? {
							questions: context.run.answers.length
								? []
								: [
										"Which default?\n\n- English: shared readers\n- Dutch: local readers",
									],
							questionRecommendations: context.run.answers.length
								? []
								: [
										{
											questionIndex: 0,
											answer: "English",
											reason: "Shared readers",
										},
									],
							decisions: context.run.answers.length ? [decision] : [],
							requirements: ["Readable publishing"],
						}
					: id === "plan"
						? { plan: "Implement readable publishing.", assets: [] }
						: id === "implement"
							? {
									status: "completed",
									summary: "Readable publishing implemented.",
									checks: ["Simulated provider checks passed"],
									questions: [],
								}
							: { summary: `${id} completed`, questions: [] };
			const runner = new MockAgentRunner(
				{
					factoryHome: home,
					onMessage: async (message) => {
						rawMessages.push(message);
						manager.markFactoryMessage(message, context.stepKey);
						await manager.handleClaudeMessage(sessionId, message);
					},
				},
				JSON.stringify(output),
			);
			await runner.start("Scripted role");
			const accepted = validateFactoryResult(id, output);
			if (!["plan", "implement"].includes(id)) {
				const presented = presentLinearPublication({
					purpose: "outcome",
					eventId: context.stepKey,
					owner: "validated-role",
					source: { runId: context.run.id },
					content: accepted,
				});
				if (presented.destination === "transcript")
					await tracking.record(context.run, {
						key: `role:${context.stepKey}:${presented.markdown}`,
						purpose: "operational",
						body: presented.markdown,
					});
			}
			return accepted;
		},
		script: async () => ({}),
		tool: async (context: any) => {
			if (context.step.tool === "record-decisions") return tools.tool(context);
			if (context.step.tool === "handoff") {
				await wire.createAgentActivity({
					agentSessionId: sessionId,
					content: { type: "thought", body: "CI checks pending" },
				});
				await wire.createAgentActivity({
					agentSessionId: sessionId,
					content: { type: "thought", body: "CI checks pending" },
				});
				await wire.createAgentActivity({
					agentSessionId: sessionId,
					content: { type: "error", body: "CI checks failed: fixture access" },
				});
				await wire.createAgentActivity({
					agentSessionId: sessionId,
					content: { type: "thought", body: "CI checks pending" },
				});
				return {
					url: "https://github.com/example/fixture/pull/1",
					headSha: "fixture",
					ready: true,
				};
			}
			return { url: "https://github.com/example/fixture/pull/1", merged: true };
		},
	};
	runtime = new WorkflowRuntime(home, hooks);
	runtime.updateWorkflows(
		[...runtime.listWorkflows(), workflow, child],
		workflow.id,
	);
	const run = runtime.create({
		repositoryId: "fixture",
		workflow,
		workspace: home,
		input: "Fixture",
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
	});
	run.ticketReference = {
		provider: "native",
		platform: "linear",
		workspaceId: "fixture",
		id: issue.id,
		url: issue.url,
	};
	tracking = new TicketTracking(
		async () =>
			nativeAdapter(run.ticketReference as any, tracker, {
				getTranscriptSession: async () => sessionId,
			}),
		(value) => runtime.save(value),
		() => {},
	);
	const completion = runtime.launch(run);
	for (
		let i = 0;
		i < 100 &&
		!activities.some((value) =>
			value.content.body?.startsWith("Factory needs assistance:"),
		);
		i++
	)
		await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(run.status, "waiting");
	assert.equal(
		activities.filter((value) =>
			value.content.body?.startsWith("Factory needs assistance:"),
		).length,
		1,
	);
	assert.equal(comments.length, 0);
	runtime.answer(run.id, "English");
	await completion;
	assert.equal(run.status, "completed");
	assert.equal(comments.length, 2);
	assert.equal(
		comments[0].body.replace(/\n\n<!-- factory:[^\n]+ -->$/, ""),
		"**Which default?**\n\nEnglish\n\nRationale: Shared readers",
	);
	assert.equal(
		activities.filter((value) => value.content.type === "response").length,
		0,
	);
	assert.equal(
		activities.filter((value) => value.content.body === "CI checks pending")
			.length,
		2,
	);
	assert.equal(
		activities.filter(
			(value) => value.content.body === "CI checks failed: fixture access",
		).length,
		1,
	);
	assert(activities.every((value) => !/^\s*[{[]/.test(value.content.body)));
	assert(
		rawMessages.some(
			(value: any) =>
				value.type === "result" && value.result.includes('"decisions"'),
		),
	);
	assert(
		manager
			.serializeState()
			.entries[sessionId].some((value) => value.metadata?.factoryStepKey),
	);
	assert.equal(
		comments[1].body.replace(/\n\n<!-- factory:[^\n]+ -->$/, ""),
		"Delivered: https://github.com/example/fixture/pull/1. The Git provider confirmed merge.\n\nReadable publishing implemented.\n\nVerification:\n- Simulated provider checks passed",
	);
	const rawBuild = `${"Building module successfully\n".repeat(2000)}src/app.ts:42 error TS2345: Invalid argument\nExpected a string.\n${"Build details\n".repeat(1000)}`;
	await wire.createAgentActivity({
		agentSessionId: sessionId,
		content: { type: "error", body: rawBuild },
	});
	const failure = activities.at(-1).content;
	assert.equal(failure.type, "thought");
	assert.equal(
		failure.body,
		"Building module successfully\nsrc/app.ts:42 error TS2345: Invalid argument\nExpected a string.\nBuild details…\n\nFull output is retained in Factory.",
	);
	const afterFailure = activities.length;
	await wire.createAgentActivity({
		agentSessionId: sessionId,
		content: {
			type: "response",
			body: '```json\n{"findings":[],"summary":"Review completed"}\n```',
		},
	});
	assert.equal(activities.length, afterFailure);
	assert.equal(comments.filter((value) => value.implicit).length, 0);
	const before = activities.length + comments.length;
	tracking.stop();
	wire.stopDelivery();
	wire = makeWire();
	const restored = new WorkflowRuntime(home, hooks).get(run.id);
	tracking = new TicketTracking(
		async () =>
			nativeAdapter(restored.ticketReference as any, tracker, {
				getTranscriptSession: async () => sessionId,
			}),
		() => {},
		() => {},
	);
	await tracking.flush(restored);
	await wire.flushActivityDelivery();
	assert.equal(activities.length + comments.length, before);
	assert.equal(unhandled.length, 0);
	console.log(
		JSON.stringify({
			result: "PASS",
			mode: "mock",
			standaloneDocumentationComments: comments.length,
			operationalComments: 0,
			clarificationEvents: 1,
			deliveryResponses: 0,
			restartDuplicates: 0,
			nestedAndParallel: true,
			localMessages: rawMessages.length,
			unhandled: 0,
		}),
	);
} finally {
	tracking?.stop();
	wire?.stopDelivery();
	await server.close();
	process.off("unhandledRejection", onUnhandled);
	rmSync(home, { recursive: true, force: true });
}
