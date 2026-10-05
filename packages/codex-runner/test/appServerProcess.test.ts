import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type {
	IAppServerClient,
	NotificationHandler,
	ServerRequestHandler,
} from "../src/backend/appServerClient.js";
import {
	AppServerProcessManager,
	type AppServerThreadHandler,
} from "../src/backend/appServerProcess.js";
import type { ResolvedCodexConfig } from "../src/backend/types.js";

/** Minimal in-memory app-server client for pool tests. */
class FakeClient extends EventEmitter implements IAppServerClient {
	notificationHandler: NotificationHandler | null = null;
	serverRequestHandler: ServerRequestHandler | null = null;
	startCalls = 0;
	closeCalls = 0;
	setNotificationHandler(handler: NotificationHandler): void {
		this.notificationHandler = handler;
	}
	setServerRequestHandler(handler: ServerRequestHandler): void {
		this.serverRequestHandler = handler;
	}
	start(): void {
		this.startCalls += 1;
	}
	request<T = unknown>(): Promise<T> {
		return Promise.resolve({} as T);
	}
	close(): Promise<void> {
		this.closeCalls += 1;
		return Promise.resolve();
	}
	push(method: string, params: unknown): void {
		this.notificationHandler?.(method, params);
	}
}

function configWithEnv(env?: Record<string, string>): ResolvedCodexConfig {
	return {
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
		...(env ? { env } : {}),
	};
}

function recordingFactory() {
	const clients: FakeClient[] = [];
	const factory = () => {
		const c = new FakeClient();
		clients.push(c);
		return c;
	};
	return { clients, factory };
}

describe("AppServerProcessManager pool", () => {
	it("isolates changed MCP endpoints while sharing equivalent configurations", async () => {
		const { clients, factory } = recordingFactory();
		const manager = new AppServerProcessManager(factory, {
			idleCloseMs: 30000,
		});
		const config = configWithEnv();
		const first = await manager.acquire({
			...config,
			configOverrides: {
				mcp_servers: {
					context: { command: "node", args: ["server.mjs", "old-input.json"] },
				},
			},
		});
		const resumed = await manager.acquire({
			...config,
			resumeSessionId: "saved-thread",
			configOverrides: {
				mcp_servers: {
					context: { command: "node", args: ["server.mjs", "new-input.json"] },
				},
			},
		});
		const equivalent = await manager.acquire({
			...config,
			configOverrides: {
				mcp_servers: {
					context: { args: ["server.mjs", "new-input.json"], command: "node" },
				},
			},
		});
		expect(clients).toHaveLength(2);
		expect(clients.map((client) => client.startCalls)).toEqual([1, 1]);
		await first.release();
		await resumed.release();
		await equivalent.release();
		await manager.closeAll();
		expect(clients.map((client) => client.closeCalls)).toEqual([1, 1]);
	});
	it("awaits MCP process shutdown after its final lease without interrupting other clients", async () => {
		const { clients, factory } = recordingFactory();
		const manager = new AppServerProcessManager(factory, {
			idleCloseMs: 30000,
		});
		const config = {
			...configWithEnv(),
			configOverrides: { mcp_servers: { context: { command: "node" } } },
		};
		const first = await manager.acquire(config);
		const second = await manager.acquire(config);
		await first.release();
		expect(clients[0]!.closeCalls).toBe(0);
		let finish!: () => void;
		const closing = new Promise<void>((resolve) => {
			finish = resolve;
		});
		vi.spyOn(clients[0]!, "close").mockImplementation(async () => {
			clients[0]!.closeCalls++;
			await closing;
		});
		let released = false;
		const release = second.release().then(() => {
			released = true;
		});
		await Promise.resolve();
		expect(clients[0]!.closeCalls).toBe(1);
		expect(released).toBe(false);
		finish();
		await release;
		const resumed = await manager.acquire({
			...config,
			resumeSessionId: "saved-thread",
		});
		expect(clients).toHaveLength(2);
		await resumed.release();
		await manager.closeAll();
	});
	it("shares one process for identical launch configs", async () => {
		const { clients, factory } = recordingFactory();
		const manager = new AppServerProcessManager(factory, { idleCloseMs: 0 });

		await manager.acquire(configWithEnv({ CODEX_HOME: "/h" }));
		await manager.acquire(configWithEnv({ CODEX_HOME: "/h" }));

		expect(clients).toHaveLength(1);
		expect(clients[0]?.startCalls).toBe(1);
	});

	it("starts a SEPARATE process for a different launch config (no hard-fail)", async () => {
		const { clients, factory } = recordingFactory();
		const manager = new AppServerProcessManager(factory, { idleCloseMs: 0 });

		// Two concurrent leases whose env differs must each get their own process
		// rather than the second throwing "already running with different options".
		await manager.acquire(configWithEnv({ CODEX_HOME: "/home-a" }));
		await expect(
			manager.acquire(configWithEnv({ CODEX_HOME: "/home-b" })),
		).resolves.toBeDefined();

		expect(clients).toHaveLength(2);
	});

	it("evicts an idle process so the next acquire starts fresh", async () => {
		vi.useFakeTimers();
		try {
			const { clients, factory } = recordingFactory();
			const manager = new AppServerProcessManager(factory, {
				idleCloseMs: 100,
			});

			const lease = await manager.acquire(configWithEnv({ CODEX_HOME: "/h" }));
			lease.release();
			await vi.advanceTimersByTimeAsync(150);
			expect(clients[0]?.closeCalls).toBe(1);

			// Same key, but the prior process was disposed → a fresh one is created.
			await manager.acquire(configWithEnv({ CODEX_HOME: "/h" }));
			expect(clients).toHaveLength(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("routes notifications to the owning thread by threadId", async () => {
		const { clients, factory } = recordingFactory();
		const manager = new AppServerProcessManager(factory, { idleCloseMs: 0 });
		const lease = await manager.acquire(configWithEnv({ CODEX_HOME: "/h" }));

		const a = handlerSpy();
		const b = handlerSpy();
		lease.registerThread("thread-A", a.handler);
		lease.registerThread("thread-B", b.handler);

		clients[0]?.push("item/completed", { threadId: "thread-B", item: {} });

		expect(a.notifications).toHaveLength(0);
		expect(b.notifications).toHaveLength(1);
	});

	it("delivers a threadId-less notification to the sole registered thread", async () => {
		const { clients, factory } = recordingFactory();
		const manager = new AppServerProcessManager(factory, { idleCloseMs: 0 });
		const lease = await manager.acquire(configWithEnv({ CODEX_HOME: "/h" }));

		const only = handlerSpy();
		lease.registerThread("thread-1", only.handler);

		clients[0]?.push("turn/started", { turn: { status: "in_progress" } });

		expect(only.notifications).toHaveLength(1);
	});

	it("drops a threadId-less notification when multiple threads are registered", async () => {
		const { clients, factory } = recordingFactory();
		const manager = new AppServerProcessManager(factory, { idleCloseMs: 0 });
		const lease = await manager.acquire(configWithEnv({ CODEX_HOME: "/h" }));

		const a = handlerSpy();
		const b = handlerSpy();
		lease.registerThread("thread-A", a.handler);
		lease.registerThread("thread-B", b.handler);

		clients[0]?.push("turn/started", { turn: { status: "in_progress" } });

		expect(a.notifications).toHaveLength(0);
		expect(b.notifications).toHaveLength(0);
	});
});

function handlerSpy() {
	const notifications: { method: string; params: unknown }[] = [];
	const handler: AppServerThreadHandler = {
		onNotification: (method, params) => notifications.push({ method, params }),
		onProcessGone: () => {},
		onProcessError: () => {},
	};
	return { handler, notifications };
}
