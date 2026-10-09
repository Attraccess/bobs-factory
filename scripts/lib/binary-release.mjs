import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	closeSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readSync,
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
export function sha256File(path) {
	const fd = openSync(path, "r");
	try {
		const hash = createHash("sha256");
		const buffer = Buffer.alloc(1024 * 1024);
		for (;;) {
			const size = readSync(fd, buffer, 0, buffer.length, null);
			if (size === 0) break;
			hash.update(buffer.subarray(0, size));
		}
		return hash.digest("hex");
	} finally {
		closeSync(fd);
	}
}
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
		parseReleaseVersion(version) !== null,
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
export function parseReleaseVersion(version) {
	if (typeof version !== "string") return null;
	const match =
		/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?$/.exec(
			version,
		);
	if (!match) return null;
	const prerelease = match[4]?.split(".") ?? [];
	if (
		prerelease.some(
			(part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"),
		)
	)
		return null;
	return { core: match.slice(1, 4).map(BigInt), prerelease };
}
export function compareReleaseVersions(left, right) {
	const a = parseReleaseVersion(left);
	const b = parseReleaseVersion(right);
	requireValue(a && b, "Cannot compare invalid release versions");
	for (let i = 0; i < 3; i++) {
		if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
	}
	if (!a.prerelease.length || !b.prerelease.length) {
		return a.prerelease.length === b.prerelease.length
			? 0
			: a.prerelease.length
				? -1
				: 1;
	}
	for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
		const x = a.prerelease[i];
		const y = b.prerelease[i];
		if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
		if (x === y) continue;
		const numericX = /^\d+$/.test(x);
		const numericY = /^\d+$/.test(y);
		if (numericX && numericY) return BigInt(x) > BigInt(y) ? 1 : -1;
		if (numericX !== numericY) return numericX ? -1 : 1;
		return x > y ? 1 : -1;
	}
	return 0;
}
export function selectPublicRelease(releases) {
	requireValue(Array.isArray(releases), "Invalid public release list");
	const candidates = releases.filter(
		(release) =>
			!release.draft &&
			release.assets?.some((asset) => asset.name === "release.json") &&
			parseReleaseVersion(release.tag_name?.slice(1)) &&
			release.tag_name.startsWith("v"),
	);
	for (const release of candidates) {
		requireValue(
			release.prerelease === release.tag_name.includes("-"),
			"Release prerelease flag does not match version",
		);
	}
	// Stable installations stay on stable. Before 1.0, the reviewed beta is usable.
	const stable = candidates.filter((release) => !release.prerelease);
	return (
		(stable.length ? stable : candidates).sort((a, b) =>
			compareReleaseVersions(b.tag_name.slice(1), a.tag_name.slice(1)),
		)[0] ?? null
	);
}
export function validateLatestVersion(version, latest) {
	if (!latest) return;
	requireValue(
		/^v\d+\.\d+\.\d+$/.test(latest.tag_name),
		"Latest stable release has an unsupported version tag",
	);
	requireValue(
		compareReleaseVersions(version, latest.tag_name.slice(1)) > 0,
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
		value.channel === undefined ||
			value.channel === (value.version.includes("-") ? "prerelease" : "stable"),
		"Release channel must match exact version",
	);
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
	return { file, sha256: sha256File(path), size: statSync(path).size };
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
		"native-helpers.json",
		"prepared-agent-boundaries.json",
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
			sha256File(sourcePath) === evidence.source.sha256,
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

function validateNativeReceiptIdentity(
	receipt,
	identity,
	target,
	build,
	validation,
) {
	requireValue(
		receipt?.schemaVersion === 1 &&
			receipt.product === "bobs-factory" &&
			receipt.validation === validation &&
			receipt.status === "passed" &&
			receipt.version === identity.version &&
			receipt.commit === identity.commit &&
			receipt.target === target &&
			receipt.dirty === false &&
			build.version === identity.version &&
			build.commit === identity.commit &&
			build.target === target &&
			build.dirty === false &&
			receipt.executableSha256 === build.executable?.sha256 &&
			receipt.resourceDigest === build.resourceDigest &&
			/^[a-f0-9]{64}$/.test(receipt.executableSha256) &&
			/^[a-f0-9]{64}$/.test(receipt.resourceDigest),
		`Native ${validation} receipt does not match the clean candidate binary: ${target}`,
	);
}

export function validateNativeHelpers(receipt, identity, target, build) {
	validateNativeReceiptIdentity(
		receipt,
		identity,
		target,
		build,
		"native-helpers",
	);
	const [os, arch] = target.split("-");
	requireValue(
		receipt.platform?.os === os &&
			receipt.platform.arch === arch &&
			["release", "systemVersion", "cpuModel"].every(
				(field) =>
					typeof receipt.platform[field] === "string" &&
					receipt.platform[field].trim().length > 0,
			) &&
			(os === "linux"
				? /^glibc \d+\.\d+$/.test(receipt.platform.libc)
				: receipt.platform.libc === "not-applicable"),
		`Missing observed native OS/libc/CPU evidence: ${target}`,
	);
	requireValue(
		receipt.scope?.transport === "controlled-local-https" &&
			receipt.scope.credentials === "synthetic-scoped" &&
			receipt.scope.agentInference === "none" &&
			Number.isSafeInteger(receipt.requestCount) &&
			receipt.requestCount >= 4,
		`Native helper validation scope is missing or ambiguous: ${target}`,
	);
	for (const check of [
		"gitCredentialScoped",
		"gitCredentialForeignRejected",
		"restApiScoped",
		"graphqlApiScoped",
		"apiForeignRejected",
		"missingCredentialNoFallback",
		"http201CiRetry",
		"helperWithoutPath",
		"cursorPermission",
	])
		requireValue(
			receipt.checks?.[check] === "passed",
			`Native helper check missing: ${target}/${check}`,
		);
	return receipt;
}

export function validatePreparedAgentBoundaries(
	receipt,
	identity,
	target,
	build,
) {
	validateNativeReceiptIdentity(
		receipt,
		identity,
		target,
		build,
		"prepared-agent-boundaries",
	);
	requireValue(
		receipt.scope?.agents === "synthetic-sdk-and-mocked-adapters" &&
			receipt.scope.authenticatedProviders === false &&
			receipt.scope.agentInference === "none" &&
			receipt.compiledCursorIpcCreateResume === "passed" &&
			receipt.adapterCheckout?.commit === identity.commit &&
			receipt.adapterCheckout.dirty === false,
		`Prepared agent boundary scope is missing or mislabeled: ${target}`,
	);
	for (const runner of ["claude", "codex", "gemini", "opencode", "cursor"]) {
		const adapter = receipt.adapters?.[runner];
		requireValue(
			adapter?.status === "passed" &&
				Number.isSafeInteger(adapter.passed) &&
				adapter.passed > 0 &&
				Number.isSafeInteger(adapter.skipped) &&
				adapter.skipped >= 0 &&
				Array.isArray(adapter.files) &&
				adapter.files.length > 0 &&
				adapter.files.every(
					(file) =>
						typeof file === "string" && /^[A-Za-z0-9.-]+\.test\.ts$/.test(file),
				) &&
				/^[a-f0-9]{64}$/.test(adapter.reportSha256),
			`Prepared adapter boundary evidence missing: ${target}/${runner}`,
		);
	}
	// This proves protocol boundaries; it never grants the authenticated-agent gate.
	return receipt;
}
