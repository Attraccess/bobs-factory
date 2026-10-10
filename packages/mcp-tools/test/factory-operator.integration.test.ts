import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, it, vi } from "vitest";
import { defaultWorkflows } from "../../edge-worker/src/factory/defaultWorkflows.js";
import { OperatorConfiguration } from "../../edge-worker/src/factory/OperatorConfiguration.js";
import { OperatorGrants } from "../../edge-worker/src/factory/OperatorGrants.js";
import { OperatorServer } from "../../edge-worker/src/factory/OperatorServer.js";
import {
	OperatorService,
	operatorError,
} from "../../edge-worker/src/factory/OperatorService.js";
import { operatorSanitize } from "../../edge-worker/src/factory/OperatorTransport.js";
import { validateWorkflows } from "../../edge-worker/src/factory/Workflow.js";
import { WorkflowRuntime } from "../../edge-worker/src/factory/WorkflowRuntime.js";
import { createFactoryOperatorBridge } from "../src/factoryOperator.js";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn();
});
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "operator-test-"));
	cleanup.push(() => rmSync(home, { recursive: true, force: true }));
	const agent = vi.fn(async () => ({ status: "completed", questions: [] }));
	const runtime = new WorkflowRuntime(home, {
		agent,
		script: async () => ({}),
		tool: async () => ({}),
		retryTracking: async (run) => {
			run.ticketSync = {
				receipts: [{ key: "mock-tracking", body: "synced", delivered: true }],
			};
		},
	});
	const workflow = validateWorkflows([
		...defaultWorkflows,
		{
			id: "custom",
			name: "Custom",
			steps: [
				{
					id: "work",
					name: "Work",
					type: "agent",
					prompt: "work",
					askQuestions: true,
					next: "end",
				},
			],
		},
	]).at(-1)!;
	const run = runtime.create({
		repositoryId: "repo",
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
		workflow,
		workspace: home,
		input: "fixture",
		runner: "opencode",
	});
	run.status = "failed";
	const grants = new OperatorGrants(home);
	const service = new OperatorService(
		runtime,
		{
			stop: (id) => runtime.stop(id),
			chat: () => ({ enabled: false, available: false }),
			sanitize: (text) =>
				operatorSanitize(text, [
					{ headers: { Authorization: "fixture-secret-value" } },
				]),
		},
		grants.instance(),
	);
	const server = new OperatorServer(grants, service);
	cleanup.push(() => server.stop());
	return { home, runtime, run, grants, service, server, agent };
}
async function sdk(
	f: ReturnType<typeof fixture>,
	scopes: string[] = ["inspect", "operate", "configure"],
) {
	const meta = f.grants.issue("test", scopes),
		credential = JSON.parse(readFileSync(meta.credentialFile, "utf8"));
	const headers = {
		authorization: `Bearer ${credential.token}`,
		"x-factory-instance": credential.instance,
		"x-factory-grant": credential.id,
	};
	const bridge = createFactoryOperatorBridge(async (path, body) => {
		const response = await f.server.app.inject({
			method: "POST",
			url: `/${path}`,
			headers,
			payload: body ?? {},
		});
		if (response.statusCode !== 200) throw new Error("unauthorized");
		return response.json();
	});
	const client = new Client({ name: "test", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await bridge.connect(a);
	await client.connect(b);
	cleanup.push(() => client.close());
	cleanup.push(() => bridge.close());
	const call = async (name: string, args: Record<string, unknown>) =>
		(await client.callTool({ name, arguments: args })).structuredContent as any;
	return { client, call, meta, headers };
}
it("discovers scopes without Linear and revokes existing SDK clients durably", async () => {
	const f = fixture(),
		c = await sdk(f, ["inspect"]);
	const names = (await c.client.listTools()).tools.map((t) => t.name);
	expect(names).toContain("inspect_run");
	expect(names).not.toContain("retry_run");
	expect(names).not.toContain("update_mcp_connection");
	expect(
		(
			await c.call("retry_run", {
				runId: f.run.id,
				expectedRevision: f.service.revision(f.run),
			})
		).error.code,
	).toBe("insufficient_scope");
	expect(
		(
			await f.server.app.inject({
				method: "POST",
				url: "/tools",
				headers: { ...c.headers, "x-factory-instance": "another-instance" },
				payload: {},
			})
		).statusCode,
	).toBe(401);
	f.grants.revoke(c.meta.id);
	expect(new OperatorGrants(f.home).list()).toEqual([]);
	await expect(c.client.listTools()).rejects.toThrow("unauthorized");
	expect(statSync(c.meta.credentialFile).mode & 0o777).toBe(0o600);
	expect(JSON.stringify(f.grants.list())).not.toContain("token");
});
it("returns instance/run context and recovery guidance for rejected SDK requests without acting", async () => {
	const f = fixture(),
		c = await sdk(f);
	const preserved = JSON.stringify(f.run);
	const unknownTool = await c.call("unknown_operator_tool", {});
	expect(unknownTool).toEqual({
		ok: false,
		instance: f.grants.instance(),
		error: {
			code: "not_found",
			message: "Operator tool not found",
			nextStep: expect.stringContaining("tools/list"),
		},
	});
	const unknownRun = await c.call("inspect_run", { runId: "unknown-run" });
	expect(unknownRun).toMatchObject({
		ok: false,
		instance: f.grants.instance(),
		runId: "unknown-run",
		error: {
			code: "not_found",
			nextStep: expect.stringContaining("list_runs"),
		},
	});
	const invalid = await c.call("retry_run", { runId: f.run.id, extra: true });
	expect(invalid).toMatchObject({
		ok: false,
		instance: f.grants.instance(),
		runId: f.run.id,
		error: {
			code: "invalid_request",
			nextStep: expect.stringContaining("input schema"),
		},
	});
	const secretId = await c.call("inspect_run", {
		runId: "fixture-secret-value",
	});
	expect(secretId.runId).toBe("[redacted]");
	expect(JSON.stringify(secretId)).not.toContain("fixture-secret-value");
	expect(
		(await c.call("inspect_run", { runId: "x".repeat(201) })).runId,
	).toHaveLength(200);
	expect(JSON.stringify(f.run)).toBe(preserved);
	expect(f.agent).not.toHaveBeenCalled();
});
it("rejects overlapping SDK connection edits as stale_configuration without dispatching another edit", async () => {
	const f = fixture(),
		c = await sdk(f);
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	f.service.hooks.update = vi.fn(async () => {
		await pending;
		return { runId: f.run.id, persisted: true, applied: true };
	});
	const request = {
		runId: f.run.id,
		expectedConfigRevision: "current",
		server: "taskbot",
		connection: { type: "http", url: "https://taskbot.example/mcp" },
		permissions: ["get_ticket"],
	};
	const first = c.call("update_mcp_connection", request);
	try {
		await vi.waitFor(() =>
			expect(f.service.hooks.update).toHaveBeenCalledTimes(1),
		);
		expect(await c.call("update_mcp_connection", request)).toMatchObject({
			ok: false,
			instance: f.grants.instance(),
			runId: f.run.id,
			error: {
				code: "stale_configuration",
				nextStep: expect.stringContaining("inspect_mcp_connections"),
			},
		});
		expect(
			(
				await c.call("retry_run", {
					runId: f.run.id,
					expectedRevision: f.service.revision(f.run),
				})
			).error.code,
		).toBe("stale_state");
		expect(f.service.hooks.update).toHaveBeenCalledTimes(1);
		expect(f.run.status).toBe("failed");
	} finally {
		release();
	}
	expect(await first).toMatchObject({
		ok: true,
		result: { persisted: true, applied: true },
	});
	expect((await c.call("update_mcp_connection", request)).ok).toBe(true);
	expect(f.service.hooks.update).toHaveBeenCalledTimes(2);
});
it("rejects stale and parallel actions while preserving checkpoint and publication work", async () => {
	const f = fixture(),
		c = await sdk(f);
	f.run.outputs.implementation = { status: "completed", artifact: "preserved" };
	f.run.repositoryOutputs = {
		repo: {
			publication: {
				url: "https://github.com/example/repo/pull/1",
				headSha: "saved",
			},
		},
	};
	f.run.humanDecisions = [
		{
			reviewId: "saved",
			headSha: "saved",
			decision: "approve",
			at: "2026-01-01",
		},
	];
	f.run.checkpoint = { current: "end", visits: {}, outputs: f.run.outputs };
	const preserved = JSON.stringify([
		f.run.outputs,
		f.run.repositoryOutputs,
		f.run.humanDecisions,
	]);
	const inspected = (await c.call("inspect_run", { runId: f.run.id })).result;
	const results = await Promise.all([
		c.call("retry_run", {
			runId: f.run.id,
			expectedRevision: inspected.revision,
		}),
		c.call("retry_run", {
			runId: f.run.id,
			expectedRevision: inspected.revision,
		}),
	]);
	expect(results.filter((r) => r.ok)).toHaveLength(1);
	expect(results.filter((r) => !r.ok)).toHaveLength(1);
	await vi.waitFor(() => expect(f.run.status).toBe("completed"));
	expect(f.agent).not.toHaveBeenCalled();
	expect(
		JSON.stringify([
			f.run.outputs,
			f.run.repositoryOutputs,
			f.run.humanDecisions,
		]),
	).toBe(preserved);
	expect(
		(
			await c.call("resume_run", {
				runId: f.run.id,
				expectedRevision: f.service.revision(f.run),
			})
		).error.code,
	).toBe("invalid_state");
	expect(
		(await c.call("retry_run", { runId: f.run.id, expectedRevision: "stale" }))
			.error.code,
	).toBe("stale_state");
});
it("does not approve reviews, blocks disabled chat, pages activity and sanitizes credentials", async () => {
	const f = fixture(),
		c = await sdk(f);
	f.run.status = "waiting";
	f.run.questions = ["Choose a value"];
	f.run.reviewGate = { status: "pending" } as any;
	expect(
		(
			await c.call("answer_run", {
				runId: f.run.id,
				expectedRevision: f.service.revision(f.run),
				answer: "approve",
				context: { questions: f.run.questions },
			})
		).error.code,
	).toBe("invalid_state");
	delete f.run.reviewGate;
	expect(
		(
			await c.call("steer_run", {
				runId: f.run.id,
				expectedRevision: f.service.revision(f.run),
				text: "go",
			})
		).error.code,
	).toBe("invalid_state");
	f.run.error =
		"fixture-secret-value https://user:pass@example.test/mcp?token=hidden";
	f.run.events = Array.from({ length: 3 }, (_, i) => ({
		at: new Date().toISOString(),
		step: "work",
		message: `event ${i}: fixture-secret-value`,
		source: "workflow" as const,
	}));
	const result = await c.call("read_run_activity", {
		runId: f.run.id,
		limit: 2,
	});
	expect(result.result.nextOffset).toBe(2);
	expect(JSON.stringify(result)).not.toContain("fixture-secret-value");
	const inspection = JSON.stringify(
		await c.call("inspect_run", { runId: f.run.id }),
	);
	expect(inspection).not.toContain("fixture-secret-value");
	expect(inspection).not.toContain("user:pass");
	expect(inspection).not.toContain("token=hidden");
	expect(
		operatorError(new Error("401 provider body with fixture-secret-value"))
			.error,
	).toEqual({
		code: "missing_authentication",
		message: expect.any(String),
		nextStep: expect.stringContaining("authentication"),
	});
});
it("commits connection and exact permissions together, preserves other settings and reports failed reload", async () => {
	const f = fixture(),
		path = join(f.home, "config.json");
	writeFileSync(
		path,
		JSON.stringify({
			repositories: [
				{
					id: "repo",
					name: "Repo",
					repositoryPath: f.home,
					workspaceBaseDir: f.home,
					baseBranch: "main",
					allowedTools: ["Read"],
					linearWorkspaceId: "cli-workspace",
				},
			],
			customSetting: "preserved",
		}),
	);
	const config = new OperatorConfiguration(
		f.home,
		f.runtime,
		() => path,
		async () => ({ allowed: ["Read"], denied: [] }),
		() => false,
	);
	const request = {
		expectedConfigRevision: config.revision(f.run),
		server: "taskbot",
		connection: { type: "http", url: "https://taskbot.example/mcp" },
		permissions: ["get_ticket"],
	};
	const result = await config.update(f.run, request);
	expect(result.persisted).toBe(true);
	expect(result.applied).toBe(false);
	expect(result.error?.code).toBe("reload_failure");
	const saved = JSON.parse(readFileSync(path, "utf8"));
	expect(saved.customSetting).toBe("preserved");
	expect(saved.repositories[0].allowedTools).toEqual([
		"Read",
		"mcp__taskbot__get_ticket",
	]);
	expect(
		JSON.parse(readFileSync(saved.repositories[0].mcpConfigPath[0], "utf8"))
			.mcpServers.taskbot.url,
	).toBe("https://taskbot.example/mcp");
	await expect(config.update(f.run, request)).rejects.toMatchObject({
		code: "stale_configuration",
	});
	const denied = new OperatorConfiguration(
		f.home,
		f.runtime,
		() => path,
		async () => ({ denied: ["mcp__taskbot__*"] }),
		() => true,
	);
	await expect(
		denied.update(f.run, {
			...request,
			expectedConfigRevision: denied.revision(f.run),
		}),
	).rejects.toMatchObject({ code: "denied_tool" });
}, 10_000); // Allow the five-second reload observation deadline to expire.
it("compiled CLI connects over stdio without starting another worker", async () => {
	const f = fixture();
	await f.server.start();
	const meta = f.grants.issue("stdio", ["inspect"]);
	const client = new Client({ name: "stdio-smoke", version: "1" });
	const transport = new StdioClientTransport({
		command:
			process.env.BOBS_FACTORY_OPERATOR_SMOKE_EXECUTABLE ?? process.execPath,
		args: [
			...(process.env.BOBS_FACTORY_OPERATOR_SMOKE_EXECUTABLE
				? []
				: [resolve("../../apps/cli/dist/src/app.js")]),
			"operator-mcp",
			"--home",
			f.home,
			"--credential-file",
			meta.credentialFile,
		],
		stderr: "pipe",
	});
	await client.connect(transport);
	cleanup.push(() => client.close());
	expect((await client.listTools()).tools).toHaveLength(5);
	expect(
		(
			await client.callTool({
				name: "inspect_run",
				arguments: { runId: f.run.id },
			})
		).structuredContent,
	).toMatchObject({ ok: true, result: { runId: f.run.id, status: "failed" } });
	f.grants.revoke(meta.id);
	await expect(client.listTools()).rejects.toThrow();
});
it("binds answers to the current batch and keeps explanation requests out of answers", async () => {
	const f = fixture(),
		c = await sdk(f);
	f.agent
		.mockResolvedValueOnce({
			status: "blocked",
			questions: ["Choose one"],
		} as any)
		.mockResolvedValueOnce({
			status: "blocked",
			questions: ["Explained choice"],
		} as any)
		.mockResolvedValue({ status: "completed", questions: [] });
	f.runtime.retry(f.run.id);
	await vi.waitFor(() => expect(f.run.status).toBe("waiting"));
	const first = (await c.call("inspect_run", { runId: f.run.id })).result;
	expect(
		(
			await c.call("answer_run", {
				runId: f.run.id,
				expectedRevision: first.revision,
				answer: "x",
				context: { ...first.questionContext, questionBatchId: "old" },
			})
		).error.code,
	).toBe("stale_state");
	expect(
		(
			await c.call("answer_run", {
				runId: f.run.id,
				expectedRevision: first.revision,
				answer: "Explain the choice",
				kind: "explanation",
				context: first.questionContext,
			})
		).ok,
	).toBe(true);
	await vi.waitFor(() => expect(f.run.questions).toEqual(["Explained choice"]));
	expect(f.run.answers).toHaveLength(0);
	expect(f.run.questionRequests).toHaveLength(1);
	const current = (await c.call("inspect_run", { runId: f.run.id })).result;
	expect(
		(
			await c.call("answer_run", {
				runId: f.run.id,
				expectedRevision: current.revision,
				answer: "Choice A",
				kind: "answer",
				context: current.questionContext,
			})
		).ok,
	).toBe(true);
	await vi.waitFor(() => expect(f.run.status).toBe("completed"));
	expect(f.run.answers).toHaveLength(1);
});
it("resumes interrupted saved progress and retries tracking without rerunning agents", async () => {
	const f = fixture(),
		c = await sdk(f);
	f.run.status = "interrupted";
	f.run.checkpoint = { current: "end", visits: {}, outputs: {} };
	expect(
		(
			await c.call("resume_run", {
				runId: f.run.id,
				expectedRevision: f.service.revision(f.run),
			})
		).ok,
	).toBe(true);
	await vi.waitFor(() => expect(f.run.status).toBe("completed"));
	f.run.ticketReference = {
		provider: "taskbot",
		instance: "https://taskbot.example",
		server: "taskbot",
		project: "fixture",
		id: 1,
		url: "https://taskbot.example/p/fixture/t/1",
	};
	expect(
		(
			await c.call("retry_ticket_sync", {
				runId: f.run.id,
				expectedRevision: f.service.revision(f.run),
			})
		).ok,
	).toBe(true);
	expect(f.run.ticketSync?.receipts[0]?.delivered).toBe(true);
	expect(f.agent).not.toHaveBeenCalled();
	f.run.status = "waiting";
	expect(
		(
			await c.call("stop_run", {
				runId: f.run.id,
				expectedRevision: f.service.revision(f.run),
			})
		).ok,
	).toBe(true);
	expect(f.run.status).toBe("stopped");
});
it("updates future tool profiles without replacing a run's frozen selection", async () => {
	const f = fixture(),
		path = join(f.home, "config.json");
	writeFileSync(
		path,
		JSON.stringify({
			repositories: [
				{
					id: "repo",
					name: "Repo",
					repositoryPath: f.home,
					workspaceBaseDir: f.home,
					baseBranch: "main",
					linearWorkspaceId: "cli-workspace",
				},
			],
		}),
	);
	const profiles = f.runtime.executionProfiles.save(
		{
			schemaVersion: 1,
			revision: 0,
			identities: [],
			tools: [
				{
					id: "tools",
					revision: 1,
					name: "Tools",
					mode: "factory-only",
					mcp: {},
					sources: [],
					remove: [],
					denyTools: [],
				},
			],
			defaults: {},
			repositories: {},
		},
		0,
	);
	f.run.executionSnapshot = {
		schemaVersion: 1,
		tools: structuredClone(profiles.tools[0]),
		sources: { identity: "legacy", tools: "manual" },
	};
	const accepted = JSON.stringify(f.run.executionSnapshot);
	const config = new OperatorConfiguration(
		f.home,
		f.runtime,
		() => path,
		async () => ({ allowed: ["Read"], denied: [] }),
		() => true,
	);
	const request = {
		expectedConfigRevision: config.revision(f.run),
		server: "taskbot",
		connection: {
			type: "http",
			url: "https://taskbot.example/mcp",
			headers: { Authorization: { env: "TASKBOT_AUTHORIZATION" } },
		},
		permissions: ["get_ticket"],
	};
	await expect(config.update(f.run, request)).rejects.toMatchObject({
		code: "frozen_configuration",
	});
	const result = await config.update(f.run, { ...request, profileId: "tools" });
	expect(result).toMatchObject({
		persisted: true,
		applied: false,
		scope: "future_launches",
	});
	expect(JSON.stringify(f.run.executionSnapshot)).toBe(accepted);
	const updated = f.runtime.executionProfiles.read().tools[0]!;
	expect(updated.allowTools).toEqual(["mcp__taskbot__get_ticket"]);
	expect(updated.mcp.taskbot).toMatchObject({
		headers: {
			Authorization: { source: "env", name: "TASKBOT_AUTHORIZATION" },
		},
	});
});

it("operator recovery respects disabled workflows and requires explicit individual Resume", async () => {
	const f = fixture();
	f.runtime.updateWorkflows([...f.runtime.listWorkflows(), f.run.workflow]);
	f.runtime.setWorkflowEnabled(f.run.workflow.id, false);
	expect(f.service.inspect(f.run.id).actions.retry_run.available).toBe(false);
	expect(f.service.inspect(f.run.id).actions.resume_run.available).toBe(false);
	await expect(
		f.service.call(
			"resume_run",
			{ runId: f.run.id, expectedRevision: f.service.revision(f.run) },
			["operate"],
		),
	).rejects.toThrow();
	f.runtime.setWorkflowEnabled(f.run.workflow.id, true);
	expect(f.agent).not.toHaveBeenCalled();
	expect(f.service.inspect(f.run.id).actions.resume_run.available).toBe(true);
	await f.service.call(
		"resume_run",
		{ runId: f.run.id, expectedRevision: f.service.revision(f.run) },
		["operate"],
	);
	await vi.waitFor(() => expect(f.agent).toHaveBeenCalledOnce());
	await f.runtime.shutdown();
});

it("resumes a chat-enabled saved Simple run through the runtime and reports unavailable recovery", async () => {
	const f = fixture();
	const simple = f.runtime.selectWorkflow([], "manual", "simple");
	f.run.workflow = simple;
	f.run.status = "running";
	f.run.setupComplete = true;
	const recovery = vi.fn(async () => {});
	(f.runtime as any).hooks.simple = recovery;
	f.service.hooks.chat = () => ({ enabled: true, available: false });
	const c = await sdk(f);
	f.runtime.setWorkflowEnabled("simple", false);
	let result = await c.call("resume_run", {
		runId: f.run.id,
		expectedRevision: f.service.revision(f.run),
	});
	expect(result.error.code).toBe("invalid_state");
	expect(recovery).not.toHaveBeenCalled();
	f.runtime.setWorkflowEnabled("simple", true);
	expect(f.run.status).toBe("blocked");
	result = await c.call("resume_run", {
		runId: f.run.id,
		expectedRevision: f.service.revision(f.run),
	});
	expect(result.ok).toBe(true);
	expect(result.result.accepted).toBe(true);
	expect(f.run.workflowBlock).toBeUndefined();
	expect(f.runtime.catalog.getBlock(f.run.id)).toBeUndefined();
	await vi.waitFor(() => expect(recovery).toHaveBeenCalledOnce());
	await vi.waitFor(() => expect(f.run.status).toBe("completed"));
	await f.runtime.shutdown();
});
