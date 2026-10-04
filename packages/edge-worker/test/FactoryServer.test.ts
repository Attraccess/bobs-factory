import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryServer } from "../src/factory/FactoryServer.js";
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
			const workflow = structuredClone(defaultWorkflows[1]!);
			workflow.steps = [workflow.steps[0]!];
			const run = runtime.create({
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
			},
		});
		expect(started.statusCode).toBe(202);
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
