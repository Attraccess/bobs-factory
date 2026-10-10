// Controlled backend and persisted runs for native-acceptance.mjs. Never live agents.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultWorkflows } from "../../../packages/edge-worker/dist/factory/defaultWorkflows.js";
import { FactoryServer } from "../../../packages/edge-worker/dist/factory/FactoryServer.js";
import { FactoryTools } from "../../../packages/edge-worker/dist/factory/FactoryTools.js";
import { validateWorkflows } from "../../../packages/edge-worker/dist/factory/Workflow.js";
import { WorkflowRuntime } from "../../../packages/edge-worker/dist/factory/WorkflowRuntime.js";
import {
	LocalOnboarding,
	localRepository,
} from "../../cli/dist/src/onboarding.js";
import { acquireInstanceLock } from "../../cli/dist/src/services/InstanceLock.js";

export const until = async (check, label, timeout = 20000) => {
	const end = Date.now() + timeout;
	while (!(await check())) {
		assert(Date.now() < end, `Timed out: ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};
const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
export function repository(home) {
	const repo = join(home, "project");
	mkdirSync(repo, { recursive: true });
	execFileSync("git", ["init", "-q", "-b", "main", repo]);
	execFileSync("git", [
		"-C",
		repo,
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"commit",
		"--allow-empty",
		"-qm",
		"Acceptance fixture",
	]);
	execFileSync("git", [
		"-C",
		repo,
		"remote",
		"add",
		"origin",
		"https://github.com/f1-test/native-acceptance",
	]);
	return repo;
}
export async function seed(home) {
	mkdirSync(home, { recursive: true, mode: 0o700 });
	const repo = repository(home);
	writeFileSync(
		join(home, "config.json"),
		JSON.stringify({
			repositories: [localRepository(repo, home, "local")],
			defaultRunner: "codex",
		}),
		{ mode: 0o600 },
	);
	const worktree = join(home, "worktrees", "acceptance");
	mkdirSync(join(home, "worktrees"), { recursive: true });
	execFileSync("git", [
		"-C",
		repo,
		"worktree",
		"add",
		"-q",
		"-b",
		"acceptance",
		worktree,
	]);
	writeFileSync(join(worktree, "retained.txt"), "Accepted worktree output\n");
	const workflows = validateWorkflows([
		...defaultWorkflows,
		{
			id: "acceptance-active",
			name: "Controlled native job",
			allowedTriggers: ["manual"],
			steps: [
				{
					id: "job",
					name: "Bounded shell job",
					type: "script",
					script: `echo $$ > ${quote(join(home, "job.pid"))}; /bin/sleep 120 & child=$!; echo "$child" > ${quote(join(home, "descendant.pid"))}; trap 'kill "$child" 2>/dev/null; exit 1' TERM INT; while ! test -e ${quote(join(home, "release-job"))}; do /bin/sleep 0.1; done; kill "$child" 2>/dev/null; wait "$child" 2>/dev/null; echo complete >> ${quote(join(home, "job-receipts"))}; printf '{"completed":true}'`,
					next: "end",
				},
			],
		},
		{
			id: "acceptance-question",
			name: "Controlled waiting answer",
			allowedTriggers: ["manual"],
			steps: [
				{
					id: "prepare",
					name: "Completed synthetic native checkpoint",
					type: "agent",
					prompt: "Fixture only",
					runner: "codex",
					next: "ci-fix",
				},
				{
					id: "ci-fix",
					name: "Retained scripted assistance question",
					type: "script",
					script: `if test -e ${quote(join(home, "answer-fixture"))}; then printf '{"questions":[],"accepted":true}'; else printf '{"questions":["Which fixture color?"]}'; fi`,
					next: "end",
				},
			],
		},
		{
			id: "acceptance-review",
			name: "Controlled review gate",
			allowedTriggers: ["manual"],
			steps: [
				{
					id: "review",
					name: "Retained human review",
					type: "tool",
					tool: "human-review",
					next: "end",
				},
			],
		},
	]);
	const runtime = new WorkflowRuntime(home, {
		agent: async (ctx) => {
			ctx.checkpointAgent?.({
				runner: "codex",
				sessionId: "mock-native-accepted-conversation",
				cwd: worktree,
			});
			writeFileSync(join(home, "mock-preparation-receipt"), "prepared once\n", {
				flag: "wx",
			});
			return { prepared: true, scope: "mock checkpoint only" };
		},
		script: async () => ({ questions: ["Which fixture color?"] }),
		tool: async () => ({
			headSha: "d".repeat(40),
			url: "https://example.invalid/review/fixture",
		}),
	});
	for (const id of [
		"acceptance-question",
		"acceptance-review",
		"acceptance-active",
	]) {
		const run = runtime.create({
			id,
			repositoryId: "local",
			workspace: worktree,
			input: "Synthetic acceptance fixture",
			workflow: workflows.find((w) => w.id === id),
			workflowDefinitions: workflows,
			triggerOrigin: {
				type: "manual",
				workflowId: id,
				at: new Date().toISOString(),
			},
		});
		run.title = id;
		run.titleGeneration = {
			...run.titleGeneration,
			state: "failed",
			error: "Fixture disables all title inference",
		};
		run.outputs.repository = {
			githubUrl: "https://github.com/f1-test/native-acceptance",
		};
		run.outputs["draft-pr"] = {
			url: "https://example.invalid/review/fixture",
			headSha: "d".repeat(40),
			draft: true,
		};
		run.outputs.accepted = {
			receipt: "controlled-existing-output",
			immutable: true,
		};
		run.setupComplete = true;
		runtime.save(run);
		if (id !== "acceptance-active") {
			void runtime.launch(run);
			await until(() => run.status === "waiting", `seed ${id}`);
		}
	}
	const captured = Object.fromEntries(
		["acceptance-question", "acceptance-review"].map((id) => [
			id,
			preserved(runtime.get(id)),
		]),
	);
	await runtime.shutdown();
	return { captured, worktree };
}
export function preserved(run) {
	return JSON.parse(
		JSON.stringify(
			Object.fromEntries(
				[
					"id",
					"workflow",
					"workflowDefinitions",
					"outputs",
					"history",
					"questions",
					"questionBatchId",
					"reviewGate",
					"checkpoint",
					"answers",
					"humanDecisions",
				].map((key) => [key, structuredClone(run[key])]),
			),
		),
	);
}

async function backend(home, port, origin) {
	assert.equal(process.env.F1_AGENT_MODE, "mock");
	const release = await acquireInstanceLock(home, {
		dashboardPort: Number(port),
	});
	const tools = new FactoryTools({});
	const runtime = new WorkflowRuntime(home, {
		agent: async () => {
			throw Error("No inference permitted");
		},
		script: (ctx) => tools.script(ctx),
		tool: (ctx) => tools.tool(ctx),
	});
	const calls = [];
	// Exact, bounded synthetic GitHub transport; no network/provider authentication.
	globalThis.fetch = async (url, options) => {
		assert(String(url).startsWith("https://api.github.com/"));
		calls.push({ path: new URL(url).pathname, method: options?.method });
		writeFileSync(join(home, "provider-calls.json"), JSON.stringify(calls));
		const token = options.headers.Authorization;
		const path = new URL(url).pathname;
		const value =
			path === "/user"
				? { login: "fixture-operator" }
				: path === "/graphql"
					? {
							data: {
								repository: {
									nameWithOwner: "f1-test/native-acceptance",
									viewerPermission: token.endsWith("denied-fixture")
										? "READ"
										: "WRITE",
									defaultBranchRef: { target: { oid: "d".repeat(40) } },
									pullRequests: { nodes: [] },
								},
							},
						}
					: { permissions: { push: true } };
		return new Response(JSON.stringify(value), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};
	const onboarding = new LocalOnboarding(home, async () => {});
	const server = new FactoryServer(
		runtime,
		{
			repositories: () => [],
			sessions: () => [],
			entries: () => [],
			start: async () => {
				throw Error("No launch in onboarding fixture");
			},
			stop: (id) => runtime.stop(id),
			onboarding,
		},
		{ origins: [origin], sessionHours: 1 },
	);
	await server.start(Number(port));
	writeFileSync(
		join(home, "backend-ready.json"),
		JSON.stringify({
			pid: process.pid,
			origin,
			transport: "actual protected FactoryServer / controlled GitHub",
			port: Number(port),
		}),
	);
	const stop = async () => {
		await server.stop();
		await runtime.shutdown();
		release();
		process.exit(0);
	};
	process.on("SIGTERM", () => void stop());
}
if (process.argv[1] === fileURLToPath(import.meta.url))
	void backend(...process.argv.slice(2));
