// F1_AGENT_MODE=mock node apps/f1/test-drives/assets/update-maintenance.mjs
// Actual EdgeWorker startup, OperatorServer/Service and UpdateDrain. Tracker
// fetches and final ticket routing are controlled; no native/OS restart claim.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EdgeWorker } from "../../../../packages/edge-worker/dist/EdgeWorker.js";
import { LaunchAdmission } from "../../../../packages/edge-worker/dist/factory/LaunchAdmission.js";
import { OperatorGrants } from "../../../../packages/edge-worker/dist/factory/OperatorGrants.js";
import { WorkflowRuntime } from "../../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";
import { UpdateManager } from "../../../../packages/edge-worker/dist/updates/UpdateManager.js";
import { f1AgentHandlers } from "../../dist/src/MockAgentRunner.js";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const home = mkdtempSync(join(tmpdir(), "f1-update-maintenance-"));
const seedRuntime = new WorkflowRuntime(home, {
	agent: async () => ({}),
	script: async () => ({}),
	tool: async () => ({}),
});
const waiting = seedRuntime.create({
	id: "retained-wait",
	title: "Retained wait",
	repositoryId: "fixture",
	workspace: home,
	input: "fixture",
	triggerOrigin: {
		type: "manual",
		workflowId: "fixture",
		at: new Date().toISOString(),
	},
	workflow: {
		id: "fixture",
		name: "Fixture",
		allowedTriggers: ["manual"],
		steps: [
			{
				id: "question",
				name: "Question",
				type: "agent",
				prompt: "Mock",
				askQuestions: true,
				next: "end",
			},
		],
	},
});
waiting.status = "waiting";
waiting.questions = ["Retained question"];
waiting.questionBatchId = "retained-batch";
waiting.checkpoint = {
	step: "question",
	agent: { runner: "codex", sessionId: "mock-retained-native-session" },
};
seedRuntime.save(waiting);
await seedRuntime.shutdown();
const manager = new UpdateManager(home);
manager.configure({}, 0);
const candidate = {
	version: "1.1.0",
	channel: "stable",
	commit: "b".repeat(40),
	target: "darwin-arm64",
	manifestSha256: "c".repeat(64),
	publishedAt: "2026-10-10T16:00:00.000Z",
};
function transaction(id) {
	const state = JSON.parse(readFileSync(manager.file, "utf8"));
	state.transaction = {
		id,
		candidate,
		staged: {
			candidate,
			executable: "/fixture/new",
			previousExecutable: "/fixture/old",
		},
		previous: {
			version: "1.0.0",
			commit: "a".repeat(40),
			target: "darwin-arm64",
		},
		revision: 1,
		phase: "snapshot",
		switchStarted: false,
		startedAt: new Date().toISOString(),
	};
	writeFileSync(manager.file, JSON.stringify(state));
}
function finish() {
	const state = JSON.parse(readFileSync(manager.file, "utf8"));
	state.transaction.phase = "succeeded";
	state.transaction.release = {
		transactionId: state.transaction.id,
		outcome: "succeeded",
		status: "pending",
	};
	writeFileSync(manager.file, JSON.stringify(state));
}
const admission = new LaunchAdmission(home);
admission.reserve(
	{
		issueKey: "fixture-issue",
		sessionId: "pending-before-reboot",
		webhook: {
			organizationId: "fixture",
			agentSession: { id: "pending-before-reboot", issue: { id: "issue" } },
		},
		origin: {
			type: "ticket-assignment",
			workflowId: "simple",
			at: new Date().toISOString(),
			ticket: { provider: "cli", workspaceId: "fixture", issueId: "issue" },
		},
	},
	() => false,
);
transaction("reboot-maintenance");
writeFileSync(
	join(home, "updates", "maintenance.json"),
	JSON.stringify({ transactionId: "reboot-maintenance" }),
);
const initialReceipts = readFileSync(
	join(home, "factory", "ticket-deliveries.json"),
	"utf8",
);
const worker = new EdgeWorker({
	platform: "cli",
	factoryHome: home,
	repositories: [],
	serverPort: 0,
	serverHost: "127.0.0.1",
	handlers: f1AgentHandlers("mock"),
});
const receipts = [];
let fetches = 0,
	routes = 0;
worker.fetchFullIssueDetails = async () => {
	fetches++;
	return { id: "issue", title: "Fixture ticket", description: "fixture" };
};
worker.fetchIssueLabels = async () => [];
worker.routeAcceptedTicketLaunch = async (webhook) => {
	routes++;
	const receipt = worker
		.getLaunchAdmission()
		.get(webhook.organizationId, webhook.agentSession.id);
	worker.getLaunchAdmission().update(receipt, { phase: "settled" });
};
const until = async (check) => {
	const deadline = Date.now() + 10000;
	while (!check()) {
		assert.ok(Date.now() < deadline, "F1 fixture timeout");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
};
try {
	await worker.start();
	const runtime = worker.getFactoryRuntime(),
		drain = worker.updateDrain;
	assert.equal(fetches, 0);
	assert.equal(routes, 0);
	assert.equal(
		readFileSync(join(home, "factory", "ticket-deliveries.json"), "utf8"),
		initialReceipts,
	);
	const before = JSON.stringify(runtime.get(waiting.id));
	const grants = new OperatorGrants(home),
		issued = grants.issue("F1 synthetic operator", [
			"inspect",
			"operate",
			"configure",
		]);
	const client = JSON.parse(readFileSync(issued.credentialFile, "utf8"));
	const server = worker.operatorServer,
		service = server.service;
	const call = (name, args) =>
		server.app.inject({
			method: "POST",
			url: "/call",
			headers: {
				authorization: `Bearer ${client.token}`,
				"x-factory-instance": issued.instance,
				"x-factory-grant": issued.id,
			},
			payload: { name, arguments: args },
		});
	for (const name of [
		"stop_run",
		"answer_run",
		"resume_run",
		"retry_run",
		"steer_run",
		"retry_ticket_sync",
		"update_mcp_connection",
	]) {
		const response = await call(name, {
			runId: waiting.id,
			expectedRevision: service.revision(runtime.get(waiting.id)),
		});
		assert.equal(response.json().error.code, "update_maintenance");
	}
	assert.equal(
		(await call("inspect_run", { runId: waiting.id })).json().ok,
		true,
	);
	assert.equal(JSON.stringify(runtime.get(waiting.id)), before);
	assert.equal(
		runtime.get(waiting.id).checkpoint.agent.sessionId,
		"mock-retained-native-session",
	);
	receipts.push(
		"actual EdgeWorker reboot skips pending dispatch/preflight and retains receipt, waiting question and mock-native checkpoint",
	);
	receipts.push(
		"actual worker-owned OperatorServer rejects seven mutation tools during freeze and preserves authenticated inspection",
	);
	await assert.rejects(drain.end("wrong-transaction"), /mismatch/);
	assert.equal(fetches, 0);
	assert.equal(routes, 0);
	finish();
	await drain.end("reboot-maintenance");
	await until(() => routes === 1 && worker.inFlightTicketStarts.size === 0);
	assert.equal(fetches, 1);
	await drain.end("reboot-maintenance");
	assert.equal(routes, 1);
	receipts.push(
		"exact successful release deliberately resumes production pending dispatcher/preflight once; mismatched release does not resume",
	);

	let done;
	const hold = new Promise((resolve) => {
		done = resolve;
	});
	const originalUpdate = service.hooks.update;
	let entered = false;
	service.hooks.update = async () => {
		entered = true;
		await hold;
		writeFileSync(join(home, "config.json"), '{"fixtureApplied":true}');
		return { applied: true };
	};
	const accepted = call("update_mcp_connection", {
		runId: waiting.id,
		server: "fixture",
		expectedConfigRevision: "a".repeat(64),
		connection: { type: "http", url: "https://example.test/mcp" },
		permissions: ["inspect"],
	});
	await until(() => entered);
	transaction("accepted-operation");
	await drain.begin("accepted-operation");
	assert.equal((await drain.inspect()).idle, false);
	const digest = drain.receipt().preservedStateSha256;
	done();
	assert.equal((await accepted).json().ok, true);
	assert.equal((await drain.inspect()).idle, true);
	assert.notEqual(drain.receipt().preservedStateSha256, digest);
	service.hooks.update = originalUpdate;
	finish();
	await drain.end("accepted-operation");
	receipts.push(
		"awaited authenticated operator mutation admitted before freeze drains through final retained-state write before idle acknowledgment",
	);
	let finishPreflight;
	const preflightHold = new Promise((resolve) => {
		finishPreflight = resolve;
	});
	const fetchDetails = worker.fetchFullIssueDetails;
	let preflightEntered = false;
	worker.fetchFullIssueDetails = async (...args) => {
		preflightEntered = true;
		await preflightHold;
		return fetchDetails(...args);
	};
	const next = worker.getLaunchAdmission().reserve(
		{
			issueKey: "fixture-next",
			sessionId: "accepted-preflight",
			webhook: {
				organizationId: "fixture",
				agentSession: { id: "accepted-preflight", issue: { id: "issue" } },
			},
			origin: {
				type: "ticket-assignment",
				workflowId: "simple",
				at: new Date().toISOString(),
				ticket: { provider: "cli", workspaceId: "fixture", issueId: "issue" },
			},
		},
		() => false,
	);
	const launching = worker.startAcceptedTicketLaunch(next.receipt, []);
	await until(() => preflightEntered);
	transaction("accepted-preflight");
	await drain.begin("accepted-preflight");
	assert.equal((await drain.inspect()).idle, false);
	finishPreflight();
	await launching;
	assert.equal(worker.inFlightTicketStarts.size, 0);
	assert.equal((await drain.inspect()).idle, true);
	assert.equal(routes, 2);
	finish();
	await drain.end("accepted-preflight");
	receipts.push(
		"actual production ticket preflight admitted before freeze drains through routing and state persistence before idle acknowledgment",
	);
	const output = {
		mode: "mock",
		testedCommit: process.env.F1_TESTED_COMMIT ?? "working-tree",
		home,
		receipts,
		fetches,
		routes,
		limitations: [
			"Actual EdgeWorker startup/listeners; controlled tracker detail fetch and final route instead of agents/network",
			"Synthetic operator grant and seeded waiting checkpoint; no native session execution",
			"No PublishedUpdateSource successful signature/extraction or OwnedUpdateLifecycle/OS restart is exercised",
			"No production homes, real agent credits, signing or publication",
		],
	};
	const directory = process.env.F1_EVIDENCE_DIR ?? home;
	mkdirSync(directory, { recursive: true });
	const file = join(directory, "update-maintenance.json");
	writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
	console.log(JSON.stringify({ passed: receipts, receipt: file }));
} finally {
	await worker.stop();
}
