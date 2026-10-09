import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	closeSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const REPOSITORY = "jappyjan/bobs-factory";
export const TARGETS = [
	"darwin-arm64",
	"darwin-x64",
	"linux-x64",
	"linux-arm64",
];
export const sha256 = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
export const jsonBytes = (value) =>
	Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export function requireValue(condition, message) {
	if (!condition) throw new Error(message);
}
export function validatePublicRepository(repository) {
	requireValue(
		repository?.full_name === REPOSITORY &&
			repository.private === false &&
			repository.visibility === "public",
		"Public binary releases require the canonical repository to be publicly accessible; private/internal releases still require GitHub authentication",
	);
}
export function validateIdentity(version, commit, runId) {
	requireValue(
		/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version),
		"Invalid exact release version",
	);
	requireValue(
		/^[a-f0-9]{40}$/.test(commit),
		"Candidate must be a full immutable commit SHA",
	);
	requireValue(
		Number.isSafeInteger(runId) && runId > 0,
		"Invalid binary build run ID",
	);
}
export function validateLatestVersion(version, latest) {
	if (!latest) return;
	requireValue(
		/^v\d+\.\d+\.\d+$/.test(latest.tag_name),
		"Latest stable release has an unsupported version tag",
	);
	const previous = latest.tag_name.slice(1).split(".").map(BigInt);
	const next = version.split("-")[0].split(".").map(BigInt);
	const changed = next.findIndex((value, index) => value !== previous[index]);
	requireValue(
		changed >= 0 && next[changed] > previous[changed],
		"New release version must be newer than the current stable release",
	);
}
export function validatePublicationSlot(
	identity,
	existingRelease,
	existingTag,
	latest,
) {
	requireValue(
		!existingRelease && !existingTag,
		"Immutable version/tag already exists; choose a new version. Never delete or replace a previous release.",
	);
	validateLatestVersion(identity.version, latest);
}
function validateFile(record, expected) {
	requireValue(
		record?.file === expected,
		`Unexpected release filename: ${expected}`,
	);
	requireValue(
		/^[a-f0-9]{64}$/.test(record.sha256),
		`Invalid checksum: ${expected}`,
	);
	requireValue(
		Number.isSafeInteger(record.size) && record.size > 0,
		`Invalid size: ${expected}`,
	);
}
export function validateReleaseManifest(value) {
	requireValue(
		value?.schemaVersion === 1 &&
			value.product === "bobs-factory" &&
			value.repository === REPOSITORY,
		"Unsupported release manifest identity",
	);
	requireValue(
		value.status === "available" || value.status === "pending",
		"Invalid release status",
	);
	if (value.status === "pending") return value;
	validateIdentity(value.version, value.commit, value.buildRunId);
	requireValue(
		value.tag === `v${value.version}`,
		"Release tag must match exact version",
	);
	validateFile(value.installer, "install.sh");
	validateFile(value.verifier, "install-binary.sh");
	validateFile(value.source, "source-rebuild.tar.gz");
	requireValue(
		Object.keys(value.targets ?? {})
			.sort()
			.join() === [...TARGETS].sort().join(),
		"All four release targets are required",
	);
	for (const target of TARGETS) {
		const entry = value.targets[target];
		const name = `bobs-factory-${value.version}-${target}`;
		validateFile(
			{
				file: entry.archive,
				sha256: entry.archiveSha256,
				size: entry.archiveSize,
			},
			`${name}.tar.gz`,
		);
		validateFile(
			{
				file: entry.manifest,
				sha256: entry.manifestSha256,
				size: entry.manifestSize,
			},
			`${name}.manifest.json`,
		);
	}
	return value;
}
export function fileRecord(path, file) {
	const bytes = readFileSync(path);
	return { file, sha256: sha256(bytes), size: bytes.length };
}
export function validateBuildProvenance(run, jobs, artifacts, identity) {
	const { version, commit, runId } = identity;
	validateIdentity(version, commit, runId);
	requireValue(
		run.id === runId &&
			run.status === "completed" &&
			run.conclusion === "success",
		"Binary build run must have completed successfully",
	);
	requireValue(
		run.repository?.full_name === REPOSITORY &&
			run.head_repository?.full_name === REPOSITORY,
		"Binary build must come from the canonical repository",
	);
	requireValue(
		run.path === ".github/workflows/binary-build.yml" &&
			run.event === "workflow_dispatch",
		"Unexpected binary build workflow",
	);
	requireValue(
		run.head_sha === commit,
		"Workflow source SHA must be the reviewed candidate SHA; dispatch from that candidate ref",
	);
	const selected = {};
	for (const target of TARGETS) {
		const native = jobs.filter((job) => job.name.includes(target));
		requireValue(
			native.length === 1 &&
				native[0].status === "completed" &&
				native[0].conclusion === "success",
			`Missing successful native job: ${target}`,
		);
		const candidates = artifacts.filter(
			(artifact) => artifact.name === `bobs-factory-${target}-${commit}`,
		);
		requireValue(
			candidates.length === 1,
			`Missing or ambiguous candidate artifact: ${target}`,
		);
		const artifact = candidates[0];
		requireValue(
			!artifact.expired &&
				artifact.workflow_run?.id === runId &&
				artifact.workflow_run?.head_sha === commit,
			`Invalid artifact provenance: ${target}`,
		);
		requireValue(
			/^sha256:[a-f0-9]{64}$/.test(artifact.digest),
			`Artifact has no GitHub SHA-256 digest: ${target}`,
		);
		selected[target] = artifact;
	}
	return selected;
}
export function validateArtifactZip(
	zipPath,
	artifact,
	destination,
	identity,
	target,
) {
	requireValue(
		sha256(readFileSync(zipPath)) === artifact.digest.slice(7),
		`GitHub artifact digest mismatch: ${target}`,
	);
	const entries = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
		.trim()
		.split("\n");
	requireValue(
		new Set(entries).size === entries.length,
		"Duplicate artifact zip entries",
	);
	requireValue(
		entries.every(
			(entry) =>
				!entry.startsWith("/") &&
				!entry.includes("\\") &&
				!entry.split("/").some((part) => part === "." || part === ".."),
		),
		"Unsafe artifact zip entry",
	);
	const name = `bobs-factory-${identity.version}-${target}`;
	const needed = [
		`${name}.tar.gz`,
		`${name}.manifest.json`,
		"runtime-smoke.txt",
	];
	for (const file of needed) {
		requireValue(
			entries.includes(file),
			`Missing candidate artifact entry: ${file}`,
		);
		const fd = destination(file);
		try {
			execFileSync("unzip", ["-p", zipPath, file], {
				stdio: ["ignore", fd, "pipe"],
			});
		} finally {
			closeSync(fd);
		}
	}
}
export function validateArchive(archivePath, manifestPath, identity, target) {
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const name = `bobs-factory-${identity.version}-${target}`;
	requireValue(
		manifest.schemaVersion === 1 &&
			manifest.product === "bobs-factory" &&
			manifest.version === identity.version &&
			manifest.commit === identity.commit &&
			manifest.target === target &&
			manifest.dirty === false,
		`Candidate manifest does not match reviewed source: ${target}`,
	);
	validateFile(manifest, `${name}.tar.gz`);
	requireValue(
		statSync(archivePath).size === manifest.size &&
			sha256(readFileSync(archivePath)) === manifest.sha256,
		`Archive integrity failure: ${target}`,
	);
	const entries = execFileSync("tar", ["-tzf", archivePath], {
		encoding: "utf8",
	})
		.trim()
		.split("\n");
	const required = [
		"bobs-factory",
		"LICENSE",
		"NOTICE",
		"THIRD_PARTY_NOTICES.txt",
		"build.json",
	];
	const allowed = new Set([
		`${name}/`,
		...required.map((file) => `${name}/${file}`),
	]);
	requireValue(
		entries.length === new Set(entries).size &&
			entries.every((entry) => allowed.has(entry)),
		`Unexpected/duplicate archive inventory: ${target}`,
	);
	requireValue(
		required.every((file) => entries.includes(`${name}/${file}`)),
		`Missing archive inventory: ${target}`,
	);
	const types = execFileSync("tar", ["-tvzf", archivePath], {
		encoding: "utf8",
	})
		.trim()
		.split("\n");
	requireValue(
		types.every((line) => /^[d-]/.test(line)),
		`Links or special files in archive: ${target}`,
	);
	const work = mkdtempSync(join(tmpdir(), "factory-release-check-"));
	try {
		execFileSync("tar", ["-xzf", archivePath, "-C", work]);
		const build = JSON.parse(
			readFileSync(join(work, name, "build.json"), "utf8"),
		);
		requireValue(
			build.schemaVersion === 1 &&
				build.product === "bobs-factory" &&
				build.version === identity.version &&
				build.commit === identity.commit &&
				build.target === target &&
				build.dirty === false,
			`Embedded build identity mismatch: ${target}`,
		);
		requireValue(
			build.tooling?.bun === "1.4.2" &&
				/^[a-f0-9]{64}$/.test(build.resourceDigest),
			`Unverified build tooling/resources: ${target}`,
		);
		validateFile(build.executable, "bobs-factory");
		const binary = readFileSync(join(work, name, "bobs-factory"));
		requireValue(
			binary.length === build.executable.size &&
				sha256(binary) === build.executable.sha256,
			`Executable integrity failure: ${target}`,
		);
		requireValue(
			readFileSync(join(work, name, "LICENSE"), "utf8").includes(
				"Apache License",
			),
			`Missing product license: ${target}`,
		);
		requireValue(
			readFileSync(join(work, name, "NOTICE"), "utf8").includes("Cyrus"),
			`Missing upstream attribution: ${target}`,
		);
		const notices = readFileSync(
			join(work, name, "THIRD_PARTY_NOTICES.txt"),
			"utf8",
		);
		requireValue(
			notices.includes("Bun 1.4.2") && notices.length > 100,
			`Missing runtime/dependency license notices: ${target}`,
		);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
	return manifest;
}
export function validateEvidence(evidence, directory, identity) {
	requireValue(
		evidence?.schemaVersion === 1 &&
			evidence.product === "bobs-factory" &&
			evidence.version === identity.version &&
			evidence.commit === identity.commit &&
			evidence.buildRunId === identity.runId,
		"Release evidence must match exact reviewed candidate and build run",
	);
	const receipt = (record, label, statuses = ["passed"]) => {
		requireValue(
			statuses.includes(record?.status),
			`Unresolved release validation: ${label}`,
		);
		const file = record.receipt?.file;
		requireValue(
			typeof file === "string" &&
				/^[A-Za-z0-9_./-]+$/.test(file) &&
				!file.startsWith("/") &&
				!file.split("/").includes(".."),
			`Unsafe/missing evidence receipt: ${label}`,
		);
		requireValue(
			/^[a-f0-9]{64}$/.test(record.receipt.sha256),
			`Invalid evidence receipt hash: ${label}`,
		);
		const receiptPath = realpathSync(resolve(directory, file));
		requireValue(
			receiptPath.startsWith(`${realpathSync(directory)}/`) &&
				statSync(receiptPath).isFile(),
			`Receipt is outside evidence directory: ${label}`,
		);
		requireValue(
			sha256(readFileSync(receiptPath)) === record.receipt.sha256,
			`Evidence receipt integrity failure: ${label}`,
		);
		if (record.status === "waived")
			requireValue(
				typeof record.approvedBy === "string" &&
					record.approvedBy.trim().length > 0,
				`Human waiver attribution missing: ${label}`,
			);
	};
	receipt(evidence.reviewedCandidate, "reviewed candidate");
	receipt(evidence.fullPayloadF1, "full payload F1", [
		"passed",
		"not-applicable",
	]);
	receipt(evidence.migrationPreservation, "migration preservation");
	receipt(evidence.licensingAndSource, "source/rebuild and licensing");
	for (const target of TARGETS) {
		receipt(
			evidence.targets?.[target]?.preparedAgents,
			`${target} prepared agents`,
			["passed", "waived"],
		);
		receipt(
			evidence.targets?.[target]?.nativeHelpers,
			`${target} native helpers`,
		);
	}
	validateFile(evidence.source, "source-rebuild.tar.gz");
	const sourcePath = realpathSync(join(directory, evidence.source.file));
	requireValue(
		sourcePath.startsWith(`${realpathSync(directory)}/`) &&
			statSync(sourcePath).isFile(),
		"Source/rebuild archive is outside evidence directory",
	);
	requireValue(
		statSync(sourcePath).size === evidence.source.size &&
			sha256(readFileSync(sourcePath)) === evidence.source.sha256,
		"Source/rebuild archive integrity failure",
	);
	const listing = execFileSync("tar", ["-tzf", sourcePath], {
		encoding: "utf8",
	})
		.trim()
		.split("\n");
	requireValue(
		listing.length === new Set(listing).size &&
			listing.every(
				(entry) =>
					entry.startsWith("source-rebuild/") &&
					!entry.includes("\\") &&
					!entry.split("/").some((part) => part === "." || part === ".."),
			),
		"Unsafe source/rebuild archive inventory",
	);
	const verbose = execFileSync("tar", ["-tvzf", sourcePath], {
		encoding: "utf8",
	})
		.trim()
		.split("\n");
	requireValue(
		verbose.every((line) => /^[d-]/.test(line)),
		"Links/special files in source/rebuild archive",
	);
	for (const file of [
		"commit.txt",
		"README.md",
		"pnpm-lock.yaml",
		"bun-source.tar.gz",
	])
		requireValue(
			listing.includes(`source-rebuild/${file}`),
			`Source/rebuild material missing: ${file}`,
		);
	const commit = execFileSync(
		"tar",
		["-xOzf", sourcePath, "source-rebuild/commit.txt"],
		{ encoding: "utf8" },
	).trim();
	requireValue(
		commit === identity.commit,
		"Source/rebuild archive commit mismatch",
	);
	return evidence;
}
