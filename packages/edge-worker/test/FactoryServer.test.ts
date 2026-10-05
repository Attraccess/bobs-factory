import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryServer } from "../src/factory/FactoryServer.js";
import type { ResolvedLaunchRequest } from "../src/factory/LaunchFields.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";

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
			workflow.steps = [workflow.steps[0]!];
			const run = runtime.create({
				runner: input.runner,
				reasoningEffort: input.reasoningEffort,
				modelVariant: input.modelVariant,
				serviceTier: input.serviceTier,
				title: input.title,
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
		expect(runtime.selectWorkflow([]).id).toBe("factory");
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
		expect(
			(
				await server.app.inject({
					method: "POST",
					url: `/api/runs/${id}/answer`,
					headers,
					payload: { answer: "Codex" },
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
			title: input.title,
			repositoryId: input.repositoryId,
			workspace: home,
			input: input.prompt,
			launchInputs: input.inputs,
			source: input.source,
			workflow: runtime.selectWorkflow([], input.workflow),
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
				titleProvided: false,
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
			title: "Deploy",
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
		runtime.updateWorkflows(legacy);
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
		title: "Large evidence",
		repositoryId: "repo",
		workspace: home,
		input: "",
		workflow: defaultWorkflows[1]!,
	});
	run.status = "completed";
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
		const response = await fetch(
			`http://localhost:${address.port}/api/events`,
			{ signal: controller.signal },
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
		expect((await send(" New instruction ")).statusCode).toBe(202);
		expect(message).toHaveBeenCalledExactlyOnceWith(
			"legacy",
			"New instruction",
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
		message.mockImplementation(() => {
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
