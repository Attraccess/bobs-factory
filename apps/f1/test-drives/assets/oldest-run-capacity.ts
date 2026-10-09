// F1_AGENT_MODE=mock bun apps/f1/test-drives/assets/oldest-run-capacity.ts
// Real issue RPC, EdgeWorker, worktrees, coordinator and workflow recovery.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowRuntime } from "../../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";
import { EdgeWorker } from "../../../../packages/edge-worker/dist/index.js";
import { MachineCapacity } from "../../../../packages/edge-worker/dist/MachineCapacity.js";
import { f1AgentHandlers } from "../../src/MockAgentRunner.js";

assert.equal(process.env.F1_AGENT_MODE, "mock");
// Keep fixture execution independent of the parent agent's accepted home/lease.
for (const key of Object.keys(process.env))
	if (key.startsWith("BOBS_FACTORY_")) delete process.env[key];
const directory = realpathSync(
	mkdtempSync(join(tmpdir(), "f1-oldest-capacity-")),
);
const home = join(directory, "home"),
	repo = join(directory, "repo");
mkdirSync(home);
mkdirSync(repo);
const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: repo, encoding: "utf8" });
git("init", "-q", "-b", "main");
git("config", "user.name", "F1 fixture");
git("config", "user.email", "f1@example.invalid");
writeFileSync(join(repo, "README.md"), "# Capacity fixture\n");
git("add", ".");
git("-c", "commit.gpgsign=false", "commit", "-qm", "Initial fixture");
git("remote", "add", "origin", repo);
process.env.BOBS_FACTORY_FACTORY_PORT = "3660";
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	directory,
	"empty-legacy-pool",
);
const events: { kind: string; at: string }[] = [];
const counts = new Map<string, number>();
const record = (kind: string) => {
	events.push({ kind, at: new Date().toISOString() });
	writeFileSync(
		join(directory, "events.json"),
		JSON.stringify(events, null, 2),
	);
};
const touch = (name: string) => writeFileSync(join(directory, name), "ready");
async function until<T>(
	check: () => T | Promise<T>,
	label: string,
): Promise<NonNullable<T>> {
	const deadline = Date.now() + 20000;
	while (Date.now() < deadline) {
		const value = await check();
		if (value) return value as NonNullable<T>;
		await new Promise((r) => setTimeout(r, 30));
	}
	throw new Error(`Timeout: ${label}`);
}
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;
const waitFile = (file: string) =>
	`node -e ${shellQuote(`const fs=require('node:fs');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(join(directory, file))})){clearInterval(t);console.log('{}')}},30)`)}`;
const oldScript = `node -e ${shellQuote(`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(join(directory, "script-start"))},'started');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(join(directory, "release-script"))})){clearInterval(t);console.log('{}')}},30)`)}`;
let worker: any;
let runtime: any;
const config = {
	platform: "cli" as const,
	factoryHome: home,
	serverPort: 3661,
	serverHost: "127.0.0.1",
	maxConcurrentSessions: 1,
	defaultRunner: "codex" as const,
	linearWorkspaces: {
		"cli-workspace": { linearToken: "cli-mode-no-token-needed" },
	},
	repositories: [
		{
			id: "fixture",
			name: "Capacity fixture",
			repositoryPath: repo,
			workspaceBaseDir: join(directory, "worktrees"),
			baseBranch: "main",
			linearWorkspaceId: "cli-workspace",
			isActive: true,
		},
	],
	handlers: {
		...f1AgentHandlers("mock"),
		createAgentRunner: (type: any, config: any) => {
			const run = [...(runtime?.runs.values() ?? [])].find(
				(run: any) => run.workspace === config.workingDirectory,
			) as any;
			const label =
				config.workspaceName === "fixture-interactive"
					? "Interactive"
					: run?.outputs.ticket?.title;
			const human = label === "Human";
			const output =
				human && !run.answers?.length
					? { questions: ["Resume the fixture?"], summary: "Waiting" }
					: human
						? { questions: [] }
						: {};
			const native = f1AgentHandlers("mock", JSON.stringify(output))!
				.createAgentRunner!(type, config);
			if (!label || human) return native;
			let cancelled = false;
			return new Proxy(native, {
				get(target, property, receiver) {
					if (property === "start")
						return async (prompt: string) => {
							const attempt = (counts.get(label) ?? 0) + 1;
							counts.set(label, attempt);
							record(`${label}:${attempt}:start`);
							await until(() => {
								if (cancelled) throw new Error("Fixture provider stopped");
								return existsSync(
									join(directory, `release-${label}-${attempt}`),
								);
							}, `${label} release`);
							const result = await target.start(prompt);
							record(`${label}:${attempt}:end`);
							return result;
						};
					if (property === "stop")
						return () => {
							cancelled = true;
							target.stop();
						};
					const value = Reflect.get(target, property, receiver);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
		},
	},
};
function construct() {
	worker = new EdgeWorker(config);
	runtime = worker.getFactoryRuntime();
}
async function rpc(method: string, params: any = {}) {
	const response = await fetch("http://127.0.0.1:3661/cli/rpc", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
	});
	const data = await response.json();
	assert(!data.error, JSON.stringify(data.error));
	return data.result;
}
async function launch(title: string, workflow: string) {
	const { issue } = await rpc("createIssue", {
		teamId: "team-default",
		title,
		description: `[workflow=${workflow}]`,
	});
	const { session } = await rpc("startSession", { issueId: issue.id });
	const run = await until(
		() => runtime.runs.get(session.sessionId),
		`${title} run`,
	);
	return { run, sessionId: session.sessionId, issueId: issue.id };
}
const interactive = () =>
	worker.createRunnerForType(
		"codex",
		{
			factoryHome: home,
			workingDirectory: repo,
			workspaceName: "fixture-interactive",
		},
		undefined,
		"fixture-interactive",
	);
const snapshot = async (name: string) => {
	const value = await worker.runnerSlots.snapshot();
	writeFileSync(
		join(directory, `${name}.json`),
		JSON.stringify(value, null, 2),
	);
	return value;
};
try {
	construct();
	runtime.updateWorkflows(
		[
			...runtime.listWorkflows(),
			{
				id: "age-child",
				name: "Age child",
				allowedTriggers: ["workflow"],
				steps: [
					{
						id: "old-agent",
						name: "Old agent",
						type: "agent",
						prompt: "Return an empty object.",
					},
				],
			},
			{
				id: "age-old",
				name: "Older nested fanout",
				allowedTriggers: ["ticket-assignment", "manual"],
				steps: [
					{
						id: "gate",
						name: "Passive gate",
						type: "script",
						computeIntensive: false,
						script: waitFile("gate-old"),
					},
					{
						id: "parallel",
						name: "Parallel leaves",
						type: "fanout",
						groups: [
							[
								{
									id: "call",
									name: "Child",
									type: "workflow",
									workflow: "age-child",
								},
							],
							[
								{
									id: "script-gate",
									name: "Script gate",
									type: "script",
									computeIntensive: false,
									script: waitFile("gate-script"),
								},
								{
									id: "old-script",
									name: "Intensive script",
									type: "script",
									script: oldScript,
								},
							],
						],
					},
				],
			},
			{
				id: "age-new",
				name: "Newer",
				allowedTriggers: ["ticket-assignment", "manual"],
				steps: [
					{
						id: "gate",
						name: "Passive gate",
						type: "script",
						computeIntensive: false,
						script: waitFile("gate-new"),
					},
					{
						id: "new-agent",
						name: "New agent",
						type: "agent",
						prompt: "Return an empty object.",
					},
				],
			},
			...["cancel", "spare"].map((kind) => ({
				id: `age-${kind}`,
				name: kind,
				allowedTriggers: ["ticket-assignment", "manual"],
				steps: [
					{
						id: "gate",
						name: "Passive gate",
						type: "script",
						computeIntensive: false,
						script: waitFile(`gate-${kind}`),
					},
					{
						id: "agent",
						name: "Agent",
						type: "agent",
						prompt: "Return an empty object.",
					},
				],
			})),
			{
				id: "age-human",
				name: "Human wait",
				allowedTriggers: ["ticket-assignment", "manual"],
				steps: [
					{
						id: "question",
						name: "Question",
						type: "agent",
						askQuestions: true,
						prompt:
							"Ask a question, then return an empty object after the answer.",
					},
				],
			},
		],
		"age-new",
	);
	await worker.start();
	const older = await launch("Older", "age-old");
	const newer = await launch("Newer", "age-new");
	await until(
		async () => (await worker.runnerSlots.snapshot()).active === 0,
		"passive gates own no slots",
	);
	assert(Date.parse(older.run.createdAt) < Date.parse(newer.run.createdAt));
	const blocker = await worker.runnerSlots.acquireLease();
	touch("gate-new");
	await until(
		async () =>
			(await worker.runnerSlots.snapshot()).requests.some((r: any) =>
				r.workflowRun?.identity.endsWith(`:run:${newer.run.id}`),
			),
		"newer enqueued",
	);
	worker.agentSessionManager.createChatSession(
		"fixture-interactive",
		{ path: repo },
		"fixture",
		[{ repositoryId: "fixture", baseBranchName: "main" }],
	);
	worker.sessionRepositories.set("fixture-interactive", "fixture");
	const interactiveRunner = interactive();
	const interactiveWork = interactiveRunner
		.start("Interactive fixture")
		.catch(() => {});
	await until(
		async () =>
			(await worker.runnerSlots.snapshot()).requests.some((r: any) =>
				r.identity.endsWith(":session:fixture-interactive"),
			),
		"interactive enqueued",
	);
	touch("gate-old");
	await until(
		async () =>
			(await worker.runnerSlots.snapshot()).requests.some((r: any) =>
				r.identity.endsWith("/old-agent:1"),
			),
		"nested agent queued first",
	);
	touch("gate-script");
	await until(
		async () =>
			(await worker.runnerSlots.snapshot()).requests.filter((r: any) =>
				r.workflowRun?.identity.endsWith(`:run:${older.run.id}`),
			).length === 2,
		"nested old leaves queued",
	);
	const before = await snapshot("before-priority");
	const original = before.requests.find((r: any) =>
		r.workflowRun?.identity.endsWith(`:run:${newer.run.id}`),
	);
	await blocker.release();
	await until(() => counts.get("Older") === 1, "older admitted first");
	const exchanged = await snapshot("exchanged");
	const moved = exchanged.requests.find((r: any) => r.id === original.id);
	assert.equal(moved.sequence, original.sequence);
	assert.equal(moved.queuedAt, original.queuedAt);
	assert(moved.admissionPosition > original.admissionPosition);
	touch("release-Older-1");
	await until(
		() => counts.get("Interactive") === 1,
		"interactive retains middle position",
	);
	await until(
		() => older.run.checkpoint?.active?.children?.[0]?.current === "end",
		"completed nested child persisted",
	);
	await snapshot("before-restart");
	const trackerState = worker.issueTrackers.get("cli-workspace").state;
	const stopping = worker.stop();
	await until(() => worker.runnerSlots.closing, "coordinator shutdown started");
	interactiveRunner.stop();
	await Promise.all([stopping, interactiveWork]);
	construct();
	// Simulate the external tracker surviving a worker restart.
	worker.issueTrackers.get("cli-workspace").state = trackerState;
	const restartBlock = await worker.runnerSlots.acquireLease();
	await worker.start();
	const resumedInteractive = interactive();
	const resumedInteractiveWork = resumedInteractive.start(
		"Rejoined interactive fixture",
	);
	await until(
		async () =>
			(await worker.runnerSlots.snapshot()).requests.some(
				(r: any) =>
					r.identity.endsWith(":session:fixture-interactive") && !r.parked,
			),
		"interactive rejoined",
	);
	const restored = await snapshot("restored-positions");
	const retained = restored.requests.find((r: any) => r.id === original.id);
	assert.equal(retained.admissionPosition, moved.admissionPosition);
	assert.equal(retained.sequence, original.sequence);
	assert.equal(retained.queuedAt, original.queuedAt);
	await restartBlock.release();
	await until(
		() => counts.get("Interactive") === 2,
		"interactive before newer after restart",
	);
	assert.equal(counts.get("Newer"), undefined);
	assert.equal(counts.get("Older"), 1);
	touch("release-Interactive-2");
	await resumedInteractiveWork;
	await until(
		() => existsSync(join(directory, "script-start")),
		"old intensive script admitted",
	);
	assert.equal(counts.get("Newer"), undefined);
	touch("release-script");
	await until(
		() => counts.get("Newer") === 1,
		"newer fills remaining capacity",
	);
	touch("release-Newer-1");
	await until(
		() =>
			runtime.runs.get(older.run.id).status === "completed" &&
			runtime.runs.get(newer.run.id).status === "completed",
		"both complete",
	);
	const spareRuns = [];
	for (const label of ["SpareOld", "SpareNew1", "SpareNew2"])
		spareRuns.push(await launch(label, "age-spare"));
	await until(
		async () => (await worker.runnerSlots.snapshot()).active === 0,
		"spare runs waiting passively",
	);
	const spareBlock = await worker.runnerSlots.acquireLease();
	touch("gate-spare");
	await until(
		async () =>
			(await worker.runnerSlots.snapshot()).requests.filter((r: any) =>
				spareRuns.some((s) =>
					r.workflowRun?.identity.endsWith(`:run:${s.run.id}`),
				),
			).length === 3,
		"spare jobs queued",
	);
	await worker.runnerSlots.setLimit(3);
	await until(
		() => counts.get("SpareOld") === 1 && counts.get("SpareNew1") === 1,
		"old and newer fill free slots",
	);
	assert.equal(counts.get("SpareNew2"), undefined);
	await spareBlock.release();
	await until(
		() => counts.get("SpareNew2") === 1,
		"third slot filled while old is still executing",
	);
	await snapshot("spare-slots");
	for (const label of ["SpareOld", "SpareNew1", "SpareNew2"])
		touch(`release-${label}-1`);
	await until(
		() => spareRuns.every((s) => s.run.status === "completed"),
		"spare runs completed",
	);
	await worker.runnerSlots.setLimit(1);
	const human = await launch("Human", "age-human");
	await until(() => human.run.status === "waiting", "human waiting");
	await until(
		async () => (await worker.runnerSlots.snapshot()).active === 0,
		"human waiter releases capacity",
	);
	const cancelled = await launch("Cancelled", "age-cancel");
	const hold = await worker.runnerSlots.acquireLease();
	touch("gate-cancel");
	await until(
		async () =>
			(await worker.runnerSlots.snapshot()).requests.some((r: any) =>
				r.workflowRun?.identity.endsWith(`:run:${cancelled.run.id}`),
			),
		"cancelled queued",
	);
	await rpc("stopSession", { sessionId: cancelled.sessionId });
	await until(() => cancelled.run.status === "stopped", "queued run stopped");
	await hold.release();
	assert.equal(counts.get("Cancelled"), undefined);
	runtime.answer(human.run.id, "Resume");
	await until(() => human.run.status === "completed", "human resumed");
	// Provider operations are simulated; delivery coordination and capacity are real.
	let finishCI!: () => void;
	const ci = new Promise<void>((resolve) => {
		finishCI = resolve;
	});
	const deliveryRuntime = new WorkflowRuntime(
		join(directory, "delivery-home"),
		{
			capacity: worker.runnerSlots,
			agent: async (context) => {
				const lease = await worker.runnerSlots.acquireLease(
					context.signal,
					context.capacity,
				);
				try {
					return {};
				} finally {
					await lease.release();
				}
			},
			script: async () => ({}),
			tool: async ({ run, step }) => {
				if (run.input === "first" && step.tool === "ci") await ci;
				return { url: "https://github.com/f1/local-test/pull/1", merged: true };
			},
		},
	);
	deliveryRuntime.updateWorkflows(
		[
			...deliveryRuntime.listWorkflows(),
			{
				id: "delivery-fixture",
				name: "Delivery fixture",
				allowedTriggers: ["manual"],
				steps: [
					{
						id: "implement",
						name: "Implement",
						type: "agent",
						prompt: "Simulated implementation",
					},
					{ id: "draft-pr", name: "Integrate", type: "tool", tool: "draft-pr" },
					{ id: "ci", name: "CI", type: "tool", tool: "ci" },
					{
						id: "capture",
						name: "Capture",
						type: "agent",
						prompt: "Simulated capture",
					},
					{ id: "merge", name: "Merge", type: "tool", tool: "merge" },
				],
			},
		],
		"delivery-fixture",
	);
	const definition = deliveryRuntime
		.listWorkflows()
		.find((w) => w.id === "delivery-fixture")!;
	const deliveries = ["first", "second"].map((input) => {
		const run = deliveryRuntime.create({
			title: input,
			repositoryId: "fixture",
			workflow: definition,
			workspace: repo,
			input,
			triggerOrigin: {
				type: "manual",
				workflowId: definition.id,
				at: new Date().toISOString(),
			},
		});
		run.outputs.repository = {
			githubUrl: "https://github.com/f1/local-test",
			baseBranch: "main",
		};
		return run;
	});
	const firstDelivery = deliveryRuntime.launch(deliveries[0]!);
	await until(
		() => deliveries[0]!.capacityLeaves?.ci?.phase === "waiting-ci",
		"passive CI reached",
	);
	const secondDelivery = deliveryRuntime.launch(deliveries[1]!);
	await until(
		() => deliveries[1]!.deliveryCoordination?.phase === "queued",
		"overlapping delivery waits",
	);
	assert.equal((await worker.runnerSlots.snapshot()).active, 0);
	assert.equal((await worker.runnerSlots.snapshot()).queued, 0);
	writeFileSync(
		join(directory, "delivery-wait.json"),
		JSON.stringify(deliveries, null, 2),
	);
	finishCI();
	await Promise.all([firstDelivery, secondDelivery]);
	assert(deliveries.every((run) => run.status === "completed"));
	writeFileSync(
		join(directory, "delivery-completed.json"),
		JSON.stringify(deliveries, null, 2),
	);
	const separate = new MachineCapacity(
		2,
		join(directory, "other-home", "machine-capacity"),
	);
	const lease = await separate.acquireLease();
	assert.equal((await worker.runnerSlots.snapshot()).active, 0);
	await lease.release();
	await separate.shutdown();
	const activity = await rpc("viewSession", {
		sessionId: older.sessionId,
		limit: 100,
		offset: 0,
	});
	writeFileSync(
		join(directory, "activities.json"),
		JSON.stringify(activity, null, 2),
	);
	await until(
		async () => (await worker.runnerSlots.snapshot()).requests.length === 0,
		"pool drained",
	);
	const receipts = [...runtime.runs.values()];
	writeFileSync(
		join(directory, "run-receipts.json"),
		JSON.stringify(receipts, null, 2),
	);
	assert(
		receipts.some((run: any) =>
			run.events.some((e: any) =>
				e.message.includes("Waiting for instance capacity"),
			),
		),
	);
	assert(
		receipts.some((run: any) =>
			run.events.some((e: any) =>
				e.message.includes("Instance capacity admitted"),
			),
		),
	);
	await snapshot("final");
	console.log(
		JSON.stringify({
			passed: true,
			directory,
			events,
			checks: [
				"oldest later enqueue",
				"nested fanout age",
				"interactive position",
				"original queue metadata",
				"durable restart",
				"completed branch not repeated",
				"intensive script admission",
				"newer spare use",
				"human wait/resume",
				"passive CI and overlapping delivery waits",
				"queued cancellation",
				"independent home",
				"queue/admission activity",
				"cleanup",
			],
		}),
	);
} finally {
	await worker?.stop();
}
