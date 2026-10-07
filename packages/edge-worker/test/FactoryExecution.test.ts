import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ExecutionEnvironmentResolver } from "../src/factory/ExecutionEnvironment.js";
import {
	ExecutionProfileStore,
	IdentityProfileSchema,
	ToolProfileSchema,
} from "../src/factory/ExecutionProfiles.js";
import { FactoryServer } from "../src/factory/FactoryServer.js";
import { executeCommand } from "../src/factory/FactoryTools.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";

const directories: string[] = [];
afterEach(() => {
	for (const path of directories.splice(0))
		rmSync(path, { recursive: true, force: true });
});
const fixture = () => {
	const home = mkdtempSync(join(tmpdir(), "factory-execution-"));
	directories.push(home);
	execFileSync("git", ["init", "-q", home]);
	const ref = {
		source: "env" as const,
		name: "SELECTED_API_KEY",
		version: "v1",
		owner: "declared test owner",
	};
	const identity = IdentityProfileSchema.parse({
		id: "bob",
		revision: 1,
		name: "Bob",
		author: {
			mode: "factory-only",
			value: { name: "Bob author", email: "author@example.test" },
		},
		committer: {
			mode: "factory-only",
			value: { name: "Bob committer", email: "committer@example.test" },
		},
		signing: { format: "disabled" },
		repositories: [],
		runners: {
			claude: { mode: "factory-only", provider: "anthropic", credential: ref },
			codex: { mode: "share", provider: "openai", credential: ref },
			cursor: { mode: "factory-only", provider: "cursor", credential: ref },
			gemini: { mode: "factory-only", provider: "google", credential: ref },
			opencode: { mode: "factory-only", provider: "openai", credential: ref },
		},
	});
	const tools = ToolProfileSchema.parse({
		id: "private",
		revision: 1,
		name: "Private",
		mode: "factory-only",
		remove: ["removed"],
		mcp: { selected: { type: "stdio", command: "node" } },
	});
	const store = new ExecutionProfileStore(join(home, "factory"));
	store.save(
		{
			schemaVersion: 1,
			revision: 0,
			identities: [identity],
			tools: [tools],
			defaults: { identityProfile: "bob", toolProfile: "private" },
			repositories: {},
		},
		0,
	);
	const resolver = new ExecutionEnvironmentResolver(join(home, "factory"), {
		PATH: process.env.PATH,
		HOME: home,
		SELECTED_API_KEY: "private-canary-secret",
		GH_TOKEN: "ambient-account",
		GIT_AUTHOR_NAME: "Host author",
		GIT_AUTHOR_EMAIL: "host@example.test",
		GIT_COMMITTER_NAME: "Host committer",
		GIT_COMMITTER_EMAIL: "host-committer@example.test",
	});
	return { home, identity, tools, store, resolver };
};

it("freezes profile definitions across deletion and restart, passing only a private environment to commands", async () => {
	const { home, store, resolver } = fixture();
	const workflow = WorkflowSchema.parse({
		id: "probe",
		name: "Probe",
		allowedTriggers: ["manual"],
		steps: [{ id: "probe", name: "Probe", type: "script", script: "unused" }],
	});
	const { MachineCapacity } = await import("../src/MachineCapacity.js");
	const capacity = new MachineCapacity(1, join(home, "capacity"));
	const hooks = {
		capacity,
		agent: async () => ({}),
		tool: async () => ({}),
		execution: (run: any) =>
			resolver.resolve(run.executionSnapshot, run.id, home, "claude"),
		script: async (context: any) => ({
			leased: (await capacity.snapshot()).active === 1,
			stdout: await executeCommand(context, process.execPath, [
				"-e",
				"process.stdout.write(process.env.ANTHROPIC_API_KEY.slice(0,8));setTimeout(()=>process.stdout.write(process.env.ANTHROPIC_API_KEY.slice(8)+'|'+process.env.GIT_AUTHOR_NAME+'|'+String(process.env.GH_TOKEN)),20)",
			]),
		}),
	};
	const runtime = new WorkflowRuntime(home, hooks);
	const run = runtime.create({
		id: "accepted",
		repositoryId: "repo",
		workflow,
		workspace: home,
		input: "probe",
		triggerOrigin: {
			type: "manual",
			workflowId: "probe",
			at: new Date().toISOString(),
		},
	});
	store.save(
		{
			schemaVersion: 1,
			revision: 1,
			identities: [],
			tools: [],
			defaults: {},
			repositories: {},
		},
		1,
	);
	await runtime.launch(run);
	expect(run.status).toBe("completed");
	expect((await capacity.snapshot()).active).toBe(0);
	expect(run.outputs.probe).toEqual({
		leased: true,
		stdout: "[REDACTED]|Bob author|undefined",
	});
	expect(
		readFileSync(join(home, "factory", "runs", "accepted.json"), "utf8"),
	).not.toContain("private-canary-secret");
	const restored = new WorkflowRuntime(home, hooks).get("accepted");
	expect(restored.executionSnapshot?.identity?.id).toBe("bob");
	expect(
		(
			await resolver.resolve(
				restored.executionSnapshot!,
				restored.id,
				home,
				"claude",
			)
		).environment.GIT_COMMITTER_NAME,
	).toBe("Bob committer");
});

it.each([
	"claude",
	"codex",
	"opencode",
	"cursor",
	"gemini",
] as const)("supports both crossed policies for %s without adopting native project MCP", async (runner) => {
	const { home, store, resolver } = fixture();
	const hostSource = join(home, "host-mcp.json");
	writeFileSync(
		hostSource,
		JSON.stringify({
			mcpServers: { shared: { command: "node" }, removed: { command: "node" } },
		}),
	);
	const selected = store.select("repo")!;
	selected.tools = ToolProfileSchema.parse({
		...selected.tools,
		mode: "share",
		sources: [hostSource],
	});
	selected.identity!.runners[runner]!.mode = "factory-only";
	const first = await resolver.resolve(
		selected,
		"crossed",
		home,
		runner,
		"first",
	);
	expect(Object.keys(first.mcp)).toEqual(["shared", "selected"]);
	selected.identity!.author = { mode: "share" };
	selected.identity!.committer = { mode: "share" };
	selected.identity!.signing = { format: "share" };
	selected.identity!.runners[runner]!.mode = "share";
	selected.tools = ToolProfileSchema.parse({
		...selected.tools,
		mode: "factory-only",
		sources: [],
	});
	const second = await resolver.resolve(
		selected,
		"crossed",
		home,
		runner,
		"second",
	);
	expect(second.environment.GIT_AUTHOR_NAME).toBe("Host author");
	expect(Object.keys(second.mcp)).toEqual(["selected"]);
	expect(first.environment.HOME).not.toBe(second.environment.HOME);
	const selectedKey = {
		claude: "ANTHROPIC_API_KEY",
		codex: "OPENAI_API_KEY",
		opencode: "OPENAI_API_KEY",
		cursor: "CURSOR_API_KEY",
		gemini: "GEMINI_API_KEY",
	}[runner];
	expect(first.environment[selectedKey]).toBe("private-canary-secret");
	expect(second.environment[selectedKey]).toBe("private-canary-secret");
	for (const key of [
		"ANTHROPIC_API_KEY",
		"OPENAI_API_KEY",
		"CURSOR_API_KEY",
		"GEMINI_API_KEY",
	]) {
		if (key === selectedKey) continue;
		expect(first.environment[key]).toBeUndefined();
		expect(second.environment[key]).toBeUndefined();
	}
	writeFileSync(
		join(home, ".mcp.json"),
		JSON.stringify({ mcpServers: { removed: { command: "node" } } }),
	);
	const config = {
		cyrusHome: home,
		mcpConfigPath: join(home, ".mcp.json"),
		additionalEnv: { CYRUS_GH_TOKEN: "unselected" },
	};
	resolver.apply(config, selected, second);
	expect(config).toMatchObject({
		mcpConfig: { selected: { type: "stdio", command: "node" } },
		childEnvironment: { HOME: second.environment.HOME },
	});
	expect(config.additionalEnv).toBeUndefined();
});

it("keeps ordinary setting overlays separate and reuses a private source snapshot on recovery", async () => {
	const { home, store, resolver } = fixture();
	const source = join(home, "ordinary.json");
	writeFileSync(
		source,
		'{"attribution":{"commit":"host"},"language":"English"}',
	);
	const snapshot = store.select("repo")!;
	snapshot.tools = ToolProfileSchema.parse({
		...snapshot.tools,
		mode: "overlay",
		runnerSettingsSources: { claude: [source] },
		runnerSettings: { claude: { attribution: { pr: "factory" } } },
	});
	const initial = await resolver.resolve(snapshot, "ordinary", home, "claude");
	writeFileSync(source, '{"language":"Changed after admission"}');
	const restored = await resolver.resolve(snapshot, "ordinary", home, "claude");
	expect(restored.settings).toEqual({
		language: "English",
		attribution: { commit: "host", pr: "factory" },
	});
	expect(initial.environment.ANTHROPIC_API_KEY).toBe(
		restored.environment.ANTHROPIC_API_KEY,
	);
	expect(() =>
		ToolProfileSchema.parse({
			...snapshot.tools,
			runnerSettings: { claude: { apiKeyHelper: "unapproved" } },
		}),
	).toThrow("does not support imported setting");
});

it("serves reference-only definitions and rejects stale API saves and literal secrets without discarding edits", async () => {
	const { home, store } = fixture();
	const runtime = new WorkflowRuntime(home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const server = new FactoryServer(runtime, {
		repositories: () => [{ id: "repo", name: "Repo" }],
		sessions: () => [],
		entries: () => [],
		start: async () => {
			throw new Error("Unused");
		},
		stop: () => {},
	});
	try {
		const before = (
			await server.app.inject({
				url: "/api/config",
				headers: { host: "localhost" },
			})
		).json();
		expect(
			before.executionProfiles.identities[0].runners.claude.credential.name,
		).toBe("SELECTED_API_KEY");
		const headers = { host: "localhost", "x-factory-request": "1" };
		const profiles = store.read();
		const save = () =>
			server.app.inject({
				method: "PUT",
				url: "/api/execution-profiles",
				headers,
				payload: { profiles, expectedRevision: 1 },
			});
		const responses = await Promise.all([save(), save()]);
		expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
		const current = store.read();
		current.tools[0]!.mcp = {
			bad: {
				type: "stdio",
				command: "node",
				args: [],
				env: { API_KEY: { literal: "leaked-secret" } },
			},
		};
		const rejected = await server.app.inject({
			method: "PUT",
			url: "/api/execution-profiles",
			headers,
			payload: { profiles: current, expectedRevision: 2 },
		});
		expect(rejected.statusCode).toBe(400);
		expect(rejected.body).not.toContain("leaked-secret");
		expect(store.read().revision).toBe(2);
		expect(
			existsSync(join(home, "factory", "execution-profiles.json.lock")),
		).toBe(false);
	} finally {
		await server.stop();
	}
});

it("removes generated auth caches while preserving accepted bindings and resume state", async () => {
	const { home, store, resolver } = fixture();
	const snapshot = store.select("repo")!;
	const context = await resolver.resolve(snapshot, "cleanup", home, "codex");
	const auth = join(context.environment.CODEX_HOME!, "auth.json");
	const state = join(context.environment.CODEX_HOME!, "resume.json");
	writeFileSync(
		auth,
		JSON.stringify({ OPENAI_API_KEY: "private-canary-secret" }),
		{ mode: 0o600 },
	);
	writeFileSync(state, '{"thread":"saved"}', { mode: 0o600 });
	resolver.cleanupCredentials("cleanup");
	expect(existsSync(auth)).toBe(false);
	expect(existsSync(state)).toBe(true);
	expect(
		(await resolver.resolve(snapshot, "cleanup", home, "codex")).environment
			.OPENAI_API_KEY,
	).toBe("private-canary-secret");
});

it("materializes provider-native API auth and keeps Claude setup tokens separate from API keys", async () => {
	const { home, store, resolver } = fixture();
	const snapshot = store.select("repo")!;
	const codex = await resolver.resolve(snapshot, "native-auth", home, "codex");
	expect(
		JSON.parse(
			readFileSync(join(codex.environment.CODEX_HOME!, "auth.json"), "utf8"),
		),
	).toEqual({ auth_mode: "apikey", OPENAI_API_KEY: "private-canary-secret" });
	snapshot.identity!.runners.claude!.kind = "setup-token";
	const claude = await resolver.resolve(
		snapshot,
		"setup-token",
		home,
		"claude",
	);
	expect(claude.environment.CLAUDE_CODE_OAUTH_TOKEN).toBe(
		"private-canary-secret",
	);
	expect(claude.environment.ANTHROPIC_API_KEY).toBeUndefined();
	snapshot.identity!.runners.codex!.kind = "setup-token";
	await expect(
		resolver.resolve(snapshot, "bad-token", home, "codex"),
	).rejects.toThrow("supported only for Claude");
});
