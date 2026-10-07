import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	createReadStream,
	existsSync,
	lstatSync,
	readdirSync,
	realpathSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { qaDigest } from "./EvidenceDigest.js";
import { dependencyCovers, dependencyHashes } from "./Incremental.js";
import { OutputValidationError } from "./OutputValidation.js";
import type { ExecutionContext, FactoryRun } from "./WorkflowRuntime.js";

export const VIDEO_CONTRACT = "video-v1" as const;
export const videoLimits = {
	clips: 3,
	seconds: 120,
	bytes: 50 * 1024 * 1024,
	runBytes: 512 * 1024 * 1024,
	temporaryMs: 24 * 3600000,
	terminalMs: 30 * 24 * 3600000,
};
const text = z.string().trim().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = text.regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const VideoTaskSchema = z.object({
	id,
	title: text.max(120),
	storyIds: z.array(text).min(1),
	criterionIds: z.array(text).min(1),
	rationale: text,
	steps: z.array(text).min(1),
	dependencies: z.array(text).min(1),
	environment: text,
	targetSeconds: z.number().min(1).max(videoLimits.seconds),
	required: z.boolean().default(false),
	changed: z.boolean().default(true),
});
export const VideoScopeFields = {
	videoContract: z.literal(VIDEO_CONTRACT).optional(),
	videoTasks: z.array(VideoTaskSchema).max(videoLimits.clips).optional(),
	videoReason: text.optional(),
};
export const VideoReceiptSchema = z.object({
	taskId: id,
	sha256: hash,
	inspectedPlayback: z.literal(true),
});
const asset = z.object({ path: text, sha256: hash });
export const VideoSchema = z.object({
	taskId: id,
	path: text,
	caption: text.max(600),
	recorder: text,
	receipt: z.object({ executed: z.literal(true), action: text, details: text }),
	storyIds: z.array(text).min(1),
	criterionIds: z.array(text).min(1),
	viewport: z.object({
		width: z.number().int().min(1).max(7680),
		height: z.number().int().min(1).max(4320),
	}),
	transcript: text.max(16000),
	environment: text,
	posterPath: text,
	captionsPath: text.optional(),
	reused: z.boolean().optional(),
	validation: z
		.object({
			mime: z.enum(["video/mp4", "video/webm"]),
			codecs: z.array(text),
			duration: z.number().positive().max(videoLimits.seconds),
			bytes: z.number().int().positive().max(videoLimits.bytes),
			sha256: hash,
			captureRevision: text,
			validatedRevision: text,
			dirty: z.boolean(),
			taskDigest: hash,
			scopeDigest: hash,
			dependencyFingerprint: hash.optional(),
			poster: asset,
			captions: asset.optional(),
		})
		.optional(),
});
export const VideoCaptureFields = {
	videoContract: z.literal(VIDEO_CONTRACT).optional(),
	videos: z.array(VideoSchema).max(videoLimits.clips).optional(),
	videoUnavailable: z
		.array(
			z.object({
				taskId: id,
				reason: text,
				cause: z.enum(["tooling", "export", "product"]),
			}),
		)
		.max(videoLimits.clips)
		.optional(),
	videoDependencyManifests: z
		.record(hash, z.record(z.string(), z.string()))
		.optional(),
};
export type Video = z.infer<typeof VideoSchema>;
export type VideoTask = z.infer<typeof VideoTaskSchema>;
export type VideoScope = {
	videoContract?: "video-v1";
	videoTasks?: VideoTask[];
	videoReason?: string;
	nonVisualFiles?: string[];
	stories: { id: string; criteria: { id: string }[] }[];
};
export type VideoCapture = {
	videos?: Video[];
	videoContract?: "video-v1";
	videoUnavailable?: z.infer<typeof VideoCaptureFields.videoUnavailable>;
	videoDependencyManifests?: Record<string, Record<string, string>>;
};

export function videoScopeIssues(scope: VideoScope): string[] {
	if (!scope.videoContract) return [];
	const tasks = scope.videoTasks ?? [],
		issues: string[] = [];
	if (!tasks.length && !scope.videoReason)
		issues.push("No demonstrations selected requires a concrete videoReason");
	if (new Set(tasks.map((t) => t.id)).size !== tasks.length)
		issues.push("Video task IDs must be unique");
	for (const t of tasks) {
		if (
			new Set(t.storyIds).size !== t.storyIds.length ||
			new Set(t.criterionIds).size !== t.criterionIds.length ||
			t.storyIds.some((id) => !scope.stories.some((s) => s.id === id)) ||
			t.criterionIds.some(
				(id) =>
					!scope.stories.some(
						(s) =>
							t.storyIds.includes(s.id) && s.criteria.some((c) => c.id === id),
					),
			)
		)
			issues.push(
				`Unknown or duplicate video story/criterion reference: ${t.id}`,
			);
	}
	return issues;
}

/** Resolve every asset against a canonical evidence root. Never accept arbitrary paths. */
export function evidenceFile(
	path: string,
	directory: string,
	maxBytes = videoLimits.bytes,
	allowEmpty = false,
): string {
	if (!isAbsolute(path)) throw new Error("Video assets require absolute paths");
	if (lstatSync(directory).isSymbolicLink())
		throw new Error("Run evidence directory cannot be a symlink");
	const root = realpathSync(directory),
		real = realpathSync(path),
		name = relative(root, real),
		stat = statSync(real);
	if (
		!name ||
		name === ".." ||
		name.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
		isAbsolute(name) ||
		!stat.isFile()
	)
		throw new Error(
			"Video asset must be a file inside this run's evidence directory",
		);
	if ((!allowEmpty && !stat.size) || stat.size > maxBytes)
		throw new Error("Video asset is empty or exceeds its size limit");
	return real;
}
export async function fileHash(path: string): Promise<string> {
	const digest = createHash("sha256");
	for await (const chunk of createReadStream(path)) digest.update(chunk);
	return digest.digest("hex");
}
const exec = promisify(execFile);
export async function probeVideo(path: string, signal?: AbortSignal) {
	const { stdout } = await exec(
		"ffprobe",
		[
			"-v",
			"error",
			"-protocol_whitelist",
			"file,pipe",
			"-show_format",
			"-show_streams",
			"-of",
			"json",
			path,
		],
		{ timeout: 15000, maxBuffer: 1024 * 1024, signal },
	);
	const probe = JSON.parse(stdout),
		streams = probe.streams ?? [],
		videos = streams.filter(
			(s: { codec_type: string }) => s.codec_type === "video",
		);
	const duration = Number(probe.format?.duration);
	const mp4 = String(probe.format?.format_name).split(",").includes("mp4"),
		webm = String(probe.format?.format_name).split(",").includes("webm");
	const codecs = streams.map((s: { codec_name: string }) => s.codec_name);
	if (
		(!mp4 && !webm) ||
		videos.length !== 1 ||
		!Number.isFinite(duration) ||
		duration <= 0 ||
		duration > videoLimits.seconds ||
		!Number.isFinite(videos[0].width) ||
		videos[0].width <= 0 ||
		!Number.isFinite(videos[0].height) ||
		videos[0].height <= 0 ||
		streams.some(
			(s: { codec_type: string; codec_name: string; pix_fmt: string }) =>
				s.codec_type === "video"
					? mp4
						? s.codec_name !== "h264" ||
							!["yuv420p", "yuvj420p"].includes(s.pix_fmt)
						: !["vp8", "vp9", "av1"].includes(s.codec_name)
					: s.codec_type !== "audio" ||
						!(mp4 ? ["aac", "mp3"] : ["opus", "vorbis"]).includes(s.codec_name),
		)
	)
		throw new Error("Unsupported container/codecs or invalid video duration");
	// Probe headers alone can accept truncated files. Decode all frames with a bounded process.
	await exec(
		"ffmpeg",
		[
			"-nostdin",
			"-v",
			"error",
			"-xerror",
			"-protocol_whitelist",
			"file,pipe",
			"-i",
			path,
			"-f",
			"null",
			"-",
		],
		{ timeout: 30000, maxBuffer: 1024 * 1024, signal },
	);
	return {
		mime: mp4 ? ("video/mp4" as const) : ("video/webm" as const),
		codecs,
		duration,
		audio: streams.some(
			(s: { codec_type: string }) => s.codec_type === "audio",
		),
	};
}
async function captionAsset(path: string, directory: string) {
	const real = evidenceFile(path, directory, 1024 * 1024),
		content = await readFile(real, "utf8");
	if (
		!/^WEBVTT(?:\r?\n|\s)/.test(content) ||
		!/\d{2}:\d{2}(?::\d{2})?\.\d{3}\s+-->\s+\d{2}:\d{2}(?::\d{2})?\.\d{3}/.test(
			content,
		) ||
		/<script|<iframe/i.test(content)
	)
		throw new Error("Captions must be a bounded WebVTT track with timed cues");
	return { path: real, sha256: await fileHash(real) };
}
export async function finalizeVideoEvidence(
	context: ExecutionContext,
	output: unknown,
): Promise<unknown> {
	if (!context.step.videoContract) return output;
	const capture = output as VideoCapture,
		scope = context.run.outputs["visual-scope"] as VideoScope;
	const current = context.progress?.currentRevision;
	if (!current)
		throw new Error("Video capture requires runtime revision provenance");
	const tasks = scope.videoTasks ?? [],
		previous = context.progress?.previousOutput as VideoCapture | undefined;
	capture.videoContract = VIDEO_CONTRACT;
	const videos = capture.videos ?? [],
		unavailable = capture.videoUnavailable ?? [];
	const ids = [
		...videos.map((v) => v.taskId),
		...unavailable.map((v) => v.taskId),
	];
	if (
		new Set(ids).size !== ids.length ||
		ids.some((id) => !tasks.some((t) => t.id === id))
	)
		throw new OutputValidationError(output, [
			{
				path: "/videos",
				message:
					"Video tasks must be selected and occur once, captured or unavailable",
			},
		]);
	const manifests: Record<string, Record<string, string>> = {};
	for (const [index, video] of videos.entries()) {
		try {
			const task = tasks.find((t) => t.id === video.taskId)!;
			if (
				qaDigest([...video.storyIds].sort()) !==
					qaDigest([...task.storyIds].sort()) ||
				qaDigest([...video.criterionIds].sort()) !==
					qaDigest([...task.criterionIds].sort()) ||
				video.environment !== task.environment
			)
				throw new Error(
					"Video scenarios/environment differ from the selected task",
				);
			const path = evidenceFile(video.path, context.evidenceDir),
				before = statSync(path),
				media = await probeVideo(path, context.signal);
			const sha256 = await fileHash(path),
				after = statSync(path);
			if (
				before.size !== after.size ||
				before.mtimeMs !== after.mtimeMs ||
				before.ctimeMs !== after.ctimeMs
			)
				throw new Error("Video changed during validation");
			const { verifiedScreenshot } = await import("./FactoryTools.js");
			const posterPath = evidenceFile(
				video.posterPath,
				context.evidenceDir,
				10 * 1024 * 1024,
			);
			verifiedScreenshot(posterPath, context.evidenceDir);
			await exec(
				"ffmpeg",
				[
					"-nostdin",
					"-v",
					"error",
					"-xerror",
					"-protocol_whitelist",
					"file,pipe",
					"-i",
					posterPath,
					"-frames:v",
					"1",
					"-f",
					"null",
					"-",
				],
				{ timeout: 15000, maxBuffer: 1024 * 1024, signal: context.signal },
			);
			const poster = { path: posterPath, sha256: await fileHash(posterPath) };
			const captions = video.captionsPath
				? await captionAsset(video.captionsPath, context.evidenceDir)
				: undefined;
			if (media.audio && !captions)
				throw new Error(
					"Spoken/audio recordings require timed captions as well as a transcript",
				);
			const sources = dependencyHashes(
					context.run.workspace,
					task.dependencies,
				),
				dependencyFingerprint = qaDigest(sources),
				taskDigest = qaDigest({ ...task, changed: undefined }),
				scopeDigest = qaDigest(scope);
			manifests[dependencyFingerprint] = sources;
			const old = previous?.videos?.find(
				(v) => v.path === video.path || v.validation?.sha256 === sha256,
			);
			if (old || video.reused) {
				const accepted = (
					context.run.outputs["visual-review"] as
						| { acceptedVideos?: z.infer<typeof VideoReceiptSchema>[] }
						| undefined
				)?.acceptedVideos;
				const unexplained =
					context.progress?.changedFiles.some(
						(f) =>
							!scope.nonVisualFiles?.includes(f) &&
							!tasks.some((t) =>
								t.dependencies.some((d) => dependencyCovers(f, d)),
							),
					) ?? true;
				if (
					!old?.validation ||
					current.dirty ||
					context.progress?.uncertain ||
					old.validation.dirty ||
					old.validation.sha256 !== sha256 ||
					old.validation.taskDigest !== taskDigest ||
					old.validation.dependencyFingerprint !== dependencyFingerprint ||
					Object.values(sources).includes("missing") ||
					(!context.progress?.unchangedCode && (task.changed || unexplained)) ||
					old.environment !== video.environment ||
					old.transcript !== video.transcript ||
					old.validation.poster.sha256 !== poster.sha256 ||
					old.validation.captions?.sha256 !== captions?.sha256 ||
					!accepted?.some(
						(a) =>
							a.taskId === task.id &&
							a.sha256 === sha256 &&
							a.inspectedPlayback,
					)
				)
					throw new Error(
						"Reuse lacks prior playback acceptance or unchanged sources, scenarios, fixtures and bytes; record this task freshly",
					);
			}
			video.path = path;
			video.posterPath = poster.path;
			video.captionsPath = captions?.path;
			video.reused = Boolean(old);
			video.validation = {
				mime: media.mime,
				codecs: media.codecs,
				duration: media.duration,
				bytes: after.size,
				sha256,
				captureRevision: old?.validation?.captureRevision ?? current.headSha,
				validatedRevision: current.headSha,
				dirty: current.dirty,
				taskDigest,
				scopeDigest,
				dependencyFingerprint,
				poster,
				captions,
			};
		} catch (error) {
			throw new OutputValidationError(output, [
				{
					path: `/videos/${index}`,
					message:
						error instanceof Error ? error.message : "Video validation failed",
				},
			]);
		}
	}
	for (const t of tasks)
		if (!ids.includes(t.id))
			unavailable.push({
				taskId: t.id,
				cause: "export",
				reason: "No recording or capability failure receipt supplied",
			});
	const retained = evidenceBytes(context.evidenceDir);
	if (retained > videoLimits.runBytes)
		throw new OutputValidationError(output, [
			{
				path: "/videos",
				message:
					"Run evidence storage exceeds 512 MiB; preserve referenced evidence and report storage exhaustion",
			},
		]);
	capture.videos = videos;
	capture.videoUnavailable = unavailable;
	capture.videoDependencyManifests = manifests;
	return capture;
}

/** Gate and handoff recheck bytes, current revision and exact playback receipts. */
export async function videoGateIssues(
	context: ExecutionContext,
	headSha: string,
): Promise<{
	blocked: string[];
	failures: {
		id: string;
		rating: number;
		status: string;
		summary: string;
		evidence: string;
	}[];
}> {
	const blocked: string[] = [],
		failures: {
			id: string;
			rating: number;
			status: string;
			summary: string;
			evidence: string;
		}[] = [];
	if (!context.step.videoContract) return { blocked, failures };
	const scope = context.run.outputs["visual-scope"] as VideoScope,
		capture = context.run.outputs.capture as VideoCapture;
	const receipts =
		(
			context.run.outputs["visual-review"] as {
				acceptedVideos?: z.infer<typeof VideoReceiptSchema>[];
			}
		)?.acceptedVideos ?? [];
	for (const task of scope.videoTasks ?? []) {
		const video = capture.videos?.find((v) => v.taskId === task.id),
			gap = capture.videoUnavailable?.find((v) => v.taskId === task.id);
		if (!video) {
			if (gap?.cause === "product")
				failures.push({
					id: `video-${task.id}`,
					rating: 3,
					status: "open",
					summary: `Demonstrated product flow failed: ${task.title}`,
					evidence: gap.reason,
				});
			else if (
				task.required ||
				!gap ||
				gap.reason === "No recording or capability failure receipt supplied"
			)
				blocked.push(
					`${task.id}: ${gap?.reason ?? "Video evidence is missing"}`,
				);
			continue;
		}
		try {
			const v = video.validation;
			if (
				!v ||
				v.dirty ||
				v.validatedRevision !== headSha ||
				v.taskDigest !== qaDigest({ ...task, changed: undefined }) ||
				v.scopeDigest !== qaDigest(scope)
			)
				throw new Error("Stale or unverified recording");
			if (
				(await fileHash(evidenceFile(video.path, context.evidenceDir))) !==
					v.sha256 ||
				(await fileHash(
					evidenceFile(v.poster.path, context.evidenceDir, 10 * 1024 * 1024),
				)) !== v.poster.sha256 ||
				(v.captions &&
					(await fileHash(
						evidenceFile(v.captions.path, context.evidenceDir, 1024 * 1024),
					)) !== v.captions.sha256)
			)
				throw new Error("Video/poster/caption bytes changed");
			if (
				v.dependencyFingerprint !==
				qaDigest(dependencyHashes(context.run.workspace, task.dependencies))
			)
				throw new Error("Recording source dependencies changed");
			if (
				!receipts.some(
					(r) =>
						r.taskId === task.id &&
						r.sha256 === v.sha256 &&
						r.inspectedPlayback,
				)
			)
				throw new Error("No exact inspected-playback acceptance receipt");
		} catch (error) {
			blocked.push(`${task.id}: ${(error as Error).message}`);
		}
	}
	return { blocked, failures };
}

export function byteRange(
	header: string | undefined,
	size: number,
): { start: number; end: number } | undefined {
	if (header === undefined) return;
	const m = /^bytes=(\d*)-(\d*)$/.exec(header);
	if (!m || (!m[1] && !m[2])) throw new Error("Invalid byte range");
	const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
	const end = m[1]
		? m[2]
			? Math.min(Number(m[2]), size - 1)
			: size - 1
		: size - 1;
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		start < 0 ||
		start >= size ||
		end < start ||
		(!m[1] && Number(m[2]) <= 0)
	)
		throw new Error("Unsatisfiable byte range");
	return { start, end };
}

/** Startup maintenance is bounded; active and waiting runs are never pruned. */
export function cleanupVideoEvidence(
	root: string,
	runs: Iterable<FactoryRun>,
	now = Date.now(),
): void {
	let budget = 200;
	for (const run of runs) {
		if (
			!budget ||
			!["completed", "stopped"].includes(run.status) ||
			!/^[a-zA-Z0-9_-]+$/.test(run.id)
		)
			continue;
		const directory = join(root, run.id);
		if (!existsSync(directory) || lstatSync(directory).isSymbolicLink())
			continue;
		const terminalExpired =
			now - Date.parse(run.updatedAt) > videoLimits.terminalMs;
		const capture = run.outputs.capture as VideoCapture | undefined;
		const assets = terminalExpired
			? (capture?.videos ?? []).flatMap((v) => [
					v.path,
					v.posterPath,
					...(v.captionsPath ? [v.captionsPath] : []),
				])
			: [];
		for (const name of readdirSync(directory).slice(0, 200))
			if (/^video-temp-[\w.-]+\.(mp4|webm|vtt|png|jpe?g)$/.test(name)) {
				const path = join(directory, name);
				let stat: ReturnType<typeof lstatSync>;
				try {
					stat = lstatSync(path);
				} catch {
					continue;
				}
				if (!stat.isFile()) continue;
				if (
					now - stat.mtimeMs > videoLimits.temporaryMs &&
					!(capture?.videos ?? []).some((v) =>
						[v.path, v.posterPath, v.captionsPath].includes(path),
					)
				)
					assets.push(path);
			}
		for (const path of new Set(assets)) {
			if (!budget--) return;
			try {
				if (lstatSync(path).isSymbolicLink()) continue;
				unlinkSync(
					evidenceFile(path, directory, Number.MAX_SAFE_INTEGER, true),
				);
			} catch {
				/* Missing, symlink escape or already expired: retain metadata. */
			}
		}
	}
}

/** Bound scanning as well as storage; do not follow directory symlinks. */
function evidenceBytes(directory: string): number {
	let entries = 0,
		bytes = 0;
	const visit = (dir: string) => {
		for (const name of readdirSync(dir)) {
			if (++entries > 10000)
				throw new Error(
					"Run evidence inventory exceeds the maintenance scan limit",
				);
			const path = join(dir, name),
				stat = lstatSync(path);
			if (stat.isDirectory()) visit(path);
			else if (stat.isFile()) bytes += stat.size;
			if (bytes > videoLimits.runBytes) return;
		}
	};
	visit(directory);
	return bytes;
}
