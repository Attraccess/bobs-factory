import { randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { factoryRuntimeIdentity } from "bobs-factory-core";
import { z } from "zod";
import { compareReleaseVersions } from "../../../../scripts/lib/binary-release.mjs";
import { UpdateOperationLock } from "./UpdateOperationLock.js";

export const UpdateSettingsSchema = z
	.object({
		channel: z.enum(["stable", "nightly"]).default("stable"),
		overrides: z
			.object({
				stable: z.enum(["manual", "idle-auto"]).optional(),
				nightly: z.enum(["manual", "idle-auto"]).optional(),
			})
			.default({}),
		paused: z.boolean().default(false),
		pin: z
			.string()
			.regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/)
			.optional(),
	})
	.strict();
export type UpdateSettings = z.infer<typeof UpdateSettingsSchema>;
export const UpdateSettingsPatchSchema = z
	.object({
		channel: z.enum(["stable", "nightly"]).optional(),
		policy: z.enum(["manual", "idle-auto", "default"]).optional(),
		paused: z.boolean().optional(),
		pin: z
			.string()
			.regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/)
			.nullable()
			.optional(),
	})
	.strict();
export type UpdateSettingsPatch = z.infer<typeof UpdateSettingsPatchSchema>;
const CandidateSchema = z.object({
	version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
	commit: z.string().regex(/^[a-f0-9]{40}$/),
	channel: z.enum(["stable", "nightly"]),
	target: z.enum(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]),
	manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
	publishedAt: z.string().datetime(),
});
export type UpdateCandidate = z.infer<typeof CandidateSchema>;
const InstalledSchema = z.object({
	version: z.string(),
	commit: z.string().nullable(),
	target: z.string().nullable(),
});
export type InstalledUpdate = z.infer<typeof InstalledSchema>;
const StagedSchema = z.object({
	candidate: CandidateSchema,
	executable: z.string(),
	previousExecutable: z.string(),
});
export type StagedUpdate = z.infer<typeof StagedSchema>;
const OutcomeSchema = z.enum(["succeeded", "rolled-back", "cancelled"]);
const TransactionSchema = z
	.object({
		id: z.string(),
		candidate: CandidateSchema,
		staged: StagedSchema,
		previous: InstalledSchema,
		snapshot: z.string().optional(),
		revision: z.number().int(),
		phase: z.enum([
			"draining",
			"preflight",
			"snapshot",
			"stopping",
			"activating",
			"starting",
			"health",
			"rollback",
			"recovery-required",
			"succeeded",
			"rolled-back",
			"cancelled",
		]),
		switchStarted: z.boolean().default(false),
		startedAt: z.string(),
		error: z.string().optional(),
		release: z
			.object({
				transactionId: z.string(),
				outcome: OutcomeSchema,
				status: z.enum(["pending", "acknowledged"]),
			})
			.optional(),
	})
	.superRefine((transaction, ctx) => {
		if (
			transaction.release &&
			transaction.release.transactionId !== transaction.id
		)
			ctx.addIssue({
				code: "custom",
				message: "Maintenance release must belong to its transaction",
			});
	});
export type UpdateTransaction = z.infer<typeof TransactionSchema>;
const StateSchema = z.object({
	schemaVersion: z.literal(1),
	revision: z.number().int().nonnegative(),
	settings: UpdateSettingsSchema,
	installed: InstalledSchema,
	pending: z
		.object({
			candidate: CandidateSchema,
			since: z.string(),
			staged: StagedSchema.optional(),
			consentRevision: z.number().optional(),
		})
		.optional(),
	transaction: TransactionSchema.optional(),
	badCandidates: z.array(z.string()),
	nextCheckAt: z.number(),
	failures: z.number().int(),
	lastCheckedAt: z.string().optional(),
	error: z.string().optional(),
});
export type UpdateState = z.infer<typeof StateSchema>;
export interface UpdateSource {
	discover(
		settings: UpdateSettings,
		installed: InstalledUpdate,
	): Promise<UpdateCandidate | undefined>;
	stage(candidate: UpdateCandidate): Promise<StagedUpdate>;
}
/** Runs in the lifecycle supervisor, never in the worker being replaced.
 * Every method must be idempotent for the persisted transaction. Maintenance freezes
 * all intake and suppresses old-runtime auto-restart. isIdle includes descendant leases.
 * rollback must confirm failed replacement exit before starting the previous worker;
 * snapshots/restore are restricted to compatible Factory-owned state, never native stores.
 */
export interface UpdateLifecycle {
	acquireMaintenance(transactionId: string): Promise<void>;
	isIdle(): Promise<boolean>;
	preflight(
		staged: StagedUpdate,
		installed: InstalledUpdate,
	): Promise<{ stateCompatible: true }>;
	snapshot(transactionId: string): Promise<string>;
	stop(): Promise<void>;
	activate(staged: StagedUpdate): Promise<void>;
	start(): Promise<void>;
	health(candidate: UpdateCandidate): Promise<void>;
	rollback(transaction: UpdateTransaction): Promise<void>;
	releaseMaintenance(transactionId: string): Promise<void>;
}
export function effectiveUpdatePolicy(settings: UpdateSettings) {
	return (
		settings.overrides[settings.channel] ??
		(settings.channel === "nightly" ? "idle-auto" : "manual")
	);
}
export function candidateKey(candidate: UpdateCandidate) {
	return [
		candidate.channel,
		candidate.version,
		candidate.commit,
		candidate.target,
		candidate.manifestSha256,
	].join(":");
}
class UpdateStateLockBusyError extends Error {}

const now = () => new Date().toISOString();
const terminal = (transaction?: UpdateTransaction) =>
	!transaction ||
	(["succeeded", "rolled-back", "cancelled"].includes(transaction.phase) &&
		transaction.release?.status === "acknowledged");

/** Per-home durable state. Short sync writes serialize policy/consent independently
 * of network/staging. Long operations use a fenced owner lock with a nonce and process start identity.
 * recover() requires explicit operator confirmation, then verifies stale ownership
 * under an exclusive reclaim guard. Legacy live PID-only records fail closed.
 */
export class UpdateManager {
	readonly directory: string;
	readonly file: string;
	constructor(
		readonly home: string,
		private readonly source?: UpdateSource,
		private readonly lifecycle?: UpdateLifecycle,
		private readonly initial: InstalledUpdate = factoryRuntimeIdentity,
	) {
		this.directory = join(resolve(home), "updates");
		this.file = join(this.directory, "state.json");
	}
	private read(): UpdateState {
		if (
			existsSync(this.directory) &&
			(!lstatSync(this.directory).isDirectory() ||
				lstatSync(this.directory).isSymbolicLink())
		)
			throw new Error("Update directory must be a real owned directory");
		if (existsSync(this.file) && !lstatSync(this.file).isFile())
			throw new Error("Update state must be a regular file");
		if (existsSync(this.file) && lstatSync(this.file).isSymbolicLink())
			throw new Error("Update state cannot be a symlink");
		if (existsSync(this.file))
			return StateSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
		return StateSchema.parse({
			schemaVersion: 1,
			revision: 0,
			settings: {},
			installed: this.initial,
			badCandidates: [],
			nextCheckAt: 0,
			failures: 0,
		});
	}
	private change<T>(
		mutate: (state: UpdateState) => T,
		shouldWrite: (state: UpdateState) => boolean = () => true,
	): T | undefined {
		mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		const lock = join(this.directory, "state.lock");
		this.read();
		try {
			writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			throw new UpdateStateLockBusyError(
				"Update settings are being saved; retry. Inspect a retained state.lock after interruption.",
			);
		}
		try {
			const state = this.read();
			if (!shouldWrite(state)) return;
			const result = mutate(state);
			StateSchema.parse(state);
			const temporary = `${this.file}.${randomUUID()}.tmp`;
			const fd = openSync(temporary, "wx", 0o600);
			try {
				writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`);
				fsyncSync(fd);
			} finally {
				closeSync(fd);
			}
			renameSync(temporary, this.file);
			const directoryFd = openSync(this.directory, "r");
			try {
				fsyncSync(directoryFd);
			} finally {
				closeSync(directoryFd);
			}
			return result;
		} finally {
			unlinkSync(lock);
		}
	}
	/** Startup observation never owns a supervisor transaction. Only lock contention
	 * is deferred; malformed state and unexpected runtime identities still fail startup.
	 * The bounded wait is asynchronous so the legitimate writer can finish normally.
	 */
	async observeInstalled(identity: InstalledUpdate) {
		InstalledSchema.parse(identity);
		if (!identity.target || !identity.commit) return;
		const observed = InstalledSchema.extend({
			version: CandidateSchema.shape.version,
			commit: CandidateSchema.shape.commit,
			target: CandidateSchema.shape.target,
		}).parse(identity);
		const matches = (expected: InstalledUpdate) =>
			observed.version === expected.version &&
			observed.commit === expected.commit &&
			observed.target === expected.target;
		const shouldWrite = (state: UpdateState) => {
			const transaction = state.transaction;
			if (!terminal(transaction)) {
				const owned = transaction!;
				if (
					candidateKey(owned.candidate) !== candidateKey(owned.staged.candidate)
				)
					throw new Error(
						"Update transaction has inconsistent staged identity",
					);
				const phase = owned.phase;
				const expected = ["starting", "health", "succeeded"].includes(phase)
					? [owned.candidate]
					: ["activating", "recovery-required"].includes(phase)
						? [owned.previous, owned.candidate]
						: [owned.previous];
				if (!expected.some(matches))
					throw new Error(
						`Installed runtime does not match update transaction phase ${phase}`,
					);
				return false;
			}
			return !matches(state.installed);
		};
		const deadline = Date.now() + 1_000;
		while (true) {
			if (!shouldWrite(this.read())) return;
			try {
				// Recheck under the writer lock: a supervisor may have started a
				// transaction while this observer waited. Never overwrite its view.
				this.change((state) => {
					state.installed = observed;
				}, shouldWrite);
				return;
			} catch (error) {
				if (!(error instanceof UpdateStateLockBusyError)) throw error;
				if (Date.now() >= deadline) {
					console.warn(
						`Installed runtime observation deferred. ${error.message}`,
					);
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
		}
	}

	status() {
		const state = this.read();
		return {
			...state,
			instance: resolve(this.home),
			effectivePolicy: effectiveUpdatePolicy(state.settings),
			activationSupported: Boolean(this.lifecycle),
			operationOwner: this.operationOwner(),
		};
	}
	private operationOwner() {
		const file = join(this.directory, "operation.lock");
		return existsSync(file) ? readFileSync(file, "utf8") : undefined;
	}
	configure(input: UpdateSettingsPatch, expectedRevision: number) {
		const patch = UpdateSettingsPatchSchema.parse(input);
		this.change((state) => {
			if (state.revision !== expectedRevision)
				throw new Error("Update settings changed; refresh before saving.");
			// The irreversible boundary was already authorized. Report rather than pretending
			// a newly selected policy can undo a switch in progress.
			if (
				state.transaction &&
				[
					"stopping",
					"activating",
					"starting",
					"health",
					"rollback",
					"recovery-required",
				].includes(state.transaction.phase)
			)
				throw new Error(
					"Update switch/recovery is in progress; recover it before changing policy.",
				);
			if (patch.channel) state.settings.channel = patch.channel;
			if (patch.policy === "default")
				delete state.settings.overrides[state.settings.channel];
			else if (patch.policy)
				state.settings.overrides[state.settings.channel] = patch.policy;
			if (patch.paused !== undefined) state.settings.paused = patch.paused;
			if (patch.pin === null) delete state.settings.pin;
			else if (patch.pin !== undefined) state.settings.pin = patch.pin;
			state.revision++;
			state.nextCheckAt = 0;
			if (state.pending) {
				delete state.pending.consentRevision;
				if (!this.matches(state, state.pending.candidate)) delete state.pending;
			}
		});
		return this.status();
	}
	private matches(state: UpdateState, candidate: UpdateCandidate) {
		return (
			candidate.channel === state.settings.channel &&
			(!state.settings.pin || state.settings.pin === candidate.version) &&
			(!state.installed.target || candidate.target === state.installed.target)
		);
	}
	private downgrade(installed: InstalledUpdate, candidate: UpdateCandidate) {
		// Returning from nightly to stable remains an intentional channel change.
		if (
			installed.version.includes("-nightly.") &&
			candidate.channel === "stable"
		)
			return true;
		try {
			return compareReleaseVersions(candidate.version, installed.version) < 0;
		} catch {
			return true;
		} // Unknown development/legacy identity requires consent.
	}
	private authorized(state: UpdateState, candidate: UpdateCandidate) {
		return (
			this.matches(state, candidate) &&
			!state.settings.paused &&
			state.pending &&
			candidateKey(state.pending.candidate) === candidateKey(candidate) &&
			!state.badCandidates.includes(candidateKey(candidate)) &&
			(state.pending.consentRevision === state.revision ||
				(!state.settings.pin &&
					effectiveUpdatePolicy(state.settings) === "idle-auto" &&
					!this.downgrade(state.installed, candidate)))
		);
	}
	async check() {
		if (!this.source)
			throw new Error("No verified update source is configured.");
		const source = this.source;
		return this.operation(async () => {
			const before = this.read();
			try {
				const candidate = await source.discover(
					before.settings,
					before.installed,
				);
				this.change((state) => {
					if (state.revision !== before.revision) return;
					state.lastCheckedAt = now();
					state.failures = 0;
					state.nextCheckAt = Date.now() + 15 * 60_000;
					delete state.error;
					if (candidate) {
						CandidateSchema.parse(candidate);
						if (!this.matches(state, candidate))
							throw new Error(
								"Release does not match selected channel/pin/target.",
							);
						if (
							candidate.version === state.installed.version &&
							candidate.commit === state.installed.commit
						) {
							delete state.pending;
							return;
						}
						if (
							!state.pending ||
							candidateKey(state.pending.candidate) !== candidateKey(candidate)
						)
							state.pending = { candidate, since: now() };
					} else delete state.pending;
				});
			} catch (error) {
				this.change((state) => {
					if (state.revision !== before.revision) return;
					state.failures++;
					state.nextCheckAt =
						Date.now() +
						Math.min(
							6 * 60 * 60_000,
							60_000 * 2 ** Math.min(state.failures, 9),
						);
					state.error = (error as Error).message;
				});
			}
			return this.status();
		});
	}
	/** Explicit Install is bound to the currently displayed exact candidate + revision. */
	requestInstall(key: string, expectedRevision: number, retry = false) {
		this.change((state) => {
			if (
				state.revision !== expectedRevision ||
				!state.pending ||
				candidateKey(state.pending.candidate) !== key
			)
				throw new Error(
					"Update candidate/settings changed; refresh before Install.",
				);
			if (state.settings.paused)
				throw new Error("Updates are paused; resume before Install.");
			if (retry)
				state.badCandidates = state.badCandidates.filter(
					(value) => value !== key,
				);
			if (state.badCandidates.includes(key))
				throw new Error(
					"This candidate previously failed; use explicit retry after inspecting the result.",
				);
			state.pending.consentRevision = state.revision;
		});
		return this.status();
	}
	private async operation<T>(
		work: () => Promise<T>,
		recover = false,
	): Promise<T> {
		this.read();
		mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		return new UpdateOperationLock(join(this.directory, "operation.lock")).run(
			work,
			recover,
		);
	}
	async stage() {
		return this.operation(async () => {
			if (!this.source)
				throw new Error("No verified update source is configured.");
			const before = this.read();
			if (!before.pending)
				throw new Error("Check for an available update first.");
			try {
				const staged = StagedSchema.parse(
					await this.source.stage(before.pending.candidate),
				);
				if (
					candidateKey(staged.candidate) !==
					candidateKey(before.pending.candidate)
				)
					throw new Error("Staged release identity changed.");
				this.change((state) => {
					if (
						state.pending &&
						candidateKey(state.pending.candidate) ===
							candidateKey(staged.candidate) &&
						this.matches(state, staged.candidate)
					) {
						state.pending.staged = staged;
						delete state.error;
					}
				});
			} catch (error) {
				this.change((state) => {
					state.error = (error as Error).message;
					state.badCandidates = [
						...new Set([
							...state.badCandidates,
							candidateKey(before.pending!.candidate),
						]),
					];
				});
				throw error;
			}
			return this.status();
		});
	}
	private phase(
		phase: UpdateTransaction["phase"],
		extra: Partial<UpdateTransaction> = {},
	) {
		this.change((state) => {
			if (!state.transaction) throw new Error("Missing update transaction");
			Object.assign(state.transaction, extra, { phase });
			this.prepareRelease(state.transaction);
		});
	}
	private prepareRelease(transaction: UpdateTransaction) {
		const outcome = OutcomeSchema.safeParse(transaction.phase);
		if (outcome.success)
			transaction.release = {
				transactionId: transaction.id,
				outcome: outcome.data,
				status: "pending",
			};
	}
	private async releaseMaintenance(transactionId: string) {
		// Persist before the external call, including migration of legacy terminal
		// records. A crash or lost response must retry only this exact release.
		this.change((state) => {
			const transaction = state.transaction;
			if (!transaction || transaction.id !== transactionId)
				throw new Error("Maintenance transaction changed");
			if (!transaction.release) this.prepareRelease(transaction);
			if (!transaction.release)
				throw new Error("Maintenance release has no completed outcome");
		});
		const transaction = this.read().transaction!;
		if (transaction.release!.status === "acknowledged") return;
		try {
			await this.lifecycle!.releaseMaintenance(transactionId);
			this.change((state) => {
				if (state.transaction?.id !== transactionId)
					throw new Error("Maintenance transaction changed");
				state.transaction.phase = state.transaction.release!.outcome;
				state.transaction.release!.status = "acknowledged";
			});
		} catch (error) {
			this.phase("recovery-required", {
				error: `Maintenance release failed: ${(error as Error).message}`,
			});
			throw error;
		}
	}
	async reconcile() {
		if (!this.lifecycle)
			throw new Error(
				"Activation needs the owned lifecycle supervisor. Checkout/Nix/external installations must use their owner; no executable was switched.",
			);
		const lifecycle = this.lifecycle;
		return this.operation(async () => {
			const state = this.read();
			if (!terminal(state.transaction))
				throw new Error(
					"Interrupted update requires recovery before another activation.",
				);
			const pending = state.pending;
			if (!pending || !this.authorized(state, pending.candidate))
				return this.status();
			if (!pending.staged)
				throw new Error(
					"Stage and verify the selected update before activation.",
				);
			const transaction: UpdateTransaction = {
				id: randomUUID(),
				candidate: pending.candidate,
				staged: pending.staged,
				previous: state.installed,
				revision: state.revision,
				phase: "draining",
				switchStarted: false,
				startedAt: now(),
			};
			this.change((current) => {
				if (!this.authorized(current, transaction.candidate))
					throw new Error("Update policy changed");
				current.transaction = transaction;
			});
			let maintenance = false;
			try {
				await lifecycle.acquireMaintenance(transaction.id);
				maintenance = true;
				if (!(await lifecycle.isIdle())) {
					this.phase("cancelled", {
						error:
							"Waiting for active work/descendant leases to drain; update remains pending.",
					});
				} else {
					const eligible = () => {
						if (!this.authorized(this.read(), transaction.candidate))
							throw new Error(
								"Update activation cancelled by current policy/candidate.",
							);
					};
					eligible();
					this.phase("preflight");
					const preflight = await lifecycle.preflight(
						transaction.staged,
						transaction.previous,
					);
					if (preflight.stateCompatible !== true)
						throw new Error(
							"Candidate state compatibility is not established.",
						);
					eligible();
					this.phase("snapshot");
					const snapshot = await lifecycle.snapshot(transaction.id);
					eligible();
					// This short write is the atomic authorization boundary. A policy mutation
					// can occur during any preceding await, but never slip between authorization
					// and committing the stopping phase.
					this.change((current) => {
						if (!this.authorized(current, transaction.candidate))
							throw new Error(
								"Update activation cancelled by current policy/candidate.",
							);
						current.transaction!.snapshot = snapshot;
						current.transaction!.phase = "stopping";
						current.transaction!.switchStarted = true;
					});
					await lifecycle.stop();
					this.phase("activating");
					await lifecycle.activate(transaction.staged);
					this.phase("starting");
					await lifecycle.start();
					this.phase("health");
					await lifecycle.health(transaction.candidate);
					this.change((current) => {
						current.installed = transaction.candidate;
						current.transaction!.phase = "succeeded";
						this.prepareRelease(current.transaction!);
						delete current.pending;
						delete current.error;
					});
				}
			} catch (error) {
				const current = this.read().transaction!;
				const message = (error as Error).message;
				if (current.phase === "draining" && !maintenance) {
					this.phase("recovery-required", {
						error: `Maintenance acquisition outcome uncertain: ${message}`,
					});
				} else if (!current.switchStarted) {
					this.phase("cancelled", { error: message });
					this.change((value) => {
						value.error = message;
						if (!message.startsWith("Update activation cancelled"))
							value.badCandidates = [
								...new Set([
									...value.badCandidates,
									candidateKey(transaction.candidate),
								]),
							];
					});
				} else {
					this.phase("rollback", { error: message });
					try {
						await lifecycle.rollback(this.read().transaction!);
						this.change((value) => {
							value.installed = transaction.previous;
							value.transaction!.phase = "rolled-back";
							this.prepareRelease(value.transaction!);
							value.badCandidates = [
								...new Set([
									...value.badCandidates,
									candidateKey(transaction.candidate),
								]),
							];
							value.error = message;
							if (value.pending) delete value.pending.consentRevision;
						});
					} catch (rollbackError) {
						this.phase("recovery-required", {
							error: `${message}; rollback failed: ${(rollbackError as Error).message}`,
						});
						maintenance = false;
					}
				}
			} finally {
				if (maintenance) {
					try {
						await this.releaseMaintenance(transaction.id);
					} catch (error) {
						this.phase("recovery-required", {
							error: `Maintenance release failed: ${(error as Error).message}`,
						});
					}
				}
			}
			return this.status();
		});
	}
	/** Caller must stop the recorded operation owner first. Retains transaction;
	 * interrupted switches always roll back, never blindly retry an activation. */
	async recover(confirm: string) {
		if (confirm !== "operation owner stopped")
			throw new Error(
				'Confirm "operation owner stopped" only after checking the retained owner is no longer running.',
			);
		if (!this.lifecycle)
			throw new Error("Recovery needs the owned lifecycle supervisor.");
		return this.operation(async () => {
			const transaction = this.read().transaction;
			if (
				transaction &&
				(transaction.release?.status === "pending" ||
					(OutcomeSchema.safeParse(transaction.phase).success &&
						!transaction.release))
			) {
				await this.releaseMaintenance(transaction.id);
				return this.status();
			}
			if (!terminal(transaction)) {
				await this.lifecycle!.acquireMaintenance(transaction!.id);
				if (!transaction!.switchStarted)
					this.phase("cancelled", {
						error: "Interrupted before switching; previous runtime retained.",
					});
				else {
					this.phase("rollback");
					try {
						await this.lifecycle!.rollback(transaction!);
						this.change((state) => {
							state.installed = transaction!.previous;
							state.transaction!.phase = "rolled-back";
							this.prepareRelease(state.transaction!);
							state.badCandidates = [
								...new Set([
									...state.badCandidates,
									candidateKey(transaction!.candidate),
								]),
							];
							if (state.pending) delete state.pending.consentRevision;
						});
					} catch (error) {
						this.phase("recovery-required", {
							error: (error as Error).message,
						});
						throw error;
					}
				}
				await this.releaseMaintenance(transaction!.id);
			}
			return this.status();
		}, true);
	}
	/** Supervisor timer: 15-minute release checks, capped exponential offline
	 * backoff; pending candidates coalesce to the current signed channel target. */
	async tick() {
		if (Date.now() >= this.read().nextCheckAt) await this.check();
		const state = this.read();
		if (state.pending && this.authorized(state, state.pending.candidate)) {
			if (!state.pending.staged) await this.stage();
			if (this.lifecycle) await this.reconcile();
		}
		return this.status();
	}
}
