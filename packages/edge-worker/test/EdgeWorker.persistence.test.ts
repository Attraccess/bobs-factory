import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	PersistenceManager,
	SerializableEdgeWorkerState,
} from "cyrus-core";
import { afterEach, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";

interface PersistenceAccess {
	savePersistedState(): Promise<void>;
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
])("coalesces save bursts and waits for the latest state (first save fails: %s)", async (failFirst) => {
	const home = await mkdtemp(join(tmpdir(), "edge-persistence-"));
	homes.push(home);
	const worker = new EdgeWorker({
		platform: "cli",
		cyrusHome: home,
		repositories: [],
	});
	const access = worker as unknown as PersistenceAccess;
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
