import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FactoryAuth } from "../src/factory/FactoryAuth.js";
import {
	authorizeFactoryEnrollment,
	requestFactoryAuthRecovery,
	requestFactoryTerminalSession,
} from "../src/factory/FactoryAuthOperator.js";
import { FactoryAuthStore } from "../src/factory/FactoryAuthStore.js";
import { authenticator } from "./fixtures/webauthn.js";

const origin = "https://factory.example.test";
const homes: string[] = [],
	services: FactoryAuth[] = [];
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "factory-auth-test-"));
	homes.push(home);
	const auth = new FactoryAuth(home, { origins: [origin] });
	services.push(auth);
	const grant = () =>
		JSON.parse(readFileSync(auth.grantPath, "utf8")).token as string;
	const key = authenticator();
	const enroll = async () => {
		const options = await auth.options(
			"register",
			origin,
			"browser",
			undefined,
			grant(),
			"My phone",
		);
		return auth.verify(
			"register",
			options.transaction,
			origin,
			"browser",
			key.register(options.options.challenge, origin),
		);
	};
	return { home, auth, grant, key, enroll };
}
afterEach(() => {
	vi.useRealTimers();
	for (const auth of services.splice(0)) auth.close();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
it("requires operator authorization even with an empty store and atomically consumes each grant", async () => {
	const f = fixture();
	await expect(f.auth.options("register", origin, "browser")).rejects.toThrow(
		"setup code",
	);
	await expect(
		f.auth.options("register", origin, "browser", undefined, "wrong"),
	).rejects.toThrow("Invalid");
	const grant = f.grant();
	const attempts = await Promise.allSettled([
		f.auth.options("register", origin, "a", undefined, grant),
		f.auth.options("register", origin, "b", undefined, grant),
	]);
	expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
	expect(attempts.filter((a) => a.status === "rejected")).toHaveLength(1);
});
it("verifies real registration and signed login, persists counters and hashed sessions with private permissions", async () => {
	const f = fixture(),
		session = await f.enroll();
	expect(f.auth.session(session.token, origin)).toBeDefined();
	expect(f.auth.session(session.token, "https://evil.test")).toBeUndefined();
	const options = await f.auth.options("login", origin, "browser");
	const signed = f.key.login(options.options.challenge, origin);
	const login = await f.auth.verify(
		"login",
		options.transaction,
		origin,
		"browser",
		signed,
	);
	expect(f.auth.store.state.credentials[0]!.counter).toBe(1);
	expect(readFileSync(f.auth.store.path, "utf8")).not.toContain(login.token);
	expect(statSync(f.auth.store.path).mode & 0o777).toBe(0o600);
	expect(statSync(f.auth.store.directory).mode & 0o777).toBe(0o700);
	f.auth.close();
	const restored = new FactoryAuth(f.home, { origins: [origin] });
	services.push(restored);
	expect(restored.session(login.token, origin)).toBeDefined();
	await expect(
		restored.verify("login", options.transaction, origin, "browser", signed),
	).rejects.toThrow("already used");
	restored.logout(login.token, origin);
	expect(restored.session(login.token, origin)).toBeUndefined();
	expect(() => restored.remove(session.token, origin, f.key.id)).toThrow(
		"at least one",
	);
});
it.each([
	"origin",
	"challenge",
	"signature",
	"uv",
	"binding",
	"expired",
	"unknown",
])("rejects real login with invalid %s and prevents retry/replay", async (failure) => {
	const f = fixture();
	await f.enroll();
	const options = await f.auth.options("login", origin, "browser");
	const response = f.key.login(
		failure === "challenge" ? "wrong-challenge" : options.options.challenge,
		failure === "origin" ? "https://evil.test" : origin,
		1,
		failure !== "uv",
	);
	if (failure === "signature")
		response.response.signature =
			Buffer.from("bad-signature").toString("base64url");
	if (failure === "unknown") response.id = "unknown";
	if (failure === "expired") {
		vi.useFakeTimers();
		vi.setSystemTime(Date.now() + 300001);
	}
	await expect(
		f.auth.verify(
			"login",
			options.transaction,
			origin,
			failure === "binding" ? "other" : "browser",
			response,
		),
	).rejects.toThrow();
	await expect(
		f.auth.verify(
			"login",
			options.transaction,
			origin,
			"browser",
			f.key.login(options.options.challenge, origin),
		),
	).rejects.toThrow("already used");
});
it("rejects registration without user verification, duplicate credentials and simultaneous challenge use", async () => {
	const f = fixture();
	const options = await f.auth.options(
		"register",
		origin,
		"browser",
		undefined,
		f.grant(),
	);
	await expect(
		f.auth.verify(
			"register",
			options.transaction,
			origin,
			"browser",
			f.key.register(options.options.challenge, origin, false),
		),
	).rejects.toThrow();
	writeFileSync(
		f.auth.grantPath,
		JSON.stringify({ token: "a".repeat(43), expires: Date.now() + 60000 }),
	);
	const retry = await f.auth.options(
		"register",
		origin,
		"browser",
		undefined,
		"a".repeat(43),
	);
	const response = f.key.register(retry.options.challenge, origin);
	const result = await Promise.allSettled([
		f.auth.verify("register", retry.transaction, origin, "browser", response),
		f.auth.verify("register", retry.transaction, origin, "browser", response),
	]);
	expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
	expect(f.auth.store.state.credentials).toHaveLength(1);
});
it("revokes credential sessions, enforces expiry/recent verification, and resets only authentication", async () => {
	const f = fixture(),
		first = await f.enroll();
	const second = authenticator(),
		options = await f.auth.options(
			"register",
			origin,
			"second-browser",
			first.token,
		);
	const session = await f.auth.verify(
		"register",
		options.transaction,
		origin,
		"second-browser",
		second.register(options.options.challenge, origin),
	);
	f.auth.remove(session.token, origin, f.key.id);
	expect(f.auth.session(first.token, origin)).toBeUndefined();
	expect(f.auth.session(session.token, origin)).toBeDefined();
	vi.useFakeTimers();
	vi.setSystemTime(Date.now() + 300001);
	expect(() => f.auth.credentials(session.token, origin)).toThrow("again");
	vi.setSystemTime(Date.now() + 12 * 3600000);
	expect(f.auth.session(session.token, origin)).toBeUndefined();
	vi.useRealTimers();
	writeFileSync(
		join(f.auth.store.directory, "recover"),
		"RESET FACTORY AUTHENTICATION",
	);
	f.auth.checkRecovery();
	expect(f.auth.store.state.credentials).toHaveLength(0);
	expect(f.auth.store.state.sessions).toHaveLength(0);
	expect(f.grant()).toHaveLength(43);
});
it("fails closed on corruption/identity changes, enforces existing permissions and rolls back failed writes", async () => {
	const f = fixture();
	await f.enroll();
	f.auth.close();
	chmodSync(f.auth.store.path, 0o644);
	new FactoryAuthStore(f.home, [origin]);
	expect(statSync(f.auth.store.path).mode & 0o777).toBe(0o600);
	expect(() => new FactoryAuthStore(f.home, ["https://other.test"])).toThrow(
		"origins changed",
	);
	const original = structuredClone(f.auth.store.state);
	expect(() =>
		f.auth.store.update((state) => {
			state.credentials[0]!.counter = -1;
		}),
	).toThrow();
	expect(f.auth.store.state).toEqual(original);
	writeFileSync(f.auth.store.path, "corrupt");
	expect(() => new FactoryAuthStore(f.home, [origin])).toThrow("corrupt");
});

it("authorizes local enrollment, rejects expired grants and recovers corrupt state without changing run files", async () => {
	const f = fixture();
	// FactoryAuth takes a factory directory; the operator commands take its parent home.
	const { mkdirSync } = await import("node:fs");
	const home = join(f.home, "operator-home"),
		factory = join(home, "factory");
	mkdirSync(factory, { recursive: true });
	writeFileSync(join(factory, "runs.json"), "preserved runs");
	const token = authorizeFactoryEnrollment(home);
	const pending = join(factory, "auth", "enroll.json");
	expect(JSON.parse(readFileSync(pending, "utf8")).token).toBe(token);
	expect(() => requestFactoryAuthRecovery(home, undefined)).toThrow(
		"Recovery revokes",
	);
	writeFileSync(join(factory, "auth", "state.json"), "corrupt state");
	requestFactoryAuthRecovery(home, "RESET FACTORY AUTHENTICATION");
	const restarted = new FactoryAuth(factory, { origins: [origin] });
	services.push(restarted);
	restarted.checkRecovery();
	expect(restarted.store.state.credentials).toHaveLength(0);
	expect(readFileSync(join(factory, "runs.json"), "utf8")).toBe(
		"preserved runs",
	);
	writeFileSync(
		restarted.grantPath,
		JSON.stringify({ token: "b".repeat(43), expires: Date.now() - 1 }),
	);
	await expect(
		restarted.options("register", origin, "browser", undefined, "b".repeat(43)),
	).rejects.toThrow("expired");
});
it("supports valid zero-counter passkeys rather than requiring a positive signature counter", async () => {
	const f = fixture();
	await f.enroll();
	const options = await f.auth.options("login", origin, "browser");
	const session = await f.auth.verify(
		"login",
		options.transaction,
		origin,
		"browser",
		f.key.login(options.options.challenge, origin, 0),
	);
	expect(f.auth.session(session.token, origin)).toBeDefined();
	expect(f.auth.store.state.credentials[0]!.counter).toBe(0);
});
it("grants localhost-only terminal sessions from local operator requests that cannot manage passkeys", () => {
	const home = mkdtempSync(join(tmpdir(), "factory-terminal-test-"));
	homes.push(home);
	const factory = join(home, "factory"),
		local = "http://localhost:3457";
	mkdirSync(factory);
	const auth = new FactoryAuth(factory, { origins: [local, origin] });
	services.push(auth);
	const token = requestFactoryTerminalSession(home);
	const requests = () =>
		readdirSync(auth.store.directory).filter((name) =>
			name.startsWith("terminal-"),
		);
	expect(requests()).toHaveLength(1);
	// Only the token hash reaches disk.
	expect(
		readFileSync(join(auth.store.directory, requests()[0]!), "utf8"),
	).not.toContain(token);
	expect(auth.session(token, local)).toBeUndefined();
	auth.checkTerminalRequests();
	expect(requests()).toHaveLength(0);
	expect(auth.session(token, local)).toMatchObject({ credential: "terminal" });
	expect(auth.session(token, origin)).toBeUndefined();
	expect(() => auth.credentials(token, local)).toThrow("again");
	// Terminal sessions are memory-only and never persisted with passkey sessions.
	expect(auth.store.state.sessions).toHaveLength(0);
	auth.logout(token, local);
	expect(auth.session(token, local)).toBeUndefined();

	const expired = join(auth.store.directory, `terminal-${"a".repeat(32)}.json`);
	writeFileSync(
		expired,
		JSON.stringify({ hash: "b".repeat(64), expires: Date.now() - 1 }),
		{ mode: 0o600 },
	);
	auth.checkTerminalRequests();
	expect(existsSync(expired)).toBe(false);
	expect(auth.session("x".repeat(43), local)).toBeUndefined();

	const revoked = requestFactoryTerminalSession(home);
	auth.checkTerminalRequests();
	expect(auth.session(revoked, local)).toBeDefined();
	writeFileSync(
		join(auth.store.directory, "recover"),
		"RESET FACTORY AUTHENTICATION",
	);
	auth.checkRecovery();
	expect(auth.session(revoked, local)).toBeUndefined();
	// Malformed request paths cannot crash the server, and a restart revokes terminal access.
	mkdirSync(join(auth.store.directory, `terminal-${"c".repeat(32)}.json`));
	expect(() => auth.checkTerminalRequests()).not.toThrow();
	const beforeRestart = requestFactoryTerminalSession(home);
	auth.checkTerminalRequests();
	expect(auth.session(beforeRestart, local)).toBeDefined();
	auth.close();
	const restarted = new FactoryAuth(factory, { origins: [local, origin] });
	services.push(restarted);
	expect(restarted.session(beforeRestart, local)).toBeUndefined();
});
it("ignores terminal requests without a localhost origin", () => {
	const home = mkdtempSync(join(tmpdir(), "factory-terminal-test-"));
	homes.push(home);
	const factory = join(home, "factory");
	mkdirSync(factory);
	const auth = new FactoryAuth(factory, { origins: [origin] });
	services.push(auth);
	const token = requestFactoryTerminalSession(home);
	auth.checkTerminalRequests();
	expect(auth.session(token, origin)).toBeUndefined();
});
