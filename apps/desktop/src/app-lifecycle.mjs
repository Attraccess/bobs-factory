import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	appExecutable,
	appFingerprint,
	installationKind,
	verifyAppProof,
} from "./app-source.mjs";

const sleep = () => new Promise((r) => setTimeout(r, 100));
export function save(file, value) {
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	writeFileSync(`${file}.tmp`, JSON.stringify(value), {
		mode: 0o600,
		flush: true,
	});
	renameSync(`${file}.tmp`, file);
}
export const read = (file) => JSON.parse(readFileSync(file, "utf8"));
export function processStamp(pid) {
	try {
		return (
			execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}).trim() || undefined
		);
	} catch (e) {
		if (e.status === 1) return;
		throw e;
	}
}
function descendantOf(pid, ancestor) {
	for (let n = 0; n < 32 && pid > 1; n++) {
		if (pid === ancestor) return true;
		try {
			pid = Number(
				execFileSync("/bin/ps", ["-p", String(pid), "-o", "ppid="], {
					encoding: "utf8",
					stdio: ["ignore", "pipe", "pipe"],
				}).trim(),
			);
		} catch (error) {
			if (error.status === 1) return false;
			throw error;
		}
	}
	return false;
}
function processGroup(pid) {
	try {
		return Number(
			execFileSync("/bin/ps", ["-p", String(pid), "-o", "pgid="], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}).trim(),
		);
	} catch (error) {
		if (error.status === 1) return;
		throw error;
	}
}
function groupAlive(group) {
	return execFileSync("/bin/ps", ["-e", "-o", "pgid="], { encoding: "utf8" })
		.split("\n")
		.some((value) => Number(value.trim()) === group);
}
export class DesktopAppLifecycle {
	constructor(options, services) {
		Object.assign(this, options);
		this.services = services;
		this.directory = join(this.home, "desktop", "updates");
		this.fence = join(this.home, "runtime", "update-owner.json");
		this.receipt = join(this.directory, "installation.json");
		this.client = new services.FactoryClient({
			home: this.home,
			port: this.port,
			requestSession: services.requestFactoryTerminalSession,
		});
	}
	journal() {
		return read(join(this.directory, "state.json")).transaction;
	}
	assertOwner() {
		const r = read(this.receipt);
		const metadata = verifyAppProof(r.proof, r.candidate, this.services);
		if (
			r.schema !== 1 ||
			r.install !== this.install ||
			r.target !== this.target ||
			r.candidate.target !== this.target ||
			r.fingerprint !== metadata.fingerprint ||
			installationKind(this.install, this.target) !== "bob-owned" ||
			appFingerprint(this.install, this.target) !== r.fingerprint
		)
			throw Error(
				"App ownership/integrity changed; use package-manager/manual handoff",
			);
	}
	async acquireMaintenance(id) {
		const release = await this.services.lifecycleGuard(this.home);
		try {
			if (
				this.services.desktopStopped(this.home) &&
				this.services.workerOwner(this.home)
			)
				throw Error(
					"Stopped intent conflicts with a live worker; reconcile its owner",
				);
			const service = join(this.home, "runtime", "service.json");
			if (
				existsSync(service) &&
				read(service).desiredState === "stopped" &&
				this.services.workerOwner(this.home)
			)
				throw Error("Service stopped intent conflicts with a live worker");
			if (
				existsSync(this.fence) &&
				(read(this.fence).transactionId !== id ||
					read(this.fence).product !== "bobs-factory-desktop")
			)
				throw Error("Another lifecycle owns maintenance");
			this.id = id;
			// An interrupted switch may have moved the old app. Recover from its immutable snapshot.
			if (!this.journal()?.switchStarted) this.assertOwner();
			const currentWorker = this.services.workerOwner(this.home);
			if (
				currentWorker &&
				!(await this.client.get("/api/version")).capabilities?.includes(
					"desktop-app-maintenance-v1",
				)
			)
				throw Error(
					"Update the local Factory runtime through its owner before shell activation; it lacks desktop maintenance support",
				);
			this.worker = existsSync(this.fence)
				? read(this.fence).worker
				: this.services.workerOwner(this.home);
			save(this.fence, {
				transactionId: id,
				product: "bobs-factory-desktop",
				worker: this.worker,
			});
		} finally {
			release();
		}
		if (this.worker) {
			this.unchangedWorker();
			await this.client.post("/api/updates/maintenance", {
				transactionId: id,
				action: "begin",
			});
		}
	}
	unchangedWorker() {
		const now = this.services.workerOwner(this.home);
		if (
			this.worker
				? !now ||
					now.nonce !== this.worker.nonce ||
					now.pid !== this.worker.pid ||
					!this.services.ownerAlive(now)
				: Boolean(now)
		)
			throw Error(
				"Local worker ownership changed; shell updater will not start or replace it",
			);
	}
	async isIdle() {
		this.unchangedWorker();
		return this.worker
			? (await this.client.get("/api/updates/drain")).idle
			: true;
	}
	async preflight(staged) {
		this.assertOwner();
		if (staged.previousExecutable !== this.install)
			throw Error("Staged app installation changed");
		const proof = read(
			join(
				dirname(staged.executable),
				this.target.startsWith("darwin") ? ".." : ".",
				"verified.json",
			),
		);
		const metadata = verifyAppProof(
			proof.proof,
			staged.candidate,
			this.services,
		);
		if (appFingerprint(staged.executable, this.target) !== metadata.fingerprint)
			throw Error("Staged app changed");
		return { stateCompatible: true };
	}
	async snapshot(id) {
		this.assertOwner();
		const path = join(this.directory, `switch-${id}.json`);
		save(path, {
			install: this.install,
			previous: `${this.install}.bobs-previous-${id}`,
			replacement: `${this.install}.bobs-candidate-${id}`,
			receipt: read(this.receipt),
			healthToken: randomUUID(),
			worker: this.worker,
		});
		return path;
	}
	async stop() {
		this.unchangedWorker();
		if (!(await this.isIdle()))
			throw Error("Work started before shell activation");
		save(join(this.directory, "quit.json"), {
			transactionId: this.id,
			pid: this.uiPid,
			stamp: this.uiStamp,
		});
		for (let n = 0; n < 600; n++) {
			if (processStamp(this.uiPid) !== this.uiStamp) return;
			await sleep();
		}
		throw Error("Desktop UI did not exit; no app replaced");
	}
	async activate(staged) {
		const t = this.journal(),
			s = read(t.snapshot);
		this.assertOwner();
		this.unchangedWorker();
		if (existsSync(s.previous) || existsSync(s.replacement))
			throw Error("Retained app paths require recovery");
		cpSync(staged.executable, s.replacement, {
			recursive: this.target.startsWith("darwin"),
			dereference: false,
			verbatimSymlinks: true,
			errorOnExist: true,
			force: false,
		});
		const proof = read(
			join(
				dirname(staged.executable),
				this.target.startsWith("darwin") ? ".." : ".",
				"verified.json",
			),
		);
		const metadata = verifyAppProof(
			proof.proof,
			staged.candidate,
			this.services,
		);
		if (appFingerprint(s.replacement, this.target) !== metadata.fingerprint)
			throw Error("Copied app integrity failure");
		renameSync(this.install, s.previous);
		renameSync(s.replacement, this.install);
		save(this.receipt, {
			schema: 1,
			install: this.install,
			target: this.target,
			fingerprint: metadata.fingerprint,
			candidate: staged.candidate,
			proof: proof.proof,
		});
	}
	async start() {
		const t = this.journal(),
			s = read(t.snapshot);
		this.unchangedWorker();
		save(t.snapshot, { ...s, launchPending: true });
		const child = spawn(
			appExecutable(this.install, this.target),
			this.launchArgs ?? [],
			{
				detached: true,
				stdio: "ignore",
				env: {
					...process.env,
					ELECTRON_RUN_AS_NODE: undefined,
					BOBS_FACTORY_DESKTOP_HOME: this.home,
					BOBS_FACTORY_DESKTOP_PORT: String(this.port),
					BOBS_FACTORY_DESKTOP_HEALTH: s.healthToken,
				},
			},
		);
		const launched = await new Promise((resolve, reject) => {
			child.once("spawn", () => resolve(child.pid));
			child.once("error", reject);
		});
		save(t.snapshot, {
			...s,
			launchPending: false,
			child: { pid: launched, stamp: processStamp(launched) },
		});
		child.unref();
	}
	async health(candidate) {
		const s = read(this.journal().snapshot);
		for (let n = 0; n < 300; n++) {
			const path = join(this.directory, `health-${s.healthToken}.json`);
			if (existsSync(path)) {
				const h = read(path);
				if (
					h.token !== s.healthToken ||
					h.install !== this.install ||
					h.version !== candidate.version ||
					h.commit !== candidate.commit ||
					h.target !== candidate.target ||
					!s.child ||
					!descendantOf(h.pid, s.child.pid) ||
					!h.stamp ||
					processStamp(h.pid) !== h.stamp
				)
					throw Error("Candidate shell health identity mismatch");
				save(this.journal().snapshot, {
					...s,
					launcher: s.child,
					child: { pid: h.pid, stamp: h.stamp },
				});
				this.assertOwner();
				this.unchangedWorker();
				return;
			}
			if (processStamp(s.child.pid) !== s.child.stamp)
				throw Error("Candidate shell exited before readiness");
			await sleep();
		}
		throw Error("Candidate shell readiness timed out");
	}
	async rollback(transaction) {
		let s = read(transaction.snapshot);
		if (
			s.install !== this.install ||
			s.receipt.install !== this.install ||
			s.previous !== `${this.install}.bobs-previous-${transaction.id}` ||
			s.replacement !== `${this.install}.bobs-candidate-${transaction.id}`
		)
			throw Error("Recovery installation/snapshot identity mismatch");
		if (s.launchPending && !s.child) {
			const health = join(this.directory, `health-${s.healthToken}.json`);
			for (let n = 0; n < 100 && !existsSync(health); n++) await sleep();
			if (!existsSync(health))
				throw Error(
					"Interrupted shell launch lacks a process receipt; inspect and stop candidate UI before recovery",
				);
			const h = read(health);
			if (
				h.token !== s.healthToken ||
				h.install !== this.install ||
				h.version !== transaction.candidate.version ||
				h.commit !== transaction.candidate.commit ||
				h.target !== transaction.candidate.target ||
				!h.stamp ||
				processStamp(h.pid) !== h.stamp
			)
				throw Error("Interrupted shell process receipt mismatch");
			s = { ...s, child: { pid: h.pid, stamp: h.stamp } };
			save(transaction.snapshot, s);
		}
		this.unchangedWorker();
		// Never signal an unverified PID, and never restart a Factory worker.
		if (s.child?.stamp && processStamp(s.child.pid) === s.child.stamp) {
			const launcher = s.launcher ?? s.child;
			const group =
				processGroup(s.child.pid) === launcher.pid &&
				(launcher.pid !== s.child.pid ||
					processStamp(launcher.pid) === launcher.stamp)
					? launcher.pid
					: undefined;
			process.kill(group ? -group : s.child.pid, "SIGTERM");
			for (let n = 0; n < 100; n++) {
				if (
					group
						? !groupAlive(group)
						: processStamp(s.child.pid) !== s.child.stamp
				)
					break;
				await sleep();
			}
			if (
				group ? groupAlive(group) : processStamp(s.child.pid) === s.child.stamp
			)
				throw Error("Failed shell still running; rollback deferred");
		}
		if (processStamp(this.uiPid) === this.uiStamp) {
			save(join(this.directory, "quit.json"), {
				transactionId: transaction.id,
				pid: this.uiPid,
				stamp: this.uiStamp,
			});
			for (let n = 0; n < 300 && processStamp(this.uiPid) === this.uiStamp; n++)
				await sleep();
			if (processStamp(this.uiPid) === this.uiStamp)
				throw Error("Current UI must exit before app recovery");
		}
		const previousMetadata = verifyAppProof(
			s.receipt.proof,
			s.receipt.candidate,
			this.services,
		);
		if (s.receipt.fingerprint !== previousMetadata.fingerprint)
			throw Error("Previous app receipt fingerprint mismatch");
		if (existsSync(s.previous)) {
			if (appFingerprint(s.previous, this.target) !== s.receipt.fingerprint)
				throw Error("Previous app integrity failure");
			if (existsSync(this.install))
				renameSync(
					this.install,
					`${this.install}.bobs-failed-${transaction.id}`,
				);
			renameSync(s.previous, this.install);
		}
		if (appFingerprint(this.install, this.target) !== s.receipt.fingerprint)
			throw Error("Cannot verify previous app");
		save(this.receipt, s.receipt);
		if (processStamp(this.uiPid) !== this.uiStamp) {
			save(transaction.snapshot, {
				...read(transaction.snapshot),
				healthToken: randomUUID(),
				child: undefined,
				launchPending: false,
			});
			await this.start();
			await this.health(transaction.previous);
		}
	}
	async releaseMaintenance(id) {
		const release = await this.services.lifecycleGuard(this.home);
		try {
			if (!existsSync(this.fence)) return;
			const f = read(this.fence);
			if (f.transactionId !== id || f.product !== "bobs-factory-desktop")
				throw Error("Shell maintenance identity changed");
			if (f.worker) {
				this.worker = f.worker;
				this.unchangedWorker();
				await this.client.post("/api/updates/maintenance", {
					transactionId: id,
					action: "end",
				});
			}
			rmSync(this.fence);
			rmSync(join(this.directory, "quit.json"), { force: true });
		} finally {
			release();
		}
	}
}
