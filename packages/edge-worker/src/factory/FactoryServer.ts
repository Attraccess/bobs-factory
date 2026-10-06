import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { activityMarkers, activityPage } from "./ActivityPage.js";
import { reasoningLevels, serviceTierRunners } from "./AgentSettings.js";
import { CaptureSchema, verifiedScreenshot } from "./FactoryTools.js";
import { factoryWebAssets } from "./FactoryWebAssets.js";
import {
	getLaunchFields,
	LaunchRequestSchema,
	type ResolvedLaunchRequest,
	resolveLaunchRequest,
} from "./LaunchFields.js";
import type { ChatState } from "./SessionChat.js";
import type { FactoryRun, WorkflowRuntime } from "./WorkflowRuntime.js";

interface ServerHooks {
	chat?(id: string): ChatState;
	message?(id: string, text: string): void;
	defaultRunner?(): string;
	subscribe?(listener: (id: string) => void): () => void;
	repositories(): { id: string; name: string }[];
	sessions(): {
		triggerOrigin?: import("cyrus-core").WorkflowTriggerOrigin;
		id: string;
		title: string;
		status: string;
		createdAt: string;
		workspace: string;
		repositoryId?: string;
	}[];
	entries(id: string): unknown[];
	start(input: ResolvedLaunchRequest): Promise<FactoryRun>;
	followup?(id: string, feedback: string): Promise<FactoryRun>;
	stop(id: string): void;
}

export class FactoryServer {
	readonly app: FastifyInstance;
	private streams = new Set<ServerResponse>();
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
		const pendingIds = new Set<string>();
		let configChanged = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const broadcast = (change: { id?: string; config?: boolean }) => {
			if (!this.streams.size) return;
			if (change.id) pendingIds.add(change.id);
			if (change.config) configChanged = true;
			if (timer || !this.streams.size) return;
			timer = setTimeout(() => {
				timer = undefined;
				const data = `event: change\ndata: ${JSON.stringify({ ids: [...pendingIds], config: configChanged })}\n\n`;
				pendingIds.clear();
				configChanged = false;
				for (const stream of this.streams) {
					if (stream.destroyed) this.streams.delete(stream);
					else if (!stream.write(data)) stream.destroy(); // Slow readers reconnect and refresh, never queue unlimited events.
				}
			}, 500);
		};
		const unsubscribeRuntime = runtime.subscribe(broadcast);
		const unsubscribeSessions = hooks.subscribe?.((id) => broadcast({ id }));
		this.app.addHook("preClose", async () => {
			unsubscribeRuntime();
			unsubscribeSessions?.();
			if (timer) clearTimeout(timer);
			for (const stream of this.streams) stream.end();
			this.streams.clear();
		});
		const shell = factoryWebAssets();
		const configRevision = () =>
			createHash("sha256")
				.update(
					JSON.stringify([
						runtime.listWorkflows(),
						runtime.getDefaultWorkflow(),
					]),
				)
				.digest("hex");
		this.app.addHook("onSend", async (request, reply) => {
			if (request.url.startsWith("/api/")) {
				reply.header("Cache-Control", "no-store");
				reply.header("X-Factory-Build", shell.build);
			}
		});
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
				const version = request.headers["x-factory-build"];
				// Header-less local automation remains compatible; the versioned UI always sends it.
				if (version !== undefined && version !== shell.build)
					return reply.code(409).send({
						error:
							"Factory updated. Preserve your drafts and update before trying again.",
						code: "FACTORY_VERSION_MISMATCH",
					});
				const config = request.headers["x-factory-config"];
				if (
					["/api/workflows", "/api/runs"].includes(request.url) &&
					config !== undefined &&
					config !== configRevision()
				)
					return reply.code(409).send({
						error:
							"Recipe settings changed. Refresh and review your draft before sending.",
					});
			}
		});
		for (const asset of shell.assets) {
			this.app.get(asset.path, (_request, reply) =>
				reply
					.header(
						"Cache-Control",
						asset.immutable
							? "public, max-age=31536000, immutable"
							: "no-cache",
					)
					.header("X-Factory-Build", shell.build)
					.header("X-Content-Type-Options", "nosniff")
					.type(asset.type)
					.send(asset.bytes),
			);
		}
		this.app.get("/api/version", () => ({
			build: shell.build,
			protocol: shell.protocol,
		}));
		this.app.get("/api/events", (_request, reply) => {
			reply.hijack();
			const stream = reply.raw;
			stream.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-store, no-transform",
				"X-Factory-Build": shell.build,
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			});
			this.streams.add(stream);
			stream.write("event: ready\ndata: {}\n\n");
			const heartbeat = setInterval(
				() => stream.write(": heartbeat\n\n"),
				15000,
			);
			stream.on("close", () => {
				clearInterval(heartbeat);
				this.streams.delete(stream);
			});
		});
		this.app.get("/api/config", () => ({
			configRevision: configRevision(),
			repositories: hooks.repositories(),
			workflows: runtime.listWorkflows().map((workflow) => ({
				...workflow,
				launchFields: getLaunchFields(workflow),
			})),
			defaultWorkflow: runtime.getDefaultWorkflow(),
			defaultRunner: hooks.defaultRunner?.() ?? "claude",
			titleGeneration: runtime.getTitleSettings(),
			reasoningLevels,
			serviceTierRunners,
		}));
		this.app.put("/api/title-settings", (request) => ({
			titleGeneration: runtime.updateTitleSettings(request.body),
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
				workflows: runtime
					.updateWorkflows(workflows, defaultWorkflow)
					.map((workflow) => ({
						...workflow,
						launchFields: getLaunchFields(workflow),
					})),
				defaultWorkflow: runtime.getDefaultWorkflow(),
				configRevision: configRevision(),
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
					triggerOrigin,
					error,
					reviewGate,
					outputs,
					history,
				}) => ({
					id,
					title,
					status,
					createdAt,
					updatedAt,
					repositoryId,
					step,
					workflow: workflow.id,
					triggerOrigin,
					error,
					reviewGate,
					hasGuide: Boolean(outputs.guide),
					history: history.map(({ step, at, call }) => ({ step, at, call })),
				}),
			);
			const tracked = new Set(workflowRuns.map((run) => run.id));
			return [
				...workflowRuns.map((run) => ({
					...run,
					viewState: runtime.viewState(run.id),
				})),
				...hooks
					.sessions()
					.filter((session) => !tracked.has(session.id))
					.map((session) => ({
						...session,
						workflow: "simple",
						viewState: runtime.viewState(session.id),
					})),
			].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		});
		this.app.post("/api/runs", async (request, reply) => {
			const input = LaunchRequestSchema.parse(request.body);
			const workflow = runtime.selectWorkflow([], "manual", input.workflow);
			return reply
				.code(202)
				.send(await hooks.start(resolveLaunchRequest(workflow, input)));
		});
		this.app.get<{ Params: { id: string }; Querystring: { view?: string } }>(
			"/api/runs/:id",
			(request, reply) => {
				const run = runtime.runs.get(request.params.id);
				const session = hooks
					.sessions()
					.find((item) => item.id === request.params.id);
				if (!run && !session)
					return reply.code(404).send({ error: "Run not found" });
				const detail = {
					...(run ?? {
						...session,
						workflow: runtime
							.listWorkflows()
							.find((item) => item.id === "simple"),
						events: [],
						questions: [],
						outputs: {},
					}),
					chat: hooks.chat?.(request.params.id) ?? {
						enabled: false,
						available: false,
					},
					chatMessages: runtime.chatMessages(request.params.id),
					entries: hooks.entries(request.params.id),
					viewState: runtime.viewState(request.params.id),
				};
				if (request.query.view !== "dashboard") return detail;
				const {
					sessionSnapshot: _session,
					checkpoint: _checkpoint,
					...slim
				} = detail as typeof detail & {
					sessionSnapshot?: unknown;
					checkpoint?: unknown;
				};
				return {
					...slim,
					outputs: Object.fromEntries(
						Object.entries(detail.outputs).map(([name, value]) => {
							const encoded = JSON.stringify(value) ?? "null";
							if (encoded.length < 30000) return [name, value];
							if (value && typeof value === "object" && !Array.isArray(value)) {
								const kept = Object.fromEntries(
									Object.entries(value).filter(
										([, part]) =>
											(JSON.stringify(part) ?? "null").length < 12000,
									),
								);
								return [
									name,
									{
										...kept,
										__artifactPreview: true,
										__artifactHash: createHash("sha256")
											.update(encoded)
											.digest("hex"),
										size: Buffer.byteLength(encoded),
										keys: Object.keys(value),
									},
								];
							}
							return [
								name,
								{
									__artifactPreview: true,
									__artifactHash: createHash("sha256")
										.update(encoded)
										.digest("hex"),
									size: Buffer.byteLength(encoded),
								},
							];
						}),
					),
					history: (run?.history ?? []).map(({ step, at, call }) => ({
						step,
						at,
						call,
					})),
					events: (run?.events ?? []).slice(-15).map((event) => ({
						...event,
						message: event.message.slice(0, 1000),
					})),
					entries: detail.entries.slice(-12).map((value) => {
						const entry = value as Record<string, any>;
						return {
							...entry,
							content:
								typeof entry.content === "string"
									? entry.content.slice(0, 3000)
									: "Recorded activity",
							metadata: {
								timestamp: entry.metadata?.timestamp,
								toolName: entry.metadata?.toolName,
								toolUseId: entry.metadata?.toolUseId,
							},
						};
					}),
				};
			},
		);
		this.app.get<{
			Params: { id: string; name: string };
			Querystring: { v?: string };
		}>("/api/runs/:id/artifacts/:name", (request, reply) => {
			const run = runtime.get(request.params.id);
			if (!Object.hasOwn(run.outputs, request.params.name))
				return reply.code(404).send({ error: "Artifact not found" });
			const value = run.outputs[request.params.name];
			if (
				request.query.v &&
				request.query.v !==
					createHash("sha256")
						.update(JSON.stringify(value) ?? "null")
						.digest("hex")
			)
				return reply
					.code(409)
					.send({ error: "Artifact changed; refresh this run" });
			return value;
		});
		this.app.get<{
			Params: { id: string };
			Querystring: {
				step?: string;
				before?: string;
				after?: string;
				limit?: string;
			};
		}>("/api/runs/:id/activity", (request) => {
			const query = z
				.object({
					step: z.string().optional(),
					before: z.string().max(256).optional(),
					after: z.string().max(256).optional(),
					limit: z.coerce.number().int().min(1).max(200).default(120),
				})
				.parse(request.query);
			const run = runtime.runs.get(request.params.id);
			const markers = run ? activityMarkers(run) : undefined;
			return activityPage(
				hooks.entries(request.params.id),
				run?.events ?? [],
				query,
				markers,
			);
		});
		this.app.get<{ Params: { id: string; index: string } }>(
			"/api/runs/:id/activity/entries/:index",
			(request, reply) => {
				const index = z.coerce
					.number()
					.int()
					.nonnegative()
					.parse(request.params.index);
				const value = hooks.entries(request.params.id)[index];
				return value ?? reply.code(404).send({ error: "Entry not found" });
			},
		);
		this.app.post<{ Params: { id: string } }>(
			"/api/runs/:id/messages",
			(request, reply) => {
				const id = request.params.id;
				if (
					!runtime.runs.has(id) &&
					!hooks.sessions().some((session) => session.id === id)
				)
					return reply.code(404).send({ error: "Run not found" });
				const { text } = z
					.object({ text: z.string().trim().min(1).max(100000) })
					.parse(request.body);
				const state = hooks.chat?.(id);
				if (!state?.enabled || !state.available || !hooks.message)
					throw new Error(
						state?.reason ?? "Chat is disabled for this workflow",
					);
				hooks.message(id, text);
				const message = runtime.recordChatMessage(
					id,
					text,
					state.step ?? "simple",
				);
				return reply.code(202).send({ message, mode: state.mode });
			},
		);
		this.app.post<{ Params: { id: string } }>(
			"/api/runs/:id/review",
			(request, reply) => {
				const decision = z
					.object({
						reviewId: z.string().min(1),
						headSha: z.string().min(1),
						decision: z.enum(["approve", "reject"]),
						feedback: z.string().trim().max(100000).optional(),
					})
					.parse(request.body);
				runtime.decide(request.params.id, decision);
				return reply.code(202).send({ accepted: true });
			},
		);
		this.app.put<{ Params: { id: string } }>(
			"/api/runs/:id/view",
			(request, reply) => {
				const id = request.params.id;
				if (
					!runtime.runs.has(id) &&
					!hooks.sessions().some((session) => session.id === id)
				)
					return reply.code(404).send({ error: "Run not found" });
				const state = z
					.object({
						settledAt: z.string().datetime().optional(),
						seenAt: z.string().datetime().optional(),
						keptOpen: z.boolean().optional(),
					})
					.parse(request.body);
				const status =
					runtime.runs.get(id)?.status ??
					hooks.sessions().find((session) => session.id === id)?.status;
				if (
					state.settledAt &&
					["running", "active", "waiting"].includes(status ?? "")
				)
					throw new Error("Only finished runs can settle");
				return runtime.updateViewState(id, state);
			},
		);
		this.app.post<{ Params: { id: string } }>(
			"/api/runs/:id/followup",
			async (request, reply) => {
				if (!hooks.followup) throw new Error("Follow-up unavailable");
				const { feedback } = z
					.object({ feedback: z.string().trim().min(1).max(100000) })
					.parse(request.body);
				return reply
					.code(202)
					.send(await hooks.followup(request.params.id, feedback));
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
			"/api/runs/:id/guide/refresh",
			async (request, reply) => {
				const { reviewId } = z
					.object({ reviewId: z.string().min(1) })
					.parse(request.body);
				return reply
					.code(202)
					.send(await runtime.refreshGuide(request.params.id, reviewId));
			},
		);
		this.app.post<{ Params: { id: string } }>(
			"/api/runs/:id/retry",
			(request, reply) =>
				reply.code(202).send(runtime.retry(request.params.id)),
		);
		this.app.post<{ Params: { id: string } }>(
			"/api/runs/:id/answer",
			(request) => {
				const { answer, context } = z
					.object({
						answer: z.string().trim().min(1).max(100000),
						context: z
							.object({
								questions: z.array(z.string()),
								step: z.string().optional(),
							})
							.optional(),
					})
					.parse(request.body);
				const run = runtime.get(request.params.id);
				if (
					context &&
					(context.step !== run.step ||
						!isDeepStrictEqual(context.questions, run.questions))
				)
					throw new Error(
						"The question or step changed. Refresh and review your draft before answering.",
					);
				runtime.answer(request.params.id, answer);
				return { accepted: true };
			},
		);
		this.app.get<{ Params: { id: string } }>(
			"/api/runs/:id/evidence",
			(request) => {
				const run = runtime.get(request.params.id);
				const capture = run.outputs.capture as
					| {
							screenshots?: {
								area: string;
								state: string;
								caption: string;
								imageSha256?: string;
							}[];
					  }
					| undefined;
				return {
					screenshots: (capture?.screenshots ?? []).map(
						({ area, state, caption, imageSha256 }, index) => ({
							area,
							state,
							caption,
							imageSha256,
							index,
						}),
					),
				};
			},
		);
		this.app.get<{ Params: { id: string; name: string } }>(
			"/api/runs/:id/question-images/:name",
			(request, reply) => {
				const run = runtime.get(request.params.id);
				const name = z
					.string()
					.regex(/^[a-zA-Z0-9][\w.-]*\.(?:png|jpe?g)$/i)
					.parse(request.params.name);
				const directory = join(runtime.directory, "evidence", run.id);
				if (!existsSync(join(directory, name)))
					return reply.code(404).send({ error: "Question image not found" });
				const bytes = readFileSync(verifiedScreenshot(name, directory));
				return reply
					.header("Cache-Control", "no-store")
					.type(bytes[0] === 137 ? "image/png" : "image/jpeg")
					.send(bytes);
			},
		);
		this.app.get<{
			Params: { id: string; index: string };
			Querystring: { artifact?: string; v?: string };
		}>("/api/runs/:id/screenshots/:index", (request, reply) => {
			const run = runtime.get(request.params.id);
			const index = z.coerce
				.number()
				.int()
				.nonnegative()
				.parse(request.params.index);
			const shot = CaptureSchema.parse(
				run.outputs[request.query.artifact ?? "capture"],
			).screenshots[index];
			if (!shot) return reply.code(404).send({ error: "Screenshot not found" });
			const path = verifiedScreenshot(
				shot.path,
				join(runtime.directory, "evidence", run.id),
			);
			const bytes = readFileSync(path);
			const value = run.outputs[request.query.artifact ?? "capture"];
			const actualHash = createHash("sha256").update(bytes).digest("hex");
			if (shot.imageSha256 && shot.imageSha256 !== actualHash)
				return reply
					.code(409)
					.send({ error: "Screenshot content changed after verification" });
			const versions = [
				shot.imageSha256,
				shot.path,
				createHash("sha256").update(JSON.stringify(value)).digest("hex"),
			];
			if (request.query.v && !versions.includes(request.query.v))
				return reply
					.code(409)
					.send({ error: "Screenshot changed; refresh this run" });
			return reply
				.header(
					"Cache-Control",
					request.query.v && shot.imageSha256
						? "private, max-age=3600"
						: "no-cache",
				)
				.type(bytes[0] === 137 ? "image/png" : "image/jpeg")
				.send(bytes);
		});
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
