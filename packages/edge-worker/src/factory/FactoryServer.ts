import { readFileSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { reasoningLevels } from "./AgentSettings.js";
import { CaptureSchema, verifiedScreenshot } from "./FactoryTools.js";
import {
	getLaunchFields,
	LaunchRequestSchema,
	type ResolvedLaunchRequest,
	resolveLaunchRequest,
} from "./LaunchFields.js";
import type { FactoryRun, WorkflowRuntime } from "./WorkflowRuntime.js";

interface ServerHooks {
	defaultRunner?(): string;
	repositories(): { id: string; name: string }[];
	sessions(): {
		id: string;
		title: string;
		status: string;
		createdAt: string;
		workspace: string;
		repositoryId?: string;
	}[];
	entries(id: string): unknown[];
	start(input: ResolvedLaunchRequest): Promise<FactoryRun>;
	stop(id: string): void;
}

export class FactoryServer {
	readonly app: FastifyInstance;
	constructor(runtime: WorkflowRuntime, hooks: ServerHooks) {
		this.app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
		this.app.setErrorHandler((error, _request, reply) =>
			reply.code(error instanceof z.ZodError ? 400 : 409).send({
				error:
					error instanceof z.ZodError
						? error.issues.map((issue) => issue.message).join("\n")
						: error instanceof Error
							? error.message
							: "Request failed",
			}),
		);
		// This separate listener is loopback-only and never registered on Cyrus's webhook tunnel.
		this.app.addHook("onRequest", async (request, reply) => {
			const host = request.headers.host ?? "";
			if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host))
				return reply.code(403).send({ error: "Local UI only" });
			if (!["GET", "HEAD"].includes(request.method)) {
				const origin = request.headers.origin;
				if (origin && origin !== `http://${host}`)
					return reply.code(403).send({ error: "Invalid origin" });
				if (request.headers["x-factory-request"] !== "1")
					return reply
						.code(403)
						.send({ error: "Factory request header required" });
			}
		});
		for (const [path, name, contentType] of [
			["/", "index.html", "text/html"],
			["/app.js", "app.js", "application/javascript"],
			["/styles.css", "styles.css", "text/css"],
		]) {
			this.app.get(path!, (_request, reply) =>
				reply
					.type(contentType!)
					.send(
						readFileSync(new URL(`./web/${name}`, import.meta.url), "utf8"),
					),
			);
		}
		this.app.get("/api/config", () => ({
			repositories: hooks.repositories(),
			workflows: runtime.listWorkflows().map((workflow) => ({
				...workflow,
				launchFields: getLaunchFields(workflow),
			})),
			defaultWorkflow: runtime.getDefaultWorkflow(),
			defaultRunner: hooks.defaultRunner?.() ?? "claude",
			reasoningLevels,
		}));
		this.app.put("/api/workflows", (request) => {
			// Retain the original array API for existing local clients.
			if (Array.isArray(request.body))
				return runtime.updateWorkflows(request.body);
			const { workflows, defaultWorkflow } = z
				.object({
					workflows: z.array(z.unknown()),
					defaultWorkflow: z.string().min(1),
				})
				.parse(request.body);
			return {
				workflows: runtime.updateWorkflows(workflows, defaultWorkflow),
				defaultWorkflow: runtime.getDefaultWorkflow(),
			};
		});
		this.app.get("/api/runs", () => {
			const workflowRuns = [...runtime.runs.values()].map(
				({
					id,
					title,
					status,
					createdAt,
					updatedAt,
					repositoryId,
					step,
					workflow,
					error,
				}) => ({
					id,
					title,
					status,
					createdAt,
					updatedAt,
					repositoryId,
					step,
					workflow: workflow.id,
					error,
				}),
			);
			const tracked = new Set(workflowRuns.map((run) => run.id));
			return [
				...workflowRuns,
				...hooks
					.sessions()
					.filter((session) => !tracked.has(session.id))
					.map((session) => ({ ...session, workflow: "simple" })),
			].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		});
		this.app.post("/api/runs", async (request, reply) => {
			const input = LaunchRequestSchema.parse(request.body);
			const workflow = runtime.selectWorkflow([], input.workflow);
			return reply
				.code(202)
				.send(await hooks.start(resolveLaunchRequest(workflow, input)));
		});
		this.app.get<{ Params: { id: string } }>(
			"/api/runs/:id",
			(request, reply) => {
				const run = runtime.runs.get(request.params.id);
				const session = hooks
					.sessions()
					.find((item) => item.id === request.params.id);
				if (!run && !session)
					return reply.code(404).send({ error: "Run not found" });
				return {
					...(run ?? {
						...session,
						workflow: { id: "simple", steps: [] },
						events: [],
						questions: [],
						outputs: {},
					}),
					entries: hooks.entries(request.params.id),
				};
			},
		);
		this.app.post<{ Params: { id: string } }>(
			"/api/runs/:id/stop",
			(request, reply) => {
				if (
					!runtime.runs.has(request.params.id) &&
					!hooks.sessions().some((session) => session.id === request.params.id)
				)
					return reply.code(404).send({ error: "Run not found" });
				hooks.stop(request.params.id);
				return { stopped: true };
			},
		);
		this.app.post<{ Params: { id: string } }>(
			"/api/runs/:id/answer",
			(request) => {
				const { answer } = z
					.object({ answer: z.string().trim().min(1).max(100000) })
					.parse(request.body);
				runtime.answer(request.params.id, answer);
				return { accepted: true };
			},
		);
		this.app.get<{ Params: { id: string; index: string } }>(
			"/api/runs/:id/screenshots/:index",
			(request, reply) => {
				const run = runtime.get(request.params.id);
				const index = z.coerce
					.number()
					.int()
					.nonnegative()
					.parse(request.params.index);
				const shot = CaptureSchema.parse(run.outputs.capture).screenshots[
					index
				];
				if (!shot)
					return reply.code(404).send({ error: "Screenshot not found" });
				const path = verifiedScreenshot(
					shot.path,
					join(runtime.directory, "evidence", run.id),
				);
				const bytes = readFileSync(path);
				return reply
					.type(bytes[0] === 137 ? "image/png" : "image/jpeg")
					.send(bytes);
			},
		);
	}
	async start(port: number): Promise<void> {
		if (!Number.isInteger(port) || port < 0 || port > 65535)
			throw new Error("Invalid factory UI port");
		await this.app.listen({ port, host: "127.0.0.1" });
	}
	async stop(): Promise<void> {
		await this.app.close();
	}
}
