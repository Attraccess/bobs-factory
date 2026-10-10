import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { requestFactoryTerminalSession } from "bobs-factory-edge-worker";
import { FactoryClient } from "../tui/client.js";
import { desktopStopped, lifecycleGuard } from "./DesktopLifecycle.js";
import {
	assertInstallationProof,
	type InstallationProof,
	installationProof,
} from "./InstallationOwnership.js";
import {
	acquireInstanceLock,
	ownerAlive,
	workerOwner,
} from "./InstanceLock.js";
import { ServiceLifecycle } from "./ServiceLifecycle.js";

const runFile = promisify(execFile);
export interface LifecycleCandidate {
	version: string;
	commit: string;
	target: string;
}
export interface LifecycleStaged {
	candidate: LifecycleCandidate;
	executable: string;
	previousExecutable: string;
}
export interface LifecycleTransaction {
	id: string;
	staged: LifecycleStaged;
	snapshot?: string;
}
interface Drain {
	idle: boolean;
	preservedStateSha256: string;
	runIds: string[];
}
interface Owner {
	kind: "service" | "desktop";
	executable: string;
}
/** External owner adapter. Never replace a running worker from its own process. */
export class OwnedUpdateLifecycle {
	private transactionId?: string;
	private preservation?: Drain;
	private staged?: LifecycleStaged;
	private readonly manager: ServiceLifecycle;
	private readonly client: FactoryClient;
	private readonly owner: Owner;
	private readonly installationOwner: InstallationProof | undefined;
	constructor(
		readonly home: string,
		port: number,
	) {
		this.manager = new ServiceLifecycle(home);
		this.client = new FactoryClient({
			home,
			port,
			requestSession: requestFactoryTerminalSession,
		});
		const service = this.manager.record();
		const desktop = join(home, "runtime", "desktop-runtime.json");
		if (service)
			this.owner = { kind: "service", executable: service.executable };
		else if (existsSync(desktop)) {
			const record = JSON.parse(readFileSync(desktop, "utf8"));
			const link = join(
				home,
				"runtime",
				"desktop-installed",
				"bin",
				"bobs-factory",
			);
			if (
				record.schema !== 1 ||
				record.home !== realpathSync(home) ||
				record.executable !== link
			)
				throw new Error("Desktop installation ownership mismatch");
			this.owner = { kind: "desktop", executable: link };
		} else
			throw new Error(
				"Foreground/checkout/Nix/external owner: use its supported update handoff, not an owned replacement",
			);
		if (!lstatSync(this.owner.executable).isSymbolicLink())
			throw new Error(
				"Updates require the explicit owned executable link, never an app bundle/system executable",
			);
		this.installationOwner =
			service?.updateOwner ??
			(!service ? installationProof(home, this.owner.executable) : undefined);
		assertInstallationProof(
			home,
			this.owner.executable,
			this.installationOwner,
		);
		const current = workerOwner(home);
		if (current?.pid === process.pid)
			throw new Error(
				"Update supervisor must be outside the worker being replaced",
			);
	}
	get runtimeLink() {
		return this.owner.executable;
	}
	private fence() {
		return join(this.home, "runtime", "update-owner.json");
	}
	private save(value: unknown) {
		mkdirSync(dirname(this.fence()), { recursive: true, mode: 0o700 });
		writeFileSync(`${this.fence()}.tmp`, JSON.stringify(value), {
			mode: 0o600,
			flush: true,
		});
		renameSync(`${this.fence()}.tmp`, this.fence());
	}
	async acquireMaintenance(transactionId: string) {
		const release = await lifecycleGuard(this.home);
		try {
			this.assertMayStart();
			assertInstallationProof(
				this.home,
				this.owner.executable,
				this.installationOwner,
			);
			this.admitMaintenance(transactionId);
		} finally {
			release();
		}
		await this.beginMaintenance(transactionId);
	}
	private admitMaintenance(transactionId: string) {
		if (existsSync(this.fence())) {
			const saved = JSON.parse(readFileSync(this.fence(), "utf8"));
			if (saved.transactionId !== transactionId)
				throw new Error("Another update owns lifecycle suppression");
			this.preservation = saved.preservation;
		}
		this.transactionId = transactionId;
		this.save({ transactionId, preservation: this.preservation });
	}
	private async beginMaintenance(transactionId: string) {
		const current = workerOwner(this.home);
		if (!current || !ownerAlive(current)) {
			if (!this.preservation) {
				const transaction = JSON.parse(
					readFileSync(join(this.home, "updates", "state.json"), "utf8"),
				).transaction;
				if (
					transaction?.id !== transactionId ||
					transaction.switchStarted ||
					realpathSync(this.owner.executable) !==
						realpathSync(transaction.staged.previousExecutable)
				)
					throw new Error(
						"Interrupted switch lacks a durable preservation receipt",
					);
			}
			const marker = process.env.BOBS_FACTORY_WORKER_ID;
			try {
				const release = await acquireInstanceLock(this.home);
				release();
			} finally {
				if (marker === undefined) delete process.env.BOBS_FACTORY_WORKER_ID;
				else process.env.BOBS_FACTORY_WORKER_ID = marker;
			}
			if (this.preservation) return;
			if (this.owner.kind === "desktop") await this.start();
			else {
				for (let attempt = 0; attempt < 150; attempt++) {
					const live = workerOwner(this.home);
					if (live && ownerAlive(live)) break;
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
			}
		}
		await this.client.post("/api/updates/maintenance", {
			transactionId,
			action: "begin",
		});
	}
	async isIdle() {
		const receipt = await this.client.get<Drain>("/api/updates/drain");
		if (receipt.idle) {
			this.preservation = receipt;
			this.save({ transactionId: this.transactionId, preservation: receipt });
		}
		return receipt.idle;
	}
	private copyOwned(destination: string) {
		mkdirSync(destination, { recursive: true, mode: 0o700 });
		const copy = (source: string, target: string, relative: string) => {
			if (relative === "factory/auth" || relative.startsWith("factory/auth/"))
				return;
			const stat = lstatSync(source);
			if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
				throw new Error(
					`Snapshot refuses external/special owned state: ${relative}`,
				);
			if (stat.isDirectory()) {
				mkdirSync(target, { recursive: true, mode: 0o700 });
				for (const name of readdirSync(source))
					copy(join(source, name), join(target, name), `${relative}/${name}`);
			} else cpSync(source, target);
		};
		for (const name of ["config.json", "state", "factory"]) {
			const source = join(this.home, name);
			if (existsSync(source)) copy(source, join(destination, name), name);
		}
	}
	async preflight(staged: LifecycleStaged, installed: { version: string }) {
		if (
			staged.candidate.version.split(".")[0] !== installed.version.split(".")[0]
		)
			throw new Error(
				"Cross-major state migration requires an explicit reviewed adapter",
			);
		const executable = realpathSync(staged.executable),
			previous = realpathSync(staged.previousExecutable);
		if (previous !== realpathSync(this.owner.executable))
			throw new Error("Staged previous runtime does not match selected owner");
		const metadata = JSON.parse(
			readFileSync(join(dirname(executable), "build.json"), "utf8"),
		);
		const bytes = readFileSync(executable);
		if (
			metadata.product !== "bobs-factory" ||
			metadata.dirty ||
			metadata.version !== staged.candidate.version ||
			metadata.commit !== staged.candidate.commit ||
			metadata.target !== staged.candidate.target ||
			metadata.executable?.sha256 !==
				createHash("sha256").update(bytes).digest("hex") ||
			metadata.executable.size !== bytes.length
		)
			throw new Error("Staged runtime identity/integrity mismatch");
		const isolated = mkdtempSync(join(tmpdir(), "factory-update-preflight-"));
		try {
			this.copyOwned(isolated);
			const { stdout } = await runFile(
				executable,
				["--home", isolated, "--no-open", "service", "validate-state"],
				{ timeout: 30000, env: { PATH: process.env.PATH, HOME: isolated } },
			);
			const result = JSON.parse(stdout);
			if (result.stateCompatible !== true)
				throw new Error("Candidate state preflight failed");
			if (
				JSON.stringify(result.runIds) !==
				JSON.stringify(this.preservation?.runIds)
			)
				throw new Error("Preflight lost preserved workflow identities");
		} finally {
			rmSync(isolated, { recursive: true, force: true });
		}
		this.staged = { ...staged, executable, previousExecutable: previous };
		return { stateCompatible: true as const };
	}
	async snapshot(transactionId: string) {
		if (transactionId !== this.transactionId || !this.preservation)
			throw new Error("Verified idle receipt required before snapshot");
		const path = join(this.home, "updates", "snapshots", transactionId);
		if (existsSync(path))
			throw new Error(
				"Snapshot already exists: recover the persisted transaction",
			);
		this.copyOwned(path);
		writeFileSync(
			join(path, "lifecycle-receipt.json"),
			JSON.stringify(this.preservation),
			{ mode: 0o600 },
		);
		return path;
	}
	private async stopDesktopOwner() {
		const expected = workerOwner(this.home);
		if (
			!expected ||
			expected.owner !== "desktop" ||
			expected.executable !== realpathSync(this.owner.executable)
		)
			throw new Error("Desktop worker ownership mismatch");
		if (ownerAlive(expected)) {
			try {
				process.kill(expected.pid, "SIGTERM");
			} catch (error) {
				if (ownerAlive(expected)) throw error;
			}
		}
		for (let attempt = 0; attempt < 300; attempt++) {
			const current = workerOwner(this.home);
			if (!current) return;
			if (current.nonce !== expected.nonce)
				throw new Error(
					"Worker owner changed during shutdown; replacement forbidden",
				);
			if (!ownerAlive(current)) {
				const release = await acquireInstanceLock(this.home, {
					markWorker: false,
				});
				release();
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error("Desktop worker still owns home; replacement forbidden");
	}
	async stop() {
		if (!this.transactionId) throw new Error("Maintenance required");
		const fresh = await this.client.get<Drain>("/api/updates/drain");
		if (
			!fresh.idle ||
			fresh.preservedStateSha256 !== this.preservation?.preservedStateSha256
		)
			throw new Error("Idle/preserved state changed before stop");
		if (this.owner.kind === "service") await this.manager.action("maintenance");
		else await this.stopDesktopOwner();
	}
	private switchLink(executable: string) {
		assertInstallationProof(
			this.home,
			this.owner.executable,
			this.installationOwner,
		);
		if (workerOwner(this.home))
			throw new Error("Existing worker ownership blocks runtime activation");
		const next = `${this.owner.executable}.next-${this.transactionId}`;
		try {
			symlinkSync(executable, next);
			renameSync(next, this.owner.executable);
		} catch (error) {
			try {
				rmSync(next);
			} catch {}
			throw error;
		}
	}
	async activate(staged: LifecycleStaged) {
		if (
			!this.staged ||
			this.staged.executable !== realpathSync(staged.executable)
		)
			throw new Error("Candidate not preflighted");
		this.switchLink(this.staged.executable);
	}
	private async readyRuntime() {
		const expected = JSON.parse(
			readFileSync(
				join(dirname(realpathSync(this.owner.executable)), "build.json"),
				"utf8",
			),
		);
		const readiness = new FactoryClient({
			home: this.home,
			port: Number(new URL(this.client.origin).port),
			requestSession: requestFactoryTerminalSession,
			requestTimeoutMs: 1000,
		});
		const deadline = Date.now() + 30000;
		while (Date.now() < deadline) {
			try {
				const { runtime } = await readiness.get<{
					runtime: LifecycleCandidate;
				}>("/api/version");
				const owner = workerOwner(this.home);
				if (
					owner &&
					ownerAlive(owner) &&
					owner.executable === realpathSync(this.owner.executable) &&
					runtime.version === expected.version &&
					runtime.commit === expected.commit &&
					runtime.target === expected.target
				)
					return;
			} catch {}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		throw new Error(
			"Owned worker did not become ready with the exact runtime identity",
		);
	}
	private assertMayStart() {
		if (
			desktopStopped(this.home) ||
			["stopped"].includes(this.manager.record()?.desired ?? "")
		)
			throw new Error(
				"Deliberate Stop intent blocks automatic startup/recovery",
			);
	}
	async start() {
		const release = await lifecycleGuard(this.home);
		try {
			this.assertMayStart();
			assertInstallationProof(
				this.home,
				this.owner.executable,
				this.installationOwner,
			);
			await this.startOwned();
		} finally {
			release();
		}
	}
	private async startOwned() {
		if (this.owner.kind === "service") {
			await this.manager.resume();
			for (let attempt = 0; attempt < 300; attempt++) {
				const current = workerOwner(this.home);
				if (
					current &&
					current.owner === "service" &&
					current.executable === realpathSync(this.owner.executable) &&
					ownerAlive(current)
				) {
					await this.readyRuntime();
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			throw new Error(
				"Managed replacement did not acquire its worker startup fence",
			);
		} else {
			const { spawn } = await import("node:child_process");
			const log = (await import("node:fs")).openSync(
				join(this.home, "runtime", "desktop-worker.log"),
				"a",
				0o600,
			);
			const child = spawn(
				this.owner.executable,
				[
					"--home",
					this.home,
					"--port",
					String(new URL(this.client.origin).port),
					"--no-open",
					"local",
				],
				{
					detached: true,
					stdio: ["ignore", log, log],
					env: { ...process.env, BOBS_FACTORY_DESKTOP_OWNER: "1" },
				},
			);
			(await import("node:fs")).closeSync(log);
			let launchError: Error | undefined;
			child.on("error", (error) => {
				launchError = error;
			});
			child.unref();
			// A spawned process has not necessarily claimed its durable worker
			// fence yet. Never let immediate failure/rollback race that startup.
			for (let attempt = 0; attempt < 300; attempt++) {
				if (launchError) throw launchError;
				if (child.exitCode !== null || child.signalCode !== null)
					throw new Error("Owned worker exited before acquiring ownership");
				const current = workerOwner(this.home);
				if (current) {
					if (current.pid !== child.pid)
						throw new Error("Another worker acquired ownership during launch");
					if (ownerAlive(current)) {
						await this.readyRuntime();
						return;
					}
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			throw new Error(
				"Owned worker did not acquire its startup fence; recovery must confirm its exit",
			);
		}
	}
	async restartCrashedDesktop() {
		if (
			this.owner.kind !== "desktop" ||
			existsSync(this.fence()) ||
			existsSync(join(this.home, "runtime", "desktop-stopped.json"))
		)
			return;
		const current = workerOwner(this.home);
		if (current && ownerAlive(current)) return;
		const marker = process.env.BOBS_FACTORY_WORKER_ID;
		try {
			const release = await acquireInstanceLock(this.home);
			release();
		} finally {
			if (marker === undefined) delete process.env.BOBS_FACTORY_WORKER_ID;
			else process.env.BOBS_FACTORY_WORKER_ID = marker;
		}
		await this.start();
	}

	async health(candidate: LifecycleCandidate) {
		let failure = "Runtime did not respond";
		for (let attempt = 0; attempt < 100; attempt++) {
			try {
				const identity = await this.client.get<{ runtime: LifecycleCandidate }>(
					"/api/version",
				);
				const receipt = await this.client.get<Drain>("/api/updates/drain");
				const owner = workerOwner(this.home);
				if (
					identity.runtime.version === candidate.version &&
					identity.runtime.commit === candidate.commit &&
					identity.runtime.target === candidate.target &&
					owner &&
					ownerAlive(owner) &&
					receipt.preservedStateSha256 ===
						this.preservation?.preservedStateSha256
				)
					return;
				failure = `Observed ${identity.runtime.version}/${identity.runtime.commit}/${identity.runtime.target}; liveOwner=${Boolean(owner && ownerAlive(owner))}; preservedState=${receipt.preservedStateSha256 === this.preservation?.preservedStateSha256}`;
			} catch (error) {
				failure = (error as Error).message;
			}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		throw new Error(
			`Replacement failed exact runtime/preserved-state health check: ${failure}`,
		);
	}
	async rollback(transaction: LifecycleTransaction) {
		if (
			!transaction.snapshot ||
			resolve(transaction.snapshot) !==
				join(resolve(this.home), "updates", "snapshots", transaction.id)
		)
			throw new Error("Rollback snapshot ownership mismatch");
		// Suppression stays active. Stop only the failed replacement, never a new external owner.
		if (workerOwner(this.home)) {
			if (this.owner.kind === "service")
				await this.manager.action("maintenance");
			else await this.stopDesktopOwner();
		}
		if (workerOwner(this.home))
			throw new Error("Replacement exit not confirmed");
		// Restore only bounded Factory-owned state after replacement exit. Keep
		// actual native stores outside this home, current auth, updates and runtime.
		const retained = join(
			this.home,
			"updates",
			"recovery-retained",
			transaction.id,
		);
		mkdirSync(retained, { recursive: true, mode: 0o700 });
		for (const name of ["config.json", "state", "factory"]) {
			const current = join(this.home, name),
				backup = join(transaction.snapshot, name);
			if (existsSync(join(retained, name)))
				throw new Error(
					"Interrupted rollback requires reconciliation of retained state",
				);
			if (existsSync(current)) renameSync(current, join(retained, name));
			if (existsSync(backup)) cpSync(backup, current, { recursive: true });
			if (name === "factory" && existsSync(join(retained, name, "auth"))) {
				mkdirSync(current, { recursive: true, mode: 0o700 });
				renameSync(join(retained, name, "auth"), join(current, "auth"));
			}
		}
		this.switchLink(realpathSync(transaction.staged.previousExecutable));
		await this.start();
		const old = JSON.parse(
			readFileSync(
				join(
					dirname(realpathSync(transaction.staged.previousExecutable)),
					"build.json",
				),
				"utf8",
			),
		);
		await this.health(old);
	}
	async releaseMaintenance(transactionId: string) {
		if (!this.transactionId) {
			const journal = JSON.parse(
				readFileSync(join(this.home, "updates", "state.json"), "utf8"),
			);
			const transaction = journal.transaction;
			if (
				transaction?.id !== transactionId ||
				(transaction.release &&
					transaction.release.transactionId !== transactionId) ||
				(!transaction.release &&
					!["succeeded", "rolled-back", "cancelled"].includes(
						transaction.phase,
					))
			)
				throw new Error(
					"Maintenance release lacks exact durable terminal outcome",
				);
			this.transactionId = transactionId;
		}
		if (transactionId !== this.transactionId)
			throw new Error("Maintenance owner mismatch");
		if (existsSync(this.fence())) {
			const saved = JSON.parse(readFileSync(this.fence(), "utf8"));
			if (saved.transactionId !== transactionId)
				throw new Error("Another lifecycle owns maintenance");
			this.preservation = saved.preservation;
		} else if (!existsSync(join(this.home, "updates", "maintenance.json")))
			return;
		const current = workerOwner(this.home);
		if (!current || !ownerAlive(current)) {
			const journal = JSON.parse(
				readFileSync(join(this.home, "updates", "state.json"), "utf8"),
			);
			const transaction = journal.transaction;
			const expected =
				(transaction.release?.outcome ?? transaction.phase) === "succeeded"
					? transaction.candidate
					: transaction.previous;
			await this.acquireMaintenance(transactionId);
			await this.start();
			await this.health(expected);
		}
		await this.client.post("/api/updates/maintenance", {
			transactionId,
			action: "end",
		});
		rmSync(this.fence(), { force: true });
	}
}
