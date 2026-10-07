// Run from the repository root after building bobs-factory-edge-worker and bobs-factory-f1.
// Explicit runner injection is required: this older embedded F1 server does not
// implement F1_AGENT_MODE. No live provider is reachable from this fixture.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

assert.equal(process.env.F1_AGENT_MODE, "mock");
const root = process.cwd();
const home = mkdtempSync(join(tmpdir(), "refinement83-mock-"));
const repo = join(home, "repo");
const evidence = process.env.F1_EVIDENCE_DIR ?? join(home, "evidence");
mkdirSync(repo);
mkdirSync(evidence, { recursive: true });
const git = (...args) => execFileSync("git", args, { cwd: repo });
git("init", "-b", "main");
git("config", "user.name", "F1 Fixture");
git("config", "user.email", "f1@example.test");
writeFileSync(join(repo, "README.md"), "Isolated mocked refinement fixture\n");
git("-c", "commit.gpgsign=false", "add", ".");
git("-c", "commit.gpgsign=false", "commit", "-m", "Initial fixture");
git("remote", "add", "origin", repo);

// Keep the real bounded admission mechanism in a temporary fixture pool.
// Never edit or increase the production pool, and never start a live agent.
// This fresh fixture has no legacy coordinator; isolate migration checks too.
process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY = join(
	home,
	"legacy-capacity",
);
process.env.BOBS_FACTORY_FACTORY_PORT = "3543";
const { EdgeWorker } = await import(
	join(root, "packages/edge-worker/dist/index.js")
);
const { CLIIssueTrackerService } = await import(
	join(root, "packages/core/dist/index.js")
);
const { LinearActivitySink } = await import(
	join(root, "packages/edge-worker/dist/sinks/LinearActivitySink.js")
);
const tracker = new CLIIssueTrackerService();
tracker.seedDefaultData();
const worker = new EdgeWorker({
	platform: "cli",
	factoryHome: home,
	serverPort: 3623,
	serverHost: "127.0.0.1",
	defaultRunner: "codex",
	repositories: [
		{
			id: "fixture",
			name: "Refinement fixture",
			repositoryPath: repo,
			workspaceBaseDir: join(home, "worktrees"),
			baseBranch: "main",
			linearWorkspaceId: "cli-workspace",
			isActive: true,
		},
	],
});
worker.issueTrackers.set("cli-workspace", tracker);
worker.activitySinks.set(
	"cli-workspace",
	new LinearActivitySink(tracker, "cli-workspace"),
);
const calls = [];
const questions = [
	"Which notification channel should we use?",
	"When should notifications arrive?",
];
const recommendations = [
	{
		questionIndex: 0,
		answer: "Email",
		reason:
			"The fixture specifies no SMS budget and detailed nonurgent updates.",
	},
	{
		questionIndex: 1,
		answer: "Daily digest",
		reason: "The fixture specifies nonurgent updates and fewer interruptions.",
	},
];
worker.buildRunnerForType = (type, config) => {
	assert.equal(type, "codex");
	let messages = [];
	return {
		supportsStreamingInput: false,
		isRunning: () => false,
		stop() {},
		getMessages: () => messages,
		async start(prompt) {
			const contextConfig = config.mcpConfig?.["factory-context"];
			if (!contextConfig) {
				// The unrelated automatic title job also uses the injected runner.
				assert.match(config.appendSystemPrompt ?? "", /title/i);
				messages = [
					{
						type: "result",
						subtype: "success",
						result: '{"title":"Mocked refinement fixture"}',
					},
				];
				config.onMessage?.(messages[0]);
				return { sessionId: "mock-title" };
			}
			const input = JSON.parse(readFileSync(contextConfig.args[1], "utf8"));
			assert.match(config.appendSystemPrompt, /questionRecommendations/);
			assert.match(
				config.appendSystemPrompt,
				/explicit human submission is required/,
			);
			const answered = input.answers.length > 0;
			// Canned output establishes transport/retention, never model reasoning.
			const output = answered
				? { questions: [], decisions: [], requirements: [] }
				: {
						questions,
						questionRecommendations: recommendations,
						decisions: [],
						requirements: [],
					};
			calls.push({
				input,
				output,
				prompt,
				instruction: config.appendSystemPrompt,
			});
			const sessionId = `mock-question-${calls.length}`;
			config.onMessage?.({
				type: "system",
				subtype: "init",
				session_id: sessionId,
			});
			messages = [
				{ type: "result", subtype: "success", result: JSON.stringify(output) },
			];
			config.onMessage?.(messages[0]);
			return { sessionId };
		},
	};
};
const runtime = worker.getFactoryRuntime();
const runCommand = promisify(execFile);
const commands = [];
async function command(file, args, env = {}) {
	const result = await runCommand(file, args, {
		cwd: root,
		env: { ...process.env, ...env },
		timeout: 30000,
		maxBuffer: 1024 * 1024,
	});
	commands.push({ file, args, stdout: result.stdout, stderr: result.stderr });
	writeFileSync(
		join(evidence, "qa83-mock-commands.json"),
		JSON.stringify(commands, null, 2),
	);
	// biome-ignore lint/suspicious/noControlCharactersInRegex: F1 CLI emits ANSI colors.
	return result.stdout.replace(/\u001b\[[0-9;]*m/g, "");
}
const f1 = (...args) =>
	command(join(root, "apps/f1/f1"), args, { BOBS_FACTORY_PORT: "3623" });
const browserSession = `refinement83-${Date.now()}`;
const browser = (...args) =>
	command("agent-browser", ["--session", browserSession, ...args]);
async function until(check) {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		const value = check();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("Timed out waiting for fixture state");
}
const records = [];
try {
	await worker.start();
	runtime.updateWorkflows([
		...runtime.listWorkflows(),
		{
			id: "refinement-mock",
			name: "Mocked refinement transport",
			labels: ["workflow:refinement-mock"],
			allowedTriggers: ["manual", "ticket-assignment"],
			steps: [
				{
					id: "clarify",
					name: "Clarify preferences",
					type: "agent",
					runner: "codex",
					askQuestions: true,
					prompt:
						'Read all ticket context and explicit answers. Ask for notification channel and schedule. Return {"questions":[],"decisions":[],"requirements":[]}.',
				},
				{
					id: "receipt",
					name: "Record explicit answers",
					type: "script",
					computeIntensive: false,
					script:
						'node -e \'const fs=require("node:fs");const input=JSON.parse(fs.readFileSync(process.env.FACTORY_INPUT_FILE,"utf8"));console.log(JSON.stringify({answers:input.answers}));\'',
				},
			],
		},
	]);
	await f1("ping");
	for (const method of ["dashboard", "ticket"]) {
		const created = await f1(
			"create-issue",
			"--title",
			`Preferences ${method}`,
			"--description",
			"Detailed nonurgent updates; no SMS budget; prefer fewer interruptions. Ask separately for notification channel and schedule. Do not implement or publish.",
			"--labels",
			"workflow:refinement-mock,codex",
		);
		const issueId = created.match(/ID: (issue-\d+)/)?.[1];
		assert.ok(issueId, created);
		const started = await f1("start-session", "--issue-id", issueId);
		const id = started.match(/Session ID: (session-\d+)/)?.[1];
		assert.ok(id, started);
		const run = await until(
			() => runtime.runs.get(id)?.status === "waiting" && runtime.get(id),
		);
		assert.deepEqual(run.questionRecommendations, recommendations);
		assert.deepEqual(run.answers, []);
		assert.equal(run.outputs.receipt, undefined);
		const waiting = structuredClone(run);
		if (method === "dashboard") {
			await browser(
				"--headed",
				"false",
				"open",
				`http://127.0.0.1:3543/#/runs/${id}`,
			);
			await browser("wait", 'input[type="radio"]');
			await browser("wait", "500");
			await browser("set", "viewport", "1280", "1100");
			const snapshot = await browser("snapshot", "-i");
			assert.equal(
				(
					snapshot.match(
						/radio "Use recommendation".*\[checked(?:=true)?[,\]]/g,
					) ?? []
				).length,
				2,
				snapshot,
			);
			assert.deepEqual(run.answers, []);
			assert.equal(run.outputs.receipt, undefined);
			await browser("screenshot", join(evidence, "qa83-mock-defaults.png"));
			const sendRef = snapshot.match(
				/button "Send answers.*" \[ref=(\w+)\]/,
			)?.[1];
			assert.ok(sendRef, snapshot);
			await browser("click", `@${sendRef}`);
		} else {
			await f1(
				"prompt-session",
				"--session-id",
				id,
				"--message",
				"Use Email and Daily digest.",
			);
		}
		await until(() => run.status === "completed");
		assert.equal(run.answers.length, 1);
		assert.equal(
			run.answers[0].answer,
			method === "dashboard"
				? questions
						.map((q, i) => `${i + 1}. ${q}\n${recommendations[i].answer}`)
						.join("\n\n")
				: "Use Email and Daily digest.",
		);
		assert.deepEqual(run.outputs.receipt.answers, run.answers);
		assert.equal(
			run.history.filter((entry) => entry.step === "receipt").length,
			1,
		);
		assert.equal(
			calls.filter(
				(call) =>
					call.input.answers.length &&
					call.input.answers[0].answer === run.answers[0].answer,
			).length,
			1,
		);
		await f1("view-session", "--session-id", id, "--limit", "10");
		records.push({ method, waiting, completed: structuredClone(run) });
	}
	assert.equal(calls.length, 4);
	writeFileSync(
		join(evidence, "qa83-mock-path.json"),
		JSON.stringify(
			{
				headSha: execFileSync("git", ["rev-parse", "HEAD"], {
					cwd: root,
					encoding: "utf8",
				}).trim(),
				mode: "mock",
				home,
				browserSession,
				records,
				calls,
				commands,
				limitations: [
					"Canned agent output cannot establish live model generation or missing-fact reasoning.",
					"No live Taskbot delivery or status reconciliation was tested.",
				],
			},
			null,
			2,
		),
	);
	console.log(
		"PASS: dashboard defaults and existing-session ticket reply each resumed one mocked agent turn and one receipt.",
	);
} finally {
	await browser("close").catch(() => {});
	for (const run of runtime.runs.values()) {
		if (!["completed", "stopped"].includes(run.status)) runtime.stop(run.id);
	}
	await worker.stop();
}
