import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

interface Artifact {
	path: string;
	original: string | null;
	mode: number;
	generated: string;
}
interface Journal {
	pid: number;
	owner: string;
	workspace: string;
	artifacts: Artifact[];
}
const digest = (value: Buffer | string) =>
	createHash("sha256").update(value).digest("hex");

class ArtifactLeaseBusyError extends Error {}

/** Cross-process lease with private backups and compare-before-restore recovery. */
export class ProjectArtifactLease {
	static get sharedDirectory(): string {
		return join(
			tmpdir(),
			`cyrus-artifact-leases-${process.getuid?.() ?? "user"}`,
		);
	}
	/** Wait only for the shared workspace resource, leaving unrelated jobs concurrent. */
	static async acquire(
		workspace: string,
		resource: string,
		privateDirectory = ProjectArtifactLease.sharedDirectory,
		signal?: AbortSignal,
	): Promise<ProjectArtifactLease> {
		for (;;) {
			signal?.throwIfAborted();
			try {
				return new ProjectArtifactLease(workspace, resource, privateDirectory);
			} catch (error) {
				if (!(error instanceof ArtifactLeaseBusyError)) throw error;
			}
			await new Promise<void>((resolve, reject) => {
				const done = () => {
					signal?.removeEventListener("abort", abort);
					resolve();
				};
				const timer = setTimeout(done, 50);
				const abort = () => {
					clearTimeout(timer);
					signal?.removeEventListener("abort", abort);
					reject(signal?.reason ?? new Error("Artifact wait aborted"));
				};
				signal?.addEventListener("abort", abort, { once: true });
			});
		}
	}

	/** Restore an abandoned journal, or identify unchanged artifacts owned by a live job. */
	static recoverOwnedArtifacts(
		workspace: string,
		resource: string,
		privateDirectory: string,
	): Set<string> {
		workspace = realpathSync(workspace);
		const file = join(
			privateDirectory,
			`${digest(`${workspace}\0${resource}`)}.json`,
		);
		if (!existsSync(file)) return new Set();
		const journal: Journal = JSON.parse(readFileSync(file, "utf8"));
		let alive = true;
		try {
			process.kill(journal.pid, 0);
		} catch (error) {
			alive = (error as NodeJS.ErrnoException).code !== "ESRCH";
		}
		if (!alive) {
			new ProjectArtifactLease(workspace, resource, privateDirectory).release();
			return new Set();
		}
		if (journal.workspace !== workspace)
			throw new Error("Artifact journal workspace mismatch");
		return new Set(
			journal.artifacts
				.filter(
					(artifact) =>
						existsSync(artifact.path) &&
						digest(readFileSync(artifact.path)) === artifact.generated,
				)
				.map((artifact) => artifact.path),
		);
	}
	private journal: Journal;
	private file: string;
	constructor(
		workspace: string,
		resource: string,
		privateDirectory = join(
			tmpdir(),
			`cyrus-artifact-leases-${process.getuid?.() ?? "user"}`,
		),
	) {
		workspace = realpathSync(workspace);
		mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
		if (process.platform !== "win32" && statSync(privateDirectory).mode & 0o077)
			throw new Error("Artifact lease directory must be private (chmod 700)");
		this.file = join(
			privateDirectory,
			`${digest(`${workspace}\0${resource}`)}.json`,
		);
		this.journal = {
			pid: process.pid,
			owner: randomUUID(),
			workspace,
			artifacts: [],
		};
		try {
			this.create();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			let previous: Journal;
			try {
				previous = JSON.parse(readFileSync(this.file, "utf8"));
			} catch {
				throw new Error(
					"Incomplete artifact lease. Inspect the private journal before retrying.",
				);
			}
			let alive = true;
			try {
				process.kill(previous.pid, 0);
			} catch (failure) {
				alive = (failure as NodeJS.ErrnoException).code !== "ESRCH";
			}
			if (alive)
				throw new ArtifactLeaseBusyError(
					"Another process owns this workspace's runner artifacts. Wait for it to finish.",
				);
			// Elect one recovery process without allowing a second entrant to race restoration.
			const recovery = `${this.file}.recovery`;
			try {
				writeFileSync(recovery, String(process.pid), {
					flag: "wx",
					mode: 0o600,
				});
			} catch {
				throw new Error(
					"Artifact recovery is already in progress. Inspect a stale recovery lock before retrying.",
				);
			}
			try {
				const current: Journal = JSON.parse(readFileSync(this.file, "utf8"));
				if (current.owner !== previous.owner)
					throw new Error("Artifact lease changed during recovery. Retry.");
				this.restore(previous);
				unlinkSync(this.file);
				this.create();
			} finally {
				unlinkSync(recovery);
			}
		}
	}
	private create(): void {
		writeFileSync(this.file, JSON.stringify(this.journal), {
			mode: 0o600,
			flag: "wx",
		});
	}
	private safePath(path: string): string {
		const file = resolve(this.journal.workspace, path);
		const rel = relative(this.journal.workspace, file);
		if (!rel || rel.startsWith("..") || isAbsolute(rel))
			throw new Error("Artifact must be inside its workspace");
		let ancestor = file;
		while (ancestor !== this.journal.workspace) {
			if (existsSync(ancestor) && lstatSync(ancestor).isSymbolicLink())
				throw new Error("Runner artifacts cannot use symlinked paths");
			ancestor = dirname(ancestor);
		}
		return file;
	}
	write(path: string, content: string | Buffer, mode = 0o600): void {
		const file = this.safePath(path);
		if (
			!existsSync(this.file) ||
			JSON.parse(readFileSync(this.file, "utf8")).owner !== this.journal.owner
		)
			throw new Error("Runner artifact lease was lost");
		let artifact = this.journal.artifacts.find((entry) => entry.path === file);
		if (!artifact) {
			artifact = {
				path: file,
				original: existsSync(file)
					? readFileSync(file).toString("base64")
					: null,
				mode: existsSync(file) ? statSync(file).mode & 0o777 : mode,
				generated: digest(content),
			};
			this.journal.artifacts.push(artifact);
		} else {
			if (
				!existsSync(file) ||
				digest(readFileSync(file)) !== artifact.generated
			)
				throw new Error(
					"Runner artifact changed outside its owner. Refusing to overwrite it.",
				);
			artifact.generated = digest(content);
		}
		const temp = `${this.file}.${this.journal.owner}.tmp`;
		writeFileSync(temp, JSON.stringify(this.journal), { mode: 0o600 });
		renameSync(temp, this.file);
		mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
		// Replace instead of following hard links or retaining permissive file modes.
		const generated = `${file}.${this.journal.owner}.tmp`;
		writeFileSync(generated, content, { mode, flag: "wx" });
		renameSync(generated, file);
	}
	private restore(journal: Journal): void {
		if (
			journal.workspace !== this.journal.workspace ||
			!/^[\w-]+$/.test(journal.owner)
		)
			throw new Error("Artifact journal ownership mismatch");
		// Intent is durable before a temporary is written. Its owner-specific path
		// may hold a partial secret even when the final file is still original.
		rmSync(`${this.file}.${journal.owner}.tmp`, { force: true });
		for (const artifact of journal.artifacts) {
			this.safePath(artifact.path);
			for (const suffix of ["tmp", "restore"])
				rmSync(this.safePath(`${artifact.path}.${journal.owner}.${suffix}`), {
					force: true,
				});
			const current = existsSync(artifact.path)
				? readFileSync(artifact.path)
				: null;
			// A crash between recording intent and writing the file leaves the original intact.
			if (
				current &&
				artifact.original !== null &&
				current.toString("base64") === artifact.original
			)
				continue;
			if (!current && artifact.original === null) continue;
			if (!current || digest(current) !== artifact.generated)
				throw new Error(
					"Runner artifact was modified by another writer. Preserve it and inspect the private recovery journal.",
				);
			if (artifact.original === null) unlinkSync(artifact.path);
			else {
				const temp = `${artifact.path}.${journal.owner}.restore`;
				writeFileSync(temp, Buffer.from(artifact.original, "base64"), {
					mode: artifact.mode,
					flag: "wx",
				});
				renameSync(temp, artifact.path);
			}
		}
	}
	release(): void {
		if (!existsSync(this.file)) return;
		const current: Journal = JSON.parse(readFileSync(this.file, "utf8"));
		if (current.owner !== this.journal.owner)
			throw new Error("Runner artifact lease was lost");
		this.restore(current);
		rmSync(this.file);
	}
}
