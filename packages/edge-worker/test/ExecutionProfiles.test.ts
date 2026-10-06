import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentResolver } from "../src/factory/ExecutionEnvironment.js";
import {
	ExecutionProfileStore,
	IdentityProfileSchema,
	ToolProfileSchema,
} from "../src/factory/ExecutionProfiles.js";

const directories: string[] = [];
function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "factory-execution-"));
	directories.push(directory);
	return directory;
}
const ref = {
	source: "env" as const,
	name: "FACTORY_TEST_KEY",
	version: "v1",
	owner: "Test fixture (unverified)",
};
const identity = () =>
	IdentityProfileSchema.parse({
		id: "factory",
		revision: 1,
		name: "Factory",
		author: {
			mode: "factory-only",
			value: { name: "Author", email: "author@example.test" },
		},
		committer: {
			mode: "factory-only",
			value: { name: "Committer", email: "committer@example.test" },
		},
		signing: { format: "disabled" },
		repositories: [],
		runners: {
			claude: { mode: "factory-only", provider: "anthropic", credential: ref },
		},
	});
const tools = () =>
	ToolProfileSchema.parse({
		id: "private",
		revision: 1,
		name: "Private tools",
		mode: "factory-only",
	});
const config = () => ({
	schemaVersion: 1,
	revision: 0,
	identities: [identity()],
	tools: [tools()],
	defaults: { identityProfile: "factory" },
	repositories: { repo: { toolProfile: "private" } },
});
const git = (cwd: string, args: string[], env?: Record<string, string>) =>
	execFileSync("git", args, {
		cwd,
		env: env ?? process.env,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
afterEach(() => {
	vi.unstubAllGlobals();
	for (const path of directories.splice(0))
		rmSync(path, { recursive: true, force: true });
});

describe("Execution profile store", () => {
	it("resolves each selection independently and preserves accepted snapshots across edits and removal", () => {
		const store = new ExecutionProfileStore(fixture());
		expect(store.select("legacy")).toBeUndefined();
		const saved = store.save(config(), 0);
		const snapshot = store.select("repo")!;
		expect(snapshot.sources).toEqual({
			identity: "factory",
			tools: "repository",
		});
		expect(store.select("repo", { toolProfile: "private" })?.sources).toEqual({
			identity: "factory",
			tools: "manual",
		});
		store.save(
			{ ...saved, identities: [], tools: [], defaults: {}, repositories: {} },
			saved.revision,
		);
		expect(snapshot.identity?.id).toBe("factory");
		expect(snapshot.tools?.id).toBe("private");
		expect(store.select("repo")).toBeUndefined();
	});
	it("rejects stale writes from another editor without losing the accepted defaults", () => {
		const directory = fixture();
		const first = new ExecutionProfileStore(directory);
		const second = new ExecutionProfileStore(directory);
		first.save(config(), 0);
		expect(() => second.save(config(), 0)).toThrow(
			"Execution profiles changed",
		);
		expect(second.read().revision).toBe(1);
		if (process.platform !== "win32")
			expect(
				statSync(join(directory, "execution-profiles.json")).mode & 0o077,
			).toBe(0);
	});
	it("rejects secret literals, reserved infrastructure removal and unknown fields", () => {
		expect(() =>
			ToolProfileSchema.parse({ ...tools(), remove: ["factory-context"] }),
		).toThrow();
		expect(() =>
			ToolProfileSchema.parse({
				...tools(),
				mcp: {
					test: {
						type: "stdio",
						command: "node",
						env: { API_KEY: { literal: "not-a-reference" } },
					},
				},
			}),
		).toThrow();
		expect(() =>
			IdentityProfileSchema.parse({ ...identity(), token: "canary" }),
		).toThrow();
	});
});

describe("Private execution materialization", () => {
	function setup() {
		const directory = fixture();
		git(directory, ["init", "--quiet"]);
		const host = {
			PATH: process.env.PATH,
			HOME: directory,
			FACTORY_TEST_KEY: "fixture-secret-canary",
			GH_TOKEN: "wrong-host-account",
			ANTHROPIC_AUTH_TOKEN: "wrong-provider",
			BASH_ENV: "/unapproved/startup",
		};
		return {
			directory,
			host,
			resolver: new ExecutionEnvironmentResolver(
				join(directory, "factory"),
				host,
			),
		};
	}
	const snapshot = () => ({
		schemaVersion: 1 as const,
		identity: identity(),
		tools: tools(),
		sources: { identity: "manual" as const, tools: "manual" as const },
	});
	it("applies separate real Git identities and disables host signing, helpers and environment fallback", async () => {
		const { directory, resolver } = setup();
		const resolved = await resolver.resolve(
			snapshot(),
			"run1",
			directory,
			"claude",
		);
		expect(
			git(directory, ["var", "GIT_AUTHOR_IDENT"], resolved.environment),
		).toMatch(/^Author <author@example.test> /);
		expect(
			git(directory, ["var", "GIT_COMMITTER_IDENT"], resolved.environment),
		).toMatch(/^Committer <committer@example.test> /);
		expect(
			git(directory, ["config", "commit.gpgsign"], resolved.environment),
		).toBe("false");
		expect(resolved.environment.GH_TOKEN).toBeUndefined();
		expect(resolved.environment.BASH_ENV).toBeUndefined();
		expect(resolved.environment.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
		expect(resolved.environment.ANTHROPIC_API_KEY).toBe(
			"fixture-secret-canary",
		);
		expect(resolved.redact("fixture-secret-canary")).toBe("[REDACTED]");
		writeFileSync(join(directory, "file.txt"), "fixture");
		git(directory, ["add", "file.txt"], resolved.environment);
		git(directory, ["commit", "-m", "fixture"], resolved.environment);
		expect(
			git(
				directory,
				["show", "-s", "--format=%an <%ae>|%cn <%ce>"],
				resolved.environment,
			),
		).toBe("Author <author@example.test>|Committer <committer@example.test>");
	});
	it("signs and verifies a real commit and tag with a separately selected SSH key", async () => {
		const { directory, resolver } = setup();
		const key = join(directory, "signing-key");
		execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key], {
			stdio: "pipe",
		});
		const signers = join(directory, "allowed-signers");
		writeFileSync(
			signers,
			`committer@example.test ${readFileSync(`${key}.pub`, "utf8")}`,
		);
		const input = snapshot();
		input.identity.signing = {
			format: "ssh",
			key,
			allowedSigners: signers,
			commits: true,
			tags: true,
		};
		const resolved = await resolver.resolve(
			input,
			"signed",
			directory,
			"claude",
		);
		git(
			directory,
			["commit", "--allow-empty", "-m", "signed fixture"],
			resolved.environment,
		);
		git(directory, ["verify-commit", "HEAD"], resolved.environment);
		git(
			directory,
			["tag", "-m", "signed fixture", "signed-fixture"],
			resolved.environment,
		);
		git(directory, ["verify-tag", "signed-fixture"], resolved.environment);
	});
	it("signs and verifies with an explicitly prepared private OpenPGP home", async () => {
		const { directory, resolver } = setup();
		const home = join(directory, "gpg");
		mkdirSync(home, { mode: 0o700 });
		try {
			execFileSync(
				"gpg",
				[
					"--homedir",
					home,
					"--batch",
					"--pinentry-mode",
					"loopback",
					"--passphrase",
					"",
					"--quick-generate-key",
					"Fixture <committer@example.test>",
					"ed25519",
					"sign",
					"0",
				],
				{ stdio: "ignore", timeout: 15000 },
			);
			const fingerprint = execFileSync(
				"gpg",
				["--homedir", home, "--with-colons", "--list-secret-keys"],
				{ stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
			)
				.split("\n")
				.find((line) => line.startsWith("fpr:"))!
				.split(":")[9]!;
			const input = snapshot();
			input.identity.signing = {
				format: "openpgp",
				home,
				fingerprint,
				commits: true,
				tags: true,
			};
			const resolved = await resolver.resolve(
				input,
				"openpgp",
				directory,
				"claude",
			);
			git(
				directory,
				["commit", "--allow-empty", "-m", "OpenPGP fixture"],
				resolved.environment,
			);
			git(directory, ["verify-commit", "HEAD"], resolved.environment);
			git(
				directory,
				["tag", "-m", "OpenPGP fixture", "signed-fixture"],
				resolved.environment,
			);
			git(directory, ["verify-tag", "signed-fixture"], resolved.environment);
		} finally {
			execFileSync("gpgconf", ["--homedir", home, "--kill", "gpg-agent"], {
				stdio: "pipe",
			});
		}
	});

	it("keeps simultaneous materializations independent without changing the parent environment", async () => {
		const { directory, resolver, host } = setup();
		const other = new ExecutionEnvironmentResolver(join(directory, "factory"), {
			...host,
			FACTORY_TEST_KEY: "second-fixture-secret",
		});
		const parent = { ...process.env };
		const [first, second] = await Promise.all([
			resolver.resolve(snapshot(), "first", directory, "claude"),
			other.resolve(snapshot(), "second", directory, "claude"),
		]);
		expect(first.environment.HOME).not.toBe(second.environment.HOME);
		expect(first.environment.ANTHROPIC_API_KEY).toBe("fixture-secret-canary");
		expect(second.environment.ANTHROPIC_API_KEY).toBe("second-fixture-secret");
		expect(process.env).toEqual(parent);
	});

	it("replaces whole MCP definitions and removes inherited servers after overlay", async () => {
		const { directory, resolver } = setup();
		const source = join(directory, "mcp.json");
		writeFileSync(
			source,
			JSON.stringify({
				mcpServers: {
					replace: {
						type: "http",
						url: "https://example.test/old",
						headers: { Authorization: "stale" },
					},
					removed: { command: "old" },
				},
			}),
		);
		const input = snapshot();
		input.tools = ToolProfileSchema.parse({
			...tools(),
			mode: "overlay",
			sources: [source],
			mcp: { replace: { type: "stdio", command: "node" } },
			remove: ["removed"],
		});
		const resolved = await resolver.resolve(input, "run2", directory, "claude");
		expect(resolved.mcp).toEqual({
			replace: { type: "stdio", command: "node", args: [], env: {} },
		});
		writeFileSync(
			source,
			JSON.stringify({ mcpServers: { unexpected: { command: "new" } } }),
		);
		expect(
			(await resolver.resolve(input, "run2", directory, "claude")).mcp,
		).toEqual(resolved.mcp);
		expect(JSON.stringify(input)).not.toContain("stale");
		expect(resolved.redact("stale")).toBe("[REDACTED]");
	});
	it("blocks credential changes, missing credentials and unsafe local Git config", async () => {
		const { directory, resolver, host } = setup();
		await resolver.resolve(snapshot(), "run3", directory, "claude");
		const rotated = new ExecutionEnvironmentResolver(
			join(directory, "factory"),
			{ ...host, FACTORY_TEST_KEY: "different-account" },
		);
		await expect(
			rotated.resolve(snapshot(), "run3", directory, "claude"),
		).rejects.toThrow("Credential changed");
		const missing = new ExecutionEnvironmentResolver(
			join(directory, "factory"),
			{ ...host, FACTORY_TEST_KEY: undefined },
		);
		await expect(
			missing.resolve(snapshot(), "run4", directory, "claude"),
		).rejects.toThrow("credential is missing");
		git(directory, ["config", "credential.helper", "osxkeychain"]);
		await expect(
			resolver.resolve(snapshot(), "run5", directory, "claude"),
		).rejects.toThrow("Repository-local Git authentication");
	});
	it("rejects a wrong authenticated provider account without exposing the token", async () => {
		const { directory, resolver } = setup();
		const input = snapshot();
		input.identity.repositories = [
			{
				host: "github.com",
				provider: "github",
				mode: "factory-only",
				account: "expected",
				credential: ref,
			},
		];
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ login: "wrong" }))),
		);
		await expect(
			resolver.resolve(input, "run6", directory, "claude"),
		).rejects.toThrow("does not match the accepted account");
	});
	it("refuses unsupported native relocation and missing runner bindings before materialization", async () => {
		const { directory, resolver } = setup();
		const input = snapshot();
		await expect(
			resolver.resolve(input, "run7", directory, "cursor"),
		).rejects.toThrow("explicit API credential binding");
		const native = { ...input, identity: undefined };
		await expect(
			resolver.resolve(native, "run7", directory, "codex"),
		).rejects.toThrow("Native login-cache relocation is unsupported");
		expect(
			readFileSync(join(directory, ".git", "config"), "utf8"),
		).not.toContain("fixture-secret-canary");
	});
});
