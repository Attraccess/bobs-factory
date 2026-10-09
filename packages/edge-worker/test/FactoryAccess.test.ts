import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { requestFactoryTerminalSession } from "../src/factory/FactoryAuthOperator.js";
import { FactoryServer } from "../src/factory/FactoryServer.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { factoryHttp } from "./fixtures/factory-http.js";
import { authenticator } from "./fixtures/webauthn.js";

const origin = "https://factory.example.test",
	host = "factory.example.test";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanups.splice(0)) await close();
});
function fixture(useEnvironment = false) {
	const home = mkdtempSync(join(tmpdir(), "factory-access-test-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const start = vi.fn(),
		entries = vi.fn(() => []),
		repositories = vi.fn(() => []);
	const server = new FactoryServer(
		runtime,
		{ repositories, sessions: () => [], entries, start, stop: vi.fn() },
		useEnvironment ? undefined : { origins: [origin, "http://localhost"] },
	);
	cleanups.push(async () => {
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { force: true, recursive: true });
	});
	const writeHeaders = { host, origin, "x-factory-request": "1" };
	const enroll = async () => {
		const key = authenticator();
		const grant = JSON.parse(readFileSync(server.auth.grantPath, "utf8")).token;
		const options = await server.app.inject({
			method: "POST",
			url: "/api/auth/register/options",
			headers: writeHeaders,
			payload: { grant },
		});
		expect(options.statusCode).toBe(200);
		const result = await server.app.inject({
			method: "POST",
			url: "/api/auth/register/verify",
			headers: {
				...writeHeaders,
				cookie: String(options.headers["set-cookie"]).split(";")[0],
			},
			payload: {
				transaction: options.json().transaction,
				response: key.register(options.json().options.challenge, origin),
			},
		});
		expect(result.statusCode).toBe(200);
		return String(result.headers["set-cookie"]);
	};
	return {
		home,
		runtime,
		server,
		start,
		entries,
		repositories,
		writeHeaders,
		enroll,
	};
}
it("denies every protected GET/HEAD/write before hooks, including unknown paths and localhost/forwarded identities", async () => {
	const f = fixture();
	for (const url of [
		"/api/runs",
		"/api/config",
		"/api/events",
		"/api/runs/id",
		"/api/runs/id/transcript",
		"/api/runs/id/raw",
		"/api/runs/id/screenshots/0",
		"/api/runs/id/videos/demo/media?v=hash",
		"/api/runs/id/videos/demo/poster?v=hash",
		"/api/runs/id/videos/demo/captions?v=hash",
		"/api/runs/id/question-images/a.png",
		"/api/runs/id/review-files",
		"/api/auth/credentials",
		"/api/new-route",
		"/private-file",
	]) {
		for (const method of ["GET", "HEAD"] as const) {
			const response = await f.server.app.inject({
				method,
				url,
				headers: { host },
			});
			expect(response.statusCode, `${method} ${url}`).toBe(401);
			expect(response.headers["cache-control"]).toBe("no-store");
		}
	}
	for (const headers of [
		{ host: "localhost" },
		{
			host,
			"x-forwarded-host": "localhost",
			"x-forwarded-for": "127.0.0.1",
			"x-forwarded-proto": "http",
		},
		{ host, origin: "http://localhost" },
	]) {
		expect(
			(await f.server.app.inject({ url: "/api/runs", headers })).statusCode,
		).toBe(headers.origin ? 403 : 401);
	}
	expect(
		(
			await f.server.app.inject({
				method: "POST",
				url: "/api/runs",
				headers: f.writeHeaders,
				payload: {},
			})
		).statusCode,
	).toBe(401);
	expect(f.start).not.toHaveBeenCalled();
	expect(f.entries).not.toHaveBeenCalled();
	expect(f.repositories).not.toHaveBeenCalled();
	expect(
		(
			await f.server.app.inject({ url: "/api/auth/status", headers: { host } })
		).json(),
	).toMatchObject({ authenticated: false, setupRequired: true });
	expect(
		(await f.server.app.inject({ url: "/", headers: { host } })).statusCode,
	).toBe(200);
});
it("requires exact Origin/action headers, performs real enrollment, and uses secure opaque cookies", async () => {
	const f = fixture();
	for (const headers of [
		{ host, "x-factory-request": "1" },
		{ host, origin },
		{ ...f.writeHeaders, origin: "https://evil.test" },
	]) {
		expect(
			(
				await f.server.app.inject({
					method: "POST",
					url: "/api/auth/register/options",
					headers,
					payload: {},
				})
			).statusCode,
		).toBe(403);
	}
	expect(
		(
			await f.server.app.inject({
				method: "POST",
				url: "/api/auth/register/options",
				headers: f.writeHeaders,
				payload: {},
			})
		).statusCode,
	).toBe(409);
	const cookie = await f.enroll();
	expect(cookie).toContain("__Host-factory-session=");
	expect(cookie).toContain("HttpOnly");
	expect(cookie).toContain("Secure");
	expect(cookie).toContain("SameSite=Strict");
	expect(cookie).toContain("Path=/");
	expect(cookie).not.toContain("Domain");
	const headers = { host, cookie: cookie.split(";")[0] };
	expect(
		(await f.server.app.inject({ url: "/api/runs", headers })).statusCode,
	).toBe(200);
	expect(
		(
			await f.server.app.inject({
				url: "/api/runs",
				headers: { ...headers, cookie: "__Host-factory-session=forged" },
			})
		).statusCode,
	).toBe(401);
	expect(
		(
			await f.server.app.inject({
				method: "POST",
				url: "/api/auth/logout",
				headers: { ...headers, ...f.writeHeaders },
			})
		).statusCode,
	).toBe(200);
	expect(
		(await f.server.app.inject({ url: "/api/runs", headers })).statusCode,
	).toBe(401);
});
it.each([
	"logout",
	"expiry",
	"recovery",
])("closes real idle SSE on %s and denies reconnect", async (reason) => {
	const f = fixture(),
		cookie = (await f.enroll()).split(";")[0]!;
	if (reason === "expiry")
		f.server.auth.store.update((state) => {
			state.sessions[0]!.expires = Date.now() + 250;
		});
	const address = await f.server.app.listen({ host: "127.0.0.1", port: 0 });
	const response = await factoryHttp(
		`${address}/api/events`,
		{ host, cookie },
		AbortSignal.timeout(3000),
	);
	expect(response.status).toBe(200);
	const reader = response.body!.getReader();
	expect(new TextDecoder().decode((await reader.read()).value)).toContain(
		"event: ready",
	);
	if (reason === "logout")
		await f.server.app.inject({
			method: "POST",
			url: "/api/auth/logout",
			headers: { ...f.writeHeaders, cookie },
		});
	if (reason === "recovery") {
		const { writeFileSync } = await import("node:fs");
		writeFileSync(
			join(f.server.auth.store.directory, "recover"),
			"RESET FACTORY AUTHENTICATION",
		);
		f.server.auth.checkRecovery();
	}
	expect((await reader.read()).done).toBe(true);
	expect(
		(
			await f.server.app.inject({
				url: "/api/events",
				headers: { host, cookie },
			})
		).statusCode,
	).toBe(401);
	expect(
		(
			await f.server.app.inject({
				url: "/api/runs/id/screenshots/0",
				headers: { host, cookie },
			})
		).statusCode,
	).toBe(401);
});

it("redirects the IP dashboard entrypoint to localhost while protecting both data surfaces", async () => {
	const home = mkdtempSync(join(tmpdir(), "factory-loopback-redirect-"));
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const server = new FactoryServer(
		runtime,
		{
			repositories: () => [],
			sessions: () => [],
			entries: () => [],
			start: async () => {
				throw new Error("Unused");
			},
			stop: () => {},
		},
		{ origins: ["http://127.0.0.1", "http://localhost"] },
	);
	cleanups.push(async () => {
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	});
	const entry = await server.app.inject({
		url: "/",
		headers: { host: "127.0.0.1" },
	});
	expect(entry.statusCode).toBe(302);
	expect(entry.headers.location).toBe("http://localhost");
	for (const host of ["127.0.0.1", "localhost"])
		expect(
			(await server.app.inject({ url: "/api/runs", headers: { host } }))
				.statusCode,
		).toBe(401);
});

// The existing public-tunnel setting must remain usable after adding authentication.
it.each([
	false,
	true,
])("protects the configured public origin with explicit-setting precedence (%s)", async (explicit) => {
	vi.stubEnv(
		"BOBS_FACTORY_FACTORY_PUBLIC_ORIGIN",
		explicit ? "https://old.example.test" : origin,
	);
	vi.stubEnv("BOBS_FACTORY_FACTORY_ORIGIN", explicit ? origin : undefined);
	vi.stubEnv("BOBS_FACTORY_FACTORY_SESSION_HOURS", "12");
	try {
		const f = fixture(true);
		expect(
			(await f.server.app.inject({ url: "/api/runs", headers: { host } }))
				.statusCode,
		).toBe(401);
		const cookie = (await f.enroll()).split(";")[0]!;
		expect(
			(
				await f.server.app.inject({
					url: "/api/runs",
					headers: { host, cookie },
				})
			).statusCode,
		).toBe(200);
		expect(
			(
				await f.server.app.inject({
					url: "/api/runs",
					headers: { host: "old.example.test", cookie },
				})
			).statusCode,
		).toBe(403);
	} finally {
		vi.unstubAllEnvs();
	}
});
it("accepts local terminal sessions as Bearer tokens on the localhost authority only", async () => {
	const f = fixture();
	const token = requestFactoryTerminalSession(f.home);
	const local = { host: "localhost", authorization: `Bearer ${token}` };
	expect(
		(await f.server.app.inject({ url: "/api/runs", headers: local }))
			.statusCode,
	).toBe(200);
	expect(
		(
			await f.server.app.inject({
				url: "/api/runs",
				headers: { host, authorization: `Bearer ${token}` },
			})
		).statusCode,
	).toBe(401);
	expect(
		(
			await f.server.app.inject({
				url: "/api/runs",
				headers: {
					host: "localhost",
					authorization: `Bearer ${"x".repeat(43)}`,
				},
			})
		).statusCode,
	).toBe(401);
	// Writes keep the browser CSRF requirements.
	expect(
		(
			await f.server.app.inject({
				method: "POST",
				url: "/api/runs/missing/stop",
				headers: local,
			})
		).statusCode,
	).toBe(403);
	expect(
		(
			await f.server.app.inject({
				method: "POST",
				url: "/api/runs/missing/stop",
				headers: {
					...local,
					origin: "http://localhost",
					"x-factory-request": "1",
				},
			})
		).statusCode,
	).toBe(404);
	expect(
		(
			await f.server.app.inject({
				url: "/api/auth/credentials",
				headers: local,
			})
		).statusCode,
	).not.toBe(200);
});
