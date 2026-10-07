import { createHash } from "node:crypto";
import {
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
import { afterEach, expect, it, vi } from "vitest";
import {
	applyMigration,
	inspectMigration,
	restoreMigration,
} from "./migration.js";
import { canonicalPath } from "./paths.js";
import { PreservationPlanSchema } from "./preservation.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn(() => "") }));
const roots: string[] = [];
afterEach(() => {
	for (const path of roots.splice(0))
		rmSync(path, { recursive: true, force: true });
});
function fixture() {
	const root = canonicalPath(
		mkdtempSync(join(tmpdir(), "factory-native-migrate-")),
	);
	roots.push(root);
	const source = join(root, "old"),
		destination = join(root, "new"),
		backup = join(root, "backup"),
		native = join(root, "native"),
		nativeDestination = join(root, "native-relocated");
	for (const directory of [
		join(source, "state"),
		join(source, "workspace"),
		native,
	])
		mkdirSync(directory, { recursive: true, mode: 0o700 });
	writeFileSync(
		join(native, "conversation.jsonl"),
		'{"assistant":"remember this"}\n',
		{ mode: 0o600 },
	);
	const service = join(root, "service.plist");
	writeFileSync(service, "old service", { mode: 0o600 });
	const evidencePath = join(root, "continuation.json");
	const evidence = JSON.stringify({
		runner: "claude",
		sessionId: "native-id",
		originalWorkspace: join(source, "workspace"),
		relocatedWorkspace: join(destination, "workspace"),
		verifiedAt: new Date().toISOString(),
		command: "fixture continuation",
		outcome: "passed",
	});
	writeFileSync(evidencePath, evidence);
	writeFileSync(
		join(source, "config.json"),
		JSON.stringify({ repositories: [], cyrusHome: source }),
	);
	writeFileSync(
		join(source, "state/edge-worker-state.json"),
		JSON.stringify({
			version: "4.0",
			state: {
				agentSessions: {
					waiting: {
						workspace: { path: join(source, "workspace") },
						claudeSessionId: "native-id",
						status: "waiting",
						metadata: { ticketSync: { delivered: true } },
					},
				},
				agentSessionEntries: { waiting: [{ content: "Cyrus at old home" }] },
			},
		}),
	);
	const workflow = { id: "factory", name: "Custom Cyrus recipe", nodes: [] };
	mkdirSync(join(source, "factory/runs"), { recursive: true });
	writeFileSync(
		join(source, "factory/runs/run.json"),
		JSON.stringify({
			id: "run",
			workspace: join(source, "workspace"),
			workflow,
			status: "waiting",
			history: [{ step: "completed", output: "Cyrus" }],
			checkpoint: { agent: { runner: "claude", sessionId: "native-id" } },
			reviewGate: { approved: false },
			ticketSync: { stage: "in_progress", delivered: true },
		}),
	);
	const plan = PreservationPlanSchema.parse({
		version: 1,
		backupPaths: [service],
		restorePaths: [service],
		nativeCopies: [{ source: native, destination: nativeDestination }],
		continuations: [
			{
				runner: "claude",
				sessionId: "native-id",
				workspace: join(source, "workspace"),
				evidencePath,
				evidenceSha256: createHash("sha256").update(evidence).digest("hex"),
			},
		],
	});
	return {
		source,
		destination,
		backup,
		native,
		nativeDestination,
		service,
		plan,
		workflow,
		evidencePath,
	};
}
it("requires verified matching continuation records for worker and factory checkpoints", () => {
	const f = fixture();
	expect(inspectMigration(f.source, f.destination).blockers).toContain(
		"Native agent conversation relocation needs an agent-verified continuation mapping before apply",
	);
	writeFileSync(f.evidencePath, "changed proof");
	expect(inspectMigration(f.source, f.destination, f.plan).blockers).toContain(
		"Native continuation evidence changed",
	);
});
it("preserves native transcripts, waiting gates and ticket receipts, and restores backed-up service definitions", () => {
	const f = fixture();
	const manifest = inspectMigration(f.source, f.destination, f.plan);
	expect(manifest.blockers).toEqual([]);
	expect(applyMigration(manifest, f.backup).status).toBe("applied");
	expect(readFileSync(join(f.nativeDestination, "conversation.jsonl"))).toEqual(
		readFileSync(join(f.native, "conversation.jsonl")),
	);
	expect(
		statSync(join(f.nativeDestination, "conversation.jsonl")).mode & 0o777,
	).toBe(0o600);
	const run = JSON.parse(
		readFileSync(join(f.destination, "factory/runs/run.json"), "utf8"),
	);
	expect(run).toMatchObject({
		workspace: join(f.destination, "workspace"),
		status: "waiting",
		workflow: f.workflow,
		history: [{ step: "completed", output: "Cyrus" }],
		checkpoint: { agent: { sessionId: "native-id" } },
		reviewGate: { approved: false },
		ticketSync: { stage: "in_progress", delivered: true },
	});
	writeFileSync(f.service, "new service");
	writeFileSync(
		join(f.nativeDestination, "new.jsonl"),
		"keep new conversation",
	);
	expect(restoreMigration(f.backup).status).toBe("restored");
	expect(readFileSync(f.service, "utf8")).toBe("old service");
	expect(
		readFileSync(join(f.backup, "native-recovery/0/new.jsonl"), "utf8"),
	).toBe("keep new conversation");
	expect(readFileSync(join(f.native, "conversation.jsonl"), "utf8")).toContain(
		"remember this",
	);
});
it("refuses credential copies and native destination collisions before mutation", () => {
	const f = fixture();
	writeFileSync(join(f.native, "auth.json"), "private credential");
	const manifest = inspectMigration(f.source, f.destination, f.plan);
	expect(manifest.blockers).toContain(
		"Native transcript copy includes host credentials; select conversation data only",
	);
	expect(JSON.stringify(manifest)).not.toContain("private credential");
	expect(() => applyMigration(manifest, f.backup)).toThrow();
	rmSync(join(f.native, "auth.json"));
	mkdirSync(f.nativeDestination);
	expect(inspectMigration(f.source, f.destination, f.plan).blockers).toContain(
		"Native transcript destination already exists",
	);
});
it("preserves queued coordinator order and refuses executing leases before mutation", () => {
	const f = fixture();
	mkdirSync(join(f.source, "machine-capacity"));
	const path = join(f.source, "machine-capacity/state.json");
	const alias = join(f.source, "..", "source-alias");
	symlinkSync(f.source, alias);
	const requests = [
		{
			id: "first",
			token: "first-token",
			owner: { pid: 999991, start: "fixture-owner", incarnation: "fixture" },
			queuedAt: "2026-10-07T00:00:00Z",
			background: false,
			parked: true,
			recoverable: true,
			remote: false,
			phase: "queued",
			identity: `${f.source}/factory:run:first:leaf:1`,
			sequence: 9,
		},
		{
			id: "second",
			token: "second-token",
			owner: { pid: 999991, start: "fixture-owner", incarnation: "fixture" },
			queuedAt: "2026-10-07T00:00:01Z",
			background: true,
			parked: true,
			recoverable: true,
			remote: false,
			phase: "queued",
			identity: `${alias}:session:second`,
			sequence: 10,
		},
	];
	writeFileSync(
		path,
		JSON.stringify({ version: 1, limit: 4, sequence: 10, bypass: 0, requests }),
	);
	const manifest = inspectMigration(f.source, f.destination, f.plan);
	expect(manifest.blockers).toEqual([]);
	applyMigration(manifest, f.backup);
	expect(
		JSON.parse(
			readFileSync(join(f.destination, "machine-capacity/state.json"), "utf8"),
		).requests,
	).toEqual(
		requests.map((r) => ({
			...r,
			identity:
				r.id === "first"
					? `${f.destination}/factory:run:first:leaf:1`
					: `${f.destination}:session:second`,
		})),
	);
	restoreMigration(f.backup);
	writeFileSync(
		path,
		JSON.stringify({
			version: 1,
			limit: 4,
			sequence: 10,
			bypass: 0,
			requests: [{ ...requests[0], parked: false, phase: "executing" }],
		}),
	);
	expect(inspectMigration(f.source, f.destination, f.plan).blockers).toContain(
		"Coordinator contains executing or stopping leases; drain through the existing worker first",
	);
});

it("rejects incomplete coordinator state before creating a destination or backup", () => {
	const f = fixture();
	mkdirSync(join(f.source, "machine-capacity"));
	const path = join(f.source, "machine-capacity/state.json");
	const bytes = JSON.stringify({ version: 1, requests: [] });
	writeFileSync(path, bytes);
	const manifest = inspectMigration(f.source, f.destination, f.plan);
	expect(manifest.blockers).toContain("Unknown coordinator state format");
	expect(() => applyMigration(manifest, f.backup)).toThrow();
	expect(readFileSync(path, "utf8")).toBe(bytes);
	expect(existsSync(f.destination)).toBe(false);
	expect(existsSync(f.backup)).toBe(false);
});

it("keeps an unapproved human review at its original revision and waiting checkpoint", () => {
	const f = fixture();
	const run = {
		id: "review-run",
		workspace: join(f.source, "workspace"),
		status: "waiting",
		workflow: {
			id: "review-probe",
			name: "Custom Cyrus review",
			steps: [
				{
					id: "human-review",
					name: "Review",
					type: "tool",
					tool: "human-review",
					args: [],
					branches: [],
					maxVisits: 100,
				},
			],
		},
		history: [
			{
				step: "guide",
				output: { headSha: "a".repeat(40), summary: "Cyrus review" },
			},
		],
		outputs: {
			"human-review": {
				headSha: "a".repeat(40),
				url: "https://example.invalid/pr/1",
			},
		},
		checkpoint: {
			current: "human-review",
			visits: { guide: 1, "human-review": 1 },
			active: { phase: "waiting" },
		},
		reviewGate: { id: "original-gate", headSha: "a".repeat(40) },
		humanDecisions: [],
		ticketSync: {
			receipts: [{ key: "guide", delivered: true }],
			lastStatus: "in_review",
		},
	};
	writeFileSync(
		join(f.source, "factory/runs/review.json"),
		JSON.stringify(run),
	);
	applyMigration(inspectMigration(f.source, f.destination, f.plan), f.backup);
	expect(
		JSON.parse(
			readFileSync(join(f.destination, "factory/runs/review.json"), "utf8"),
		),
	).toEqual({ ...run, workspace: join(f.destination, "workspace") });
});
