import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
	type FactoryArtifactBinding,
	resolveFactoryResultArtifact,
} from "bobs-factory-mcp-tools";
import {
	OutputValidationError,
	outputValidationError,
} from "./OutputValidation.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

export function roleResultArtifactBinding(
	context: ExecutionContext,
): FactoryArtifactBinding {
	const stepKey = context.stepKey ?? context.run.step ?? context.step.id;
	const revision = context.progress?.currentRevision;
	if (!revision || revision.dirty)
		throw new Error("Result artifact requires a current clean revision");
	if (lstatSync(context.evidenceDir).isSymbolicLink())
		throw new Error("Authorized result evidence root must not be a symlink");
	const authorizedRoot = realpathSync(context.evidenceDir);
	return {
		directory: join(
			authorizedRoot,
			"role-results",
			createHash("sha256").update(stepKey).digest("hex"),
		),
		authorizedRoot,
		runId: context.run.id,
		stepKey,
		headSha: revision.headSha,
		...(context.progress?.reviewScope?.baseSha
			? { baseSha: context.progress.reviewScope.baseSha }
			: {}),
	};
}

export async function resolveRoleResult(
	context: ExecutionContext,
	value: unknown,
): Promise<unknown> {
	let output = value;
	try {
		if (
			value &&
			typeof value === "object" &&
			Object.hasOwn(value, "factoryArtifact")
		)
			output = await resolveFactoryResultArtifact(
				roleResultArtifactBinding(context),
				value,
			);
	} catch (error) {
		throw outputValidationError(value, error);
	}
	try {
		if (context.step.id !== "guide" || !output || typeof output !== "object")
			return output;
		const guide = structuredClone(output) as Record<string, unknown>;
		const files = context.progress?.reviewScope?.files;
		const scope = guide.scope as Record<string, unknown> | undefined;
		const chapters = guide.chapters;
		if (Array.isArray(chapters))
			for (const [index, chapter] of chapters.entries())
				if (!chapter || typeof chapter !== "object" || Array.isArray(chapter))
					throw new OutputValidationError(value, [
						{
							path: `/chapters/${index}`,
							message: "Guide chapter must be an object",
						},
					]);
		if (
			scope?.files === "runtime" ||
			(Array.isArray(chapters) &&
				chapters.some((chapter) => Object.hasOwn(chapter, "fileIndexes")))
		) {
			if (!files)
				throw new OutputValidationError(output, [
					{
						path: "/scope/files",
						message: "Runtime-owned whole-PR file inventory is unavailable",
					},
				]);
			if (scope?.files === "runtime") scope.files = [...files];
			if (Array.isArray(chapters))
				for (const [chapterIndex, chapter] of chapters.entries()) {
					if (!Object.hasOwn(chapter, "fileIndexes")) continue;
					const indexes = chapter.fileIndexes;
					if (
						Object.hasOwn(chapter, "files") ||
						!Array.isArray(indexes) ||
						indexes.some(
							(index) =>
								!Number.isInteger(index) || index < 0 || index >= files.length,
						) ||
						new Set(indexes).size !== indexes.length
					)
						throw new OutputValidationError(output, [
							{
								path: `/chapters/${chapterIndex}/fileIndexes`,
								message:
									"Choose unique valid indexes from /progress/reviewScope/files instead of files; unknown/duplicate indexes cannot establish coverage",
							},
						]);
					chapter.files = indexes.map((index) => files[index]);
					delete chapter.fileIndexes;
				}
		}
		return guide;
	} catch (error) {
		const rejected = outputValidationError(output, error);
		throw new OutputValidationError(output, rejected.issues);
	}
}
