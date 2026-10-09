import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { factoryRuntimeIdentity } from "bobs-factory-core";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { MachineCapacity } from "../MachineCapacity.js";
import { activityMarkers, activityPage } from "./ActivityPage.js";
import { reasoningLevels, serviceTierRunners } from "./AgentSettings.js";
import { ArchitectureDecisionSchema } from "./Architecture.js";
import { ExecutionSelectionSchema } from "./ExecutionProfiles.js";
import {
	type FactoryAccess,
	FactoryAuth,
	factoryAccess,
} from "./FactoryAuth.js";
import type { FactoryOnboarding } from "./FactoryOnboarding.js";
import { CaptureSchema, verifiedScreenshot } from "./FactoryTools.js";
import { factoryWebAssets } from "./FactoryWebAssets.js";
import {
	getLaunchFields,
	LaunchRequestSchema,
	type ResolvedLaunchRequest,
	resolveLaunchRequest,
} from "./LaunchFields.js";
import { runProvenance } from "./Provenance.js";
import {
	readReviewManifest,
	readReviewPatch,
	resolveGuideSnapshot,
} from "./ReviewFiles.js";
import type { ChatState } from "./SessionChat.js";
import type { VideoCapture } from "./Video.js";
import { registerVideoRoutes } from "./VideoServer.js";
import type { FactoryRun, WorkflowRuntime } from "./WorkflowRuntime.js";
import { capacityRunStatus } from "./WorkflowRuntime.js";

interface ServerHooks {
	onboarding?: FactoryOnboarding;
	deliveryStatus?(): {
		platform: string;
		workspaceId: string;
		pending: number;
		delivered: number;
		superseded: number;
		hasError: boolean;
		nextAttemptAt?: number;
	}[];
	push?: import("./FactoryPush.js").FactoryPush;
	previewExecution?(
		repositoryId: string,
		selection: import("./ExecutionProfiles.js").ExecutionSelection,
		runner?: string,
		workflow?: string,
		model?: string,
	): Promise<unknown>;
	capacity?: MachineCapacity;
	chat?(id: string): ChatState;
	message?(id: string, text: string, messageId?: string): void | Promise<void>;
	defaultRunner?(): string;
	subscribe?(listener: (id: string) => void): () => void;
	repositories(): {
		id: string;
		name: string;
		repositoryIds?: string[];
		members?: { id: string; name: string }[];
	}[];
	sessions(): {
		triggerOrigin?: import("bobs-factory-core").WorkflowTriggerOrigin;
		id: string;
		title: string;
		status: string;
		createdAt: string;
		titleGeneration?: import("bobs-factory-core").RunTitleJob;
		workspace: string;
		repositoryId?: string;
	}[];
	entries(id: string): unknown[];
	start(input: ResolvedLaunchRequest): Promise<FactoryRun>;
	followup?(id: string, feedback: string): Promise<FactoryRun>;
	retryTitle?(id: string): void;
	stop(id: string): void;
}

export class FactoryServer {
	readonly app: FastifyInstance;
	private streams = new Set<ServerResponse>();
	readonly auth: FactoryAuth;
	private streamSessions = new Map<
		ServerResponse,
		{ token: string; origin: string }
	>();
	constructor(
		runtime: WorkflowRuntime,
		hooks: ServerHooks,
		access: FactoryAccess = factoryAccess(
			Number(process.env.BOBS_FACTORY_FACTORY_PORT ?? 3457),
			process.env.BOBS_FACTORY_FACTORY_ORIGIN ??
				process.env.BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN,
			Number(process.env.BOBS_FACTORY_FACTORY_SESSION_HOURS ?? 12),
		),
	) {
		const shell = factoryWebAssets();
		this.auth = new FactoryAuth(runtime.directory, access);
		this.app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
		registerVideoRoutes(this.app, runtime);
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
		const unsubscribeAuth = this.auth.subscribe(() => {
			for (const [stream, session] of this.streamSessions)
				if (!this.auth.session(session.token, session.origin)) stream.end();
		});
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
					const session = this.streamSessions.get(stream);
					if (!session || !this.auth.session(session.token, session.origin))
						stream.end();
					else if (stream.destroyed || stream.writableEnded)
						this.streams.delete(stream);
					else if (!stream.write(data)) stream.destroy(); // Slow readers reconnect and refresh, never queue unlimited events.
				}
			}, 500);
		};
		const unsubscribeCapacity = hooks.capacity?.subscribe(() =>
			broadcast({ config: true }),
		);
		const unsubscribeRuntime = runtime.subscribe(broadcast);
		const unsubscribeSessions = hooks.subscribe?.((id) => broadcast({ id }));
		this.app.addHook("preClose", async () => {
			unsubscribeAuth();
			this.auth.close();
			unsubscribeRuntime();
			unsubscribeCapacity?.();
			unsubscribeSessions?.();
			if (timer) clearTimeout(timer);
			for (const stream of this.streams) stream.end();
			this.streams.clear();
		});
		const configRevision = () =>
			createHash("sha256")
				.update(
					JSON.stringify([
						runtime.listWorkflows(),
						runtime.getDefaultWorkflow(),
						runtime.getTitleSettings(),
						runtime.executionProfiles.read(),
					]),
				)
				.digest("hex");
		const checkConfigRevision = (request: FastifyRequest) => {
			const config = request.headers["x-factory-config"];
			if (config !== undefined && config !== configRevision())
				throw new Error("Recipe settings changed. Refresh before sending.");
		};
		this.app.addHook("onSend", async (request, reply) => {
			if (request.url.startsWith("/api/")) {
				reply.header("Cache-Control", "no-store");
				reply.header("X-Factory-Build", shell.build);
			}
		});
		const originFor = (request: FastifyRequest) =>
			access.origins.find(
				(origin) => new URL(origin).host === request.headers.host,
			);
		const cookieName = (origin: string) =>
			origin.startsWith("https:")
				? "__Host-factory-session"
				: "factory-local-session";
		const cookie = (request: FastifyRequest, name: string) =>
			request.headers.cookie
				?.split(";")
				.map((c) => c.trim())
				.find((c) => c.startsWith(`${name}=`))
				?.slice(name.length + 1);
		// Browsers use the HttpOnly cookie; the local terminal UI sends its session as a Bearer token.
		const tokenFor = (request: FastifyRequest) =>
			cookie(request, cookieName(originFor(request)!)) ??
			/^Bearer ([A-Za-z0-9_-]{43})$/.exec(
				request.headers.authorization ?? "",
			)?.[1];
		const setCookie = (
			reply: import("fastify").FastifyReply,
			origin: string,
			token: string,
			expires: number,
		) =>
			reply.header(
				"Set-Cookie",
				`${cookieName(origin)}=${token}; Path=/; HttpOnly; SameSite=Strict; ${origin.startsWith("https:") ? "Secure; " : ""}Expires=${new Date(expires).toUTCString()}`,
			);
		const publicPaths = new Set([
			"/api/version",
			"/api/auth/status",
			"/api/auth/login/options",
			"/api/auth/login/verify",
			"/api/auth/register/options",
			"/api/auth/register/verify",
			...shell.assets.map((asset) => asset.path),
		]);
		this.app.addHook("onRequest", async (request, reply) => {
			this.auth.checkRecovery();
			this.auth.checkTerminalRequests();
			const origin = originFor(request);
			if (!origin)
				return reply.code(403).send({ error: "Invalid Factory authority" });
			if (request.headers.origin && request.headers.origin !== origin)
				return reply.code(403).send({ error: "Invalid origin" });
			if (!["GET", "HEAD"].includes(request.method)) {
				if (request.headers.origin !== origin)
					return reply
						.code(403)
						.send({ error: "Exact Factory origin required" });
				if (request.headers["x-factory-request"] !== "1")
					return reply
						.code(403)
						.send({ error: "Factory request header required" });
				const version = request.headers["x-factory-build"];
				if (version !== undefined && version !== shell.build)
					return reply.code(409).send({
						error:
							"Factory updated. Preserve your drafts and update before trying again.",
						code: "FACTORY_VERSION_MISMATCH",
					});
			}
			if (
				!publicPaths.has(request.url.split("?")[0]!) &&
				!this.auth.session(tokenFor(request), origin)
			)
				return reply.code(401).send({
					error: "Sign in with a passkey",
					code: "FACTORY_AUTH_REQUIRED",
				});
		});
		this.app.addHook("preHandler", async (request, reply) => {
			if (
				!publicPaths.has(request.url.split("?")[0]!) &&
				!this.auth.session(tokenFor(request), originFor(request)!)
			)
				return reply.code(401).send({
					error: "Sign in with a passkey",
					code: "FACTORY_AUTH_REQUIRED",
				});
		});
		// Never let an individual media handler override sensitive response policy.
		this.app.addHook("onSend", async (request, reply) => {
			if (
				!shell.assets.some((asset) => asset.path === request.url.split("?")[0])
			)
				reply.header("Cache-Control", "no-store");
		});
		this.app.get("/api/auth/status", (request) => {
			const origin = originFor(request)!;
			const session = this.auth.session(tokenFor(request), origin);
			return {
				authenticated: Boolean(session),
				expires: session?.expires,
				setupRequired: !this.auth.store.state.credentials.some(
					(c) => c.origin === origin,
				),
				origin,
			};
		});
		for (const purpose of ["login", "register"] as const) {
			this.app.post(`/api/auth/${purpose}/options`, async (request, reply) => {
				const body = z
					.object({
						grant: z.string().max(100).optional(),
						label: z.string().max(80).optional(),
					})
					.parse(request.body);
				const binding = randomBytes(32).toString("base64url");
				const origin = originFor(request)!;
				const result = await this.auth.options(
					purpose,
					origin,
					binding,
					tokenFor(request),
					body.grant,
					body.label,
				);
				reply.header(
					"Set-Cookie",
					`factory-transaction=${binding}; Path=/; HttpOnly; SameSite=Strict; ${origin.startsWith("https:") ? "Secure; " : ""}Max-Age=300`,
				);
				return result;
			});
			this.app.post(`/api/auth/${purpose}/verify`, async (request, reply) => {
				const body = z
					.object({ transaction: z.string().max(100), response: z.any() })
					.parse(request.body);
				const origin = originFor(request)!;
				const previous = tokenFor(request);
				const result = await this.auth.verify(
					purpose,
					body.transaction,
					origin,
					cookie(request, "factory-transaction") ?? "",
					body.response,
				);
				this.auth.logout(previous, origin);
				setCookie(reply, origin, result.token, result.expires);
				return { authenticated: true, expires: result.expires };
			});
		}
		this.app.post("/api/auth/logout", (request, reply) => {
			const origin = originFor(request)!;
			this.auth.logout(tokenFor(request), origin);
			setCookie(reply, origin, "", 0);
			return { authenticated: false };
		});
		this.app.get("/api/auth/credentials", (request) =>
			this.auth.credentials(tokenFor(request), originFor(request)!),
		);
		this.app.delete<{ Params: { id: string } }>(
			"/api/auth/credentials/:id",
			(request) => {
				this.auth.remove(
					tokenFor(request),
					originFor(request)!,
					request.params.id,
				);
				return { removed: true };
			},
		);
		for (const asset of shell.assets) {
			this.app.get(asset.path, (request, reply) => {
				const url = new URL(originFor(request)!);
				if (
					asset.path === "/" &&
					url.protocol === "http:" &&
					url.hostname === "127.0.0.1"
				) {
					const local = `http://localhost${url.port ? `:${url.port}` : ""}`;
					if (access.origins.includes(local))
						return reply.header("Cache-Control", "no-store").redirect(local);
				}
				return reply
					.header(
						"Cache-Control",
						asset.immutable
							? "public, max-age=31536000, immutable"
							: "no-cache",
					)
					.header("X-Factory-Build", shell.build)
					.header("X-Content-Type-Options", "nosniff")
					.type(asset.type)
					.send(asset.bytes);
			});
		}
		this.app.get(
			"/api/push",
			() =>
				hooks.push?.status() ?? {
					available: false,
					diagnostic: "Push unavailable",
					devices: [],
				},
		);
		this.app.post("/api/push/devices", { bodyLimit: 8192 }, (request) => {
			if (!hooks.push) throw new Error("Push unavailable");
			return hooks.push.register(request.body);
		});
		this.app.patch("/api/push/devices/:id", { bodyLimit: 1024 }, (request) => {
			if (!hooks.push) throw new Error("Push unavailable");
			const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
			return hooks.push.update(id, request.body);
		});
		this.app.delete("/api/push/devices/:id", (request) => {
			if (!hooks.push) throw new Error("Push unavailable");
			const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
			return hooks.push.remove(id);
		});
		this.app.post(
			"/api/push/devices/:id/test",
			{ bodyLimit: 1024 },
			async (request) => {
				if (!hooks.push) throw new Error("Push unavailable");
				const { id } = z
					.object({ id: z.string().uuid() })
					.parse(request.params);
				return hooks.push.test(id);
			},
		);
		this.app.get("/api/version", () => ({
			build: shell.build,
			protocol: shell.protocol,
			runtime: factoryRuntimeIdentity,
		}));
		this.app.get("/api/delivery-status", () => ({
			workspaces: hooks.deliveryStatus?.() ?? [],
		}));
		this.app.get("/api/events", (request, reply) => {
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
			const origin = originFor(request)!,
				token = tokenFor(request)!;
			const session = this.auth.session(token, origin)!;
			this.streamSessions.set(stream, { token, origin });
			const expiry = setTimeout(
				() => stream.end(),
				Math.max(0, session.expires - Date.now()),
			);
			stream.write("event: ready\ndata: {}\n\n");
			const heartbeat = setInterval(() => {
				if (!this.auth.session(token, origin)) stream.end();
				else stream.write(": heartbeat\n\n");
			}, 15000);
			stream.on("close", () => {
				clearInterval(heartbeat);
				clearTimeout(expiry);
				this.streamSessions.delete(stream);
				this.streams.delete(stream);
			});
		});
		this.app.get("/api/config", async (request) => ({
			onboarding:
				hooks.onboarding &&
				["localhost", "127.0.0.1"].includes(
					new URL(originFor(request)!).hostname,
				)
					? await hooks.onboarding.status()
					: undefined,
			capacity: await hooks.capacity?.snapshot(),
			configRevision: configRevision(),
			executionProfiles: runtime.executionProfiles.read(),
			executionConsumers: [...runtime.runs.values()]
				.filter((run) => run.executionSnapshot)
				.map((run) => ({
					id: run.id,
					status: run.status,
					identity: run.executionSnapshot?.identity?.id,
					tools: run.executionSnapshot?.tools?.id,
				})),
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
		const localOnboarding = (request: FastifyRequest) => {
			if (!hooks.onboarding) throw new Error("Local setup is unavailable");
			if (
				!["localhost", "127.0.0.1"].includes(
					new URL(originFor(request)!).hostname,
				)
			)
				throw new Error("Complete machine setup at the localhost address");
			return hooks.onboarding;
		};
		this.app.get("/api/onboarding", (request) =>
			localOnboarding(request).status(),
		);
		this.app.post("/api/onboarding/project", { bodyLimit: 8192 }, (request) =>
			localOnboarding(request).configure(
				z
					.object({
						repositoryPath: z.string().trim().min(1).max(4096),
						runner: z.enum(["claude", "codex", "gemini", "cursor", "opencode"]),
					})
					.strict()
					.parse(request.body),
			),
		);
		this.app.post("/api/onboarding/github", { bodyLimit: 4096 }, (request) =>
			localOnboarding(request).connectGithub(
				z
					.object({
						token: z.string().trim().min(1).max(2048),
					})
					.strict()
					.parse(request.body),
			),
		);
		this.app.put("/api/execution-profiles", (request) => {
			checkConfigRevision(request);
			const body = z
				.object({
					profiles: z.unknown(),
					expectedRevision: z.number().int().nonnegative(),
				})
				.parse(request.body);
			return runtime.updateExecutionProfiles(
				body.profiles,
				body.expectedRevision,
			);
		});
		this.app.post("/api/execution-preview", async (request) => {
			const body = z
				.object({
					repositoryId: z.string(),
					selection: ExecutionSelectionSchema,
					workflow: z.string().optional(),
					model: z.string().optional(),
					runner: z
						.enum(["claude", "codex", "gemini", "cursor", "opencode"])
						.optional(),
				})
				.parse(request.body);
			const snapshot = runtime.executionProfiles.select(
				body.repositoryId,
				body.selection,
			);
			return hooks.previewExecution
				? hooks.previewExecution(
						body.repositoryId,
						body.selection,
						body.runner,
						body.workflow,
						body.model,
					)
				: {
						snapshot,
						validation: "Execution validation is unavailable on this server",
					};
		});
		this.app.put("/api/capacity", async (request) => {
			if (!hooks.capacity) throw new Error("Instance capacity unavailable");
			// Keep the old API field for local clients. Public proxies can mistake
			// a numeric "limit" body for SQL, so the dashboard sends "concurrency".
			const limit = z
				.object({
					concurrency: z.number().int().positive().optional(),
					limit: z.number().int().positive().optional(),
				})
				.refine(
					(body) =>
						(body.concurrency !== undefined) !== (body.limit !== undefined),
					"Specify either concurrency or limit",
				)
				.transform((body) => body.concurrency ?? body.limit!)
				.parse(request.body);
			await hooks.capacity.setLimit(limit);
			return { capacity: await hooks.capacity.snapshot() };
		});
		this.app.put("/api/title-settings", (request) => {
			// Check after body parsing, in the same synchronous turn as the write.
			checkConfigRevision(request);
			return {
				titleGeneration: runtime.updateTitleSettings(request.body),
				configRevision: configRevision(),
			};
		});

		this.app.put("/api/workflows", (request) => {
			checkConfigRevision(request);
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
					capacityLeaves,
					deliveryCoordination,
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
					status: capacityRunStatus({ status, capacityLeaves } as FactoryRun),
					capacityLeaves,
					deliveryCoordination,
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
			checkConfigRevision(request);
			const input = LaunchRequestSchema.parse(request.body);
			const workflow = runtime.selectWorkflow([], "manual", input.workflow);
			return reply
				.code(202)
				.send(await hooks.start(resolveLaunchRequest(workflow, input)));
		});
		this.app.get<{ Params: { id: string } }>(
			"/api/runs/:id/provenance",
			(request, reply) => {
				const run = runtime.runs.get(request.params.id);
				if (!run) return reply.code(404).send({ error: "Run not found" });
				return runProvenance(run);
			},
		);
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
					status: run ? capacityRunStatus(run) : session!.status,
					chat:
						run?.status === "waiting" && run.architectureGate
							? {
									enabled: true,
									available: true,
									mode: "continue",
									step: run.step,
								}
							: (hooks.chat?.(request.params.id) ?? {
									enabled: false,
									available: false,
								}),
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
		this.app.post<{ Params: { id: string } }>(
			"/api/runs/:id/retry-title",
			(request, reply) => {
				const id = request.params.id;
				if (
					!runtime.runs.has(id) &&
					!hooks.sessions().some((session) => session.id === id)
				)
					return reply.code(404).send({ error: "Run not found" });
				if (!hooks.retryTitle) throw new Error("Title retry unavailable");
				hooks.retryTitle(id);
				return reply.code(202).send({ accepted: true });
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
		this.app.get<{ Params: { id: string }; Querystring: { guide: string } }>(
			"/api/runs/:id/review-files",
			async (request) => {
				const run = runtime.get(request.params.id);
				const guide = z
					.string()
					.regex(/^[a-f0-9]{64}$/)
					.parse(request.query.guide);
				const evidence = join(runtime.directory, "evidence", run.id);
				const ref = await resolveGuideSnapshot(run, evidence, guide);
				return readReviewManifest(evidence, run.id, ref);
			},
		);
		this.app.get<{
			Params: { id: string; snapshot: string; file: string };
			Querystring: { guide: string };
		}>("/api/runs/:id/review-files/:snapshot/:file", async (request) => {
			const run = runtime.get(request.params.id);
			const guide = z
				.string()
				.regex(/^[a-f0-9]{64}$/)
				.parse(request.query.guide);
			const evidence = join(runtime.directory, "evidence", run.id);
			const ref = await resolveGuideSnapshot(run, evidence, guide);
			if (ref.snapshotId !== request.params.snapshot)
				throw new Error("Snapshot is not the requested guide revision");
			const manifest = await readReviewManifest(evidence, run.id, ref);
			return readReviewPatch(evidence, manifest, request.params.file);
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
			async (request, reply) => {
				const id = request.params.id;
				if (
					!runtime.runs.has(id) &&
					!hooks.sessions().some((session) => session.id === id)
				)
					return reply.code(404).send({ error: "Run not found" });
				const { text } = z
					.object({ text: z.string().trim().min(1).max(100000) })
					.parse(request.body);
				const proposalRun = runtime.runs.get(id);
				if (proposalRun?.status === "waiting" && proposalRun.architectureGate) {
					runtime.answer(id, text);
					const message = runtime.recordChatMessage(
						id,
						text,
						proposalRun.step ?? "architecture-decision",
					);
					return reply.code(202).send({ message, mode: "continue" });
				}
				const state = hooks.chat?.(id);
				if (!state?.enabled || !state.available || !hooks.message)
					throw new Error(
						state?.reason ?? "Chat is disabled for this workflow",
					);
				const messageId = randomUUID();
				await hooks.message(id, text, messageId);
				const message = runtime.recordChatMessage(
					id,
					text,
					state.step ?? "simple",
					messageId,
				);
				return reply.code(202).send({ message, mode: state.mode });
			},
		);
		this.app.post<{ Params: { id: string } }>(
			"/api/runs/:id/ticket-sync",
			async (request, reply) => {
				await runtime.retryTracking(request.params.id);
				return reply.send({
					ticketSync: runtime.get(request.params.id).ticketSync,
				});
			},
		);
		this.app.post<{ Params: { id: string } }>(
			"/api/runs/:id/architecture-decision",
			(request, reply) => {
				try {
					runtime.decideArchitecture(
						request.params.id,
						ArchitectureDecisionSchema.parse(request.body),
					);
					return reply.code(202).send({ accepted: true });
				} catch (error) {
					return reply.code(409).send({
						error: error instanceof Error ? error.message : String(error),
					});
				}
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
				const { answer, context, kind } = z
					.object({
						answer: z.string().trim().min(1).max(100000),
						kind: z.enum(["answer", "explanation"]).optional(),
						context: z
							.object({
								questions: z.array(z.string()),
								questionBatchId: z.string().optional(),
								step: z.string().optional(),
							})
							.optional(),
					})
					.parse(request.body);
				const run = runtime.get(request.params.id);
				if (
					context &&
					(context.step !== run.step ||
						(context.questionBatchId !== undefined &&
							context.questionBatchId !== run.questionBatchId) ||
						!isDeepStrictEqual(context.questions, run.questions))
				)
					throw new Error(
						"The question or step changed. Refresh before answering.",
					);
				runtime.answer(request.params.id, answer, kind);
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
								context?: string;
								imageSha256?: string;
							}[];
					  }
					| undefined;
				return {
					videos: (
						(run.outputs.capture as VideoCapture | undefined)?.videos ?? []
					)
						.filter((v) => v.validation)
						.map((v) => ({
							taskId: v.taskId,
							caption: v.caption,
							transcript: v.transcript,
							duration: v.validation!.duration,
							mime: v.validation!.mime,
							codecs: v.validation!.codecs,
							revision: v.validation!.captureRevision,
							validatedRevision: v.validation!.validatedRevision,
							sha256: v.validation!.sha256,
							captions: Boolean(v.validation!.captions),
							available: existsSync(v.path) && existsSync(v.posterPath),
						})),
					videoUnavailable:
						(run.outputs.capture as VideoCapture | undefined)
							?.videoUnavailable ?? [],
					screenshots: (capture?.screenshots ?? []).map(
						({ area, state, caption, context, imageSha256 }, index) => ({
							area,
							state,
							caption,
							context,
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
		try {
			await this.app.listen({ port, host: "127.0.0.1" });
		} catch (error) {
			await this.app.close();
			throw error;
		}
	}
	async stop(): Promise<void> {
		await this.app.close();
	}
}
