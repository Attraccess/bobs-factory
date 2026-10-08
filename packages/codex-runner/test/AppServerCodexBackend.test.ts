import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { AppServerCodexBackend } from "../src/backend/AppServerCodexBackend.js";
import {
	AppServerClient,
	type IAppServerClient,
	type NotificationHandler,
	type ServerRequestHandler,
} from "../src/backend/appServerClient.js";
import { AppServerProcessManager } from "../src/backend/appServerProcess.js";
import type {
	NormalizedCodexEvent,
	ResolvedCodexConfig,
} from "../src/backend/types.js";
import { CodexConfigBuilder } from "../src/config/CodexConfigBuilder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** In-memory transport that records requests and lets tests push notifications. */
class FakeClient extends EventEmitter implements IAppServerClient {
	notificationHandler: NotificationHandler | null = null;
	serverRequestHandler: ServerRequestHandler | null = null;
	requests: { method: string; params: unknown }[] = [];
	startCalls = 0;
	closeCalls = 0;
	responses: Record<string, unknown | ((params: unknown) => unknown)> = {
		initialize: {},
		"thread/start": { thread: { id: "thread-1" } },
		"thread/resume": { thread: { id: "thread-resumed" } },
		"turn/start": { turn: { id: "turn-1" } },
		"turn/steer": { turnId: "turn-1" },
		"turn/interrupt": {},
	};

	setNotificationHandler(handler: NotificationHandler): void {
		this.notificationHandler = handler;
	}
	setServerRequestHandler(handler: ServerRequestHandler): void {
		this.serverRequestHandler = handler;
	}
	start(): void {
		this.startCalls += 1;
	}
	request<T = unknown>(method: string, params: unknown): Promise<T> {
		this.requests.push({ method, params });
		const response = this.responses[method];
		return Promise.resolve(
			(typeof response === "function"
				? response(params)
				: (response ?? {})) as T,
		);
	}
	close(): Promise<void> {
		this.closeCalls += 1;
		return Promise.resolve();
	}
	push(method: string, params: unknown): void {
		this.notificationHandler?.(method, params);
	}
	lastRequest(method: string): { method: string; params: unknown } | undefined {
		return [...this.requests].reverse().find((r) => r.method === method);
	}
}

const baseConfig: ResolvedCodexConfig = {
	sandbox: {
		kind: "workspace-mode",
		mode: "workspace-write",
		writableRoots: [],
		networkAccess: true,
	},
	approvalPolicy: "never",
	skipGitRepoCheck: true,
	workingDirectory: "/tmp/repo",
	codexHome: "/tmp/.codex",
};

function makeBackend(): { backend: AppServerCodexBackend; client: FakeClient } {
	const client = new FakeClient();
	const backend = new AppServerCodexBackend(() => client);
	return { backend, client };
}

describe("AppServerCodexBackend", () => {
	it.each([
		false,
		true,
	])("waits for required MCP tools before exposing a usable thread (resume=%s)", async (resume) => {
		const { backend, client } = makeBackend();
		let ready!: () => void;
		client.responses["mcpServerStatus/list"] = () =>
			new Promise((resolve) => {
				ready = () =>
					resolve({
						data: [
							{
								name: "factory-context",
								runtimeStatus: "connected",
								tools: {
									list_context: { name: "list_context" },
									read_context: { name: "read_context" },
								},
							},
						],
					});
			});
		const events: NormalizedCodexEvent[] = [];
		backend.on("event", (event) => events.push(event));
		const opening = backend.open({
			...baseConfig,
			codexPath: "/bin/true",
			...(resume ? { resumeSessionId: "saved" } : {}),
			configOverrides: {
				mcp_servers: {
					"factory-context": {
						command: "fixture",
						required: true,
						enabled_tools: ["list_context", "read_context"],
					},
				},
			},
		});
		await vi.waitFor(() =>
			expect(client.lastRequest("mcpServerStatus/list")).toBeDefined(),
		);
		expect(events).toEqual([]);
		expect(client.lastRequest("turn/start")).toBeUndefined();
		ready();
		await expect(opening).resolves.toEqual({
			threadId: resume ? "thread-resumed" : "thread-1",
		});
		expect(events).toEqual([
			{
				kind: "thread-started",
				threadId: resume ? "thread-resumed" : "thread-1",
			},
		]);
		await backend.close();
	});

	it("fails required MCP discovery before emitting init or starting model work", async () => {
		const { backend, client } = makeBackend();
		client.responses["mcpServerStatus/list"] = {
			data: [
				{
					name: "factory-context",
					runtimeStatus: "connected",
					tools: { list_context: { name: "list_context" } },
				},
			],
		};
		const event = vi.fn();
		backend.on("event", event);
		await expect(
			backend.open({
				...baseConfig,
				codexPath: "/bin/true",
				configOverrides: {
					mcp_servers: {
						"factory-context": {
							command: "fixture",
							required: true,
							enabled_tools: ["list_context", "read_context"],
						},
					},
				},
			}),
		).rejects.toThrow("read_context");
		expect(event).not.toHaveBeenCalled();
		expect(client.lastRequest("turn/start")).toBeUndefined();
		expect(client.closeCalls).toBe(1);
	});
	it.each([
		"starting",
		"failed",
		"missing",
		"discovery error",
		"request timeout",
	])("rejects %s required MCP infrastructure without a model turn", async (failure) => {
		const { backend, client } = makeBackend();
		client.responses["mcpServerStatus/list"] =
			failure === "request timeout"
				? () => Promise.reject(new Error("mcpServerStatus/list timed out"))
				: {
						data:
							failure === "missing"
								? []
								: [
										{
											name: "factory-context",
											runtimeStatus:
												failure === "discovery error" ? "connected" : failure,
											toolsError:
												failure === "discovery error"
													? "Unavailable catalog"
													: null,
											tools: { read_context: { name: "read_context" } },
										},
									],
					};
		const event = vi.fn();
		backend.on("event", event);
		await expect(
			backend.open({
				...baseConfig,
				codexPath: "/bin/true",
				configOverrides: {
					mcp_servers: {
						"factory-context": {
							command: "fixture",
							required: true,
							enabled_tools: ["read_context"],
						},
					},
				},
			}),
		).rejects.toThrow("Required MCP server 'factory-context'");
		expect(event).not.toHaveBeenCalled();
		expect(client.lastRequest("turn/start")).toBeUndefined();
		expect(client.closeCalls).toBe(1);
	});
	it("cancels required MCP discovery without exposing the late-ready thread", async () => {
		const { backend, client } = makeBackend();
		let ready!: () => void;
		client.responses["mcpServerStatus/list"] = () =>
			new Promise((resolve) => {
				ready = () =>
					resolve({
						data: [{ name: "context", runtimeStatus: "connected", tools: {} }],
					});
			});
		const event = vi.fn();
		backend.on("event", event);
		const opening = backend
			.open({
				...baseConfig,
				codexPath: "/bin/true",
				configOverrides: {
					mcp_servers: { context: { command: "fixture", required: true } },
				},
			})
			.catch(() => "cancelled");
		await vi.waitFor(() =>
			expect(client.lastRequest("mcpServerStatus/list")).toBeDefined(),
		);
		await backend.close();
		expect(await opening).toBe("cancelled");
		ready();
		await Promise.resolve();
		expect(event).not.toHaveBeenCalled();
		expect(client.closeCalls).toBe(1);
	});

	it.each([
		"fast",
		"standard",
		undefined,
	] as const)("passes %s tier independently of model/reasoning into native thread config", async (serviceTier) => {
		const resolved = await new CodexConfigBuilder({
			factoryHome: "/tmp",
			workingDirectory: "/tmp",
			model: "gpt-6.1-sol",
			modelReasoningEffort: "low",
			serviceTier,
			configOverrides: {
				service_tier: "native-tier",
				mcp_servers: { test: { command: "test-mcp" } },
			},
		}).build();
		const { backend, client } = makeBackend();
		await backend.open({ ...resolved, codexPath: "/bin/true" });
		const params = client.lastRequest("thread/start")?.params as {
			model: string;
			config: Record<string, unknown>;
		};
		expect(params.model).toBe("gpt-6.1-sol");
		expect(resolved.modelReasoningEffort).toBe("low");
		expect(params.config.service_tier).toBe(
			serviceTier === "standard" ? "default" : (serviceTier ?? "native-tier"),
		);
		expect(params.config.mcp_servers).toEqual({
			test: { command: "test-mcp" },
		});
		await backend.close();
	});
	it("cancels a pending initialize without starting a thread", async () => {
		const { backend, client } = makeBackend();
		client.responses.initialize = () => new Promise(() => {});
		const opened = backend
			.open({ ...baseConfig, codexPath: "/bin/true" })
			.catch(() => "cancelled");
		await vi.waitFor(() => expect(client.startCalls).toBe(1));
		await backend.close();
		const outcome = await Promise.race([
			opened,
			new Promise((resolve) => setTimeout(() => resolve("hung"), 100)),
		]);
		expect(outcome).toBe("cancelled");
		expect(client.closeCalls).toBe(1);
		expect(client.lastRequest("thread/start")).toBeUndefined();
	});

	it("cancels only one waiter while a shared process initializes", async () => {
		const client = new FakeClient();
		let initialized!: () => void;
		client.responses.initialize = () =>
			new Promise((resolve) => {
				initialized = () => resolve({});
			});
		const manager = new AppServerProcessManager(() => client, {
			idleCloseMs: 0,
		});
		const cancelled = new AppServerCodexBackend(manager);
		const survivor = new AppServerCodexBackend(manager);
		const config = { ...baseConfig, codexPath: "/bin/true" };
		const first = cancelled.open(config).catch(() => "cancelled");
		const second = survivor.open(config);
		await vi.waitFor(() => expect(client.startCalls).toBe(1));
		expect(client.lastRequest("thread/start")).toBeUndefined();
		await cancelled.close();
		expect(await first).toBe("cancelled");
		expect(client.closeCalls).toBe(0);
		initialized();
		expect(await second).toEqual({ threadId: "thread-1" });
		expect(
			client.requests.filter((r) => r.method === "thread/start"),
		).toHaveLength(1);
		await survivor.close();
		expect(client.closeCalls).toBe(1);
	});

	it.each([
		"thread/start",
		"thread/resume",
	])("cancels a pending %s and ignores its late response", async (method) => {
		const { backend, client } = makeBackend();
		let finish!: () => void;
		client.responses[method] = () =>
			new Promise((resolve) => {
				finish = () => resolve({ thread: { id: "late-thread" } });
			});
		const event = vi.fn();
		backend.on("event", event);
		const opening = backend
			.open({
				...baseConfig,
				codexPath: "/bin/true",
				...(method === "thread/resume" ? { resumeSessionId: "saved" } : {}),
			})
			.catch(() => "cancelled");
		await vi.waitFor(() => expect(client.lastRequest(method)).toBeDefined());
		await backend.close();
		expect(await opening).toBe("cancelled");
		expect(client.closeCalls).toBe(1);
		finish();
		await Promise.resolve();
		expect(event).not.toHaveBeenCalled();
		expect(client.lastRequest("turn/start")).toBeUndefined();
	});

	it("interrupts a late turn/start response without closing another active lease", async () => {
		const client = new FakeClient();
		let thread = 0;
		client.responses["thread/start"] = () => ({
			thread: { id: `thread-${++thread}` },
		});
		let finish!: () => void;
		client.responses["turn/start"] = (params) =>
			(params as { threadId: string }).threadId === "thread-1"
				? new Promise((resolve) => {
						finish = () => resolve({ turn: { id: "late-turn" } });
					})
				: { turn: { id: "surviving-turn" } };
		const manager = new AppServerProcessManager(() => client, {
			idleCloseMs: 0,
		});
		const cancelled = new AppServerCodexBackend(manager);
		const survivor = new AppServerCodexBackend(manager);
		const config = { ...baseConfig, codexPath: "/bin/true" };
		await cancelled.open(config);
		await survivor.open(config);
		const first = cancelled
			.runTurn([{ type: "text", text: "cancel me" }])
			.catch(() => "cancelled");
		const second = survivor.runTurn([{ type: "text", text: "keep running" }]);
		await vi.waitFor(() => expect(survivor.isTurnActive()).toBe(true));
		await cancelled.close();
		expect(await first).toBe("cancelled");
		expect(client.closeCalls).toBe(0);
		finish();
		await vi.waitFor(() =>
			expect(client.lastRequest("turn/interrupt")?.params).toEqual({
				threadId: "thread-1",
				turnId: "late-turn",
			}),
		);
		expect(cancelled.isTurnActive()).toBe(false);
		expect(survivor.isTurnActive()).toBe(true);
		client.push("turn/completed", {
			threadId: "thread-2",
			turn: { id: "surviving-turn", status: "completed" },
		});
		await second;
		await survivor.close();
		expect(client.closeCalls).toBe(1);
	});

	it.each([
		"late response",
		"timeout before close",
		"timeout after close",
		"timeout after notification",
	])("interrupts late turn notifications with %s on a shared process", async (timing) => {
		const client = new FakeClient();
		let thread = 0;
		client.responses["thread/start"] = () => ({
			thread: { id: `thread-${++thread}` },
		});
		client.responses["thread/resume"] = { thread: { id: "thread-1" } };
		let finish!: () => void;
		let timeout!: () => void;
		client.responses["turn/start"] = (params) =>
			(params as { threadId: string }).threadId === "thread-1"
				? new Promise((resolve, reject) => {
						finish = () => resolve({ turn: { id: "late-turn" } });
						timeout = () => reject(new Error("turn/start timed out"));
					})
				: { turn: { id: "surviving-turn" } };
		const manager = new AppServerProcessManager(() => client, {
			idleCloseMs: 0,
		});
		const cancelled = new AppServerCodexBackend(manager);
		const survivor = new AppServerCodexBackend(manager);
		const config = { ...baseConfig, codexPath: "/bin/true" };
		const events = vi.fn();
		cancelled.on("event", events);
		try {
			await cancelled.open(config);
			await survivor.open(config);
			const first = cancelled.runTurn([]).catch(() => "cancelled");
			const second = survivor.runTurn([]);
			await vi.waitFor(() => expect(survivor.isTurnActive()).toBe(true));
			if (timing === "timeout before close") {
				timeout();
				expect(await first).toBe("cancelled");
			}
			await cancelled.close();
			expect(await first).toBe("cancelled");
			if (timing === "timeout after close") timeout();
			// Late events must cancel remote execution without reviving the runner.
			events.mockClear();
			client.push("turn/started", {
				threadId: "thread-1",
				turn: { id: "late-turn" },
			});
			if (timing === "late response") finish();
			if (timing === "timeout after notification") timeout();
			await Promise.resolve();
			await Promise.resolve();
			client.push("turn/started", {
				threadId: "thread-1",
				turn: { id: "late-turn" },
			});
			expect(
				client.requests.filter((r) => r.method === "turn/interrupt"),
			).toEqual([
				{
					method: "turn/interrupt",
					params: { threadId: "thread-1", turnId: "late-turn" },
				},
			]);
			expect(client.closeCalls).toBe(0);
			expect(cancelled.isTurnActive()).toBe(false);
			expect(survivor.isTurnActive()).toBe(true);
			expect(events).not.toHaveBeenCalled();
			client.push("turn/completed", {
				threadId: "thread-1",
				turn: { id: "late-turn", status: "interrupted" },
			});
			// Completion retires the cancellation handler so the thread can resume.
			const resumed = new AppServerCodexBackend(manager);
			await resumed.open({ ...config, resumeSessionId: "thread-1" });
			await resumed.close();
			client.push("turn/completed", {
				threadId: "thread-2",
				turn: { id: "surviving-turn", status: "completed" },
			});
			await second;
			await survivor.close();
			expect(client.closeCalls).toBe(1);
		} finally {
			await manager.closeAll();
		}
	});

	it.each([
		"completion",
		"process exit",
	])("ignores a late start response after cancellation and %s", async (terminal) => {
		const client = new FakeClient();
		let thread = 0;
		client.responses["thread/start"] = () => ({
			thread: { id: `thread-${++thread}` },
		});
		let finish!: () => void;
		client.responses["turn/start"] = () =>
			new Promise((resolve) => {
				finish = () => resolve({ turn: { id: "late-turn" } });
			});
		const manager = new AppServerProcessManager(() => client, {
			idleCloseMs: 0,
		});
		const cancelled = new AppServerCodexBackend(manager);
		const survivor = new AppServerCodexBackend(manager);
		const config = { ...baseConfig, codexPath: "/bin/true" };
		try {
			await cancelled.open(config);
			await survivor.open(config);
			const first = cancelled.runTurn([]).catch(() => "cancelled");
			await cancelled.close();
			expect(await first).toBe("cancelled");
			if (terminal === "process exit") client.emit("exit");
			else
				client.push("turn/completed", {
					threadId: "thread-1",
					turn: { id: "late-turn", status: "completed" },
				});
			finish();
			await Promise.resolve();
			await Promise.resolve();
			expect(client.lastRequest("turn/interrupt")).toBeUndefined();
		} finally {
			await survivor.close();
			await manager.closeAll();
		}
	});

	it("declares steering support", () => {
		const { backend } = makeBackend();
		expect(backend.supportsSteer).toBe(true);
	});

	it("initializes, starts a thread, and emits thread-started", async () => {
		const { backend, client } = makeBackend();
		const events: NormalizedCodexEvent[] = [];
		backend.on("event", (e) => events.push(e));

		const { threadId } = await backend.open({
			...baseConfig,
			codexPath: "/bin/true",
		});

		expect(threadId).toBe("thread-1");
		expect(client.requests[0]?.method).toBe("initialize");
		expect(client.requests[1]?.method).toBe("thread/start");
		expect(events).toContainEqual({
			kind: "thread-started",
			threadId: "thread-1",
		});
	});

	it("passes MCP config overrides through to thread/start config", async () => {
		const { backend, client } = makeBackend();
		await backend.open({
			...baseConfig,
			codexPath: "/bin/true",
			configOverrides: { mcp_servers: { linear: { command: "linear-mcp" } } },
		});
		const cfg = (
			client.lastRequest("thread/start")?.params as {
				config?: Record<string, unknown>;
			}
		).config;
		expect(cfg?.mcp_servers).toEqual({ linear: { command: "linear-mcp" } });
	});

	it("serializes a workspace-mode sandbox to thread/start sandbox + config", async () => {
		const { backend, client } = makeBackend();
		await backend.open({
			...baseConfig,
			codexPath: "/bin/true",
			sandbox: {
				kind: "workspace-mode",
				mode: "workspace-write",
				writableRoots: ["/repo/b", "/repo/c"],
				networkAccess: false,
			},
		});
		const params = client.lastRequest("thread/start")?.params as {
			sandbox?: string;
			permissions?: string;
			config?: { sandbox_workspace_write?: Record<string, unknown> };
		};
		expect(params.sandbox).toBe("workspace-write");
		expect(params.permissions).toBeUndefined();
		expect(params.config?.sandbox_workspace_write).toEqual({
			network_access: false,
			writable_roots: ["/repo/b", "/repo/c"],
		});
	});

	it.each([
		"read-only",
		"danger-full-access",
	] as const)("serializes native %s without workspace-write overrides", async (mode) => {
		const { backend, client } = makeBackend();
		await backend.open({
			...baseConfig,
			codexPath: "/bin/true",
			sandbox: {
				kind: "workspace-mode",
				mode,
				writableRoots: [],
				networkAccess: false,
			},
		});
		const params = client.lastRequest("thread/start")?.params as {
			sandbox?: string;
			config?: { sandbox_workspace_write?: Record<string, unknown> };
		};
		expect(params.sandbox).toBe(mode);
		expect(params.config?.sandbox_workspace_write).toBeUndefined();
	});

	it.each([
		"thread/start",
		"thread/resume",
	])("serializes a profile sandbox to %s permissions + config.permissions (not sandbox)", async (method) => {
		const { backend, client } = makeBackend();
		await backend.open({
			...baseConfig,
			codexPath: "/bin/true",
			...(method === "thread/resume" ? { resumeSessionId: "saved" } : {}),
			sandbox: {
				kind: "profile",
				profileId: "cyrus-sandbox",
				extends: ":workspace",
				workspaceRoots: ["/repo/extra"],
				networkAccess: false,
				filesystem: {
					":minimal": "read",
					":workspace_roots": { ".": "write", ".codex": "read" },
					"/repo/.git": "write",
					":tmpdir": "write",
					":slash_tmp": "write",
					"/usr/lib": "read",
				},
			},
		});
		const params = client.lastRequest(method)?.params as {
			sandbox?: string;
			permissions?: string;
			config?: Record<string, unknown>;
		};
		// `permissions` and `sandbox` are mutually exclusive — only permissions is set.
		expect(params.permissions).toBe("cyrus-sandbox");
		expect(params.sandbox).toBeUndefined();
		expect(params.config?.sandbox_workspace_write).toBeUndefined();
		expect(params.config?.permissions).toEqual({
			"cyrus-sandbox": {
				extends: ":workspace",
				workspace_roots: { "/repo/extra": true },
				filesystem: {
					":minimal": "read",
					":workspace_roots": { ".": "write", ".codex": "read" },
					"/repo/.git": "write",
					":tmpdir": "write",
					":slash_tmp": "write",
					"/usr/lib": "read",
				},
				network: { enabled: false },
			},
		});
	});

	it("does not send a sandboxPolicy on turn/start (per-thread sandbox is set at thread/start)", async () => {
		const { backend, client } = makeBackend();
		await backend.open({ ...baseConfig, codexPath: "/bin/true" });

		const turnDone = backend.runTurn([{ type: "text", text: "go" }]);
		await Promise.resolve();
		expect(
			(client.lastRequest("turn/start")?.params as { sandboxPolicy?: unknown })
				.sandboxPolicy,
		).toBeUndefined();
		client.push("turn/completed", {
			threadId: "thread-1",
			turn: { id: "turn-1", status: "completed" },
		});
		await turnDone;
	});

	it("passes outputSchema on turn/start when configured", async () => {
		const { backend, client } = makeBackend();
		const schema = { type: "object", properties: { x: { type: "string" } } };
		await backend.open({
			...baseConfig,
			codexPath: "/bin/true",
			outputSchema: schema,
		});
		const turnDone = backend.runTurn([{ type: "text", text: "go" }]);
		await Promise.resolve();
		expect(
			(client.lastRequest("turn/start")?.params as { outputSchema?: unknown })
				.outputSchema,
		).toEqual(schema);
		client.push("turn/completed", {
			threadId: "thread-1",
			turn: { id: "turn-1", status: "completed" },
		});
		await turnDone;
	});

	it("resumes a thread when resumeSessionId is set", async () => {
		const { backend, client } = makeBackend();
		await backend.open({
			...baseConfig,
			codexPath: "/bin/true",
			resumeSessionId: "thread-resumed",
		});
		expect(client.lastRequest("thread/resume")?.params).toMatchObject({
			threadId: "thread-resumed",
		});
	});

	it("replays a real notification stream into normalized events and resolves the turn", async () => {
		const { backend, client } = makeBackend();
		const events: NormalizedCodexEvent[] = [];
		backend.on("event", (e) => events.push(e));
		client.responses["thread/start"] = {
			thread: { id: "019e94f0-5c4d-7661-af4a-dc427d3cd624" },
		};

		await backend.open({ ...baseConfig, codexPath: "/bin/true" });
		const turnDone = backend.runTurn([{ type: "text", text: "do it" }]);
		await Promise.resolve(); // let turn/start settle and activeTurnId set

		const fixture = readFileSync(
			join(__dirname, "fixtures", "app-server-coding-notifications.jsonl"),
			"utf8",
		)
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { method: string; params: unknown });

		for (const { method, params } of fixture) {
			client.push(method, params);
		}

		await turnDone;

		const kinds = events.map((e) => e.kind);
		expect(kinds).toContain("turn-completed");
		// The real coding stream included a commandExecution item.
		const commandItem = events.find(
			(e) => e.kind === "item-completed" && e.item.type === "command_execution",
		);
		expect(commandItem).toBeDefined();
		// turn-completed carries usage sourced from thread/tokenUsage/updated.
		const completed = events.find((e) => e.kind === "turn-completed");
		expect(
			completed && "usage" in completed && completed.usage.input_tokens,
		).toBeGreaterThan(0);
	});

	it("steers the active turn with the expected turn id", async () => {
		const { backend, client } = makeBackend();
		await backend.open({ ...baseConfig, codexPath: "/bin/true" });
		const turnDone = backend.runTurn([{ type: "text", text: "go" }]);
		await Promise.resolve();

		expect(backend.isTurnActive()).toBe(true);
		await backend.steer([{ type: "text", text: "also do this" }]);

		expect(client.lastRequest("turn/steer")?.params).toMatchObject({
			threadId: "thread-1",
			expectedTurnId: "turn-1",
			input: [{ type: "text", text: "also do this" }],
		});

		client.push("turn/completed", {
			threadId: "thread-1",
			turn: { id: "turn-1", status: "completed" },
		});
		await turnDone;
	});

	it("rejects steering when no turn is active", async () => {
		const { backend } = makeBackend();
		await backend.open({ ...baseConfig, codexPath: "/bin/true" });
		await expect(
			backend.steer([{ type: "text", text: "nope" }]),
		).rejects.toThrow(/no active turn/i);
	});

	it("emits turn-started and gates isTurnActive on the resolved turn id", async () => {
		const { backend, client } = makeBackend();
		const events: NormalizedCodexEvent[] = [];
		backend.on("event", (e) => events.push(e));
		await backend.open({ ...baseConfig, codexPath: "/bin/true" });

		// No turn yet → not steerable.
		expect(backend.isTurnActive()).toBe(false);

		const turnDone = backend.runTurn([{ type: "text", text: "go" }]);
		await Promise.resolve(); // turn/start resolves → activeTurnId set

		expect(backend.isTurnActive()).toBe(true);

		// The runner is signalled to flush buffered follow-ups only once the
		// server confirms the turn is steerable via the turn/started notification.
		expect(events.some((e) => e.kind === "turn-started")).toBe(false);
		client.push("turn/started", {
			threadId: "thread-1",
			turn: { id: "turn-1" },
		});
		expect(events.some((e) => e.kind === "turn-started")).toBe(true);

		client.push("turn/completed", {
			threadId: "thread-1",
			turn: { id: "turn-1", status: "completed" },
		});
		await turnDone;
		expect(backend.isTurnActive()).toBe(false);
	});

	it("shares one app-server client while keeping concurrent threads isolated", async () => {
		// Two backends running at once must share one app-server process/client,
		// but keep per-thread state isolated through threadId routing.
		const client = new FakeClient();
		let nextThread = 0;
		client.responses["thread/start"] = () => {
			nextThread += 1;
			return { thread: { id: nextThread === 1 ? "thread-A" : "thread-B" } };
		};
		client.responses["turn/start"] = (params) => {
			const threadId = (params as { threadId?: string }).threadId;
			return { turn: { id: threadId === "thread-A" ? "turn-A" : "turn-B" } };
		};
		const manager = new AppServerProcessManager(() => client, {
			idleCloseMs: 0,
		});
		const backendA = new AppServerCodexBackend(manager);
		const backendB = new AppServerCodexBackend(manager);
		const eventsA: NormalizedCodexEvent[] = [];
		const eventsB: NormalizedCodexEvent[] = [];
		backendA.on("event", (e) => eventsA.push(e));
		backendB.on("event", (e) => eventsB.push(e));

		await backendA.open({ ...baseConfig, codexPath: "/bin/true" });
		await backendB.open({ ...baseConfig, codexPath: "/bin/true" });
		expect(client.startCalls).toBe(1);
		expect(
			client.requests.filter((r) => r.method === "initialize"),
		).toHaveLength(1);

		const turnA = backendA.runTurn([{ type: "text", text: "A" }]);
		const turnB = backendB.runTurn([{ type: "text", text: "B" }]);
		await Promise.resolve();

		// Steer each; assert each request lands only on its own client+thread.
		await backendA.steer([{ type: "text", text: "steer-A" }]);
		await backendB.steer([{ type: "text", text: "steer-B" }]);

		const steerRequests = client.requests.filter(
			(r) => r.method === "turn/steer",
		);
		expect(steerRequests[0]?.params).toMatchObject({
			threadId: "thread-A",
			expectedTurnId: "turn-A",
			input: [{ type: "text", text: "steer-A" }],
		});
		expect(steerRequests[1]?.params).toMatchObject({
			threadId: "thread-B",
			expectedTurnId: "turn-B",
			input: [{ type: "text", text: "steer-B" }],
		});
		expect(steerRequests).toHaveLength(2);

		// Completing A must not resolve B.
		client.push("turn/completed", {
			threadId: "thread-A",
			turn: { id: "turn-A", status: "completed" },
		});
		await turnA;
		expect(backendA.isTurnActive()).toBe(false);
		expect(backendB.isTurnActive()).toBe(true);

		client.push("turn/completed", {
			threadId: "thread-B",
			turn: { id: "turn-B", status: "completed" },
		});
		await turnB;
		expect(backendB.isTurnActive()).toBe(false);

		await Promise.all([backendA.close(), backendB.close()]);
		expect(client.closeCalls).toBe(1);
	});

	it("emits turn-failed when the turn completes with failed status", async () => {
		const { backend, client } = makeBackend();
		const events: NormalizedCodexEvent[] = [];
		backend.on("event", (e) => events.push(e));
		await backend.open({ ...baseConfig, codexPath: "/bin/true" });
		const turnDone = backend.runTurn([{ type: "text", text: "go" }]);
		await Promise.resolve();

		client.push("turn/completed", {
			threadId: "thread-1",
			turn: { id: "turn-1", status: "failed", error: { message: "boom" } },
		});
		await turnDone;

		expect(events).toContainEqual({ kind: "turn-failed", message: "boom" });
		expect(backend.isTurnActive()).toBe(false);
	});

	it("fails the in-flight turn if the process exits early", async () => {
		const { backend, client } = makeBackend();
		const events: NormalizedCodexEvent[] = [];
		backend.on("event", (e) => events.push(e));
		await backend.open({ ...baseConfig, codexPath: "/bin/true" });
		const turnDone = backend.runTurn([{ type: "text", text: "go" }]);
		await Promise.resolve();

		client.emit("exit", 1, null);
		await turnDone;

		expect(events.some((e) => e.kind === "turn-failed")).toBe(true);
	});

	it("fails the turn when the app-server goes idle (watchdog)", async () => {
		vi.useFakeTimers();
		try {
			const client = new FakeClient();
			const backend = new AppServerCodexBackend(() => client, {
				turnIdleTimeoutMs: 1000,
			});
			const events: NormalizedCodexEvent[] = [];
			backend.on("event", (e) => events.push(e));
			await backend.open({ ...baseConfig, codexPath: "/bin/true" });
			const turnDone = backend.runTurn([{ type: "text", text: "go" }]);
			await Promise.resolve();

			vi.advanceTimersByTime(1001);
			await turnDone;

			expect(
				events.some(
					(e) => e.kind === "turn-failed" && /no activity/.test(e.message),
				),
			).toBe(true);
			expect(backend.isTurnActive()).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it("notifications reset the idle watchdog", async () => {
		vi.useFakeTimers();
		try {
			const client = new FakeClient();
			const backend = new AppServerCodexBackend(() => client, {
				turnIdleTimeoutMs: 1000,
			});
			const events: NormalizedCodexEvent[] = [];
			backend.on("event", (e) => events.push(e));
			await backend.open({ ...baseConfig, codexPath: "/bin/true" });
			const turnDone = backend.runTurn([{ type: "text", text: "go" }]);
			await Promise.resolve();

			// Activity at 800ms resets the 1000ms watchdog...
			vi.advanceTimersByTime(800);
			client.push("item/started", {
				threadId: "thread-1",
				item: { type: "reasoning", id: "r1" },
			});
			// ...so 800ms more is still under the budget (no failure yet).
			vi.advanceTimersByTime(800);
			expect(events.some((e) => e.kind === "turn-failed")).toBe(false);

			// Complete the turn cleanly so the test resolves.
			client.push("turn/completed", {
				threadId: "thread-1",
				turn: { id: "turn-1", status: "completed" },
			});
			await turnDone;
			expect(events.some((e) => e.kind === "turn-completed")).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("AppServerClient request timeout", () => {
	it("rejects a request when no response arrives within the timeout", async () => {
		// `sleep` ignores stdin and produces no stdout, so the request never
		// resolves and must be rejected by the timeout.
		const client = new AppServerClient({
			binaryPath: "/bin/sleep",
			args: ["5"],
			requestTimeoutMs: 50,
		});
		client.start();
		try {
			await expect(client.request("initialize", {})).rejects.toThrow(
				/timed out/i,
			);
		} finally {
			await client.close();
		}
	});
});
