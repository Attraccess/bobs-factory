import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	LINEAR_WEBHOOK_IPS,
	WebhookIpValidator,
} from "../../../../packages/core/src/security/WebhookIpValidator.ts";
import { AgentSessionManager } from "../../../../packages/edge-worker/src/AgentSessionManager.ts";
import { LinearActivitySink } from "../../../../packages/edge-worker/src/sinks/LinearActivitySink.ts";
import { LinearEventTransport } from "../../../../packages/linear-event-transport/src/LinearEventTransport.ts";
import { LinearIssueTrackerService } from "../../../../packages/linear-event-transport/src/LinearIssueTrackerService.ts";
import { MockAgentRunner } from "../../src/MockAgentRunner.ts";

// Load provider dependencies from their owning package. No model CLI or live workspace is used.
const require = createRequire(
	new URL(
		"../../../../packages/linear-event-transport/package.json",
		import.meta.url,
	),
);
const { LinearClient } = require("@linear/sdk");
const Fastify = require("fastify");
const home = mkdtempSync(join(tmpdir(), "f1-linear-delivery-104-110-"));
const provider = Fastify();
const ingress = Fastify({ trustProxy: "127.0.0.1" });
const nativeFetch = globalThis.fetch;
const nativeNow = Date.now;
let clock = nativeNow();
const unhandled: unknown[] = [];
const onUnhandled = (error: unknown) => unhandled.push(error);
process.on("unhandledRejection", onUnhandled);
Date.now = () => clock;
let tracker: LinearIssueTrackerService | undefined;
const credentialTrackers: LinearIssueTrackerService[] = [];
const rotatedRequests: { authorization: string; at: number; type: string }[] =
	[];
let rotationThrottled = true;
const remote = new Map<string, any>();
const mutations: any[] = [];
let requests = 0;
let throttled = true;
let lostFinal = false;
let runnersStarted = 0;
const sessionId = randomUUID();
const workspaceId = randomUUID();
const finalBody = "Delivered fixture PR with targeted validation.";

try {
	provider.post("/rotated-graphql", async (request: any, reply: any) => {
		rotatedRequests.push({
			authorization: request.headers.authorization,
			at: clock,
			type: request.body.variables.input.content.type,
		});
		if (rotationThrottled)
			return reply
				.code(429)
				.header("retry-after", "120")
				.send({
					errors: [{ message: "credential rotation fixture throttle" }],
				});
		return {
			data: {
				agentActivityCreate: {
					success: true,
					agentActivity: { id: request.body.variables.input.id },
					lastSyncId: 1,
				},
			},
		};
	});
	provider.post("/graphql", async (request: any, reply: any) => {
		requests++;
		const { variables } = request.body;
		if (!variables.input)
			return { data: { agentActivity: remote.get(variables.id) } };
		if (throttled)
			return reply
				.code(400)
				.header("retry-after", "1")
				.send({
					errors: [
						{
							message: "fixture throttle",
							extensions: { code: "RATELIMITED", type: "ratelimited" },
						},
					],
				});
		const input = variables.input;
		mutations.push(input);
		remote.set(input.id, {
			id: input.id,
			content: input.content,
			agentSession: { id: input.agentSessionId },
		});
		if (input.content.type === "response" && !lostFinal) {
			lostFinal = true;
			reply.raw.destroy(); // Provider accepted the mutation, but the receipt is lost.
			return reply;
		}
		return {
			data: {
				agentActivityCreate: {
					success: true,
					agentActivity: { id: input.id },
					lastSyncId: 1,
				},
			},
		};
	});
	const providerUrl = await provider.listen({ host: "127.0.0.1", port: 0 });
	const makeTracker = () =>
		new LinearIssueTrackerService(
			new LinearClient({
				accessToken: "isolated-f1-fixture",
				apiUrl: `${providerUrl}/graphql`,
			}),
			undefined,
			undefined,
			{ factoryHome: home, workspaceId, requestIntervalMs: 0 },
		);
	tracker = makeTracker();
	const manager = new AgentSessionManager();
	const rotatedWorkspace = randomUUID();
	const rotatedSession = randomUUID();
	const rotatedOptions = {
		factoryHome: home,
		workspaceId: rotatedWorkspace,
		requestIntervalMs: 0,
	};
	const rotatingTracker = new LinearIssueTrackerService(
		new LinearClient({
			accessToken: "f1-credential-before",
			apiUrl: `${providerUrl}/rotated-graphql`,
		}),
		undefined,
		undefined,
		rotatedOptions,
	);
	credentialTrackers.push(rotatingTracker);
	rotatingTracker.setAccessToken("f1-credential-after");
	manager.createCyrusAgentSession(
		rotatedSession,
		"rotation-issue",
		{
			id: "rotation-issue",
			identifier: "F1-104-ROTATION",
			title: "Credential rotation",
		},
		{ path: home, isGitWorktree: false },
	);
	manager.setActivitySink(
		rotatedSession,
		new LinearActivitySink(rotatingTracker, rotatedWorkspace),
	);
	const rotatedRunner = new MockAgentRunner(
		{
			factoryHome: home,
			workingDirectory: home,
			onMessage: (message: any) =>
				manager.handleClaudeMessage(rotatedSession, message),
		},
		"Credential rotation final remains deliverable.",
	);
	await rotatedRunner.start("Credential rotation fixture");
	assert.equal(rotatedRequests.length, 1);
	assert.equal(rotatingTracker.getActivityDeliveryStatus().pending, 2);
	rotatingTracker.stopDelivery();
	const replacementTracker = new LinearIssueTrackerService(
		new LinearClient({
			accessToken: "f1-credential-after",
			apiUrl: `${providerUrl}/rotated-graphql`,
		}),
		undefined,
		undefined,
		rotatedOptions,
	);
	credentialTrackers.push(replacementTracker);
	await replacementTracker
		.createAgentActivity({
			id: randomUUID(),
			agentSessionId: rotatedSession,
			content: {
				type: "elicitation",
				body: "Confirm the rotated credential's delivery.",
			},
		})
		.catch(() => undefined);
	assert.equal(
		rotatedRequests.length,
		1,
		"replacement using new credential observes the same 120-second cooldown",
	);
	assert.equal(replacementTracker.getActivityDeliveryStatus().pending, 3);
	rotationThrottled = false;
	clock += 120_001;
	await replacementTracker.flushActivityDelivery();
	assert.equal(replacementTracker.getActivityDeliveryStatus().pending, 0);
	assert.equal(replacementTracker.getActivityDeliveryStatus().delivered, 3);
	assert.equal(rotatedRequests.length, 4);
	assert(
		rotatedRequests.every(
			(request) => request.authorization === "Bearer f1-credential-after",
		),
	);
	assert.equal(rotatedRequests[1].at - rotatedRequests[0].at, 120_001);
	assert.deepEqual(
		rotatedRequests.map((request) => request.type),
		["thought", "response", "elicitation", "thought"],
	);
	assert(
		manager
			.getSessionEntries(rotatedSession)
			.some((entry) =>
				entry.content.includes(
					"Credential rotation final remains deliverable.",
				),
			),
	);
	replacementTracker.stopDelivery();
	const session = manager.createCyrusAgentSession(
		sessionId,
		"fixture-issue",
		{ id: "fixture-issue", identifier: "F1-104", title: "Durable delivery" },
		{ path: home, isGitWorktree: false },
	);
	const sink = new LinearActivitySink(tracker, workspaceId);
	manager.setActivitySink(sessionId, sink);
	const runner = new MockAgentRunner(
		{
			factoryHome: home,
			workingDirectory: home,
			onMessage: (message: any) =>
				manager.handleClaudeMessage(sessionId, message),
		},
		finalBody,
	);
	session.agentRunner = runner;
	const validator = new WebhookIpValidator();
	const transport = new LinearEventTransport({
		fastifyServer: ingress,
		verificationMode: "direct",
		secret: "f1-ingress-secret",
		ipAllowlist: () => validator.getAllowlist("linear"),
	});
	let work: Promise<unknown> | undefined;
	transport.on("event", () => {
		if (!work) {
			runnersStarted++;
			work = runner.start("Fixture issue");
		}
	});
	transport.register();
	await ingress.listen({ host: "127.0.0.1", port: 0 });
	const payload = {
		type: "Issue",
		action: "create",
		data: { id: "fixture-issue" },
	};
	const signature = createHmac("sha256", "f1-ingress-secret")
		.update(JSON.stringify(payload))
		.digest("hex");
	const post = (ip: string, signed = signature, forwarded?: string) =>
		ingress.inject({
			method: "POST",
			url: "/linear-webhook",
			remoteAddress: ip,
			headers: {
				"linear-signature": signed,
				...(forwarded ? { "x-forwarded-for": forwarded } : {}),
			},
			payload,
		});
	for (const ip of LINEAR_WEBHOOK_IPS)
		assert.equal((await post(ip)).statusCode, 200);
	assert.equal((await post("35.246.210.220", "0".repeat(64))).statusCode, 401);
	assert.equal(
		(await post("203.0.113.8", signature, "35.246.210.220")).statusCode,
		403,
	);
	await work;
	assert.equal(runnersStarted, 1);
	assert.equal(runner.getMessages().length, 3);
	assert.equal(
		requests,
		1,
		"one provider throttle should stop the request storm",
	);
	for (let index = 0; index < 20; index++)
		await sink
			.postActivity(sessionId, { type: "thought", body: "Waiting for CI" })
			.catch(() => undefined);
	await sink
		.postActivity(sessionId, {
			type: "elicitation",
			body: "Which deployment target?",
		})
		.catch(() => undefined);
	assert.equal(requests, 1);
	assert.equal(
		tracker.getActivityDeliveryStatus().pending,
		4,
		"model progress + final + coalesced CI progress + question retained",
	);
	assert(
		manager
			.getSessionEntries(sessionId)
			.some((entry) => entry.content.includes(finalBody)),
		"local final evidence is retained while delivery waits",
	);
	throttled = false;
	clock += 30_001;
	await tracker.flushActivityDelivery();
	assert.equal(
		tracker.getActivityDeliveryStatus().pending,
		1,
		"only the lost final receipt should remain ambiguous",
	);
	assert.equal(
		mutations[0].content.type,
		"response",
		"necessary delivery precedes routine progress after cooldown",
	);
	assert.equal(mutations[1].content.type, "elicitation");
	assert.equal(
		mutations.filter((entry) => entry.content.body === "Waiting for CI").length,
		1,
	);
	tracker.stopDelivery();
	tracker = makeTracker();
	clock += 30_001;
	await tracker.flushActivityDelivery();
	assert.deepEqual(tracker.getActivityDeliveryStatus(), {
		pending: 0,
		delivered: 4,
		superseded: 0,
		error: undefined,
		nextAttemptAt: undefined,
	});
	assert.equal(
		mutations.filter((entry) => entry.content.type === "response").length,
		1,
		"restart reconciles accepted final without repeating its mutation",
	);
	assert.equal(
		runnersStarted,
		1,
		"delivery recovery does not replay agent development",
	);
	assert.equal(
		requests,
		6,
		"one throttle + four mutations + one reconciliation lookup",
	);
	assert(remote.get(mutations[0].id)?.content.body.includes(finalBody));
	globalThis.fetch = (async () =>
		new Response(JSON.stringify({ ips: ["203.0.113.7/32"] }), {
			status: 200,
		})) as typeof fetch;
	assert.equal((await validator.refreshLinearAllowlist()).status, "updated");
	assert.equal((await post("203.0.113.7")).statusCode, 200);
	assert.equal((await post("35.246.210.220")).statusCode, 403);
	globalThis.fetch = (async () => {
		throw new Error("fixture refresh offline");
	}) as typeof fetch;
	assert.equal((await validator.refreshLinearAllowlist()).status, "failed");
	assert.equal(
		(await post("203.0.113.7")).statusCode,
		200,
		"refresh failure retains the verified snapshot",
	);
	const custom = new WebhookIpValidator({
		customAllowlists: { linear: ["192.0.2.7"] },
	});
	assert.equal((await custom.refreshLinearAllowlist()).status, "custom");
	assert.deepEqual(custom.getAllowlist("linear"), ["192.0.2.7"]);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(unhandled, []);
	console.log(
		JSON.stringify({
			result: "PASS",
			mode: "mock",
			publishedSources: LINEAR_WEBHOOK_IPS.length,
			requests,
			acceptedMutations: mutations.length,
			runnersStarted,
			pending: tracker.getActivityDeliveryStatus().pending,
			delivered: tracker.getActivityDeliveryStatus().delivered,
			unhandled: unhandled.length,
			ports: "ephemeral",
			credentialRotation: {
				requests: rotatedRequests.length,
				delivered: 3,
				cooldownMs: 120_001,
			},
		}),
	);
} finally {
	tracker?.stopDelivery();
	for (const credentialTracker of credentialTrackers)
		credentialTracker.stopDelivery();
	Date.now = nativeNow;
	globalThis.fetch = nativeFetch;
	process.off("unhandledRejection", onUnhandled);
	await ingress.close();
	await provider.close();
	rmSync(home, { recursive: true, force: true });
}
