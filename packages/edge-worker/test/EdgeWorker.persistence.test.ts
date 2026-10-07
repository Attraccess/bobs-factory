import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	PersistenceManager,
	SerializableEdgeWorkerState,
} from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";

interface PersistenceAccess {
	runnerSlots: { ready(): Promise<void> };
	savePersistedState(
		requireSuccess?: boolean,
		update?: () => () => void,
	): Promise<void>;
	persistenceManager: PersistenceManager;
}

const homes: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const home of homes.splice(0))
		await rm(home, { recursive: true, force: true });
});

it.each([
	false,
	true,
])("keeps transactional saves between lifecycle batches (failure: %s)", async (failTransaction) => {
	const home = await mkdtemp(join(tmpdir(), "edge-persistence-transaction-"));
	homes.push(home);
	const worker = new EdgeWorker({
		platform: "cli",
		factoryHome: home,
		repositories: [],
	});
	const access = worker as unknown as PersistenceAccess;
	// Constructor initialization writes capacity state; finish it before test-home cleanup.
	await access.runnerSlots.ready();
	let revision = "initial";
	vi.spyOn(worker, "serializeMappings").mockImplementation(() => ({
		pendingTriggerMessages: { session: revision },
	}));
	let release!: () => void;
	let started!: () => void;
	const entered = new Promise<void>((resolve) => {
		started = resolve;
	});
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const revisions: string[] = [];
	vi.spyOn(access.persistenceManager, "saveEdgeWorkerState").mockImplementation(
		async (state) => {
			revisions.push(state.pendingTriggerMessages!.session!);
			if (revisions.length === 1) {
				started();
				await blocked;
			}
			if (failTransaction && revision === "transaction")
				throw new Error("Disk full");
		},
	);
	const first = access.savePersistedState();
	await entered;
	const before = access.savePersistedState();
	const transaction = access.savePersistedState(true, () => {
		const previous = revision;
		revision = "transaction";
		return () => {
			revision = previous;
		};
	});
	// Observe the rejection before releasing the queue to avoid an unhandled rejection.
	const outcome = transaction.then(
		() => "saved",
		() => "rejected",
	);
	const after = access.savePersistedState();
	expect(after).not.toBe(before);
	const burst = Array.from({ length: 20 }, () => access.savePersistedState());
	release();
	await Promise.all([first, before, after, ...burst]);
	expect(await outcome).toBe(failTransaction ? "rejected" : "saved");
	expect(revisions).toEqual([
		"initial",
		"initial",
		"transaction",
		failTransaction ? "initial" : "transaction",
	]);
	await access.savePersistedState();
	expect(revisions.at(-1)).toBe(failTransaction ? "initial" : "transaction");
});

it.each([
	false,
	true,
])("coalesces save bursts and waits for the latest state (first save fails: %s)", async (failFirst) => {
	const home = await mkdtemp(join(tmpdir(), "edge-persistence-"));
	homes.push(home);
	const worker = new EdgeWorker({
		platform: "cli",
		factoryHome: home,
		repositories: [],
	});
	const access = worker as unknown as PersistenceAccess;
	await access.runnerSlots.ready();
	let releaseFirst!: () => void;
	let firstStarted!: () => void;
	let releaseSecond!: () => void;
	let secondStarted!: () => void;
	const started = new Promise<void>((resolve) => {
		firstStarted = resolve;
	});
	const blocked = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	const secondEntered = new Promise<void>((resolve) => {
		secondStarted = resolve;
	});
	const secondBlocked = new Promise<void>((resolve) => {
		releaseSecond = resolve;
	});
	let revision = "initial";
	const snapshots: SerializableEdgeWorkerState[] = [];
	vi.spyOn(worker, "serializeMappings").mockImplementation(() => ({
		pendingTriggerMessages: { session: revision },
	}));
	const save = vi
		.spyOn(access.persistenceManager, "saveEdgeWorkerState")
		.mockImplementation(async (state) => {
			snapshots.push(state);
			if (snapshots.length === 1) {
				firstStarted();
				await blocked;
				if (failFirst) throw new Error("first save failed");
			} else if (snapshots.length === 2) {
				secondStarted();
				await secondBlocked;
			}
		});
	let finished = false;
	const first = access.savePersistedState().then(() => {
		finished = true;
	});
	await started;
	const burst = Array.from({ length: 50 }, (_, index) => {
		revision = `revision-${index}`;
		return access.savePersistedState();
	});
	await Promise.resolve();
	expect(finished).toBe(false);
	let burstFinished = false;
	const burstSaved = Promise.all(burst).then(() => {
		burstFinished = true;
	});
	releaseFirst();
	await secondEntered;
	await first;
	// Later writes cannot starve an earlier caller whose snapshot is complete.
	expect(finished).toBe(true);
	expect(burstFinished).toBe(false);
	releaseSecond();
	await burstSaved;
	expect(save).toHaveBeenCalledTimes(2);
	expect(snapshots).toEqual([
		{ pendingTriggerMessages: { session: "initial" } },
		{ pendingTriggerMessages: { session: "revision-49" } },
	]);
	revision = "after-drain";
	await access.savePersistedState();
	expect(snapshots.at(-1)).toEqual({
		pendingTriggerMessages: { session: "after-drain" },
	});
});
