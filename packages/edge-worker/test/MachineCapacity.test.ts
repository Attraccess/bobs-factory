import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import {
	assertLegacyCapacityDrained,
	MachineCapacity,
} from "../src/MachineCapacity.js";

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
	for (const child of children.splice(0)) child.kill();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
const root = () => {
	const directory = mkdtempSync(join(tmpdir(), "capacity-test-"));
	roots.push(directory);
	return directory;
};
it("blocks a live legacy coordinator without mutating it or creating a second pool", async () => {
	const directory = root();
	const state = JSON.stringify({
		version: 1,
		limit: 4,
		sequence: 1,
		bypass: 0,
		requests: [
			{
				id: "old-request",
				token: "legacy-test-token",
				identity: "legacy-test",
				sequence: 1,
				owner: {
					pid: process.pid,
					start: execFileSync(
						"ps",
						["-p", String(process.pid), "-o", "lstart="],
						{ encoding: "utf8" },
					).trim(),
					incarnation: "test",
				},
				queuedAt: new Date().toISOString(),
				phase: "executing",
				background: false,
				parked: false,
				recoverable: false,
				remote: false,
			},
		],
	});
	writeFileSync(join(directory, "state.json"), state);
	await expect(assertLegacyCapacityDrained(directory)).rejects.toThrow(
		/Drain and stop/,
	);
	expect(readFileSync(join(directory, "state.json"), "utf8")).toBe(state);
	writeFileSync(join(directory, "state.json"), "invalid");
	await expect(assertLegacyCapacityDrained(directory)).rejects.toThrow();
});
it("defaults to four, shares deliberate policy changes, and reports explicit join conflicts", async () => {
	const directory = root();
	const first = new MachineCapacity(undefined, directory);
	await first.ready();
	expect((await first.snapshot()).limit).toBe(4);
	await first.setLimit(2);
	const second = new MachineCapacity(undefined, directory);
	const conflicting = new MachineCapacity(5, directory);
	await Promise.all([second.ready(), conflicting.ready()]);
	expect((await second.snapshot()).limit).toBe(2);
	expect((await conflicting.snapshot()).conflict).toMatch(
		/conflicts with shared limit 2/,
	);
	await second.setLimit(3);
	expect((await first.snapshot()).limit).toBe(3);
	expect((await conflicting.snapshot()).conflict).toMatch(/shared limit 3/);
	await second.setLimit(5);
	expect((await conflicting.snapshot()).conflict).toBeUndefined();
});
it("cancels queued work, drains lower limits, and fences repeated release", async () => {
	const service = new MachineCapacity(2, root());
	const first = await service.acquireLease();
	const second = await service.acquireLease();
	await service.setLimit(1);
	const abort = new AbortController();
	const pending = service.acquireLease(abort.signal);
	const rejected = expect(pending).rejects.toThrow();
	await vi.waitFor(async () =>
		expect((await service.snapshot()).queued).toBe(1),
	);
	abort.abort();
	await rejected;
	await first.release();
	await first.release();
	expect((await service.snapshot()).active).toBe(1);
	await second.release();
	expect((await service.snapshot()).active).toBe(0);
});
it("parks recoverable work on shutdown and rejoins with the original sequence", async () => {
	const directory = root();
	const first = new MachineCapacity(1, directory);
	const blocker = await first.acquireLease();
	const pending = first.acquireLease(undefined, {
		identity: "saved-run:leaf:1",
		recoverable: true,
	});
	const rejected = expect(pending).rejects.toThrow(/shutting down/);
	await vi.waitFor(async () => expect((await first.snapshot()).queued).toBe(1));
	const sequence = (await first.snapshot()).requests.find(
		(r) => r.identity === "saved-run:leaf:1",
	)!.sequence;
	await first.shutdown();
	await rejected;
	await blocker.release();
	const second = new MachineCapacity(undefined, directory);
	const resumed = await second.acquireLease(undefined, {
		identity: "saved-run:leaf:1",
		recoverable: true,
	});
	expect((await second.snapshot()).requests[0]!.sequence).toBe(sequence);
	await resumed.release();
});
it("fails closed on corrupt durable state", async () => {
	const directory = root();
	writeFileSync(join(directory, "state.json"), "invalid");
	const service = new MachineCapacity(1, directory);
	await expect(service.ready()).rejects.toThrow(/corrupt/);
	await expect(service.acquireLease()).rejects.toThrow(/corrupt/);
});
function worker(
	directory: string,
	home: string,
	ledger: string,
	mode = "mixed",
) {
	const child = spawn(
		process.execPath,
		[
			"--import",
			resolve("../core/node_modules/tsx/dist/loader.mjs"),
			resolve("test/fixtures/capacity-worker.ts"),
			directory,
			home,
			ledger,
			mode,
		],
		{ stdio: ["ignore", "pipe", "pipe", "ipc"] },
	);
	children.push(child);
	let errors = "";
	child.stderr!.on("data", (chunk) => {
		errors += chunk;
	});
	const done = new Promise<void>((yes, no) => {
		child.on("error", no);
		child.on("close", (code) =>
			code === 0 ? yes() : no(new Error(`worker exited ${code}: ${errors}`)),
		);
	});
	return { child, done };
}
it("bounds actual mixed execution across processes with different state homes", async () => {
	const directory = root(),
		ledger = join(directory, "intervals.jsonl");
	await new MachineCapacity(2, directory).ready();
	const a = worker(directory, join(directory, "home-a"), ledger);
	const b = worker(directory, join(directory, "home-b"), ledger);
	await Promise.all([a.done, b.done]);
	const events = readFileSync(ledger, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	let active = 0,
		maximum = 0;
	for (const event of events) {
		active += event.phase === "start" ? 1 : -1;
		maximum = Math.max(maximum, active);
		expect(active).toBeLessThanOrEqual(2);
	}
	expect(events).toHaveLength(12);
	expect(maximum).toBe(2);
	expect(active).toBe(0);
});
it("reconciles a killed owner and terminates its surviving command before admitting new work", async () => {
	const directory = root(),
		ledger = join(directory, "intervals.jsonl");
	const service = new MachineCapacity(1, directory);
	await service.ready();
	const owner = worker(directory, "old-home", ledger, "orphan");
	const stopped = owner.done.catch(() => {});
	await vi.waitFor(
		() => expect(readFileSync(ledger, "utf8")).toContain('"start"'),
		{ timeout: 10000 },
	);
	const pid = JSON.parse(readFileSync(ledger, "utf8").trim()).pid;
	owner.child.kill("SIGKILL");
	await stopped;
	const lease = await service.acquireLease();
	await delay(100);
	expect(() => process.kill(pid, 0)).toThrow();
	expect((await service.snapshot()).active).toBe(1);
	await lease.release();
});

it("rejoins a killed queued worker without changing its sequence or running twice", async () => {
	const directory = root(),
		ledger = join(directory, "intervals.jsonl");
	const service = new MachineCapacity(1, directory);
	const blocker = await service.acquireLease();
	const first = worker(directory, "queued-home", ledger, "queued");
	const stopped = first.done.catch(() => {});
	await vi.waitFor(
		async () => expect((await service.snapshot()).queued).toBe(1),
		{ timeout: 10000 },
	);
	const original = (await service.snapshot()).requests.find(
		(r) => r.identity === "queued-home:queued",
	)!;
	first.child.kill("SIGKILL");
	await stopped;
	const restarted = worker(directory, "queued-home", ledger, "queued");
	await vi.waitFor(
		async () => {
			const request = (await service.snapshot()).requests.find(
				(r) => r.identity === original.identity,
			)!;
			expect(request.owner.pid).toBe(restarted.child.pid);
			expect(request.sequence).toBe(original.sequence);
			expect(request.id).toBe(original.id);
		},
		{ timeout: 10000 },
	);
	await blocker.release();
	await restarted.done;
	const events = readFileSync(ledger, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	expect(events.map((event) => event.phase)).toEqual(["start", "end"]);
	expect((await service.snapshot()).requests).toEqual([]);
});

it("retains unverified external cancellation, but releases grants cancelled before invocation", async () => {
	const service = new MachineCapacity(1, root());
	const before = new AbortController();
	const unused = await service.acquireLease(before.signal, { remote: true });
	before.abort();
	await unused.release();
	expect((await service.snapshot()).active).toBe(0);
	const running = new AbortController();
	const external = await service.acquireLease(running.signal, { remote: true });
	await external.run(async () => {});
	running.abort();
	await expect(external.release()).rejects.toThrow(/remains reserved/);
	expect((await service.snapshot()).stopping).toBe(1);
});

it("recovers a crash during stale-lock reclamation under concurrent startup", async () => {
	const directory = root();
	const dead = JSON.stringify({
		pid: process.pid,
		start: "previous incarnation",
		incarnation: "dead",
	});
	for (const name of ["lock", "reclaim", "reclaim.reclaim"])
		symlinkSync(dead, join(directory, name));
	const a = new MachineCapacity(1, directory);
	const b = new MachineCapacity(1, directory);
	await Promise.all([a.ready(), b.ready()]);
	const first = await a.acquireLease();
	const second = b.acquireLease();
	await vi.waitFor(async () => expect((await a.snapshot()).queued).toBe(1));
	await first.release();
	await (await second).release();
	expect((await a.snapshot()).requests).toEqual([]);
});

it.each([
	false,
	true,
])("exchanges durable workflow positions without moving interactive work (batch=%s)", async (batch) => {
	const service = new MachineCapacity(1, root());
	const blocker = await service.acquireLease();
	const order: string[] = [];
	const enqueue = (id: string, createdAt?: string) =>
		service
			.acquireLease(undefined, {
				identity: id,
				workflowRun: createdAt ? { identity: id, createdAt } : undefined,
			})
			.then((lease) => {
				order.push(id);
				return lease;
			});
	const newer = enqueue("new", "2026-10-09T00:00:00Z");
	await vi.waitFor(async () =>
		expect((await service.snapshot()).queued).toBe(1),
	);
	const interactive = enqueue("interactive");
	await vi.waitFor(async () =>
		expect((await service.snapshot()).queued).toBe(2),
	);
	const older = enqueue("old", "2026-10-08T00:00:00Z");
	await vi.waitFor(async () =>
		expect((await service.snapshot()).queued).toBe(3),
	);
	const original = (await service.snapshot()).requests.find(
		(r) => r.identity === "new",
	)!;
	if (batch) await service.setLimit(4);
	else await blocker.release();
	const oldLease = await older;
	const moved = (await service.snapshot()).requests.find(
		(r) => r.identity === "new",
	)!;
	expect(moved.sequence).toBe(original.sequence);
	expect(moved.queuedAt).toBe(original.queuedAt);
	expect(moved.admissionPosition).toBe(4);
	if (!batch) await oldLease.release();
	const interactiveLease = await interactive;
	if (!batch) await interactiveLease.release();
	const newLease = await newer;
	// Batch promise polling may observe admission in another order; saved positions prove admission order.
	if (!batch) expect(order).toEqual(["old", "interactive", "new"]);
	else
		expect(
			(await service.snapshot()).requests
				.sort((a, b) => a.admissionPosition! - b.admissionPosition!)
				.map((r) => r.identity)
				.slice(1),
		).toEqual(["old", "interactive", "new"]);
	await Promise.all([
		blocker.release(),
		oldLease.release(),
		interactiveLease.release(),
		newLease.release(),
	]);
	expect((await service.snapshot()).requests).toEqual([]);
});

it("preserves exchanged positions across shutdown and authoritative rejoin", async () => {
	const directory = root();
	const first = new MachineCapacity(1, directory);
	const blocker = await first.acquireLease();
	const newerOptions = {
		identity: "new",
		recoverable: true,
		workflowRun: { identity: "new-run", createdAt: "2026-10-09T00:00:00Z" },
	};
	const pendingNew = first.acquireLease(undefined, newerOptions);
	const rejectionNew = expect(pendingNew).rejects.toThrow(/shutting down/);
	await vi.waitFor(async () => expect((await first.snapshot()).queued).toBe(1));
	const pendingInteractive = first.acquireLease(undefined, {
		identity: "interactive",
		recoverable: true,
	});
	const rejectionInteractive =
		expect(pendingInteractive).rejects.toThrow(/shutting down/);
	await vi.waitFor(async () => expect((await first.snapshot()).queued).toBe(2));
	const pendingOld = first.acquireLease(undefined, {
		workflowRun: { identity: "old-run", createdAt: "2026-10-08T00:00:00Z" },
	});
	await vi.waitFor(async () => expect((await first.snapshot()).queued).toBe(3));
	await blocker.release();
	const old = await pendingOld;
	const before = (await first.snapshot()).requests.find(
		(r) => r.identity === "new",
	)!;
	expect(before.admissionPosition).toBe(4);
	await first.shutdown();
	await Promise.all([rejectionNew, rejectionInteractive]);
	await old.release();
	const resumed = new MachineCapacity(undefined, directory);
	const hold = await resumed.acquireLease();
	const newPending = resumed.acquireLease(undefined, newerOptions);
	await vi.waitFor(async () =>
		expect(
			(await resumed.snapshot()).requests.find((r) => r.identity === "new")
				?.parked,
		).toBe(false),
	);
	const interactivePending = resumed.acquireLease(undefined, {
		identity: "interactive",
		recoverable: true,
	});
	await vi.waitFor(async () =>
		expect(
			(await resumed.snapshot()).requests.find(
				(r) => r.identity === "interactive",
			)?.parked,
		).toBe(false),
	);
	const after = (await resumed.snapshot()).requests.find(
		(r) => r.identity === "new",
	)!;
	expect(after).toMatchObject({
		sequence: before.sequence,
		queuedAt: before.queuedAt,
		admissionPosition: 4,
		workflowRun: before.workflowRun,
	});
	await hold.release();
	const interactive = await interactivePending;
	expect(
		(await resumed.snapshot()).requests.find((r) => r.identity === "new")
			?.phase,
	).toBe("queued");
	await interactive.release();
	await (await newPending).release();
});

it("rejects invalid workflow timestamps and conflicting run metadata", async () => {
	const service = new MachineCapacity(1, root());
	await expect(
		service.acquireLease(undefined, {
			workflowRun: { identity: "run", createdAt: "invalid" },
		}),
	).rejects.toThrow();
	const lease = await service.acquireLease(undefined, {
		workflowRun: { identity: "run", createdAt: "2026-10-09T00:00:00Z" },
	});
	await expect(
		service.acquireLease(undefined, {
			workflowRun: { identity: "run", createdAt: "2026-10-08T00:00:00Z" },
		}),
	).rejects.toThrow(/Conflicting/);
	await lease.release();
});

it("shares workflow position exchanges between processes", async () => {
	const directory = root(),
		ledger = join(directory, "priority.jsonl");
	const service = new MachineCapacity(1, directory);
	const blocker = await service.acquireLease();
	const newer = worker(directory, "new-run", ledger, "workflow-new");
	await vi.waitFor(
		async () => expect((await service.snapshot()).queued).toBe(1),
		{ timeout: 10000 },
	);
	const interactive = worker(directory, "interactive", ledger, "queued");
	await vi.waitFor(
		async () => expect((await service.snapshot()).queued).toBe(2),
		{ timeout: 10000 },
	);
	const older = worker(directory, "old-run", ledger, "workflow-old");
	await vi.waitFor(
		async () => expect((await service.snapshot()).queued).toBe(3),
		{ timeout: 10000 },
	);
	await blocker.release();
	await Promise.all([newer.done, interactive.done, older.done]);
	const starts = readFileSync(ledger, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line))
		.filter((event) => event.phase === "start")
		.map((event) => event.kind);
	expect(starts).toEqual(["workflow-old", "queued", "workflow-new"]);
	expect((await service.snapshot()).requests).toEqual([]);
});
