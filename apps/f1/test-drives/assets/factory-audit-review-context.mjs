import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

assert.equal(process.env.F1_AGENT_MODE, "mock");
delete process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE;
process.env.BOBS_FACTORY_FACTORY_PORT = "3601";
process.env.BOBS_FACTORY_DISABLE_REMOTE_SESSION_STORE = "1";
const root = process.cwd();
const home = mkdtempSync(join(tmpdir(), "factory-audit-review-context-"));
// Isolated fixture capacity must not inspect or interfere with live services.
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	home,
	"empty-legacy-capacity",
);
const repo = join(home, "repo");
mkdirSync(repo);
const evidence =
	process.env.FACTORY_AUDIT_EVIDENCE ?? join(home, "drive-evidence");
mkdirSync(evidence, { recursive: true });
const malformedMode = process.env.FACTORY_AUDIT_MALFORMED === "1";
const nativeFailureMode = process.env.FACTORY_AUDIT_NATIVE_FAILURE;
const git = (...args) =>
	execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
git("init", "-b", "main");
git("config", "user.name", "F1 Fixture");
git("config", "user.email", "fixture@example.test");
git("config", "commit.gpgsign", "false");
writeFileSync(
	join(repo, ".gitignore"),
	".claude/\n.codex/\n.cursor/\n.opencode/\n",
);
git("add", ".");
git("commit", "-m", "Initial fixture");
git("remote", "add", "origin", repo);
git("fetch", "origin");
await import(
	join(root, "packages/edge-worker/node_modules/reflect-metadata/Reflect.js")
);
const { EdgeWorker } = await import(
	join(root, "packages/edge-worker/dist/index.js")
);
const { WorkflowRuntime } = await import(
	join(root, "packages/edge-worker/dist/factory/WorkflowRuntime.js")
);
const { defaultWorkflows } = await import(
	join(root, "packages/edge-worker/dist/factory/defaultWorkflows.js")
);
const { FactoryAuthStore } = await import(
	join(root, "packages/edge-worker/dist/factory/FactoryAuthStore.js")
);
const { MockAgentRunner } = await import(
	join(root, "apps/f1/dist/src/MockAgentRunner.js")
);
const require = createRequire(join(root, "packages/mcp-tools/package.json"));
const { Client } = await import(
	require.resolve("@modelcontextprotocol/sdk/client/index.js")
);
const { StdioClientTransport } = await import(
	require.resolve("@modelcontextprotocol/sdk/client/stdio.js")
);

const workflow = {
	id: "audit-context",
	name: "Audit context fixture",
	labels: ["workflow:audit-context"],
	allowedTriggers: ["manual", "ticket-assignment"],
	steps: [
		{
			id: "implement",
			name: "Prepare real 3781-file fixture",
			type: "script",
			script: `node --input-type=module -e 'import {mkdirSync,writeFileSync} from "node:fs";import {execFileSync} from "node:child_process";mkdirSync("feature",{recursive:true});for(let i=0;i<3781;i++)writeFileSync("feature/file-"+i+".bin",Buffer.from([0,1,2]));execFileSync("git",["add","."]);execFileSync("git",["commit","-m","Fixture feature"],{stdio:"ignore"});console.log(JSON.stringify({status:"completed",summary:"Prepared complete binary fixture",checks:["3781 assets committed"],questions:[]}));'`,
		},
		{
			id: "ci",
			name: "Record fixture revision",
			type: "script",
			script: `node --input-type=module -e 'import {execFileSync} from "node:child_process";const git=(...args)=>execFileSync("git",args,{encoding:"utf8"}).trim();console.log(JSON.stringify({approved:true,baseSha:git("rev-parse","HEAD~1"),headSha:git("rev-parse","HEAD")}));'`,
		},
		{
			id: "code-review",
			name: "Audit review",
			type: "agent",
			runner: "claude",
			prompt: "[F1_ROLE=review] Inspect the complete fixture scope.",
			next: "review-gate",
		},
		{
			id: "review-gate",
			name: "Review gate",
			type: "tool",
			tool: "review-gate",
			branches: [
				{ when: { path: "approved", equals: false }, next: "code-fix" },
			],
			next: "guide",
		},
		{
			id: "code-fix",
			name: "Never replay implementation for missing input",
			type: "script",
			script: "exit 71",
			next: "code-review",
		},
		{
			id: "guide",
			name: "Large artifact guide",
			type: "agent",
			runner: "claude",
			prompt: "[F1_ROLE=guide] Author a complete feature guide.",
			next: "end",
		},
	],
};
const configRuntime = new WorkflowRuntime(home, {
	agent: async () => ({}),
	tool: async () => ({}),
	script: async () => ({}),
});
configRuntime.updateWorkflows([...defaultWorkflows, workflow]);
await configRuntime.shutdown();

let reviewTurns = 0,
	guideTurns = 0,
	toolsRepaired = false,
	startupFailureReplayed = false;
const roleCalls = [];
function guide(input, complete) {
	const files = input.progress.reviewScope.files;
	return {
		goal: "Review all fixture assets",
		tldr: "The complete feature remains covered",
		summary: "Mocked guide authoring with real output validation",
		scope: {
			kind: "nonvisual",
			rationale: "The fixture changes binary feature assets",
			files: "runtime",
		},
		decision: {
			status: "ready",
			summary: "Inspect mocked evidence",
			summaryShort: "All files and requirements represented",
		},
		system: {
			lanes: [
				{ id: "source", name: "Source" },
				{ id: "assets", name: "Assets" },
				{ id: "consumer", name: "Consumer" },
			],
			parts: [
				{
					id: "fixture",
					label: "Feature assets",
					laneId: "assets",
					status: "changed",
				},
			],
			before: [],
			after: [],
		},
		requirements: [
			{
				criterion: "Retain all feature assets",
				status: "supported",
				evidence: ["Runtime-owned complete inventory"],
			},
		],
		behavior: [],
		checks: ["Mocked scope checks"],
		risks: ["Provider reasoning is mocked"],
		reviewInstructions: ["Inspect every asset through Changed files"],
		chapters: [
			{
				id: "feature",
				title: "Feature assets",
				tldr: "Every asset belongs to this feature",
				summary: "All cumulative feature assets",
				before: "No fixture assets",
				after: "Complete fixture asset inventory",
				beforeShort: "No assets",
				afterShort: "Complete assets",
				risk: { level: "low", text: "Isolated fixture" },
				keyChecks: [
					{ do: "Open Changed files", expect: "3781 complete paths" },
				],
				systemPartIds: ["fixture"],
				requirementIndexes: [0],
				fileIndexes: files
					.slice(0, complete ? files.length : -1)
					.map((_, i) => i),
				screenshots: [],
				diagrams: [],
				reviewChecks: ["Inspect inventory"],
				risks: [],
				evidence: ["Complete Git diff inventory"],
			},
		],
	};
}
function scriptedRunner(_type, config) {
	let delegate = new MockAgentRunner(
		config,
		JSON.stringify({ title: "F1 audit fixture" }),
	);
	let nativeFailure = false;
	return {
		supportsStreamingInput: false,
		stop: () => delegate.stop(),
		isRunning: () => delegate.isRunning(),
		getMessages: () =>
			delegate.getMessages().map((message) =>
				nativeFailure &&
				nativeFailureMode === "result" &&
				message.type === "result"
					? {
							...message,
							is_error: true,
							errors: ["ETIMEDOUT: native provider transport offline"],
						}
					: message,
			),
		getFormatter: () => delegate.getFormatter(),
		async start(prompt) {
			const role = /\[F1_ROLE=(review|guide)\]/.exec(
				config.appendSystemPrompt ?? config.systemPrompt ?? "",
			)?.[1];
			if (!role) return delegate.start(prompt);
			if (role === "review" && !startupFailureReplayed) {
				startupFailureReplayed = true;
				throw new Error(
					"Required MCP server 'factory-context' is unavailable before model work: scripted fresh native attachment failure",
				);
			}
			const scoped = config.mcpConfig["factory-context"];
			const input = JSON.parse(readFileSync(scoped.args.at(-1), "utf8"));
			assert.ok(input.provenance.attempts.length);
			const client = new Client({ name: "f1-scripted-context", version: "1" });
			await client.connect(
				new StdioClientTransport({
					command: scoped.command,
					args: scoped.args,
					cwd: config.workingDirectory,
				}),
			);
			try {
				const large = await client.callTool({
					name: "read_context",
					arguments: { path: "/progress", limit: 1000000 },
				});
				assert.notEqual(large.isError, true);
				assert.equal(large.structuredContent.limit, 16000);
				const listing = await client.callTool({
					name: "list_context",
					arguments: { path: "", limit: 1000 },
				});
				assert.equal(listing.structuredContent.limit, 50);
				let output;
				if (role === "review") {
					reviewTurns++;
					output =
						reviewTurns === 1
							? {
									status: "blocked",
									blockers: ["Scripted missing reviewer input"],
									findings: [],
									summary: "No review performed",
								}
							: {
									status: "completed",
									blockers: [],
									findings: [],
									summary: "Mocked reviewer inspected current input",
								};
				} else {
					guideTurns++;
					assert.equal(input.progress.reviewScope.files.length, 3781);
					if (guideTurns === 2 && !toolsRepaired) {
						nativeFailure = Boolean(nativeFailureMode);
						assert.ok(input.outputCorrection);
						if (malformedMode) {
							assert.deepEqual(input.outputCorrection.output.chapters, [null]);
							writeFileSync(
								join(input.resultSubmission.directory, "guide.json"),
								JSON.stringify(guide(input, true)),
							);
						}
						output = {
							infrastructureFailure: {
								reason:
									"Scripted native context attachment disappeared after init",
							},
						};
					} else {
						mkdirSync(input.resultSubmission.directory, { recursive: true });
						const candidate = guide(input, guideTurns > 1);
						if (malformedMode && guideTurns === 1) candidate.chapters = [null];
						writeFileSync(
							join(input.resultSubmission.directory, "guide.json"),
							JSON.stringify(candidate),
						);
						const submitted = await client.callTool({
							name: "submit_result_artifact",
							arguments: { path: "guide.json" },
						});
						assert.notEqual(submitted.isError, true);
						output = submitted.structuredContent;
						assert.ok(JSON.stringify(output).length < 500);
					}
				}
				const call = {
					role,
					instructionsHash: createHash("sha256")
						.update(
							JSON.stringify({
								systemPrompt: config.systemPrompt ?? null,
								appendSystemPrompt: config.appendSystemPrompt ?? null,
								userPrompt: prompt,
							}),
						)
						.digest("hex"),
					resumeSessionId: config.resumeSessionId ?? null,
					outputCorrection: input.outputCorrection
						? {
								attempts: input.outputCorrection.attempts,
								generation: input.outputCorrection.retryGeneration,
								issues: input.outputCorrection.issues.map(
									(issue) => issue.path,
								),
							}
						: null,
				};
				roleCalls.push(call);
				delegate = new MockAgentRunner(config, JSON.stringify(output));
				const result = await delegate.start(prompt);
				call.nativeSessionId = result.sessionId;
				if (nativeFailure && nativeFailureMode === "start")
					throw new Error("ETIMEDOUT: native provider transport offline");
				return result;
			} finally {
				await client.close();
			}
		},
	};
}
const workerConfig = {
	platform: "cli",
	factoryHome: home,
	serverPort: 3604,
	serverHost: "127.0.0.1",
	defaultRunner: "claude",
	handlers: { createAgentRunner: scriptedRunner },
	repositories: [
		{
			id: "fixture",
			name: "Factory audit fixture",
			repositoryPath: repo,
			workspaceBaseDir: join(home, "worktrees"),
			baseBranch: "main",
			linearWorkspaceId: "cli-workspace",
			isActive: true,
		},
	],
	linearWorkspaces: {
		"cli-workspace": { linearToken: "cli-mode-no-token-needed" },
	},
};
let worker;
const ui = "http://127.0.0.1:3601";
const cookie = "factory-local-session=f1-audit-session";
const api = async (path, method = "GET", body) => {
	const response = await fetch(ui + path, {
		method,
		headers: {
			cookie,
			origin: ui,
			"x-factory-request": "1",
			"content-type": "application/json",
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	});
	const value = await response.json();
	assert.ok(response.ok, JSON.stringify(value));
	return value;
};
const until = async (check) => {
	const deadline = Date.now() + 45000;
	while (Date.now() < deadline) {
		const value = await check();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("Fixture timed out");
};
const exec = promisify(execFile);
const f1 = async (...args) =>
	(
		await exec(join(root, "apps/f1/f1"), args, {
			cwd: root,
			env: { ...process.env, BOBS_FACTORY_PORT: "3604" },
			timeout: 20000,
		})
	).stdout.replace(
		new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
		"",
	);
let id;
try {
	worker = new EdgeWorker(workerConfig);
	await worker.start();
	const authState = JSON.parse(
		readFileSync(join(home, "factory/auth/state.json"), "utf8"),
	);
	const auth = new FactoryAuthStore(join(home, "factory"), authState.origins);
	auth.update((state) => {
		state.credentials.push({
			id: "f1-audit",
			origin: ui,
			publicKey: "fixture",
			counter: 0,
			label: "Fixture",
			deviceType: "singleDevice",
			backedUp: false,
			createdAt: Date.now(),
			lastUsedAt: Date.now(),
		});
		state.sessions.push({
			hash: createHash("sha256").update("f1-audit-session").digest("hex"),
			credential: "f1-audit",
			origin: ui,
			expires: Date.now() + 3600000,
			verifiedAt: Date.now(),
		});
	});
	await worker.stop();
	worker = new EdgeWorker(workerConfig);
	await worker.start();
	await f1("ping");
	const created = await f1(
		"create-issue",
		"--title",
		"PRIVATE audit context fixture",
		"--description",
		"Retain all feature assets.",
		"--labels",
		"workflow:audit-context,claude",
	);
	const issue = created.match(/ID: (issue-\d+)/)?.[1];
	assert.ok(issue, created);
	const started = await f1("start-session", "--issue-id", issue);
	id = started.match(/Session ID: (session-\d+)/)?.[1];
	assert.ok(id, started);
	await until(async () =>
		(await api("/api/runs")).some(
			(run) => run.id === id && run.workflow === workflow.id,
		),
	);
	const startupFailed = await until(async () => {
		const run = await api(`/api/runs/${id}`);
		return run.status === "failed" && run;
	});
	assert.match(
		startupFailed.checkpoint.active.agent.infrastructureFailure.reason,
		/fresh native attachment/,
	);
	assert.equal(startupFailed.checkpoint.active.agent.sessionId, undefined);
	assert.equal(reviewTurns, 0);
	writeFileSync(
		join(evidence, "startup-failed.json"),
		JSON.stringify(startupFailed, null, 2),
	);
	await api(`/api/runs/${id}/retry`, "POST", {});
	const waiting = await until(async () => {
		const run = await api(`/api/runs/${id}`);
		return run.status === "waiting" && run;
	});
	assert.equal(waiting.outputs["review-gate"].approved, false);
	assert.equal(waiting.outputs["review-gate"].reviewIncomplete, true);
	assert.equal(reviewTurns, 1);
	const waitingProvenance = await api(`/api/runs/${id}/provenance`);
	assert.equal(
		waitingProvenance.attempts
			.filter(
				(attempt) =>
					attempt.step === "code-review" && attempt.kind === "agent-turn",
			)
			.at(-1).outcome,
		"blocked",
	);
	await api(`/api/runs/${id}/answer`, "POST", {
		answer: "Reviewer input repaired; perform the review.",
	});
	const failed = await until(async () => {
		const run = await api(`/api/runs/${id}`);
		return run.status === "failed" && run;
	});
	assert.equal(guideTurns, 2);
	assert.match(
		failed.error,
		nativeFailureMode ? /ETIMEDOUT/ : /native context attachment/,
	);
	assert.equal(
		failed.history.filter((item) => item.step === "implement").length,
		1,
	);
	assert.equal(
		failed.history.filter((item) => item.step === "code-review").length,
		2,
	);
	assert.equal(failed.outputs.guide, undefined);
	assert.equal(
		failed.checkpoint.active.agent.rejected.attempts,
		0,
		"Native infrastructure failure must not consume malformed-output budget",
	);
	if (malformedMode)
		assert.deepEqual(failed.checkpoint.active.agent.rejected.output.chapters, [
			null,
		]);
	const provenanceBefore = await api(`/api/runs/${id}/provenance`);
	assert.ok(
		provenanceBefore.attempts.some(
			(attempt) =>
				attempt.kind === "agent-turn" &&
				attempt.reason === "output-correction" &&
				attempt.outcome === "blocked",
		),
	);
	assert.ok(!JSON.stringify(provenanceBefore).includes("PRIVATE"));
	writeFileSync(
		join(evidence, "failed.json"),
		JSON.stringify({ failed, provenanceBefore, roleCalls }, null, 2),
	);
	writeFileSync(
		join(evidence, "timeline.txt"),
		await f1("view-session", "--session-id", id, "--limit", "10"),
	);
	await worker.stop();
	toolsRepaired = true;
	worker = new EdgeWorker(workerConfig);
	await worker.start();
	const retained = await api(`/api/runs/${id}/provenance`);
	assert.deepEqual(retained.attempts, provenanceBefore.attempts);
	if (malformedMode)
		assert.deepEqual(
			(await api(`/api/runs/${id}`)).checkpoint.active.agent.rejected.output
				.chapters,
			[null],
		);
	await api(`/api/runs/${id}/retry`, "POST", {});
	const complete = await until(async () => {
		const run = await api(`/api/runs/${id}`);
		return run.status === "completed" && run;
	});
	assert.equal(guideTurns, 3);
	assert.equal(complete.outputs.guide.chapters[0].files.length, 3781);
	assert.equal(complete.outputs.guide.scope.files.length, 3781);
	assert.ok(complete.outputs.guide.reviewFiles.snapshotId);
	assert.equal(
		complete.history.filter((item) => item.step === "implement").length,
		1,
	);
	assert.equal(
		complete.history.filter((item) => item.step === "code-review").length,
		2,
	);
	const guideCalls = roleCalls.filter((call) => call.role === "guide");
	assert.ok(guideCalls[1].resumeSessionId);
	assert.equal(guideCalls[2].resumeSessionId, guideCalls[1].resumeSessionId);
	assert.equal(guideCalls[2].outputCorrection.attempts, 0);
	assert.equal(guideCalls[2].outputCorrection.generation, 1);
	const reviewCalls = roleCalls.filter((call) => call.role === "review");
	assert.equal(reviewCalls[1].resumeSessionId, reviewCalls[0].nativeSessionId);
	const provenance = await api(`/api/runs/${id}/provenance`);
	assert.ok(provenance.attempts.some((attempt) => attempt.kind === "step"));
	assert.ok(
		provenance.attempts
			.filter((attempt) => attempt.kind === "agent-turn")
			.every(
				(attempt) =>
					attempt.instructionsSource === "effective" &&
					/^[a-f0-9]{64}$/.test(attempt.instructionsHash),
			),
	);
	assert.ok(!JSON.stringify(provenance).includes("PRIVATE"));
	for (const call of roleCalls)
		assert.ok(
			provenance.attempts.some(
				(attempt) =>
					attempt.kind === "agent-turn" &&
					attempt.instructionsHash === call.instructionsHash,
			),
			"Receipt must hash exact Factory-supplied native instructions",
		);
	assert.ok(
		provenance.attempts.some(
			(attempt) =>
				attempt.kind === "agent-turn" &&
				attempt.reason === "infrastructure-retry",
		),
	);
	writeFileSync(
		join(evidence, "results.json"),
		JSON.stringify(
			{
				mode: "mock",
				scenario: nativeFailureMode
					? `native-${nativeFailureMode}`
					: malformedMode
						? "malformed"
						: "coverage",
				home,
				repo,
				id,
				reviewTurns,
				guideTurns,
				roleCalls,
				complete,
				provenance,
				assertions: [
					"Fresh native attachment failure records no invented session",
					"Blocked empty review cannot approve",
					"Only necessary reviewer resumed",
					"Oversized pages succeed at caps",
					"3781-file artifact finalizes with exact paths",
					"Infrastructure failure preserves correction budget",
					"Restart preserves native conversation and receipts",
					"Explicit retry generation at unchanged head",
					"Per-turn effective instruction provenance excludes private content",
					...(malformedMode
						? [
								"Malformed candidate retained after artifact overwrite and restart",
							]
						: []),
				],
			},
			null,
			2,
		),
	);
	console.log(
		`PASS factory audit review/context drive: ${join(evidence, "results.json")}`,
	);
} finally {
	if (worker) await worker.stop();
	writeFileSync(
		join(evidence, "cleanup.json"),
		JSON.stringify({ workerStopped: true, home, id }),
	);
}
