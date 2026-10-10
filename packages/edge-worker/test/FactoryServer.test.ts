import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import webPush from "web-push";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryPush } from "../src/factory/FactoryPush.js";
import { FactoryServer as ProtectedFactoryServer } from "../src/factory/FactoryServer.js";
import type { ResolvedLaunchRequest } from "../src/factory/LaunchFields.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { FactoryServer } from "./fixtures/authenticated-factory.js";
import { factoryHttp } from "./fixtures/factory-http.js";
import { authenticator } from "./fixtures/webauthn.js";

it("serves question images only from the requested run, rejecting traversal, external symlinks and non-images", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-question-images-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("Unused");
		},
		stop: (id) => runtime.stop(id),
	});
	const create = (id: string) =>
		runtime.create({
			id,
			triggerOrigin: {
				type: "manual",
				workflowId: "factory",
				at: new Date().toISOString(),
			},
			title: "Question",
			repositoryId: "repo",
			workspace: home,
			input: "",
			workflow: defaultWorkflows.find((workflow) => workflow.id === "factory")!,
		});
	const run = create("with-image");
	create("without-image");
	const directory = join(runtime.directory, "evidence", run.id);
	mkdirSync(directory, { recursive: true });
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNNsAAAAASUVORK5CYII=",
		"base64",
	);
	writeFileSync(join(directory, "context.png"), png);
	writeFileSync(join(home, "outside.png"), png);
	writeFileSync(join(directory, "text.png"), "Private text is not an image");
	symlinkSync(join(home, "outside.png"), join(directory, "external.png"));
	const get = (id: string, name: string) =>
		server.app.inject({
			url: `/api/runs/${id}/question-images/${name}`,
			headers: { host: "localhost" },
		});
	try {
		const image = await get(run.id, "context.png");
		expect(image.statusCode).toBe(200);
		expect(image.headers["content-type"]).toBe("image/png");
		expect(image.headers["cache-control"]).toBe("no-store");
		expect(image.rawPayload).toEqual(png);
		expect((await get("without-image", "context.png")).statusCode).toBe(404);
		expect((await get(run.id, "missing.png")).statusCode).toBe(404);
		expect((await get(run.id, "external.png")).statusCode).toBe(409);
		expect((await get(run.id, "text.png")).statusCode).toBe(409);
		expect((await get(run.id, "..%2F..%2Foutside.png")).statusCode).toBe(400);
	} finally {
		await runtime.shutdown();
		await server.stop();
		rmSync(home, { recursive: true, force: true });
	}
});

it("accepts failed-run retries through the protected API and rejects duplicate retries", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-retry-api-"));
	const runtime = new WorkflowRuntime(home, {
		agent: (context) =>
			new Promise((_resolve, reject) => {
				context.signal.addEventListener(
					"abort",
					() => reject(new Error("Stopped")),
					{ once: true },
				);
			}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("Unused");
		},
		stop: (id) => runtime.stop(id),
	});
	const run = runtime.create({
		triggerOrigin: {
			type: "manual",
			workflowId: "retry-api",
			at: new Date().toISOString(),
		},
		title: "Task",
		repositoryId: "repo",
		workspace: home,
		input: "",
		workflow: validateWorkflows([
			...defaultWorkflows,
			{
				id: "retry-api",
				name: "Retry",
				steps: [{ id: "work", name: "Work", type: "agent", prompt: "Work" }],
			},
		]).at(-1)!,
	});
	run.status = "failed";
	run.error = "Commit message rejected";
	const headers = { host: "localhost", "x-factory-request": "1" };
	try {
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: `/api/runs/${run.id}/retry`,
					headers: { host: "localhost" },
				})
			).statusCode,
		).toBe(403);
		const accepted = await server.app.inject({
			method: "POST",
			url: `/api/runs/${run.id}/retry`,
			headers,
		});
		expect(accepted.statusCode).toBe(202);
		expect(accepted.json()).toMatchObject({ id: run.id, status: "running" });
		expect(accepted.json().error).toBeUndefined();
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: `/api/runs/${run.id}/retry`,
					headers,
				})
			).statusCode,
		).toBe(409);
	} finally {
		await runtime.shutdown();
		await server.stop();
		rmSync(home, { recursive: true, force: true });
	}
});

it("starts, displays, answers and terminates runs through the local API", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-api-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({ questions: ["Which provider?"] }),
		script: async () => ({}),
		tool: async () => ({}),
	});
	let execution: Promise<void> | undefined;
	const server = new FactoryServer(runtime, {
		repositories: () => [{ id: "repo", name: "Repo" }],
		sessions: () => [],
		entries: () => [],
		start: async (input) => {
			const workflow = structuredClone(
				defaultWorkflows.find((item) => item.id === "factory-pipeline")!,
			);
			workflow.id = "question-fixture";
			workflow.steps = [workflow.steps[0]!];
			workflow.allowedTriggers = ["manual"];
			const run = runtime.create({
				triggerOrigin: {
					type: "manual",
					workflowId: workflow.id,
					at: new Date().toISOString(),
				},
				runner: input.runner,
				reasoningEffort: input.reasoningEffort,
				modelVariant: input.modelVariant,
				serviceTier: input.serviceTier,
				repositoryId: input.repositoryId,
				workspace: home,
				input: input.prompt,
				workflow,
			});
			execution = runtime.launch(run);
			return run;
		},
		stop: (id) => runtime.stop(id),
	});
	const headers = { host: "localhost", "x-factory-request": "1" };
	try {
		expect(
			(await server.app.inject({ url: "/api/config", headers })).json()
				.defaultWorkflow,
		).toBe("simple");
		const settings = await server.app.inject({
			method: "PUT",
			url: "/api/workflows",
			headers,
			payload: { workflows: defaultWorkflows, defaultWorkflow: "factory" },
		});
		expect(settings.statusCode).toBe(200);
		expect(settings.json().defaultWorkflow).toBe("factory");
		const savedConfig = (
			await server.app.inject({ url: "/api/config", headers })
		).json();
		const rejectedSettings = await server.app.inject({
			method: "PUT",
			url: "/api/workflows",
			headers: { ...headers, "x-factory-config": "stale" },
			payload: { workflows: defaultWorkflows, defaultWorkflow: "simple" },
		});
		expect(rejectedSettings.statusCode).toBe(409);
		expect(runtime.getDefaultWorkflow()).toBe("factory");
		const unchangedSettings = await server.app.inject({
			method: "PUT",
			url: "/api/workflows",
			headers: { ...headers, "x-factory-config": savedConfig.configRevision },
			payload: { workflows: defaultWorkflows, defaultWorkflow: "factory" },
		});
		expect(unchangedSettings.statusCode).toBe(200);
		expect(unchangedSettings.json().configRevision).toBe(
			savedConfig.configRevision,
		);
		expect(settings.json().workflows).toEqual(savedConfig.workflows);
		expect(
			settings
				.json()
				.workflows.find((workflow: { id: string }) => workflow.id === "simple")
				.launchFields,
		).toMatchObject([{ name: "prompt", required: true }]);
		expect(runtime.selectWorkflow([], "manual").id).toBe("factory");
		expect(
			(await server.app.inject({ url: "/api/config", headers })).json()
				.defaultWorkflow,
		).toBe("factory");
		expect(
			(
				await server.app.inject({
					method: "PUT",
					url: "/api/workflows",
					headers,
					payload: { workflows: defaultWorkflows, defaultWorkflow: "missing" },
				})
			).statusCode,
		).toBe(409);
		expect(
			(
				await server.app.inject({
					method: "PUT",
					url: "/api/workflows",
					headers,
					payload: { workflows: defaultWorkflows },
				})
			).statusCode,
		).toBe(400);
		expect(
			(
				await server.app.inject({
					method: "PUT",
					url: "/api/workflows",
					headers,
					payload: defaultWorkflows,
				})
			).statusCode,
		).toBe(200);
		expect(runtime.getDefaultWorkflow()).toBe("factory");
		const started = await server.app.inject({
			method: "POST",
			url: "/api/runs",
			headers,
			payload: {
				title: "Task",
				prompt: "Build",
				repositoryId: "repo",
				workflow: "factory",
				runner: "codex",
				reasoningEffort: "high",
				serviceTier: "fast",
			},
		});
		expect(started.statusCode).toBe(202);
		expect(started.json().reasoningEffort).toBe("high");
		expect(started.json().serviceTier).toBe("fast");
		const id = started.json().id;
		await vi.waitFor(() => expect(runtime.get(id).status).toBe("waiting"));
		const detail = await server.app.inject({ url: `/api/runs/${id}`, headers });
		expect(detail.json().questions).toEqual(["Which provider?"]);
		const staleAnswer = await server.app.inject({
			method: "POST",
			url: `/api/runs/${id}/answer`,
			headers,
			payload: {
				answer: "Old draft",
				context: { questions: ["Old question?"], step: detail.json().step },
			},
		});
		expect(staleAnswer.statusCode).toBe(409);
		expect(runtime.get(id).answers).toHaveLength(0);
		const staleBatch = await server.app.inject({
			method: "POST",
			url: `/api/runs/${id}/answer`,
			headers,
			payload: {
				answer: "Old batch",
				context: {
					questions: detail.json().questions,
					step: detail.json().step,
					questionBatchId: "previous-batch",
				},
			},
		});
		expect(staleBatch.statusCode).toBe(409);
		expect(runtime.get(id).answers).toHaveLength(0);

		expect(
			(
				await server.app.inject({
					method: "POST",
					url: `/api/runs/${id}/answer`,
					headers,
					payload: {
						answer: "Codex",
						context: {
							questions: detail.json().questions,
							questionBatchId: detail.json().questionBatchId,
							step: detail.json().step,
						},
					},
				})
			).statusCode,
		).toBe(200);
		await vi.waitFor(() => expect(runtime.get(id).answers).toHaveLength(1));
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: `/api/runs/${id}/stop`,
					headers,
				})
			).statusCode,
		).toBe(200);
		await execution;
		expect(runtime.get(id).status).toBe("stopped");
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: `/api/runs/${id}/answer`,
					headers,
					payload: { answer: "Late" },
				})
			).statusCode,
		).toBe(409);
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: "/api/runs",
					headers,
					payload: {},
				})
			).statusCode,
		).toBe(400);
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: "/api/runs",
					headers: { ...headers, origin: "https://other.example" },
					payload: {},
				})
			).statusCode,
		).toBe(403);
		expect(
			(
				await server.app.inject({
					url: "/api/config",
					headers: { host: "other.example" },
				})
			).statusCode,
		).toBe(403);
	} finally {
		runtime.shutdown();
		await execution;
		await server.app.close();
		rmSync(home, { recursive: true, force: true });
	}
});

it("validates the selected workflow's fields, accepts source-only Takeover, and persists custom inputs", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-fields-"));
	const hooks = {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	};
	const runtime = new WorkflowRuntime(home, hooks);
	const custom = validateWorkflows([
		...defaultWorkflows,
		{
			id: "deploy",
			name: "Deploy",
			steps: [
				{ id: "execute", name: "Execute", type: "script", script: "true" },
			],
			launchFields: [
				{ name: "target", label: "Deployment target", required: true },
				{
					name: "environment",
					label: "Environment",
					type: "select",
					required: true,
					defaultValue: "staging",
					options: [
						{ value: "staging", label: "Staging" },
						{ value: "production", label: "Production" },
					],
				},
			],
		},
	]).at(-1)!;
	runtime.updateWorkflows([...defaultWorkflows, custom]);
	const start = vi.fn(async (input: ResolvedLaunchRequest) =>
		runtime.create({
			triggerOrigin: {
				type: "manual",
				workflowId: input.workflow ?? runtime.getDefaultWorkflow(),
				at: new Date().toISOString(),
			},
			repositoryId: input.repositoryId,
			workspace: home,
			input: input.prompt,
			launchInputs: input.inputs,
			source: input.source,
			workflow: runtime.selectWorkflow([], "manual", input.workflow),
		}),
	);
	const server = new FactoryServer(runtime, {
		repositories: () => [{ id: "repo", name: "Repo" }],
		sessions: () => [],
		entries: () => [],
		start,
		stop: (id) => runtime.stop(id),
	});
	const headers = { host: "localhost", "x-factory-request": "1" };
	const launch = (workflow: string, fields = {}) =>
		server.app.inject({
			method: "POST",
			url: "/api/runs",
			headers,
			payload: { repositoryId: "repo", workflow, ...fields },
		});
	try {
		const config = (
			await server.app.inject({ url: "/api/config", headers })
		).json();
		expect(
			config.workflows
				.find((w) => w.id === "takeover")
				.launchFields.map((f) => [f.name, f.required]),
		).toEqual([
			["source", true],
			["prompt", false],
		]);
		for (const fields of [
			{ source: "DEF-1" },
			{ inputs: { source: "DEF-1" } },
		]) {
			const result = await launch("takeover", fields);
			expect(result.statusCode).toBe(202);
			expect(start.mock.lastCall?.[0]).toMatchObject({
				source: "DEF-1",
				prompt: "",
				inputs: { source: "DEF-1", prompt: "" },
			});
		}
		expect((await launch("takeover")).statusCode).toBe(400);
		const beforeInvalidSource = start.mock.calls.length;
		for (const source of [
			"Add UI to configure projects and Linear",
			"https://example.com/ATT-1127",
			"https://github.com/owner/repo/issues/3",
		]) {
			const invalid = await launch("takeover", { inputs: { source } });
			expect(invalid.statusCode).toBe(400);
			expect(invalid.json().error).toContain("Additional instructions");
		}
		expect(start).toHaveBeenCalledTimes(beforeInvalidSource);
		for (const source of [
			"https://linear.app/attraccess/issue/ATT-1127/power-consumption-billing",
			"https://github.com/owner/repo/pull/3",
		]) {
			expect(
				(await launch("takeover", { inputs: { source } })).statusCode,
			).toBe(202);
		}
		expect((await launch("factory", { title: "Build" })).statusCode).toBe(400);
		expect(
			(await launch("simple", { title: "Build", prompt: "Implement it" }))
				.statusCode,
		).toBe(202);
		const calls = start.mock.calls.length;
		for (const inputs of [
			{},
			{ target: " " },
			{ target: "App", environment: "invalid" },
			{ target: "App", undeclared: "hidden" },
		]) {
			expect((await launch("deploy", { inputs })).statusCode).toBe(400);
		}
		expect(start).toHaveBeenCalledTimes(calls);
		const result = await launch("deploy", { inputs: { target: " App " } });
		expect(result.statusCode).toBe(202);
		expect(result.json()).toMatchObject({
			title: result.json().id,
			input: "",
			launchInputs: { target: "App", environment: "staging" },
		});
		const restarted = new WorkflowRuntime(home, hooks);
		expect(restarted.get(result.json().id).launchInputs).toEqual({
			target: "App",
			environment: "staging",
		});
		// Saved definitions predating launchFields receive the same useful defaults.
		const legacy = structuredClone(defaultWorkflows);
		delete legacy.find((w) => w.id === "takeover")!.launchFields;
		expect(() => runtime.updateWorkflows(legacy)).toThrow("read-only");
		expect((await launch("takeover", { source: "DEF-1" })).statusCode).toBe(
			202,
		);
		runtime.updateWorkflows([
			...defaultWorkflows,
			{ ...custom, launchFields: [] },
		]);
		expect((await launch("deploy")).statusCode).toBe(202);
	} finally {
		runtime.shutdown();
		await server.app.close();
		rmSync(home, { recursive: true, force: true });
	}
});

it("loads large artifacts lazily and persists view state without changing a run", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-lazy-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const run = runtime.create({
		triggerOrigin: {
			type: "manual",
			workflowId: "factory",
			at: new Date().toISOString(),
		},
		title: "Large evidence",
		repositoryId: "repo",
		workspace: home,
		input: "",
		workflow: defaultWorkflows[1]!,
	});
	run.status = "completed";
	run.ticketSync = {
		error: "Ticket closure unavailable",
		receipts: [
			{ key: "pending", body: "z".repeat(250000) },
			{ key: "delivered", body: "Saved update", delivered: true },
			{ key: "superseded", body: "Old update", superseded: true },
		],
	};
	run.outputs.custom = { summary: "Big evidence", notes: "x".repeat(250000) };
	run.outputs.other = { summary: "Big evidence", notes: "y".repeat(250000) };
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => run,
		stop: () => {},
	});
	try {
		const summary = (
			await server.app.inject({ method: "GET", url: "/api/runs" })
		).json();
		expect(summary[0].outputs).toBeUndefined();
		expect(summary[0].ticketSync).toEqual({
			error: "Ticket closure unavailable",
			receipts: [{}, { delivered: true }, { superseded: true }],
		});
		const detail = (
			await server.app.inject({
				method: "GET",
				url: `/api/runs/${run.id}?view=dashboard`,
			})
		).json();
		expect(detail.outputs.custom).toMatchObject({
			__artifactPreview: true,
			summary: "Big evidence",
		});
		expect(detail.outputs.custom.notes).toBeUndefined();
		if (run.outputs.other)
			expect(detail.outputs.custom.__artifactHash).not.toBe(
				detail.outputs.other.__artifactHash,
			);
		expect(
			(
				await server.app.inject({
					method: "GET",
					url: `/api/runs/${run.id}/artifacts/custom`,
				})
			).json(),
		).toEqual(run.outputs.custom);
		const state = { keptOpen: true };
		expect(
			(
				await server.app.inject({
					method: "PUT",
					url: `/api/runs/${run.id}/view`,
					headers: { "x-factory-request": "1" },
					payload: state,
				})
			).statusCode,
		).toBe(200);
		expect(
			new WorkflowRuntime(home, {
				agent: async () => ({}),
				script: async () => ({}),
				tool: async () => ({}),
			}).viewState(run.id),
		).toEqual(state);
		expect(run.status).toBe("completed");
	} finally {
		await server.stop();
		rmSync(home, { recursive: true, force: true });
	}
});

it("streams coalesced changes, reconnects with a fresh snapshot, and closes subscriptions", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-sse-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	let notify: ((id: string) => void) | undefined;
	let unsubscribed = false;
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("unused");
		},
		stop: () => {},
		subscribe: (listener) => {
			notify = listener;
			return () => {
				unsubscribed = true;
			};
		},
	});
	const controller = new AbortController();
	try {
		await server.start(0);
		const address = server.app.server.address() as { port: number };
		const response = await factoryHttp(
			`http://localhost:${address.port}/api/events`,
			{
				host: "localhost",
				cookie: "factory-local-session=route-fixture-session",
			},
			controller.signal,
		);
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		const reader = response.body!.getReader();
		const decoder = new TextDecoder();
		expect(decoder.decode((await reader.read()).value)).toBe(
			"event: ready\ndata: {}\n\n",
		);
		const next = reader.read();
		notify!("session-one");
		notify!("session-one");
		runtime.updateViewState("session-two", {
			seenAt: new Date().toISOString(),
		});
		const message = decoder.decode((await next).value);
		expect(message).toBe(
			'event: change\ndata: {"ids":["session-one","session-two"],"config":false}\n\n',
		);
		await reader.cancel();
		await server.stop();
		expect(unsubscribed).toBe(true);
	} finally {
		controller.abort();
		await server.stop();
		rmSync(home, { recursive: true, force: true });
	}
});

it("returns normalized permissions and rejects forged manual requests before the start hook, exposing both origins", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-permissions-api-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const origin = {
		type: "ticket-assignment" as const,
		workflowId: "simple",
		at: "2026-10-05T10:00:00Z",
		ticket: {
			provider: "linear" as const,
			subtype: "mention" as const,
			workspaceId: "workspace",
			issueId: "issue",
			identifier: "TEST-1",
			agentSessionId: "original-simple",
		},
	};
	const start = vi.fn(async (input: ResolvedLaunchRequest) =>
		runtime.create({
			repositoryId: input.repositoryId,
			input: input.prompt,
			workspace: home,
			workflow: runtime.selectWorkflow([], "manual", input.workflow),
			triggerOrigin: {
				type: "manual",
				workflowId: input.workflow,
				at: origin.at,
			},
		}),
	);
	const server = new FactoryServer(runtime, {
		repositories: () => [{ id: "repo", name: "Repo" }],
		sessions: () => [
			{
				id: "original-simple",
				title: "Mention",
				status: "complete",
				createdAt: origin.at,
				workspace: home,
				triggerOrigin: origin,
			},
		],
		entries: () => [],
		start,
		stop: () => {},
	});
	const headers = { host: "localhost", "x-factory-request": "1" };
	try {
		const legacy = defaultWorkflows.map(
			({ allowedTriggers: _triggers, ...w }) => w,
		);
		expect(
			(
				await server.app.inject({
					method: "PUT",
					url: "/api/workflows",
					headers,
					payload: legacy,
				})
			).statusCode,
		).toBe(200);
		expect(
			(await server.app.inject({ url: "/api/config", headers }))
				.json()
				.workflows.every((w: any) => Array.isArray(w.allowedTriggers)),
		).toBe(true);
		const definitions = runtime.listWorkflows();
		definitions.find((w) => w.id === "simple")!.allowedTriggers = [
			"ticket-assignment",
		];
		runtime.updateWorkflows(definitions);
		const denied = await server.app.inject({
			method: "POST",
			url: "/api/runs",
			headers,
			payload: {
				workflow: "simple",
				repositoryId: "repo",
				prompt: "Spoof",
				triggerOrigin: origin,
				workflowDefinitions: defaultWorkflows,
			},
		});
		expect(denied.statusCode).toBe(409);
		expect(denied.json().error).toMatch(/simple.*manual.*Recipes/);
		expect(start).not.toHaveBeenCalled();
		expect(runtime.runs.size).toBe(0);
		const accepted = await server.app.inject({
			method: "POST",
			url: "/api/runs",
			headers,
			payload: {
				workflow: "factory",
				repositoryId: "repo",
				prompt: "Accepted",
				triggerOrigin: origin,
			},
		});
		expect(accepted.statusCode).toBe(202);
		expect(start.mock.calls[0]![0]).not.toHaveProperty("triggerOrigin");
		const graph = accepted.json();
		const list = (
			await server.app.inject({ url: "/api/runs", headers })
		).json();
		expect(list.find((r: any) => r.id === graph.id).triggerOrigin.type).toBe(
			"manual",
		);
		expect(
			list.find((r: any) => r.id === "original-simple").triggerOrigin,
		).toEqual(origin);
		expect(
			(
				await server.app.inject({ url: "/api/runs/original-simple", headers })
			).json().triggerOrigin,
		).toEqual(origin);
	} finally {
		await server.stop();
		rmSync(home, { recursive: true, force: true });
	}
});

it("protects chat delivery, validates input, preserves messages and refuses disabled or failed delivery", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-chat-api-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	let enabled = true;
	const message = vi.fn();
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [
			{
				id: "legacy",
				title: "Legacy",
				status: "complete",
				createdAt: new Date().toISOString(),
				workspace: home,
			},
		],
		entries: () => [],
		start: async () => {
			throw new Error("Unused");
		},
		stop: () => {},
		chat: () => ({
			enabled,
			available: enabled,
			mode: "steer",
			step: "simple",
		}),
		message,
	});
	const headers = { host: "localhost", "x-factory-request": "1" };
	const send = (text: string, h = headers, id = "legacy") =>
		server.app.inject({
			method: "POST",
			url: `/api/runs/${id}/messages`,
			headers: h,
			payload: { text },
		});
	try {
		expect(
			(await send("Hi", { host: "localhost" } as typeof headers)).statusCode,
		).toBe(403);
		expect((await send(" ")).statusCode).toBe(400);
		expect((await send("Hi", headers, "missing")).statusCode).toBe(404);
		runtime.updateWorkflows(
			runtime
				.listWorkflows()
				.map((workflow) =>
					workflow.id === "simple"
						? { ...workflow, allowedTriggers: [] }
						: workflow,
				),
		);
		expect((await send(" New instruction ")).statusCode).toBe(202);
		expect(message).toHaveBeenCalledExactlyOnceWith(
			"legacy",
			"New instruction",
			expect.any(String),
		);
		const detail = (
			await server.app.inject({
				url: "/api/runs/legacy?view=dashboard",
				headers,
			})
		).json();
		expect(detail.chat).toMatchObject({ enabled: true, available: true });
		expect(detail.chatMessages).toMatchObject([
			{ text: "New instruction", step: "simple" },
		]);
		enabled = false;
		expect((await send("No")).statusCode).toBe(409);
		enabled = true;
		message.mockImplementation(async () => {
			throw new Error("Turn ended");
		});
		expect((await send("Too late")).json().error).toBe("Turn ended");
		expect(runtime.chatMessages("legacy")).toHaveLength(1);
	} finally {
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("serves a coherent installable shell with protected versioned writes and explicit static routes", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-pwa-api-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const start = vi.fn(async () => ({ id: "test" }) as any);
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start,
		stop: () => {},
	});
	const headers = { host: "localhost", "x-factory-request": "1" };
	try {
		const version = await server.app.inject({ url: "/api/version", headers });
		expect(version.statusCode).toBe(200);
		expect(version.headers["cache-control"]).toBe("no-store");
		const { build, protocol } = version.json();
		expect(protocol).toBe(1);
		expect(build).toMatch(/^[a-f0-9]{24}$/);
		const index = await server.app.inject({ url: "/", headers });
		expect(index.headers["content-type"]).toContain("text/html");
		expect(index.headers["cache-control"]).toBe("no-cache");
		expect(index.headers["x-factory-build"]).toBe(build);
		const scripts = index.body.matchAll(
			/(?:src|href)="(\/(?:app|styles)\.[a-f0-9]+\.(?:js|css))"/g,
		);
		const paths = [...scripts].map((match) => match[1]);
		expect(paths).toHaveLength(2);
		for (const url of paths) {
			const asset = await server.app.inject({ url, headers });
			expect(asset.statusCode).toBe(200);
			expect(asset.headers["cache-control"]).toContain("immutable");
			expect(asset.headers["x-factory-build"]).toBe(build);
		}
		const manifest = await server.app.inject({
			url: "/manifest.webmanifest",
			headers,
		});
		expect(manifest.headers["content-type"]).toContain(
			"application/manifest+json",
		);
		expect(manifest.json()).toMatchObject({
			id: "/",
			display: "standalone",
			scope: "/",
			start_url: "/",
			name: "Bob’s Factory",
		});
		for (const icon of [
			...manifest.json().icons,
			{ src: "/icons/apple-touch-icon.png" },
		]) {
			const image = await server.app.inject({ url: icon.src, headers });
			expect(image.headers["content-type"]).toBe("image/png");
			expect([...image.rawPayload.subarray(0, 8)]).toEqual([
				137, 80, 78, 71, 13, 10, 26, 10,
			]);
		}
		const worker = await server.app.inject({ url: "/sw.js", headers });
		expect(worker.headers["cache-control"]).toBe("no-cache");
		for (const url of [
			"/shell.json",
			"/current.json",
			"/package.json",
			"/icons/not-allowed.png",
			"/api/version",
		]) {
			const result = await server.app.inject({
				url,
				headers: { host: "evil.test" },
			});
			expect(result.statusCode).toBe(403);
		}
		for (const url of [
			"/shell.json",
			"/current.json",
			"/package.json",
			"/icons/not-allowed.png",
		]) {
			expect((await server.app.inject({ url, headers })).statusCode).toBe(404);
		}
		const payload = {
			repositoryId: "repo",
			workflow: "simple",
			inputs: { prompt: "task" },
		};
		const stale = await server.app.inject({
			method: "POST",
			url: "/api/runs",
			headers: { ...headers, "x-factory-build": "stale" },
			payload,
		});
		expect(stale.statusCode).toBe(409);
		expect(stale.json().code).toBe("FACTORY_VERSION_MISMATCH");
		expect(start).not.toHaveBeenCalled();
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: "/api/runs",
					headers: {
						...headers,
						"x-factory-build": build,
						origin: "https://evil.test",
					},
					payload,
				})
			).statusCode,
		).toBe(403);
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: "/api/runs",
					headers: { host: "localhost", "x-factory-build": build },
					payload,
				})
			).statusCode,
		).toBe(403);
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: "/api/runs",
					headers: { ...headers, "x-factory-build": build },
					payload,
				})
			).statusCode,
		).toBe(202);
		expect(start).toHaveBeenCalledOnce();
		// Legacy header-less local automation is explicitly compatible.
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: "/api/runs",
					headers,
					payload,
				})
			).statusCode,
		).toBe(202);
	} finally {
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("protects title retries and accepts existing standalone sessions", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-title-retry-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const retryTitle = vi.fn();
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [
			{
				id: "chat",
				title: "chat",
				status: "running",
				createdAt: new Date().toISOString(),
				workspace: home,
				titleGeneration: {
					state: "failed",
					settings: { runner: "codex" },
					context: "Task",
					error: "Timed out",
				},
			},
		],
		entries: () => [],
		start: async () => {
			throw new Error("unused");
		},
		stop: () => {},
		retryTitle,
	});
	const headers = { host: "localhost", "x-factory-request": "1" };
	const send = (id: string, requestHeaders = headers) =>
		server.app.inject({
			method: "POST",
			url: `/api/runs/${id}/retry-title`,
			headers: requestHeaders,
		});
	try {
		expect(
			(await send("chat", { host: "localhost" } as typeof headers)).statusCode,
		).toBe(403);
		expect((await send("missing")).statusCode).toBe(404);
		expect(retryTitle).not.toHaveBeenCalled();
		expect((await send("chat")).statusCode).toBe(202);
		expect(retryTitle).toHaveBeenCalledExactlyOnceWith("chat");
		retryTitle.mockImplementation(() => {
			throw new Error("Only failed title generation can be retried");
		});
		expect((await send("chat")).statusCode).toBe(409);
		expect(
			(
				await server.app.inject({
					url: "/api/runs/chat?view=dashboard",
					headers,
				})
			).json().titleGeneration.state,
		).toBe("failed");
	} finally {
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("protects and persists global title settings independently of workflow configuration", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-title-settings-"));
	const hooks = {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	};
	const runtime = new WorkflowRuntime(home, hooks);
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("unused");
		},
		stop: () => {},
	});
	const headers = { host: "localhost", "x-factory-request": "1" };
	try {
		const originalConfig = (
			await server.app.inject({ url: "/api/config", headers })
		).json();
		expect(originalConfig.titleGeneration).toEqual({});
		for (const badHeaders of [
			{ host: "evil.test", "x-factory-request": "1" },
			{ host: "localhost" },
			{ ...headers, origin: "https://evil.test" },
		])
			expect(
				(
					await server.app.inject({
						method: "PUT",
						url: "/api/title-settings",
						headers: badHeaders,
						payload: { runner: "codex" },
					})
				).statusCode,
			).toBe(403);
		const settings = {
			runner: "codex",
			model: "cheap",
			reasoningEffort: "low",
		};
		const saved = await server.app.inject({
			method: "PUT",
			url: "/api/title-settings",
			headers: {
				...headers,
				"x-factory-config": originalConfig.configRevision,
			},
			payload: settings,
		});
		expect(saved.statusCode).toBe(200);
		const savedConfig = (
			await server.app.inject({ url: "/api/config", headers })
		).json();
		expect(saved.json()).toEqual({
			titleGeneration: settings,
			configRevision: savedConfig.configRevision,
		});
		expect(savedConfig.configRevision).not.toBe(originalConfig.configRevision);
		for (const url of [
			"/api/title-settings",
			"/api/title-settings?source=tab",
		]) {
			const staleSave = await server.app.inject({
				method: "PUT",
				url,
				headers: {
					...headers,
					"x-factory-config": originalConfig.configRevision,
				},
				payload: { runner: "claude", model: "stale-tab" },
			});
			expect(staleSave.statusCode).toBe(409);
			expect(runtime.getTitleSettings()).toEqual(settings);
		}
		const currentSave = await server.app.inject({
			method: "PUT",
			url: "/api/title-settings",
			headers: { ...headers, "x-factory-config": savedConfig.configRevision },
			payload: settings,
		});
		expect(currentSave.statusCode).toBe(200);
		expect(currentSave.json().configRevision).toBe(savedConfig.configRevision);
		runtime.updateWorkflows(runtime.listWorkflows());
		expect(new WorkflowRuntime(home, hooks).getTitleSettings()).toEqual(
			settings,
		);
		expect(
			(await server.app.inject({ url: "/api/config", headers })).json()
				.titleGeneration,
		).toEqual(settings);
		expect(
			(
				await server.app.inject({
					method: "PUT",
					url: "/api/title-settings",
					headers,
					payload: { runner: "unknown" },
				})
			).statusCode,
		).toBe(400);
		expect(
			(
				await server.app.inject({
					method: "PUT",
					url: "/api/title-settings",
					headers,
					payload: { runner: "gemini", reasoningEffort: "high" },
				})
			).statusCode,
		).toBe(409);
	} finally {
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("protects tracking-only retries and leaves development checkpoints intact", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-tracking-api-"));
	const retryTracking = vi.fn(async () => {});
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
		retryTracking,
	});
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("unused");
		},
		stop: (id) => runtime.stop(id),
	});
	const run = runtime.create({
		repositoryId: "repo",
		workflow: defaultWorkflows.find((w) => w.id === "factory")!,
		workspace: home,
		input: "",
		triggerOrigin: {
			type: "manual",
			workflowId: "factory",
			at: new Date().toISOString(),
		},
	});
	run.status = "completed";
	run.outputs.merge = {
		merged: true,
		url: "https://github.com/org/repo/pull/1",
	};
	const before = structuredClone({
		status: run.status,
		checkpoint: run.checkpoint,
		outputs: run.outputs,
		history: run.history,
	});
	try {
		const url = `/api/runs/${run.id}/ticket-sync`;
		expect(
			(
				await server.app.inject({
					method: "POST",
					url,
					headers: { host: "localhost" },
				})
			).statusCode,
		).toBe(403);
		expect(
			(
				await server.app.inject({
					method: "POST",
					url,
					headers: { host: "localhost", "x-factory-request": "1" },
				})
			).statusCode,
		).toBe(200);
		expect(retryTracking).toHaveBeenCalledExactlyOnceWith(run);
		expect({
			status: run.status,
			checkpoint: run.checkpoint,
			outputs: run.outputs,
			history: run.history,
		}).toEqual(before);
	} finally {
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("rejects title saves overtaken during body parsing and simultaneous saves", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-title-save-race-"));
	const hooks = {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	};
	const runtime = new WorkflowRuntime(home, hooks);
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("unused");
		},
		stop: () => {},
	});
	const headers = { host: "localhost", "x-factory-request": "1" };
	const revision = async () =>
		(await server.app.inject({ url: "/api/config", headers })).json()
			.configRevision;
	let headersReceived!: () => void;
	const received = new Promise<void>((resolve) => {
		headersReceived = resolve;
	});
	server.app.addHook("onRequest", async (request) => {
		if (request.headers["x-test-delayed"]) headersReceived();
	});
	let delayed: ReturnType<typeof httpRequest> | undefined;
	try {
		const address = await server.app.listen({ port: 0, host: "127.0.0.1" });
		const originalRevision = await revision();
		const staleSettings = { runner: "codex", model: "delayed-tab" };
		const body = JSON.stringify(staleSettings);
		const completed = new Promise<number | undefined>((resolve, reject) => {
			delayed = httpRequest(
				`${address}/api/title-settings?source=delayed`,
				{
					method: "PUT",
					headers: {
						...headers,
						cookie: "factory-local-session=route-fixture-session",
						origin: "http://localhost",
						"x-factory-config": originalRevision,
						"x-test-delayed": "1",
						"content-type": "application/json",
						"content-length": Buffer.byteLength(body),
					},
				},
				(response) => {
					response.resume();
					response.on("end", () => resolve(response.statusCode));
				},
			);
			delayed.on("error", reject);
			delayed.write(body.slice(0, 10));
		});
		await received;
		const newerSettings = { runner: "codex", model: "newer-tab" };
		const save = (configRevision: string, model: string) =>
			server.app.inject({
				method: "PUT",
				url: "/api/title-settings",
				headers: { ...headers, "x-factory-config": configRevision },
				payload: { runner: "codex", model },
			});
		expect((await save(originalRevision, newerSettings.model)).statusCode).toBe(
			200,
		);
		delayed!.end(body.slice(10));
		expect(await completed).toBe(409);
		expect(runtime.getTitleSettings()).toEqual(newerSettings);
		expect(new WorkflowRuntime(home, hooks).getTitleSettings()).toEqual(
			newerSettings,
		);

		const currentRevision = await revision();
		const concurrent = await Promise.all([
			save(currentRevision, "tab-a"),
			save(currentRevision, "tab-b"),
		]);
		expect(concurrent.map((response) => response.statusCode).sort()).toEqual([
			200, 409,
		]);
		const winner = concurrent
			.find((response) => response.statusCode === 200)!
			.json().titleGeneration;
		expect(runtime.getTitleSettings()).toEqual(winner);
		expect(new WorkflowRuntime(home, hooks).getTitleSettings()).toEqual(winner);
	} finally {
		delayed?.destroy();
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it("protects and validates machine settings, exposing durable cross-worker policy and queue counts", async () => {
	const { MachineCapacity } = await import("../src/MachineCapacity.js");
	const home = mkdtempSync(join(tmpdir(), "factory-capacity-api-"));
	const capacity = new MachineCapacity(1, join(home, "capacity"));
	const other = new MachineCapacity(undefined, join(home, "capacity"));
	await Promise.all([capacity.ready(), other.ready()]);
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
		capacity,
	});
	const server = new FactoryServer(runtime, {
		capacity,
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("Unused");
		},
		stop: (id) => runtime.stop(id),
	});
	const headers = { host: "localhost", "x-factory-request": "1" };
	try {
		expect(
			(
				await server.app.inject({
					method: "PUT",
					url: "/api/capacity",
					headers: { host: "localhost" },
					payload: { limit: 2 },
				})
			).statusCode,
		).toBe(403);
		expect(
			(
				await server.app.inject({
					method: "PUT",
					url: "/api/capacity",
					headers: { ...headers, origin: "https://elsewhere.invalid" },
					payload: { limit: 2 },
				})
			).statusCode,
		).toBe(403);
		for (const payload of [
			...[0, -1, 1.5, "2"].flatMap((value) => [
				{ limit: value },
				{ concurrency: value },
			]),
			{},
			{ limit: 2, concurrency: 3 },
		]) {
			expect(
				(
					await server.app.inject({
						method: "PUT",
						url: "/api/capacity",
						headers,
						payload,
					})
				).statusCode,
			).toBe(400);
		}
		const concurrency = await server.app.inject({
			method: "PUT",
			url: "/api/capacity",
			headers,
			payload: { concurrency: 3 },
		});
		expect(concurrency.statusCode).toBe(200);
		expect((await other.snapshot()).limit).toBe(3);
		const saved = await server.app.inject({
			method: "PUT",
			url: "/api/capacity",
			headers,
			payload: { limit: 2 },
		});
		expect(saved.statusCode).toBe(200);
		expect(saved.json().capacity.limit).toBe(2);
		expect((await other.snapshot()).limit).toBe(2);
		const first = await other.acquireLease(),
			second = await other.acquireLease();
		const controller = new AbortController();
		const queued = other.acquireLease(controller.signal);
		const cancelled = expect(queued).rejects.toThrow();
		await vi.waitFor(async () => {
			const response = await server.app.inject({ url: "/api/config", headers });
			expect(response.json().capacity).toMatchObject({
				limit: 2,
				active: 2,
				queued: 1,
			});
		});
		controller.abort();
		await cancelled;
		await Promise.all([first.release(), second.release()]);
		expect(
			(await server.app.inject({ url: "/api/config", headers })).json()
				.capacity,
		).toMatchObject({ active: 0, queued: 0 });
	} finally {
		await runtime.shutdown();
		await server.stop();
		await capacity.shutdown();
		await other.shutdown();
		rmSync(home, { recursive: true, force: true });
	}
});

it.each([
	"trusted",
	"public",
] as const)("protects and redacts push device APIs with the exact configured HTTPS origin (%s)", async (proxy) => {
	vi.stubEnv(
		"BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN",
		proxy === "public" ? "https://factory.example.ts.net" : "",
	);
	vi.stubEnv(
		"BOBS_FACTORY_FACTORY_ORIGIN",
		proxy === "trusted" ? "https://factory.example.ts.net" : "",
	);
	if (proxy === "public") delete process.env.BOBS_FACTORY_FACTORY_ORIGIN;
	const home = mkdtempSync(join(tmpdir(), "factory-push-api-"));
	const sender = vi.fn(async () => {}),
		push = new FactoryPush(home, sender, Date.now, "mailto:test@example.com");
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const server = new ProtectedFactoryServer(runtime, {
		push,
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("unused");
		},
		stop: () => {},
	});
	const key = webPush.generateVAPIDKeys().publicKey;
	const payload = {
		label: "phone",
		subscription: {
			endpoint: "https://web.push.apple.com/private-subscription",
			keys: { p256dh: key, auth: Buffer.alloc(16, 1).toString("base64url") },
		},
	};
	const headers = {
		host: "factory.example.ts.net",
		origin: "https://factory.example.ts.net",
		"x-factory-request": "1",
	};
	try {
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: "/api/push/devices",
					headers: { ...headers, host: "evil.test" },
					payload,
				})
			).statusCode,
		).toBe(403);
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: "/api/push/devices",
					headers: { ...headers, origin: "https://evil.test" },
					payload,
				})
			).statusCode,
		).toBe(403);
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: "/api/push/devices",
					headers: { host: headers.host, origin: headers.origin },
					payload,
				})
			).statusCode,
		).toBe(403);
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: "/api/push/devices",
					headers: { ...headers, "x-factory-build": "old" },
					payload,
				})
			).statusCode,
		).toBe(409);
		for (const url of ["/api/push", "/api/push/devices"]) {
			expect((await server.app.inject({ url, headers })).statusCode).toBe(401);
		}
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: "/api/push/devices",
					headers,
					payload,
				})
			).statusCode,
		).toBe(401);
		expect(push.status().devices).toEqual([]);
		const keyFixture = authenticator();
		const grant = JSON.parse(readFileSync(server.auth.grantPath, "utf8")).token;
		const options = await server.app.inject({
			method: "POST",
			url: "/api/auth/register/options",
			headers,
			payload: { grant },
		});
		expect(options.statusCode).toBe(200);
		const verified = await server.app.inject({
			method: "POST",
			url: "/api/auth/register/verify",
			headers: {
				...headers,
				cookie: String(options.headers["set-cookie"]).split(";")[0],
			},
			payload: {
				transaction: options.json().transaction,
				response: keyFixture.register(
					options.json().options.challenge,
					headers.origin,
				),
			},
		});
		expect(verified.statusCode).toBe(200);
		const authenticatedHeaders = {
			...headers,
			cookie: String(verified.headers["set-cookie"]).split(";")[0],
		};
		const registration = await server.app.inject({
			method: "POST",
			url: "/api/push/devices",
			headers: authenticatedHeaders,
			payload,
		});
		expect(registration.statusCode).toBe(200);
		const { id } = registration.json();
		const status = await server.app.inject({
			url: "/api/push",
			headers: authenticatedHeaders,
		});
		expect(status.headers["cache-control"]).toBe("no-store");
		expect(status.body).not.toMatch(
			/private-subscription|privateKey|p256dh|auth"/,
		);
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: `/api/push/devices/${id}/test`,
					headers: authenticatedHeaders,
					payload: {},
				})
			).json().accepted,
		).toBe(true);
		expect(
			(
				await server.app.inject({
					method: "PATCH",
					url: `/api/push/devices/${id}`,
					headers: authenticatedHeaders,
					payload: { enabled: false },
				})
			).statusCode,
		).toBe(200);
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: `/api/push/devices/${id}/test`,
					headers: authenticatedHeaders,
					payload: {},
				})
			).statusCode,
		).toBe(409);
		expect(
			(
				await server.app.inject({
					method: "DELETE",
					url: `/api/push/devices/${id}`,
					headers: authenticatedHeaders,
				})
			).statusCode,
		).toBe(200);
		expect(push.status().devices).toEqual([]);
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: "/api/push/devices",
					headers: authenticatedHeaders,
					payload: {
						...payload,
						subscription: {
							...payload.subscription,
							endpoint: "https://127.0.0.1/private",
						},
					},
				})
			).statusCode,
		).toBe(400);
		server.auth.logout(
			authenticatedHeaders.cookie.split("=")[1],
			headers.origin,
		);
		for (const [method, url, payload] of [
			["GET", "/api/push", undefined],
			["POST", "/api/push/devices", {}],
			["PATCH", `/api/push/devices/${id}`, { enabled: true }],
			["DELETE", `/api/push/devices/${id}`, undefined],
			["POST", `/api/push/devices/${id}/test`, {}],
		] as const) {
			expect(
				(
					await server.app.inject({
						method,
						url,
						headers: authenticatedHeaders,
						payload,
					})
				).statusCode,
			).toBe(401);
		}
	} finally {
		await push.stop();
		await runtime.shutdown();
		await server.stop();
		rmSync(home, { recursive: true, force: true });
		vi.unstubAllEnvs();
	}
});
