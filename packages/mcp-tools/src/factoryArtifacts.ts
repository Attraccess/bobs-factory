import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";

export const factoryArtifactLimit = 8 * 1024 * 1024;
export interface FactoryArtifactBinding {
	directory: string;
	/** Canonical evidence root supplied by the runtime, never by an agent. */
	authorizedRoot?: string;
	runId: string;
	stepKey: string;
	headSha: string;
	baseSha?: string;
}
export const FactoryArtifactSchema = z
	.object({
		factoryArtifact: z
			.object({
				path: z.string().min(1).max(2000),
				sha256: z.string().regex(/^[a-f0-9]{64}$/),
				runId: z.string().min(1),
				stepKey: z.string().min(1),
				headSha: z.string().min(1),
				baseSha: z.string().min(1).optional(),
			})
			.strict(),
	})
	.strict();

/** Read only bounded regular files inside the role's runtime-owned artifact root. */
async function readArtifact(binding: FactoryArtifactBinding, path: string) {
	if (isAbsolute(path) || path.split(/[\\/]/).some((part) => part === ".."))
		throw new Error(
			"Result artifact path must remain inside the authorized artifact directory",
		);
	const authorized = binding.authorizedRoot ?? binding.directory;
	if ((await lstat(authorized)).isSymbolicLink())
		throw new Error("Authorized result artifact root must not be a symlink");
	const route = relative(authorized, binding.directory);
	if (route.startsWith("..") || isAbsolute(route))
		throw new Error(
			"Result artifact directory escapes its authorized evidence root",
		);
	let directory = authorized;
	for (const component of route.split(sep).filter(Boolean)) {
		directory = join(directory, component);
		const entry = await lstat(directory);
		if (!entry.isDirectory() || entry.isSymbolicLink())
			throw new Error(
				"Result artifact directory must remain inside the authorized evidence root without symlinks",
			);
	}
	const authorizedCanonical = await realpath(authorized);
	const root = await realpath(binding.directory);
	const rootLocation = relative(authorizedCanonical, root);
	if (rootLocation.startsWith("..") || isAbsolute(rootLocation))
		throw new Error(
			"Result artifact directory escapes its authorized evidence root",
		);
	const candidate = join(root, path);
	const stat = await lstat(candidate);
	if (!stat.isFile() || stat.isSymbolicLink())
		throw new Error("Result artifact must be a regular file, not a symlink");
	const actual = await realpath(candidate);
	const location = relative(root, actual);
	if (location.startsWith("..") || isAbsolute(location))
		throw new Error(
			"Result artifact escapes the authorized artifact directory",
		);
	const file = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const opened = await file.stat();
		if (opened.dev !== stat.dev || opened.ino !== stat.ino)
			throw new Error("Result artifact was replaced during submission");
		if (!opened.isFile() || opened.size > factoryArtifactLimit)
			throw new Error(
				`Result artifact exceeds ${factoryArtifactLimit} bytes or is not a regular file`,
			);
		// Bound the read as well: a concurrent writer cannot inflate allocation.
		const bytes = Buffer.alloc(
			Math.min(opened.size + 1, factoryArtifactLimit + 1),
		);
		let size = 0;
		while (size < bytes.length) {
			const read = await file.read(bytes, size, bytes.length - size, null);
			if (!read.bytesRead) break;
			size += read.bytesRead;
		}
		if (size > factoryArtifactLimit || size !== opened.size)
			throw new Error(
				"Result artifact changed during submission or exceeded its size limit",
			);
		const data = bytes.subarray(0, size);
		return {
			output: JSON.parse(data.toString("utf8")),
			sha256: createHash("sha256").update(data).digest("hex"),
		};
	} finally {
		await file.close();
	}
}

export async function submitFactoryResultArtifact(
	binding: FactoryArtifactBinding,
	path: string,
) {
	const { sha256 } = await readArtifact(binding, path);
	const {
		directory: _directory,
		authorizedRoot: _authorizedRoot,
		...identity
	} = binding;
	return { factoryArtifact: { ...identity, path, sha256 } };
}

/** Resolve the final envelope again so stale or changed files never bypass role validation. */
export async function resolveFactoryResultArtifact(
	binding: FactoryArtifactBinding,
	value: unknown,
): Promise<unknown> {
	if (
		!value ||
		typeof value !== "object" ||
		!Object.hasOwn(value, "factoryArtifact")
	)
		return value;
	const { factoryArtifact: artifact } = FactoryArtifactSchema.parse(value);
	if (
		artifact.runId !== binding.runId ||
		artifact.stepKey !== binding.stepKey ||
		artifact.headSha !== binding.headSha ||
		artifact.baseSha !== binding.baseSha
	)
		throw new Error(
			"Result artifact belongs to a different run, role or revision",
		);
	const candidate = await readArtifact(binding, artifact.path);
	if (candidate.sha256 !== artifact.sha256)
		throw new Error(
			"Result artifact changed after submission; submit the complete corrected candidate again",
		);
	return candidate.output;
}
