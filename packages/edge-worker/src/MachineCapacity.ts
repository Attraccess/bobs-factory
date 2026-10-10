import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
	mkdir,
	open,
	readFile,
	readlink,
	rename,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import {
	type CapacityOwner,
	type CapacityWorkflow,
	CapacityWorkflowSchema,
	executionScope,
	CapacityOwnerSchema as Owner,
	type CapacityRequest as PersistedCapacityRequest,
	resolvePath,
	CapacityStateSchema as State,
} from "bobs-factory-core";
import { z } from "zod";

import { orderWorkflowPositions } from "./CapacityOrdering.js";

export const DEFAULT_MACHINE_CAPACITY = 4;
export type CapacityRequest = PersistedCapacityRequest;
const runFile = promisify(execFile);
export interface CapacitySnapshot {
	limit: number;
	active: number;
	stopping: number;
	queued: number;
	requests: CapacityRequest[];
	defaultLimit: number;
	directory: string;
	error?: string;
	conflict?: string;
}
export interface CapacityOptions {
	identity?: string;
	workflowRun?: CapacityWorkflow;
	recoverable?: boolean;
	background?: boolean;
	remote?: boolean;
	preserveOnShutdown?: () => boolean;
	onChange?: (request: CapacityRequest | undefined) => void;
}
export interface CapacityLease {
	token: string;
	run<T>(work: () => Promise<T>): Promise<T>;
	release(): Promise<void>;
}
export interface ExecutionCapacity {
	acquireLease(
		signal?: AbortSignal,
		options?: CapacityOptions,
	): Promise<CapacityLease>;
}

async function processStart(pid: number): Promise<string | undefined> {
	try {
		const { stdout } = await runFile("ps", [
			"-p",
			String(pid),
			"-o",
			"lstart=",
		]);
		return stdout.trim() || undefined;
	} catch (error) {
		if ((error as { code?: unknown }).code === 1) return undefined;
		throw error; // Permission/tool errors are not proof that execution stopped.
	}
}
async function living(owner: CapacityOwner): Promise<boolean> {
	return (await processStart(owner.pid)) === owner.start;
}
/** Scan only for our unguessable lease marker; never expose the process environment. */
async function descendants(token: string, legacy = false): Promise<number[]> {
	if (process.platform === "win32")
		throw new Error("Capacity process reconciliation requires POSIX ps");
	const { stdout } = await runFile("ps", ["axeww", "-o", "pid=,command="], {
		maxBuffer: 32 * 1024 * 1024,
	});
	const marker = `${legacy ? "CYRUS_EXECUTION_LEASE" : "BOBS_FACTORY_EXECUTION_LEASE"}=${token}`;
	return stdout
		.split("\n")
		.filter((line) => line.split(/\s+/).includes(marker))
		.map((line) => Number(line.trim().split(/\s+/)[0]))
		.filter((pid) => pid !== process.pid);
}
async function drain(token: string): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt++) {
		const pids = await descendants(token);
		if (!pids.length) return;
		for (const pid of pids) {
			// Reverify provenance immediately before signalling; do not trust a stale PID.
			if (!(await descendants(token)).includes(pid)) continue;
			try {
				process.kill(pid, attempt < 20 ? "SIGTERM" : "SIGKILL");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
			}
		}
		await delay(100);
	}
	throw new Error(
		`Capacity cannot confirm termination for lease ${token}; admission remains blocked`,
	);
}

/** Safety barrier only: no legacy state fallback or automatic lease deletion. */
export async function assertLegacyCapacityDrained(
	directory = process.env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY ??
		join(homedir(), ".cyrus", "machine-capacity"),
): Promise<void> {
	let raw: string;
	try {
		raw = await readFile(join(directory, "state.json"), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	const state = State.parse(JSON.parse(raw));
	for (const request of state.requests) {
		if (
			(await living(request.owner)) ||
			(await descendants(request.token, true)).length
		)
			throw new Error(
				"A Cyrus coordinator still owns live execution. Drain and stop its workers and descendants before starting Bob’s Factory; use the migration guide.",
			);
	}
}
/** One durable pool per factory instance, shared by workers using the same home. */
export class MachineCapacity implements ExecutionCapacity {
	readonly directory: string;
	private owner!: CapacityOwner;
	private initialized: Promise<void>;
	private listeners = new Set<() => void>();
	private poll?: ReturnType<typeof setInterval>;
	private lastSnapshot?: CapacitySnapshot;
	private conflict?: string;
	private closing = false;
	private refreshing?: Promise<CapacitySnapshot>;
	private transactions: Promise<void> = Promise.resolve();
	constructor(
		private configuredLimit: number | undefined,
		directory: string,
	) {
		this.directory = resolvePath(directory);
		this.initialized = this.initialize();
		// Avoid an unhandled rejection before startup awaits the admission barrier.
		void this.initialized.catch(() => {});
	}
	private async initialize(): Promise<void> {
		await assertLegacyCapacityDrained();
		if (this.configuredLimit !== undefined)
			z.number().int().positive().parse(this.configuredLimit);
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		const start = await processStart(process.pid);
		if (!start)
			throw new Error("Cannot establish capacity owner process identity");
		this.owner = { pid: process.pid, start, incarnation: randomUUID() };
		await this.transaction((state) => {
			this.conflict = this.policyConflict(state.limit);
		});
	}
	private policyConflict(limit: number): string | undefined {
		return this.configuredLimit !== undefined && this.configuredLimit !== limit
			? `Configured maxConcurrentSessions=${this.configuredLimit} conflicts with shared limit ${limit}. Save the instance limit in Factory settings or deliberately change the configuration.`
			: undefined;
	}
	async ready(): Promise<void> {
		await this.initialized;
		const snapshot = await this.refresh();
		if (snapshot.error) throw new Error(snapshot.error);
	}
	private transaction<T>(
		update: (state: z.infer<typeof State>) => T | Promise<T>,
	): Promise<T> {
		const pending = this.transactions.then(() =>
			this.lockedTransaction(update),
		);
		this.transactions = pending.then(
			() => {},
			() => {},
		);
		return pending;
	}
	/** Reclaim guards use the same owner-fenced recovery as the primary lock.
	 * A crash can leave a finite chain of guards; the next worker recovers it
	 * from the deepest stale guard before inspecting its parent again. */
	private async acquireLock(
		lock: string,
		lockOwner: string,
		deadline: number,
	): Promise<void> {
		while (true) {
			try {
				await symlink(lockOwner, lock);
				return;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
			let holderText: string;
			try {
				holderText = await readlink(lock);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw error;
			}
			const holder = Owner.parse(JSON.parse(holderText));
			if (!(await living(holder))) {
				const guard =
					lock === join(this.directory, "lock")
						? join(this.directory, "reclaim")
						: `${lock}.reclaim`;
				await this.acquireLock(guard, lockOwner, deadline);
				try {
					if ((await readlink(lock)) === holderText) await unlink(lock);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				} finally {
					await unlink(guard);
				}
			}
			if (Date.now() > deadline)
				throw new Error(
					"Instance capacity coordinator lock unavailable; no workload was started",
				);
			await delay(25);
		}
	}
	private async lockedTransaction<T>(
		update: (state: z.infer<typeof State>) => T | Promise<T>,
	): Promise<T> {
		const lock = join(this.directory, "lock");
		const lockOwner = JSON.stringify(this.owner);
		const deadline = Date.now() + 15000;
		await this.acquireLock(lock, lockOwner, deadline);
		try {
			let state: z.infer<typeof State>;
			let original: string | undefined;
			try {
				original = await readFile(join(this.directory, "state.json"), "utf8");
				state = State.parse(JSON.parse(original));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT")
					throw new Error(
						"Instance capacity state is corrupt or unavailable; restore the coordinator before starting work",
						{ cause: error },
					);
				state = {
					version: 1,
					limit: this.configuredLimit ?? DEFAULT_MACHINE_CAPACITY,
					sequence: 0,
					bypass: 0,
					requests: [],
				};
			}
			// Reconciliation precedes every admission, not merely this worker's startup.
			// Share process observations only within this locked transaction. Repeated
			// leaves from one owner must not launch one ps process per leaf per poll.
			const observed = new Map<string, boolean>();
			const isLiving = async (owner: CapacityOwner) => {
				if (owner.pid === this.owner.pid && owner.start === this.owner.start)
					return true;
				const key = `${owner.pid}:${owner.start}`;
				if (!observed.has(key)) observed.set(key, await living(owner));
				return observed.get(key)!;
			};
			for (const request of [...state.requests]) {
				if (await isLiving(request.owner)) continue;
				if (request.phase === "queued" && request.recoverable) continue;
				if (request.phase !== "queued") {
					if (request.remote)
						throw new Error(
							`Unverified remote execution ${request.identity} still owns capacity. Reconcile its external execution before recovery.`,
						);
					await drain(request.token);
				}
				if (request.recoverable) request.phase = "queued";
				else state.requests = state.requests.filter((item) => item !== request);
			}
			for (const request of state.requests)
				request.admissionPosition ??= request.sequence;
			const result = await update(state);
			State.parse(state);
			while (
				!existsSync(
					join(dirname(this.directory), "updates", "admission-paused"),
				) &&
				state.requests.filter((r) => r.phase !== "queued").length < state.limit
			) {
				const eligible: CapacityRequest[] = [];
				for (const r of state.requests)
					if (r.phase === "queued" && !r.parked && (await isLiving(r.owner)))
						eligible.push(r);
				orderWorkflowPositions(eligible);
				const background = eligible.find((r) => r.background);
				const next =
					background && state.bypass >= 8
						? background
						: (eligible.find((r) => !r.background) ?? background);
				if (!next) break;
				next.phase = "executing";
				state.bypass = next.background ? 0 : background ? state.bypass + 1 : 0;
			}
			if (JSON.stringify(state) !== original) {
				const temporary = join(this.directory, `${randomUUID()}.tmp`);
				await writeFile(temporary, JSON.stringify(state), {
					mode: 0o600,
					flush: true,
				});
				await rename(temporary, join(this.directory, "state.json"));
				const directoryHandle = await open(this.directory, "r");
				try {
					await directoryHandle.sync();
				} finally {
					await directoryHandle.close();
				}
			}
			if (this.conflict) this.conflict = this.policyConflict(state.limit);
			this.lastSnapshot = {
				limit: state.limit,
				active: state.requests.filter((r) => r.phase === "executing").length,
				stopping: state.requests.filter((r) => r.phase === "stopping").length,
				queued: state.requests.filter((r) => r.phase === "queued").length,
				requests: structuredClone(state.requests),
				directory: this.directory,
				defaultLimit: DEFAULT_MACHINE_CAPACITY,
				conflict: this.conflict,
			};
			return result;
		} finally {
			await unlink(lock);
		}
	}
	refresh(): Promise<CapacitySnapshot> {
		this.refreshing ??= this.refreshOnce().finally(() => {
			this.refreshing = undefined;
		});
		return this.refreshing;
	}
	private async refreshOnce(): Promise<CapacitySnapshot> {
		await this.initialized;
		const old = JSON.stringify(this.lastSnapshot);
		try {
			await this.transaction(() => {});
		} catch (error) {
			this.lastSnapshot = {
				...(this.lastSnapshot ?? {
					limit: this.configuredLimit ?? DEFAULT_MACHINE_CAPACITY,
					active: 0,
					stopping: 0,
					queued: 0,
					requests: [],
					defaultLimit: DEFAULT_MACHINE_CAPACITY,
					directory: this.directory,
				}),
				error: (error as Error).message,
			};
		}
		if (JSON.stringify(this.lastSnapshot) !== old)
			for (const listener of this.listeners) listener();
		return this.lastSnapshot!;
	}
	async snapshot(): Promise<CapacitySnapshot> {
		return this.refresh();
	}
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		this.poll ??= setInterval(() => {
			void this.refresh().catch(() => {});
		}, 500);
		this.poll.unref();
		return () => {
			this.listeners.delete(listener);
			if (!this.listeners.size && this.poll) {
				clearInterval(this.poll);
				this.poll = undefined;
			}
		};
	}
	/** Remove only confirmed inactive queue entries belonging to this state root. */
	async reconcileQueue(inactive: (identity: string) => boolean): Promise<void> {
		await this.initialized;
		await this.transaction((state) => {
			state.requests = state.requests.filter(
				(request) => request.phase !== "queued" || !inactive(request.identity),
			);
		});
	}
	async pauseAdmissionsForUpdate(
		transactionId: string,
	): Promise<CapacitySnapshot> {
		await this.initialized;
		await this.transaction(async (state) => {
			// Observational barrier: never signal descendants to make an update idle.
			for (const request of state.requests) {
				if (
					request.phase !== "queued" ||
					(await descendants(request.token)).length
				)
					throw new Error(
						"Active capacity leases/descendants still exist; update remains pending",
					);
			}
			const marker = join(
				dirname(this.directory),
				"updates",
				"admission-paused",
			);
			await mkdir(dirname(marker), { recursive: true, mode: 0o700 });
			if (existsSync(marker)) {
				if (readFileSync(marker, "utf8") !== transactionId)
					throw new Error("Another update owns capacity maintenance");
			} else
				await writeFile(marker, transactionId, {
					flag: "wx",
					mode: 0o600,
					flush: true,
				});
		});
		return this.lastSnapshot!;
	}
	async resumeAdmissionsAfterUpdate(transactionId: string): Promise<void> {
		await this.initialized;
		await this.transaction(async () => {
			const marker = join(
				dirname(this.directory),
				"updates",
				"admission-paused",
			);
			if (!existsSync(marker)) return;
			if (readFileSync(marker, "utf8") !== transactionId)
				throw new Error("Capacity maintenance transaction mismatch");
			await unlink(marker);
		});
	}
	async setLimit(value: number): Promise<void> {
		z.number().int().positive().parse(value);
		await this.initialized;
		await this.transaction((state) => {
			state.limit = value;
			this.conflict = undefined;
		});
		for (const listener of this.listeners) listener();
	}
	async acquireLease(
		signal?: AbortSignal,
		options: CapacityOptions = {},
	): Promise<CapacityLease> {
		const workflow =
			options.workflowRun === undefined
				? undefined
				: CapacityWorkflowSchema.parse(options.workflowRun);
		await this.initialized;
		signal?.throwIfAborted();
		if (this.closing) throw new Error("Capacity worker shutting down");
		let request!: CapacityRequest;
		await this.transaction(async (state) => {
			signal?.throwIfAborted();
			const existing = options.identity
				? state.requests.find((r) => r.identity === options.identity)
				: undefined;
			if (
				existing &&
				(existing.phase !== "queued" ||
					(!existing.parked && (await living(existing.owner))))
			)
				throw new Error(`Duplicate capacity execution: ${options.identity}`);
			if (
				workflow &&
				state.requests.some(
					(r) =>
						r.workflowRun?.identity === workflow.identity &&
						Date.parse(r.workflowRun.createdAt) !==
							Date.parse(workflow.createdAt),
				)
			)
				throw new Error("Conflicting capacity workflow age");
			if (
				existing?.workflowRun &&
				workflow &&
				(existing.workflowRun.identity !== workflow.identity ||
					Date.parse(existing.workflowRun.createdAt) !==
						Date.parse(workflow.createdAt))
			)
				throw new Error("Conflicting capacity workflow metadata");
			if (existing) {
				request = existing;
				request.workflowRun ??= workflow;
				request.owner = this.owner;
				request.token = randomUUID();
				request.parked = false;
			} else {
				request = {
					id: randomUUID(),
					token: randomUUID(),
					owner: this.owner,
					sequence: ++state.sequence,
					admissionPosition: state.sequence,
					workflowRun: workflow,
					queuedAt: new Date().toISOString(),
					phase: "queued",
					parked: false,
					background: options.background ?? false,
					identity: options.identity ?? randomUUID(),
					recoverable: options.recoverable ?? false,
					remote: options.remote ?? false,
				};
				state.requests.push(request);
			}
		});
		let releasePromise: Promise<void> | undefined;
		let started = false;
		const stopping = () => {
			void this.transaction((state) => {
				const owned = state.requests.find((r) => r.token === request.token);
				if (owned?.phase === "executing") {
					owned.phase = "stopping";
					options.onChange?.(structuredClone(owned));
				}
			}).catch(() => {});
		};
		signal?.addEventListener("abort", stopping, { once: true });
		const release = () =>
			(releasePromise ??= (async () => {
				signal?.removeEventListener("abort", stopping);
				await drain(request.token);
				if (request.remote && started && signal?.aborted) {
					await this.transaction((state) => {
						const owned = state.requests.find((r) => r.token === request.token);
						if (owned && owned.phase !== "queued") owned.phase = "stopping";
						else
							state.requests = state.requests.filter(
								(r) => r.token !== request.token,
							);
					});
					options.onChange?.({ ...request, phase: "stopping" });
					throw new Error(
						`Cannot verify cancellation of external execution ${request.identity}; its capacity remains reserved`,
					);
				}
				await this.transaction((state) => {
					const owned = state.requests.find((r) => r.token === request.token);
					if (
						owned &&
						this.closing &&
						options.recoverable &&
						options.preserveOnShutdown?.() !== false
					) {
						owned.phase = "queued";
						owned.parked = true;
					} else
						state.requests = state.requests.filter(
							(r) => r.token !== request.token,
						);
				});
				options.onChange?.(
					this.closing &&
						options.recoverable &&
						options.preserveOnShutdown?.() !== false
						? { ...request, phase: "queued", parked: true }
						: undefined,
				);
			})());
		let lastChange: string | undefined;
		try {
			while (true) {
				signal?.throwIfAborted();
				if (this.closing) throw new Error("Capacity worker shutting down");
				const snapshot = await this.refresh();
				if (snapshot.error) throw new Error(snapshot.error);
				const current = snapshot.requests.find(
					(r) => r.token === request.token,
				);
				if (!current) throw new Error("Capacity request was removed");
				request = current;
				if (JSON.stringify(current) !== lastChange) {
					options.onChange?.(structuredClone(current));
					lastChange = JSON.stringify(current);
				}
				if (current.phase === "executing") break;
				await delay(100, undefined, { signal });
			}
			signal?.throwIfAborted();
			return {
				token: request.token,
				run: (work) => {
					started = true;
					return executionScope.run({ token: request.token }, work);
				},
				release,
			};
		} catch (error) {
			await release();
			throw error;
		}
	}
	async shutdown(): Promise<void> {
		this.closing = true;
		if (this.poll) clearInterval(this.poll);
	}
}
