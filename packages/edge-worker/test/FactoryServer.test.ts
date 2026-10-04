import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryServer } from "../src/factory/FactoryServer.js";
import type { ResolvedLaunchRequest } from "../src/factory/LaunchFields.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";

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
			},
		});
		expect(started.statusCode).toBe(202);
		expect(started.json().reasoningEffort).toBe("high");
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
