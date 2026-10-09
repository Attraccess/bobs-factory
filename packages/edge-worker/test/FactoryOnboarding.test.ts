import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FactoryServer } from "../src/factory/FactoryServer.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";
import { authenticator } from "./fixtures/webauthn.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanups.splice(0)) await close();
});
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "factory-guided-access-"));
	const runtime = new WorkflowRuntime(home, {
		agent: vi.fn(),
		script: vi.fn(),
		tool: vi.fn(),
	});
	const onboarding = {
		status: vi.fn(() => ({ available: true, required: true })),
		configure: vi.fn(async () => ({ required: false })),
		connectGithub: vi.fn(async () => ({ connected: true })),
	};
	const server = new FactoryServer(
		runtime,
		{
			onboarding,
			repositories: () => [],
			sessions: () => [],
			entries: () => [],
			start: vi.fn(),
			stop: vi.fn(),
		},
		{ origins: ["http://localhost", "https://remote.example.test"] },
	);
	cleanups.push(async () => {
		await server.stop();
		await runtime.shutdown();
		rmSync(home, { recursive: true, force: true });
	});
	const enroll = async (origin = "http://localhost") => {
		const key = authenticator(),
			headers = {
				host: new URL(origin).host,
				origin,
				"x-factory-request": "1",
			};
		const grant = JSON.parse(readFileSync(server.auth.grantPath, "utf8")).token;
		const options = await server.app.inject({
			method: "POST",
			url: "/api/auth/register/options",
			headers,
			payload: { grant },
		});
		expect(options.statusCode).toBe(200);
		const verify = await server.app.inject({
			method: "POST",
			url: "/api/auth/register/verify",
			headers: {
				...headers,
				cookie: String(options.headers["set-cookie"]).split(";")[0],
			},
			payload: {
				transaction: options.json().transaction,
				response: key.register(options.json().options.challenge, origin),
			},
		});
		expect(verify.statusCode).toBe(200);
		return {
			...headers,
			cookie: String(verify.headers["set-cookie"]).split(";")[0],
		};
	};
	return { server, onboarding, enroll };
}
it("keeps all setup and token endpoints behind a real passkey ceremony", async () => {
	const f = fixture();
	for (const route of [
		"/api/onboarding",
		"/api/onboarding/project",
		"/api/onboarding/github",
	]) {
		const response = await f.server.app.inject({
			method: route.endsWith("onboarding") ? "GET" : "POST",
			url: route,
			headers: {
				host: "localhost",
				origin: "http://localhost",
				"x-factory-request": "1",
			},
			payload: route.endsWith("onboarding") ? undefined : {},
		});
		expect(response.statusCode).toBe(401);
	}
	expect(f.onboarding.status).not.toHaveBeenCalled();
	expect(f.onboarding.configure).not.toHaveBeenCalled();
	expect(f.onboarding.connectGithub).not.toHaveBeenCalled();
	const headers = await f.enroll();
	const configure = await f.server.app.inject({
		method: "POST",
		url: "/api/onboarding/project",
		headers,
		payload: { repositoryPath: "/my/project", runner: "codex" },
	});
	expect(configure.statusCode).toBe(200);
	expect(f.onboarding.configure).toHaveBeenCalledWith({
		repositoryPath: "/my/project",
		runner: "codex",
	});
	const connect = await f.server.app.inject({
		method: "POST",
		url: "/api/onboarding/github",
		headers,
		payload: { token: "fixture-secret" },
	});
	expect(connect.statusCode).toBe(200);
	expect(connect.body).not.toContain("fixture-secret");
});
it("does not expose machine setup remotely even to an authenticated remote passkey", async () => {
	const f = fixture(),
		headers = await f.enroll("https://remote.example.test");
	const config = await f.server.app.inject({ url: "/api/config", headers });
	expect(config.statusCode).toBe(200);
	expect(config.json()).not.toHaveProperty("onboarding");
	const response = await f.server.app.inject({
		method: "POST",
		url: "/api/onboarding/github",
		headers,
		payload: { token: "fixture-secret" },
	});
	expect(response.statusCode).toBe(409);
	expect(response.json().error).toContain("localhost");
	expect(f.onboarding.status).not.toHaveBeenCalled();
	expect(f.onboarding.connectGithub).not.toHaveBeenCalled();
});
it("requires exact origin and request headers after enrollment before setup mutations", async () => {
	const f = fixture(),
		headers = await f.enroll();
	for (const bad of [
		{ ...headers, origin: "https://evil.example.test" },
		{ ...headers, "x-factory-request": "0" },
	]) {
		const response = await f.server.app.inject({
			method: "POST",
			url: "/api/onboarding/project",
			headers: bad,
			payload: { repositoryPath: "/my/project", runner: "codex" },
		});
		expect(response.statusCode).toBe(403);
	}
	expect(f.onboarding.configure).not.toHaveBeenCalled();
});
