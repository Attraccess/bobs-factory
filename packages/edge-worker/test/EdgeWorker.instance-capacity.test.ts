import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { MachineCapacity } from "../src/MachineCapacity.js";

const homes: string[] = [];
const coordinators: MachineCapacity[] = [];
afterEach(async () => {
	for (const slots of coordinators.splice(0)) await slots.shutdown();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
	vi.unstubAllEnvs();
});

function home() {
	const directory = mkdtempSync(join(tmpdir(), "instance-capacity-"));
	homes.push(directory);
	return directory;
}

function capacity(factoryHome: string, maxConcurrentSessions?: number) {
	const worker = new EdgeWorker({
		platform: "cli",
		factoryHome,
		repositories: [],
		maxConcurrentSessions,
	});
	const { runnerSlots } = worker as unknown as { runnerSlots: MachineCapacity };
	coordinators.push(runnerSlots);
	return runnerSlots;
}

it("admits F1 work independently of a saturated parent instance and isolates settings", async () => {
	// An inherited override must not reconnect a temporary worker to its parent pool.
	vi.stubEnv("BOBS_FACTORY_CAPACITY_DIRECTORY", join(home(), "legacy-pool"));
	const parent = capacity(home(), 1);
	const test = capacity(home(), 2);
	const parentLease = await parent.acquireLease();
	const abort = new AbortController();
	const pending = parent.acquireLease(abort.signal);
	const cancelled = expect(pending).rejects.toThrow();
	try {
		await vi.waitFor(async () =>
			expect((await parent.snapshot()).queued).toBe(1),
		);
		const testLease = await test.acquireLease(AbortSignal.timeout(2000));
		try {
			expect(await parent.snapshot()).toMatchObject({
				active: 1,
				queued: 1,
				limit: 1,
			});
			expect(await test.snapshot()).toMatchObject({
				active: 1,
				queued: 0,
				limit: 2,
			});
			await test.setLimit(3);
			expect((await parent.snapshot()).limit).toBe(1);
		} finally {
			await testLease.release();
		}
	} finally {
		abort.abort();
		await cancelled;
		await parentLease.release();
	}
});

it("retains an instance's saved limit across restart without changing other homes", async () => {
	const directory = home();
	const first = capacity(directory);
	await first.setLimit(2);
	await first.shutdown();
	const restarted = capacity(directory);
	const separate = capacity(home());
	expect((await restarted.snapshot()).limit).toBe(2);
	expect((await separate.snapshot()).limit).toBe(4);
});
