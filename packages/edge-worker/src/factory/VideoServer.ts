import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { runRepositories, scopeRevision } from "./RepositoryScope.js";
import {
	byteRange,
	evidenceFile,
	type VideoCapture,
	videoLimits,
} from "./Video.js";
import type { WorkflowRuntime } from "./WorkflowRuntime.js";

const exec = promisify(execFile);
/** Media routes live only on FactoryServer's validated loopback listener. */
export function registerVideoRoutes(
	app: FastifyInstance,
	runtime: WorkflowRuntime,
) {
	// One bounded integrity cache per server. Identity includes ctime to detect in-place replacement.
	const hashes = new Map<string, string>();
	app.route<{
		Params: { id: string; task: string; asset: string };
		Querystring: { v?: string };
	}>({
		method: ["GET", "HEAD"],
		url: "/api/runs/:id/videos/:task/:asset",
		handler: async (request, reply) => {
			reply
				.header("Cache-Control", "no-store")
				.header("X-Content-Type-Options", "nosniff");
			const run = runtime.get(request.params.id),
				video = (run.outputs.capture as VideoCapture | undefined)?.videos?.find(
					(v) => v.taskId === request.params.task,
				),
				validation = video?.validation;
			if (!video || !validation)
				return reply.code(404).send({ error: "Video evidence is unavailable" });
			if (request.query.v !== validation.sha256 || validation.dirty)
				return reply
					.code(409)
					.send({ error: "Video version changed; refresh this run" });
			const asset = request.params.asset;
			const selected =
				asset === "media"
					? { path: video.path, sha256: validation.sha256 }
					: asset === "poster"
						? validation.poster
						: asset === "captions"
							? validation.captions
							: undefined;
			if (!selected)
				return reply.code(404).send({ error: "Video asset is unavailable" });
			// Grouped runs retain Git worktrees beneath a non-Git workspace parent.
			// Match the same complete scope fingerprint used by capture finalization.
			try {
				const revisions = await Promise.all(
					runRepositories(run).map(async (repository) => {
						const options = { cwd: repository.workspace, timeout: 10000 };
						const headSha = (
							await exec("git", ["rev-parse", "HEAD"], options)
						).stdout.trim();
						const dirty = (
							await exec("git", ["status", "--porcelain"], options)
						).stdout.trim();
						return { repositoryId: repository.id, headSha, dirty };
					}),
				);
				if (
					scopeRevision(revisions) !== validation.validatedRevision ||
					revisions.some((r) => r.dirty)
				)
					return reply
						.code(409)
						.send({ error: "Video belongs to an earlier or dirty revision" });
			} catch {
				return reply.code(409).send({
					error: "Video repository revisions are unavailable; refresh this run",
				});
			}
			let path: string;
			try {
				path = evidenceFile(
					selected.path,
					join(runtime.directory, "evidence", run.id),
					asset === "media"
						? videoLimits.bytes
						: asset === "poster"
							? 10 * 1024 * 1024
							: 1024 * 1024,
				);
			} catch (error) {
				return reply
					.code((error as NodeJS.ErrnoException).code === "ENOENT" ? 410 : 409)
					.send({ error: "Video asset is expired, missing or invalid" });
			}
			const handle = await open(
				path,
				constants.O_RDONLY | constants.O_NOFOLLOW,
			);
			let streamed = false;
			try {
				const stat = await handle.stat(),
					key = [
						path,
						stat.dev,
						stat.ino,
						stat.size,
						stat.mtimeMs,
						stat.ctimeMs,
					].join(":");
				let hash = hashes.get(key);
				if (!hash) {
					const digest = createHash("sha256");
					for await (const chunk of handle.createReadStream({
						autoClose: false,
						start: 0,
					}))
						digest.update(chunk);
					const after = await handle.stat();
					if (
						after.size !== stat.size ||
						after.mtimeMs !== stat.mtimeMs ||
						after.ctimeMs !== stat.ctimeMs
					)
						return reply
							.code(409)
							.send({ error: "Video asset changed during validation" });
					hash = digest.digest("hex");
					if (hashes.size >= 128) hashes.clear();
					hashes.set(key, hash);
				}
				if (
					hash !== selected.sha256 ||
					(asset === "media" && stat.size !== validation.bytes)
				)
					return reply
						.code(409)
						.send({ error: "Video asset changed after verification" });
				const mime =
					asset === "media"
						? validation.mime
						: asset === "captions"
							? "text/vtt; charset=utf-8"
							: (await handle.read(Buffer.alloc(1), 0, 1, 0)).buffer[0] === 137
								? "image/png"
								: "image/jpeg";
				reply.type(mime).header("Accept-Ranges", "bytes");
				let range: ReturnType<typeof byteRange>;
				try {
					range = byteRange(request.headers.range, stat.size);
				} catch {
					return reply
						.code(416)
						.header("Content-Range", `bytes */${stat.size}`)
						.send();
				}
				if (range)
					reply
						.code(206)
						.header(
							"Content-Range",
							`bytes ${range.start}-${range.end}/${stat.size}`,
						);
				reply.header(
					"Content-Length",
					range ? range.end - range.start + 1 : stat.size,
				);
				if (request.method === "HEAD") return reply.send();
				const stream = handle.createReadStream({
					start: range?.start ?? 0,
					end: range?.end,
					autoClose: true,
				});
				streamed = true;
				const close = () => stream.destroy();
				reply.raw.once("close", close);
				stream.once("close", () => reply.raw.removeListener("close", close));
				return reply.send(stream);
			} finally {
				if (!streamed) await handle.close();
			}
		},
	});
}
