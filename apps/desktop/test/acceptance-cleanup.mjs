// Test-only POSIX ownership ledger. Never discover owners outside explicit fixture homes.
import { execFileSync, spawn } from "node:child_process";
import {
	lstatSync,
	readlinkSync,
	realpathSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

function processes() {
	return execFileSync(
		"/bin/ps",
		["-axo", "pid=,pgid=,stat=,lstart=,command="],
		{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
	)
		.split("\n")
		.flatMap((line) => {
			const match = line
				.trim()
				.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.{24})\s+(.*)$/);
			return match
				? [
						{
							pid: Number(match[1]),
							group: Number(match[2]),
							zombie: match[3].startsWith("Z"),
							stamp: match[4].trim(),
							command: match[5],
						},
					]
				: [];
		});
}
// argv may change during exec/startup; the kernel start stamp survives exec.
const identity = (p) => `${p.pid}:${p.stamp}`;
export class AcceptanceCleanup {
	constructor({
		homes = [],
		validateOwner = () => false,
		graceMs = 2000,
		killMs = 2000,
		removeLock = unlinkSync,
	} = {}) {
		Object.assign(this, { homes, validateOwner, graceMs, killMs, removeLock });
		this.groups = new Map();
		this.children = [];
		this.locks = new Map();
		this.errors = [];
		this.homeIdentities = new Map();
		this.timer = setInterval(() => {
			try {
				this.scan();
			} catch (e) {
				this.errors.push(e.message);
			}
		}, 100);
		this.timer.unref();
	}
	spawn(exe, args, options) {
		if (this.stopping) throw Error("Controller is stopping");
		const child = spawn(exe, args, { ...options, detached: true });
		const closed = new Promise((resolve) => {
			child.once("error", (error) => resolve({ error: error.message }));
			child.once("close", (code, signal) => resolve({ code, signal }));
		});
		this.children.push({ child, closed });
		if (child.pid) {
			this.groups.set(child.pid, new Map());
			this.capture(child.pid, processes(), true);
		}
		return child;
	}
	capture(group, rows, initial = false) {
		const known = this.groups.get(group);
		const members = rows.filter((p) => p.group === group && !p.zombie);
		if (
			!initial &&
			members.length &&
			!members.some((p) => known.has(identity(p)))
		)
			throw Error(`Process group ${group} identity changed; refusing signals`);
		for (const p of members) known.set(identity(p), p);
	}
	scan() {
		const rows = processes();
		for (const home of this.homes) {
			for (const name of ["worker.lock", "update-supervisor.lock"]) {
				const path = join(home, "runtime", name);
				const directory = lstatSync(home, { throwIfNoEntry: false });
				if (!directory) continue;
				const homeIdentity = `${directory.dev}:${directory.ino}`;
				if (
					directory.isSymbolicLink() ||
					(this.homeIdentities.has(home) &&
						this.homeIdentities.get(home) !== homeIdentity)
				)
					throw Error(`Fixture home changed: ${home}`);
				this.homeIdentities.set(home, homeIdentity);
				let text;
				try {
					text = readlinkSync(path);
				} catch (e) {
					if (e.code === "ENOENT") continue;
					throw e;
				}
				if (this.locks.get(path)?.text === text) continue;
				const previous = this.locks.get(path);
				if (
					previous &&
					rows.some((p) => identity(p) === previous.identity && !p.zombie)
				)
					throw Error(`Live fixture lock overwritten: ${path}`);
				const owner = JSON.parse(text),
					p = rows.find((row) => row.pid === owner.pid && !row.zombie);
				if (
					lstatSync(join(home, "runtime")).isSymbolicLink() ||
					owner.home !== realpathSync(home) ||
					owner.schema !== 1 ||
					typeof owner.nonce !== "string" ||
					!p ||
					p.stamp !== owner.processStamp ||
					p.group !== p.pid ||
					!this.validateOwner(owner, p)
				)
					throw Error(
						`Unverified fixture lock ${path}; refusing signals/removal`,
					);
				this.locks.set(path, { text, owner, identity: identity(p) });
				const newGroup = !this.groups.has(p.group);
				if (newGroup) this.groups.set(p.group, new Map());
				this.capture(p.group, rows, newGroup);
			}
		}
		for (const group of this.groups.keys()) this.capture(group, rows);
		return rows;
	}
	async cleanup() {
		this.stopping = true;
		clearInterval(this.timer);
		const failures = [...new Set(this.errors)],
			escalated = [];
		const attempt = (fn) => {
			try {
				return fn();
			} catch (e) {
				failures.push(e.message);
				return [];
			}
		};
		const active = () => {
			attempt(() => this.scan());
			const rows = processes();
			return [...this.groups.keys()].filter((group) =>
				rows.some((p) => p.group === group && !p.zombie),
			);
		};
		const signal = (groups, sig) => {
			for (const group of groups)
				attempt(() => {
					this.capture(group, processes());
					try {
						process.kill(-group, sig);
					} catch (e) {
						if (e.code !== "ESRCH") throw e;
					}
				});
		};
		signal(active(), "SIGTERM");
		let deadline = Date.now() + this.graceMs;
		while (active().length && Date.now() < deadline) await delay(50);
		escalated.push(...active());
		signal(escalated, "SIGKILL");
		deadline = Date.now() + this.killMs;
		while (active().length && Date.now() < deadline) await delay(50);
		const remaining = active();
		if (remaining.length)
			failures.push(`Owned groups remain: ${remaining.join(",")}`);
		const children = await Promise.all(
			this.children.map(async ({ child, closed }) => {
				const result = await Promise.race([
					closed,
					delay(this.killMs).then(() => ({ error: "Child close timeout" })),
				]);
				if (result.error) failures.push(`Child ${child.pid}: ${result.error}`);
				return { pid: child.pid, ...result };
			}),
		);
		const locks = [];
		for (const [path, saved] of this.locks)
			attempt(() => {
				let text;
				try {
					text = readlinkSync(path);
				} catch (e) {
					if (e.code === "ENOENT") {
						locks.push({ path, removed: true });
						return;
					}
					throw e;
				}
				if (
					text !== saved.text ||
					`${lstatSync(saved.owner.home).dev}:${lstatSync(saved.owner.home).ino}` !==
						this.homeIdentities.get(saved.owner.home) ||
					realpathSync(saved.owner.home) !== saved.owner.home ||
					lstatSync(join(saved.owner.home, "runtime")).isSymbolicLink()
				)
					throw Error(`Fixture lock changed: ${path}; refusing removal`);
				if (processes().some((p) => p.pid === saved.owner.pid && !p.zombie))
					throw Error(`Lock PID still present: ${path}`);
				this.removeLock(path);
				try {
					readlinkSync(path);
					throw Error(`Lock remains: ${path}`);
				} catch (e) {
					if (e.code !== "ENOENT") throw e;
				}
				locks.push({ path, removed: true });
			});
		// Includes unregistered/overwritten locks; never delete these by guessing.
		for (const home of this.homes)
			for (const name of ["worker.lock", "update-supervisor.lock"])
				attempt(() => {
					try {
						readlinkSync(join(home, "runtime", name));
						throw Error(`Unremoved fixture lock: ${home}/${name}`);
					} catch (e) {
						if (e.code !== "ENOENT") throw e;
					}
				});
		return {
			passed: failures.length === 0,
			groups: [...this.groups.keys()],
			escalated,
			remaining,
			children,
			locks,
			failures,
		};
	}
}

// A receipt is committed only after all cleanup has completed, including cancellation.
export async function acceptanceRun({
	ledger,
	receiptPath,
	bindings = {},
	work,
	close = async () => {},
}) {
	let cancellation, rejectCancellation;
	const cancelled = new Promise((_, reject) => {
		rejectCancellation = reject;
	});
	const handlers = Object.fromEntries(
		["SIGTERM", "SIGINT"].map((signal) => [
			signal,
			() => {
				cancellation ??= signal;
				ledger.stopping = true;
				rejectCancellation(Error(`Controller cancelled by ${signal}`));
			},
		]),
	);
	for (const [signal, handler] of Object.entries(handlers))
		process.on(signal, handler);
	let receipt = {},
		failure;
	try {
		receipt = await Promise.race([Promise.resolve().then(work), cancelled]);
	} catch (e) {
		failure = e;
	}
	let cleanup;
	try {
		cleanup = await ledger.cleanup();
	} catch (e) {
		cleanup = { passed: false, failures: [e.message] };
	}
	try {
		await close();
	} catch (e) {
		cleanup.passed = false;
		cleanup.failures.push(e.message);
	}
	for (const [signal, handler] of Object.entries(handlers))
		process.off(signal, handler);
	const result = {
		...bindings,
		...receipt,
		passed: !failure && !cancellation && cleanup.passed,
		cancellation: cancellation ?? null,
		error: failure?.message ?? null,
		cleanup,
	};
	writeFileSync(receiptPath, JSON.stringify(result, null, 2));
	return result;
}
