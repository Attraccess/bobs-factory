import { execFileSync } from "node:child_process";
import {
	existsSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	acquireInstanceLock,
	acquireRuntimeOperation,
	ownerAlive,
	workerOwner,
} from "./InstanceLock.js";

export const lifecycleGuard = (home: string) =>
	acquireRuntimeOperation(home, "lifecycle-operation.lock");
export const desktopStopped = (home: string) =>
	existsSync(join(home, "runtime", "desktop-stopped.json"));
function outsideMaintenance(home: string) {
	if (
		existsSync(join(home, "runtime", "update-owner.json")) ||
		existsSync(join(home, "updates", "maintenance.json"))
	)
		throw new Error(
			"An update owns maintenance; wait for completion or recovery before Stop/start",
		);
}
/** Explicit operator reopen, never called by automatic recovery. */
export async function allowDesktopStart(home: string) {
	const release = await lifecycleGuard(home);
	try {
		outsideMaintenance(home);
		if (existsSync(join(home, "runtime", "service.json")))
			throw new Error("This home is service-owned");
		rmSync(join(home, "runtime", "desktop-stopped.json"), { force: true });
	} finally {
		release();
	}
}
/** Called only AFTER the UI confirmation. Intent and signaling share maintenance admission. */
export async function stopDesktop(
	home: string,
	nonce: string,
	executable: string,
) {
	const release = await lifecycleGuard(home);
	try {
		outsideMaintenance(home);
		const owner = workerOwner(home);
		if (
			!owner ||
			owner.owner !== "desktop" ||
			owner.nonce !== nonce ||
			owner.executable !== realpathSync(executable) ||
			!ownerAlive(owner)
		)
			throw new Error(
				"Worker identity changed or independently owned; refusing shutdown",
			);
		const command =
			process.platform === "linux"
				? `/proc/${owner.pid}/exe`
				: execFileSync("/bin/ps", ["-p", String(owner.pid), "-o", "comm="], {
						encoding: "utf8",
					}).trim();
		if (
			realpathSync(command) !== owner.executable ||
			workerOwner(home)?.nonce !== nonce ||
			!ownerAlive(owner)
		)
			throw new Error(
				"Worker executable/start identity changed; refusing shutdown",
			);
		const marker = join(home, "runtime", "desktop-stopped.json");
		writeFileSync(
			`${marker}.tmp`,
			JSON.stringify({ stoppedAt: new Date().toISOString(), nonce }),
			{ mode: 0o600, flush: true },
		);
		renameSync(`${marker}.tmp`, marker);
		process.kill(owner.pid, "SIGTERM");
		for (let n = 0; n < 300; n++) {
			const current = workerOwner(home);
			if (!current) return;
			if (current.nonce !== nonce)
				throw new Error("Another owner acquired this home during shutdown");
			if (!ownerAlive(current)) {
				const reclaim = await acquireInstanceLock(home, { markWorker: false });
				reclaim();
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		throw new Error(
			"Worker still owns this home; deliberate Stop intent remains active",
		);
	} finally {
		release();
	}
}
