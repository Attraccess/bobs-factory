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
import { ownerAlive, workerOwner } from "./InstanceLock.js";
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
		const current = workerOwner(home);
		if (current?.pid === process.pid)
			throw new Error(
				"Update supervisor must be outside the worker being replaced",
			);
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
		if (existsSync(this.fence())) {
			const saved = JSON.parse(readFileSync(this.fence(), "utf8"));
			if (saved.transactionId !== transactionId)
				throw new Error("Another update owns lifecycle suppression");
			this.preservation = saved.preservation;
		}
		this.transactionId = transactionId;
		this.save({ transactionId, preservation: this.preservation });
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
	async stop() {
		if (!this.transactionId) throw new Error("Maintenance required");
		const fresh = await this.client.get<Drain>("/api/updates/drain");
		if (
			!fresh.idle ||
			fresh.preservedStateSha256 !== this.preservation?.preservedStateSha256
		)
			throw new Error("Idle/preserved state changed before stop");
		if (this.owner.kind === "service") await this.manager.action("maintenance");
		else {
			const owner = workerOwner(this.home);
			if (
				!owner ||
				owner.owner !== "desktop" ||
				!ownerAlive(owner) ||
				owner.executable !== realpathSync(this.owner.executable)
			)
				throw new Error("Desktop worker ownership mismatch");
			process.kill(owner.pid, "SIGTERM");
			for (let attempt = 0; workerOwner(this.home) && attempt < 300; attempt++)
				await new Promise((resolve) => setTimeout(resolve, 100));
			if (workerOwner(this.home))
				throw new Error(
					"Desktop worker still owns home; replacement forbidden",
				);
		}
	}
	private switchLink(executable: string) {
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
	async start() {
		if (this.owner.kind === "service") await this.manager.resume();
		else {
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
			child.unref();
		}
	}
	async health(candidate: LifecycleCandidate) {
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
			} catch {}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		throw new Error(
			"Replacement failed exact runtime/preserved-state health check",
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
			else {
				const owner = workerOwner(this.home)!;
				if (
					owner.owner !== "desktop" ||
					!ownerAlive(owner) ||
					owner.executable !== realpathSync(this.owner.executable)
				)
					throw new Error("Replacement owner changed; rollback blocked");
				process.kill(owner.pid, "SIGTERM");
				for (let i = 0; workerOwner(this.home) && i < 300; i++)
					await new Promise((resolve) => setTimeout(resolve, 100));
			}
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
		if (transactionId !== this.transactionId)
			throw new Error("Maintenance owner mismatch");
		await this.client.post("/api/updates/maintenance", {
			transactionId,
			action: "end",
		});
		rmSync(this.fence());
	}
}
