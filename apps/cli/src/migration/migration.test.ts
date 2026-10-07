import * as childProcess from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyMigration,
	inspectMigration,
	restoreMigration,
	writePreview,
} from "./migration.js";
import { canonicalPath } from "./paths.js";
import { transformEnvironment, transformState } from "./transform.js";

const roots: string[] = [];
vi.mock("node:child_process", () => ({ execFileSync: vi.fn(() => "") }));
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(childProcess.execFileSync).mockReturnValue("");
});
afterEach(() => {
	vi.restoreAllMocks();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const root = canonicalPath(mkdtempSync(join(tmpdir(), "factory-migration-")));
	roots.push(root);
	const source = join(root, "old"),
		destination = join(root, "new"),
		backup = join(root, "backup");
	mkdirSync(source, { mode: 0o700 });
	writeFileSync(
		join(source, "config.json"),
		JSON.stringify({
			repositories: [],
			cyrusHome: source,
			linearWorkspaces: { workspace: { linearToken: "private-token" } },
			customPrompt: "Cyrus at ~/.cyrus",
		}),
	);
	writeFileSync(
		join(source, ".env"),
		"CYRUS_LOG_LEVEL=DEBUG\nLINEAR_CLIENT_SECRET=private-secret\n",
		{ mode: 0o600 },
	);
	writeFileSync(join(source, "credentials"), Buffer.from([0, 1, 2, 255]), {
		mode: 0o600,
	});
	symlinkSync("credentials", join(source, "credential-link"));
	return { root, source, destination, backup };
}
describe("migration preservation and recovery", () => {
	it("previews without source mutation or credentials in the manifest", () => {
		const { root, source, destination } = fixture();
		const first = inspectMigration(source, destination);
		writePreview(first, join(root, "preview.json"));
		expect(inspectMigration(source, destination)).toEqual(first);
		expect(existsSync(destination)).toBe(false);
		expect(JSON.stringify(first)).not.toMatch(/private-token|private-secret/);
	});
	it("backs up bytes, preserves credentials/modes/links, applies once and retains changed destination on recovery", () => {
		const { source, destination, backup } = fixture();
		const manifest = inspectMigration(source, destination);
		const original = readFileSync(join(source, "config.json"));
		expect(applyMigration(manifest, backup).status).toBe("applied");
		expect(readFileSync(join(backup, "source/config.json"))).toEqual(original);
		expect(readFileSync(join(source, "config.json"))).toEqual(original);
		const config = JSON.parse(
			readFileSync(join(destination, "config.json"), "utf8"),
		);
		expect(config.factoryHome).toBe(destination);
		expect(config.linearWorkspaces.workspace.linearToken).toBe("private-token");
		expect(config.customPrompt).toBe("Cyrus at ~/.cyrus");
		expect(readFileSync(join(destination, "credential-link"))).toEqual(
			Buffer.from([0, 1, 2, 255]),
		);
		expect(statSync(join(destination, ".env")).mode & 0o777).toBe(0o600);
		expect(applyMigration(manifest, backup).status).toBe("already-applied");
		writeFileSync(join(destination, "new-run"), "retain this");
		expect(() => applyMigration(manifest, backup)).toThrow(/changed/);
		expect(restoreMigration(backup).status).toBe("restored");
		expect(
			readFileSync(join(backup, "destination-recovery/new-run"), "utf8"),
		).toBe("retain this");
		expect(existsSync(destination)).toBe(false);
	});
	it("refuses destination conflicts, changed previews, corrupt state and env collisions before backup", () => {
		const { source, destination, backup } = fixture();
		const manifest = inspectMigration(source, destination);
		mkdirSync(destination);
		expect(() => applyMigration(manifest, backup)).toThrow(/Destination/);
		expect(existsSync(backup)).toBe(false);
		rmSync(destination, { recursive: true });
		chmodSync(join(source, "credentials"), 0o644);
		expect(() => applyMigration(manifest, backup)).toThrow(/changed/);
		writeFileSync(join(source, ".env"), "CYRUS_HOME=a\nBOBS_FACTORY_HOME=b\n");
		expect(inspectMigration(source, destination).blockers).toContain(
			"Invalid or conflicting structured state: .env",
		);
		mkdirSync(join(source, "state"));
		writeFileSync(
			join(source, "state/edge-worker-state.json"),
			'{"version":"99.0"}',
		);
		expect(inspectMigration(source, destination).blockers).toContain(
			"Unsupported worker persistence version",
		);
	});
	it("blocks active consumers, hosted enrollment and unverified native continuation", () => {
		const { source, destination } = fixture();
		vi.mocked(childProcess.execFileSync).mockReturnValue(
			"9999 /usr/bin/cyrus start\n",
		);
		writeFileSync(join(source, ".env"), "CYRUS_API_KEY=keep-private\n");
		mkdirSync(join(source, "state"));
		writeFileSync(
			join(source, "state/edge-worker-state.json"),
			'{"version":"4.0","state":{"claudeSessionId":"keep-session"}}',
		);
		const manifest = inspectMigration(source, destination);
		expect(manifest.blockers).toHaveLength(3);
		expect(JSON.stringify(manifest)).not.toContain("keep-private");
	});
	it("refuses worktree relocation before any backup or external Git metadata mutation", () => {
		const { source, destination, backup } = fixture();
		const worktree = join(source, "worktrees", "issue");
		mkdirSync(worktree, { recursive: true });
		writeFileSync(
			join(worktree, ".git"),
			"gitdir: /external/repo/.git/worktrees/issue\n",
		);
		const manifest = inspectMigration(source, destination);
		expect(() => applyMigration(manifest, backup)).toThrow(
			/Git metadata backup/,
		);
		expect(existsSync(backup)).toBe(false);
		expect(
			vi
				.mocked(childProcess.execFileSync)
				.mock.calls.every(
					([, args]) => !Array.isArray(args) || !args.includes("repair"),
				),
		).toBe(true);
	});
});
it("changes only structured operational fields and refuses ambiguous env keys", () => {
	expect(
		transformState(
			{
				path: "/old/worktree",
				prompt: "/old/worktree",
				token: "cyrus-tools",
				allowedTools: ["mcp__cyrus-tools__example"],
			},
			"/old",
			"/new",
		),
	).toEqual({
		path: "/new/worktree",
		prompt: "/old/worktree",
		token: "cyrus-tools",
		allowedTools: ["mcp__bobs-factory-tools__example"],
	});
	expect(() =>
		transformEnvironment("CYRUS_HOME=a\nBOBS_FACTORY_HOME=a\n"),
	).toThrow(/collision/);
});
it("migrates exact server-wide allow/deny permissions without matching other servers", () => {
	expect(
		transformState(
			{
				allowedTools: [
					"mcp__cyrus-tools",
					"mcp__cyrus-tools__get_child_issues",
					"mcp__cyrus-tools-other",
				],
				disallowedTools: ["mcp__cyrus-tools", "mcp__cyrus-tools__delete"],
			},
			"/old",
			"/new",
		),
	).toEqual({
		allowedTools: [
			"mcp__bobs-factory-tools",
			"mcp__bobs-factory-tools__get_child_issues",
			"mcp__cyrus-tools-other",
		],
		disallowedTools: [
			"mcp__bobs-factory-tools",
			"mcp__bobs-factory-tools__delete",
		],
	});
});

it("reconciles referenced MCP files while preserving credentials, custom servers and backups", () => {
	const { source, destination, backup } = fixture();
	mkdirSync(join(source, "mcp-configs"));
	const original = {
		mcpServers: {
			"cyrus-tools": {
				type: "http",
				url: "http://localhost:3456/mcp/cyrus-tools?context=keep",
				headers: { Authorization: "secret cyrus-tools" },
			},
			custom: {
				command: "custom",
				env: { CYRUS_TOKEN: "unchanged" },
				args: ["cyrus-tools"],
			},
		},
	};
	writeFileSync(
		join(source, "mcp-configs/linear.json"),
		JSON.stringify(original),
		{ mode: 0o600 },
	);
	const config = JSON.parse(readFileSync(join(source, "config.json"), "utf8"));
	config.linearMcpConfigs = [join(source, "mcp-configs/linear.json")];
	writeFileSync(join(source, "config.json"), JSON.stringify(config));
	const manifest = inspectMigration(source, destination);
	expect(manifest.blockers).toEqual([]);
	applyMigration(manifest, backup);
	expect(
		JSON.parse(
			readFileSync(join(destination, "mcp-configs/linear.json"), "utf8"),
		),
	).toEqual({
		mcpServers: {
			"bobs-factory-tools": {
				...original.mcpServers["cyrus-tools"],
				url: "http://localhost:3456/mcp/bobs-factory-tools?context=keep",
			},
			custom: original.mcpServers.custom,
		},
	});
	expect(readFileSync(join(backup, "source/mcp-configs/linear.json"))).toEqual(
		readFileSync(join(source, "mcp-configs/linear.json")),
	);
	expect(
		statSync(join(destination, "mcp-configs/linear.json")).mode & 0o777,
	).toBe(0o600);
	expect(
		JSON.parse(readFileSync(join(destination, "config.json"), "utf8"))
			.linearMcpConfigs,
	).toEqual([join(destination, "mcp-configs/linear.json")]);
});

it("blocks external MCP reconciliation and owned server collisions before backup", () => {
	const { root, source, destination, backup } = fixture();
	const external = join(root, "external.json");
	writeFileSync(
		external,
		JSON.stringify({
			mcpServers: {
				"cyrus-tools": { url: "http://localhost/mcp/cyrus-tools" },
			},
		}),
	);
	const config = JSON.parse(readFileSync(join(source, "config.json"), "utf8"));
	config.githubMcpConfigs = [external];
	writeFileSync(join(source, "config.json"), JSON.stringify(config));
	expect(() =>
		applyMigration(inspectMigration(source, destination), backup),
	).toThrow(/MCP configuration/);
	expect(existsSync(backup)).toBe(false);
	delete config.githubMcpConfigs;
	writeFileSync(join(source, "config.json"), JSON.stringify(config));
	mkdirSync(join(source, "mcp-configs"));
	writeFileSync(
		join(source, "mcp-configs/collision.json"),
		JSON.stringify({
			mcpServers: { "cyrus-tools": {}, "bobs-factory-tools": {} },
		}),
	);
	expect(() =>
		applyMigration(inspectMigration(source, destination), backup),
	).toThrow(/Invalid or conflicting structured state/);
	expect(existsSync(backup)).toBe(false);
});

it("migrates saved and frozen workflow tool steps, including nested definitions, while preserving gates and history", () => {
	const { source, destination, backup } = fixture();
	mkdirSync(join(source, "factory/runs"), { recursive: true });
	const workflow = {
		id: "custom",
		name: "Custom Cyrus",
		steps: [
			{
				id: "call",
				type: "tool",
				tool: "mcp__cyrus-tools__get_child_issues",
				arguments: { prompt: "mcp__cyrus-tools__get_child_issues" },
			},
			{
				id: "parallel",
				type: "fanout",
				groups: [
					[
						{
							id: "nested",
							type: "tool",
							tool: "mcp__cyrus-tools__get_child_issues",
						},
					],
				],
			},
			{
				id: "ask",
				type: "agent",
				prompt: "Use mcp__cyrus-tools__get_child_issues",
			},
		],
	};
	const run = {
		id: "run",
		workflow,
		workflowDefinitions: [workflow],
		history: [{ workflow, allowedTools: ["mcp__cyrus-tools"], path: source }],
		checkpoint: { status: "waiting", step: "ask" },
		humanDecisions: [],
		outputs: { receipt: { tool: "mcp__cyrus-tools__get_child_issues" } },
	};
	writeFileSync(
		join(source, "factory/workflows.json"),
		JSON.stringify({ workflows: [workflow], defaultWorkflow: "custom" }),
	);
	writeFileSync(join(source, "factory/runs/run.json"), JSON.stringify(run));
	applyMigration(inspectMigration(source, destination), backup);
	const expected = {
		...workflow,
		steps: [
			{
				...workflow.steps[0],
				tool: "mcp__bobs-factory-tools__get_child_issues",
			},
			{
				...workflow.steps[1],
				groups: [
					[
						{
							id: "nested",
							type: "tool",
							tool: "mcp__bobs-factory-tools__get_child_issues",
						},
					],
				],
			},
			workflow.steps[2],
		],
	};
	expect(
		JSON.parse(
			readFileSync(join(destination, "factory/workflows.json"), "utf8"),
		),
	).toEqual({ workflows: [expected], defaultWorkflow: "custom" });
	expect(
		JSON.parse(
			readFileSync(join(destination, "factory/runs/run.json"), "utf8"),
		),
	).toEqual({ ...run, workflow: expected, workflowDefinitions: [expected] });
});
it("relocates owned environment paths while keeping secret values and comments", () => {
	expect(
		transformEnvironment(
			"CYRUS_HOME='/old' # state\nCYRUS_WORKTREES_DIR=\"/old/worktrees\"\nCYRUS_TOKEN=/old/secret\n",
			"/old",
			"/new",
		),
	).toBe(
		"BOBS_FACTORY_HOME='/new' # state\nBOBS_FACTORY_WORKTREES_DIR=\"/new/worktrees\"\nBOBS_FACTORY_TOKEN=/old/secret\n",
	);
	expect(() =>
		transformEnvironment("CYRUS_HOME=/old\n", "/old", "/new home"),
	).toThrow(/quotes/);
});
it("moves the recognized stock plugin while retaining customized skill bytes", () => {
	const { source, destination, backup } = fixture();
	mkdirSync(join(source, "cyrus-skills-plugin/.claude-plugin"), {
		recursive: true,
	});
	mkdirSync(join(source, "cyrus-skills-plugin/skills/custom"), {
		recursive: true,
	});
	writeFileSync(
		join(source, "cyrus-skills-plugin/.claude-plugin/plugin.json"),
		JSON.stringify({ name: "cyrus-skills", description: "custom description" }),
	);
	const text = "Customized Cyrus prompt with /old paths\n";
	writeFileSync(
		join(source, "cyrus-skills-plugin/skills/custom/SKILL.md"),
		text,
	);
	const config = JSON.parse(readFileSync(join(source, "config.json"), "utf8"));
	config.plugins = [{ path: join(source, "cyrus-skills-plugin") }];
	writeFileSync(join(source, "config.json"), JSON.stringify(config));
	applyMigration(inspectMigration(source, destination), backup);
	expect(
		readFileSync(
			join(destination, "bobs-factory-skills-plugin/skills/custom/SKILL.md"),
			"utf8",
		),
	).toBe(text);
	expect(
		JSON.parse(
			readFileSync(
				join(
					destination,
					"bobs-factory-skills-plugin/.claude-plugin/plugin.json",
				),
				"utf8",
			),
		),
	).toEqual({ name: "bobs-factory-skills", description: "custom description" });
	expect(
		JSON.parse(readFileSync(join(destination, "config.json"), "utf8"))
			.plugins[0].path,
	).toBe(join(destination, "bobs-factory-skills-plugin"));
	expect(existsSync(join(source, "cyrus-skills-plugin"))).toBe(true);
});
it("distinguishes participating workers from unrelated explicit homes and shell text", () => {
	const { source, destination } = fixture();
	vi.mocked(childProcess.execFileSync).mockReturnValue(
		"9999 bobs-factory start --home /unrelated\n9998 /bin/sh -c echo cyrus\n",
	);
	expect(inspectMigration(source, destination).blockers).toEqual([]);
	vi.mocked(childProcess.execFileSync).mockReturnValue(
		`9999 bobs-factory start --home ${source}\n`,
	);
	expect(inspectMigration(source, destination).blockers).toContain(
		"A worker or agent may still be running; disable intake, drain and verify descendants before apply",
	);
});
it("resolves process homes without exposing environment secrets and blocks ambiguous homes", () => {
	const { source, destination } = fixture();
	const command = "9999 node /repo/apps/cli/dist/src/app.js";
	vi.mocked(childProcess.execFileSync).mockImplementation((_file, args) =>
		Array.isArray(args) && args.includes("eww")
			? "node /repo/apps/cli/dist/src/app.js HOME=/unrelated SECRET=private-secret"
			: command,
	);
	expect(inspectMigration(source, destination).blockers).toEqual([]);
	vi.mocked(childProcess.execFileSync).mockImplementation((_file, args) =>
		Array.isArray(args) && args.includes("eww")
			? `node /repo/apps/cli/dist/src/app.js HOME=/unrelated BOBS_FACTORY_HOME=${source} SECRET=private-secret`
			: command,
	);
	const manifest = inspectMigration(source, destination);
	expect(manifest.blockers).toContain(
		"A worker or agent may still be running; disable intake, drain and verify descendants before apply",
	);
	expect(JSON.stringify(manifest)).not.toContain("private-secret");
	vi.mocked(childProcess.execFileSync).mockImplementation((_file, args) =>
		Array.isArray(args) && args.includes("eww")
			? "node /repo/apps/cli/dist/src/app.js BOBS_FACTORY_HOME=/path with spaces HOME=/unrelated"
			: command,
	);
	expect(inspectMigration(source, destination).blockers).toContain(
		"A worker or agent may still be running; disable intake, drain and verify descendants before apply",
	);
});
