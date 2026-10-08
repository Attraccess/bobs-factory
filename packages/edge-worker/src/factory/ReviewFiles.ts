import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	lstat,
	mkdir,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { runRepositories } from "./RepositoryScope.js";
import type { ExecutionContext, FactoryRun } from "./WorkflowRuntime.js";

const exec = promisify(execFile);
const digest = (text: string) =>
	createHash("sha256").update(text).digest("hex");
const sha = /^[a-f0-9]{40,64}$/;
const safe = /^[a-f0-9]{64}$/;
const patchLimit = 2 * 1024 * 1024;
export interface ReviewFilesReference {
	snapshotId: string;
	baseSha: string;
	headSha: string;
}
export interface ReviewFile {
	id: string;
	path: string;
	oldPath?: string;
	status: "A" | "M" | "D" | "R";
	gitStatus: string;
	oldMode: string;
	newMode: string;
	submodule: boolean;
	additions: number | null;
	deletions: number | null;
	binary: boolean;
	patchSha256?: string;
	unavailable?: string;
}
export interface ReviewFilesManifest extends ReviewFilesReference {
	runId: string;
	files: ReviewFile[];
	digest: string;
}
const git = async (
	workspace: string,
	args: string[],
	maxBuffer = 32 * 1024 * 1024,
) =>
	(
		await exec("git", args, {
			cwd: workspace,
			timeout: 30000,
			maxBuffer,
			encoding: "utf8",
		})
	).stdout;
const snapshotDirectory = (evidence: string, id: string) => {
	if (!safe.test(id)) throw new Error("Invalid review snapshot identity");
	return join(evidence, "review-files", id);
};
async function snapshotFile(evidence: string, id: string, name: string) {
	const directory = snapshotDirectory(evidence, id),
		root = await realpath(evidence),
		actual = await realpath(directory);
	if (relative(root, actual) !== join("review-files", id))
		throw new Error(
			"Snapshot must remain inside this run's evidence directory",
		);
	const path = join(directory, name),
		stat = await lstat(path);
	if (!stat.isFile() || stat.isSymbolicLink())
		throw new Error("Review snapshot files must be regular files");
	return path;
}
export async function readReviewManifest(
	evidence: string,
	runId: string,
	ref: ReviewFilesReference,
): Promise<ReviewFilesManifest> {
	const manifest: ReviewFilesManifest = JSON.parse(
		await readFile(
			await snapshotFile(evidence, ref.snapshotId, "manifest.json"),
			"utf8",
		),
	);
	const { digest: stored, ...content } = manifest;
	if (
		manifest.runId !== runId ||
		manifest.snapshotId !== ref.snapshotId ||
		manifest.baseSha !== ref.baseSha ||
		manifest.headSha !== ref.headSha ||
		digest(JSON.stringify(content)) !== stored
	)
		throw new Error(
			"Review snapshot does not match this run and guide revision",
		);
	return manifest;
}
export async function readReviewPatch(
	evidence: string,
	manifest: ReviewFilesManifest,
	id: string,
) {
	const file = manifest.files.find((file) => file.id === id);
	if (!file || !safe.test(id))
		throw new Error("File is not in the reviewed snapshot");
	if (file.unavailable || !file.patchSha256)
		return {
			patch: null,
			reason: file.unavailable ?? "No inline patch is available",
		};
	const patch = await readFile(
		await snapshotFile(evidence, manifest.snapshotId, `${id}.patch`),
		"utf8",
	);
	if (
		Buffer.byteLength(patch) > patchLimit ||
		digest(patch) !== file.patchSha256
	)
		throw new Error("Stored review patch failed integrity validation");
	return { patch, reason: null };
}
/** Atomic, content-addressed directory publication. Partial staging directories are never readable. */
export async function createReviewSnapshot(
	evidence: string,
	runId: string,
	workspace: string,
	baseSha: string,
	headSha: string,
): Promise<ReviewFilesReference> {
	if (!sha.test(baseSha) || !sha.test(headSha))
		throw new Error(
			"Exact retained Git revisions are required for Changed files",
		);
	const ref = {
		snapshotId: digest(JSON.stringify([runId, baseSha, headSha])),
		baseSha,
		headSha,
	};
	try {
		await readReviewManifest(evidence, runId, ref);
		return ref;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	await git(workspace, ["cat-file", "-e", `${baseSha}^{commit}`]);
	await git(workspace, ["cat-file", "-e", `${headSha}^{commit}`]);
	const raw = (
		await git(workspace, [
			"diff",
			"--raw",
			"--no-abbrev",
			"-z",
			"--find-renames",
			baseSha,
			headSha,
		])
	).split("\0");
	const stats = (
		await git(workspace, [
			"diff",
			"--numstat",
			"-z",
			"--find-renames",
			baseSha,
			headSha,
		])
	).split("\0");
	const counts = new Map<
		string,
		{ additions: number | null; deletions: number | null }
	>();
	for (let i = 0; i < stats.length && stats[i]; i++) {
		const record = stats[i]!,
			first = record.indexOf("\t"),
			second = record.indexOf("\t", first + 1);
		let path = record.slice(second + 1);
		if (!path) {
			i++;
			path = stats[++i]!;
		}
		const a = record.slice(0, first),
			d = record.slice(first + 1, second);
		counts.set(path, {
			additions: a === "-" ? null : Number(a),
			deletions: d === "-" ? null : Number(d),
		});
	}
	const files: ReviewFile[] = [];
	for (let i = 0; i < raw.length && raw[i]; i++) {
		const [oldMode, newMode, , , status] = raw[i]!.slice(1).split(" ");
		const first = raw[++i]!;
		const renamed = status!.startsWith("R"),
			path = renamed ? raw[++i]! : first;
		const count = counts.get(path) ?? { additions: null, deletions: null };
		files.push({
			id: digest(path),
			path,
			...(renamed ? { oldPath: first } : {}),
			status: renamed ? "R" : status === "A" || status === "D" ? status : "M",
			gitStatus: status!,
			oldMode: oldMode!,
			newMode: newMode!,
			submodule: oldMode === "160000" || newMode === "160000",
			...count,
			binary: count.additions === null,
		});
	}
	const parent = join(evidence, "review-files");
	await mkdir(parent, { recursive: true });
	const stage = join(parent, `.staging-${randomUUID()}`);
	await mkdir(stage);
	try {
		for (const file of files) {
			if (file.binary) {
				file.unavailable =
					"Binary content cannot be shown inline. Open the PR file.";
				continue;
			}
			try {
				const patch = await git(
					workspace,
					[
						"diff",
						"--no-ext-diff",
						"--no-textconv",
						"--find-renames",
						"--unified=3",
						baseSha,
						headSha,
						"--",
						...[...(file.oldPath ? [file.oldPath] : []), file.path].map(
							// Escaped glob patterns match the entire pathname. Literal
							// pathspecs also match descendants when a file became a folder.
							(path) => `:(top,glob)${path.replace(/[^/]/gu, "\\$&")}`,
						),
					],
					patchLimit,
				);
				if (Buffer.byteLength(patch) > patchLimit) {
					file.unavailable =
						"Patch exceeds the 2 MB inline limit. Open the PR file.";
					continue;
				}
				file.patchSha256 = digest(patch);
				await writeFile(join(stage, `${file.id}.patch`), patch);
			} catch (error) {
				if (
					(error as NodeJS.ErrnoException).code ===
					"ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
				)
					file.unavailable =
						"Patch exceeds the 2 MB inline limit. Open the PR file.";
				else throw error;
			}
		}
		const content = { ...ref, runId, files };
		await writeFile(
			join(stage, "manifest.json"),
			JSON.stringify({ ...content, digest: digest(JSON.stringify(content)) }),
		);
		try {
			await rename(stage, snapshotDirectory(evidence, ref.snapshotId));
		} catch (error) {
			if (
				!["EEXIST", "ENOTEMPTY"].includes(
					(error as NodeJS.ErrnoException).code ?? "",
				)
			)
				throw error;
			await readReviewManifest(evidence, runId, ref);
		}
		return ref;
	} finally {
		await rm(stage, { recursive: true, force: true });
	}
}
export async function finalizeGuideFiles(
	context: ExecutionContext,
	value: unknown,
): Promise<unknown> {
	const scope = context.progress?.reviewScope;
	if (!scope)
		throw new Error(
			"Whole-PR revision scope is unavailable; cannot bind Changed files",
		);
	if (scope.repositories?.length) {
		const repositories = runRepositories(context.run);
		const validate = async () => {
			for (const repository of repositories) {
				const revision = context.progress?.currentRevision?.repositories?.find(
					(item) => item.repositoryId === repository.id,
				);
				if (
					!revision ||
					revision.dirty ||
					(await git(repository.workspace, ["rev-parse", "HEAD"])).trim() !==
						revision.headSha ||
					(await git(repository.workspace, ["status", "--porcelain"])).trim()
				)
					throw new Error(
						`${repository.name} changed during guide authoring; regenerate the guide`,
					);
			}
		};
		await validate();
		const ref = {
			snapshotId: digest(
				JSON.stringify([
					context.run.id,
					scope.baseSha,
					scope.headSha,
					scope.repositories,
				]),
			),
			baseSha: scope.baseSha,
			headSha: scope.headSha,
		};
		const parent = join(context.evidenceDir, "review-files");
		await mkdir(parent, { recursive: true });
		const stage = join(parent, `.staging-${randomUUID()}`);
		await mkdir(stage);
		try {
			const files: ReviewFile[] = [];
			for (const repository of scope.repositories) {
				const child = await createReviewSnapshot(
					context.evidenceDir,
					context.run.id,
					repository.workspace,
					repository.baseSha,
					repository.headSha,
				);
				const manifest = await readReviewManifest(
					context.evidenceDir,
					context.run.id,
					child,
				);
				for (const original of manifest.files) {
					const path = `${repository.name}/${original.path}`;
					const file = {
						...original,
						id: digest(JSON.stringify([repository.repositoryId, original.id])),
						path,
						...(original.oldPath
							? { oldPath: `${repository.name}/${original.oldPath}` }
							: {}),
					};
					if (original.patchSha256) {
						const { patch } = await readReviewPatch(
							context.evidenceDir,
							manifest,
							original.id,
						);
						await writeFile(join(stage, `${file.id}.patch`), patch!);
					}
					files.push(file);
				}
			}
			await validate();
			const content = { ...ref, runId: context.run.id, files };
			await writeFile(
				join(stage, "manifest.json"),
				JSON.stringify({ ...content, digest: digest(JSON.stringify(content)) }),
			);
			try {
				await rename(
					stage,
					snapshotDirectory(context.evidenceDir, ref.snapshotId),
				);
			} catch (error) {
				if (
					!["EEXIST", "ENOTEMPTY"].includes(
						(error as NodeJS.ErrnoException).code ?? "",
					)
				)
					throw error;
				await readReviewManifest(context.evidenceDir, context.run.id, ref);
			}
			return { ...(value as object), reviewFiles: ref };
		} finally {
			await rm(stage, { recursive: true, force: true });
		}
	}
	const head = (await git(context.run.workspace, ["rev-parse", "HEAD"])).trim();
	if (
		head !== scope.headSha ||
		(await git(context.run.workspace, ["status", "--porcelain"])).trim()
	)
		throw new Error(
			"Worktree changed during guide authoring; regenerate the guide for the clean reviewed revision",
		);
	const reviewFiles = await createReviewSnapshot(
		context.evidenceDir,
		context.run.id,
		context.run.workspace,
		scope.baseSha,
		scope.headSha,
	);
	if (
		(await git(context.run.workspace, ["rev-parse", "HEAD"])).trim() !== head ||
		(await git(context.run.workspace, ["status", "--porcelain"])).trim()
	)
		throw new Error("Worktree changed while binding the review snapshot");
	return { ...(value as object), reviewFiles };
}
export const guideDigest = (guide: unknown) => digest(JSON.stringify(guide));
/** Historical reconstruction uses only the adjacent retained CI/readiness receipt, never live HEAD/base. */
export async function resolveGuideSnapshot(
	run: FactoryRun,
	evidence: string,
	expectedGuide: string,
): Promise<ReviewFilesReference> {
	const candidates = [
		...run.history
			.filter((h) => h.step === "guide" || h.step.endsWith("/guide"))
			.map((h) => h.output),
		run.outputs.guide,
	];
	const guide = candidates.find(
		(value) => value && guideDigest(value) === expectedGuide,
	) as { reviewFiles?: ReviewFilesReference } | undefined;
	if (!guide)
		throw new Error(
			"Guide changed or is not retained in this run; refresh the review",
		);
	if (guide.reviewFiles) return guide.reviewFiles;
	const retainedPath = join(
		evidence,
		"historical-guides",
		`${expectedGuide}.json`,
	);
	try {
		return JSON.parse(await readFile(retainedPath, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const index = run.history.findIndex(
		(h) =>
			h.output &&
			guideDigest(h.output) === expectedGuide &&
			(h.step === "guide" || h.step.endsWith("/guide")),
	);
	if (index < 0)
		throw new Error(
			"Historical guide revision is unavailable. Open the PR diff.",
		);
	const receipt = [...run.history.slice(0, index)]
		.reverse()
		.find(
			(h) =>
				h.step === "merge-readiness" ||
				h.step.endsWith("/merge-readiness") ||
				h.step === "ci" ||
				h.step.endsWith("/ci"),
		)?.output as { baseSha?: string; headSha?: string } | undefined;
	// A later handoff establishes the guide head independently of current branch data.
	const handoff = run.history
		.slice(index + 1)
		.find(
			(h) =>
				h.step === "handoff" ||
				h.step.endsWith("/handoff") ||
				h.step === "guide" ||
				h.step.endsWith("/guide"),
		);
	const head =
		handoff?.step === "handoff" || handoff?.step.endsWith("/handoff")
			? (handoff.output as { headSha?: string })?.headSha
			: undefined;
	if (!receipt?.baseSha || !head || head !== receipt.headSha)
		throw new Error(
			"Exact historical base/head receipts are unavailable. Open the PR diff.",
		);
	const base = (
		await git(run.workspace, ["merge-base", receipt.baseSha, head])
	).trim();
	const ref = await createReviewSnapshot(
		evidence,
		run.id,
		run.workspace,
		base,
		head,
	);
	await mkdir(join(evidence, "historical-guides"), { recursive: true });
	const temporary = `${retainedPath}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, JSON.stringify(ref));
		await rename(temporary, retainedPath);
	} finally {
		await rm(temporary, { force: true });
	}
	return ref;
}
