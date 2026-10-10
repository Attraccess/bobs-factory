import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	readFileSync,
	readlinkSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { promisify } from "node:util";
import { z } from "zod";

const runFile = promisify(execFile);
const Owner = z.object({
	pid: z.number().int().positive(),
	id: z.string().min(1),
	start: z.string().min(1),
	startedAt: z.string(),
});
async function processStart(pid: number) {
	try {
		const { stdout } = await runFile(
			"ps",
			["-p", String(pid), "-o", "lstart="],
			{ timeout: 5000 },
		);
		return stdout.trim() || undefined;
	} catch (error) {
		if ((error as { code?: unknown }).code === 1) return undefined;
		throw error; // Tool/permission errors do not establish that an owner exited.
	}
}
function missing(error: unknown) {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}
function read(file: string) {
	try {
		return readFileSync(file, "utf8");
	} catch (error) {
		if (missing(error)) return undefined;
		throw error;
	}
}
function releaseGuard(file: string, owner: string) {
	try {
		if (readlinkSync(file) === owner) unlinkSync(file);
	} catch (error) {
		if (!missing(error)) throw error;
	}
}
/** Serialize every primary-lock replacement/removal. Guards are atomically
 * published owner records and recursively recoverable after a process crash. */
async function guard(
	file: string,
	owner: string,
	deadline: number,
	depth = 0,
): Promise<void> {
	if (depth > 16)
		throw new Error("Update reclaim guard chain requires inspection");
	while (true) {
		try {
			symlinkSync(owner, file);
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
		let text: string;
		try {
			text = readlinkSync(file);
		} catch (error) {
			if (missing(error)) continue;
			throw error;
		}
		const holder = Owner.parse(JSON.parse(text));
		if ((await processStart(holder.pid)) !== holder.start) {
			const reclaim = `${file}.reclaim`;
			await guard(reclaim, owner, deadline, depth + 1);
			try {
				releaseGuard(file, text);
			} finally {
				releaseGuard(reclaim, owner);
			}
		}
		if (Date.now() >= deadline)
			throw new Error(
				"Update ownership reclaim is busy; retry after the current operation",
			);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

export class UpdateOperationLock {
	constructor(private readonly file: string) {}
	async run<T>(work: () => Promise<T>, recover = false): Promise<T> {
		const start = await processStart(process.pid);
		if (!start)
			throw new Error("Cannot establish updater process start identity");
		const owner = JSON.stringify({
			pid: process.pid,
			id: randomUUID(),
			start,
			startedAt: new Date().toISOString(),
		});
		const reclaim = `${this.file}.reclaim`;
		await guard(reclaim, owner, Date.now() + 5000);
		try {
			const text = read(this.file);
			if (text !== undefined) {
				if (!recover)
					throw new Error(
						"An update operation owns this instance; inspect its result or recover the interrupted owner.",
					);
				// Legacy records lack a start identity. An absent process is safe to
				// reclaim; a live/reused PID without that identity must fail closed.
				const holder = z
					.object({
						pid: z.number().int().positive(),
						start: z.string().optional(),
					})
					.parse(JSON.parse(text));
				const liveStart = await processStart(holder.pid);
				if (liveStart && (!holder.start || liveStart === holder.start))
					throw new Error(
						"Recorded update owner is still running or its legacy identity is unverifiable; recovery cannot steal its operation.",
					);
				if (read(this.file) !== text)
					throw new Error(
						"Update owner changed during recovery; retry with the current owner",
					);
				unlinkSync(this.file);
			}
			writeFileSync(this.file, owner, { flag: "wx", mode: 0o600, flush: true });
		} finally {
			releaseGuard(reclaim, owner);
		}
		try {
			return await work();
		} finally {
			await guard(reclaim, owner, Date.now() + 5000);
			try {
				if (read(this.file) === owner) unlinkSync(this.file);
			} finally {
				releaseGuard(reclaim, owner);
			}
		}
	}
}
