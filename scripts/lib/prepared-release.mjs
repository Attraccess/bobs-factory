import { execFileSync } from "node:child_process";
import {
	closeSync,
	copyFileSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	fileRecord,
	releaseAssetRecords,
	requireValue,
	TARGETS,
	validateArchive,
	validateBuildProvenance,
	validateDesktopReceipt,
	validateEvidence,
	validateNativeHelpers,
	validatePreparedAgentBoundaries,
	validatePublicInstaller,
	validateReleaseManifest,
} from "./binary-release.mjs";
import { candidateIdentity, validateCandidate } from "./release-candidate.mjs";

export function validatePreparedRelease(
	directory,
	expectedCandidate,
	{ legacyBeta = false } = {},
) {
	const manifestBytes = readFileSync(join(directory, "release.json"));
	const manifest = validateReleaseManifest(JSON.parse(manifestBytes));
	requireValue(
		manifest.status === "available" &&
			(manifest.schemaVersion === 2 ||
				(legacyBeta &&
					manifest.schemaVersion === 1 &&
					/-beta(?:\.\d+)?$/.test(manifest.version))),
		"Prepared publication requires schema 2 or explicitly authenticated historical beta",
	);
	const inventory =
		manifest.schemaVersion === 2
			? manifest.assets
			: readdirSync(directory)
					.filter(
						(file) =>
							![
								"release.json",
								"release.json.sig",
								"release.json.key-id",
								"release-attestation.json",
								"release-attestation.json.sig",
								"release-attestation.json.key-id",
							].includes(file),
					)
					.map((file) => fileRecord(join(directory, file), file));
	for (const record of releaseAssetRecords(manifest, false))
		requireValue(
			inventory.some(
				(a) =>
					a.file === record.file &&
					a.sha256 === record.sha256 &&
					a.size === record.size,
			),
			`Asset differs from immutable release manifest: ${record.file}`,
		);
	for (const r of inventory) {
		const path = join(directory, r.file);
		requireValue(
			lstatSync(path).isFile(),
			"Prepared assets must be regular files",
		);
		const actual = fileRecord(path, r.file);
		requireValue(
			actual.sha256 === r.sha256 && actual.size === r.size,
			`Prepared asset changed: ${r.file}`,
		);
	}
	const candidate =
		manifest.schemaVersion === 2
			? validateCandidate(
					JSON.parse(readFileSync(join(directory, "candidate.json"))),
				)
			: null;
	requireValue(
		!expectedCandidate || expectedCandidate.digest === candidate?.digest,
		"Prepared candidate differs from requested identity",
	);
	const identity = candidate
		? candidateIdentity(candidate, manifest.buildRunId)
		: {
				version: manifest.version,
				commit: manifest.commit,
				runId: manifest.buildRunId,
			};
	requireValue(
		!candidate ||
			(manifest.candidateDigest === candidate.digest &&
				manifest.version === identity.version &&
				manifest.commit === identity.commit &&
				manifest.workflowSha === identity.workflowSha),
		"Prepared manifest/candidate mismatch",
	);
	const provenance = JSON.parse(
		readFileSync(join(directory, "build-provenance.json")),
	);
	requireValue(
		!candidate || provenance.candidateDigest === candidate.digest,
		"Build provenance candidate mismatch",
	);
	validateBuildProvenance(
		provenance.run,
		provenance.jobs,
		Object.values(provenance.artifacts),
		identity,
	);
	for (const target of TARGETS) {
		const entry = manifest.targets[target];
		validateArchive(
			join(directory, entry.archive),
			join(directory, entry.manifest),
			identity,
			target,
		);
		const name = `bobs-factory-${identity.version}-${target}`;
		const build = JSON.parse(
			execFileSync(
				"tar",
				["-xOzf", join(directory, entry.archive), `${name}/build.json`],
				{ encoding: "utf8" },
			),
		);
		validateNativeHelpers(
			JSON.parse(
				readFileSync(join(directory, `native-helpers-${target}.json`)),
			),
			identity,
			target,
			build,
		);
		validatePreparedAgentBoundaries(
			JSON.parse(
				readFileSync(
					join(directory, `prepared-agent-boundaries-${target}.json`),
				),
			),
			identity,
			target,
			build,
		);
		if (manifest.publicInstallerValidation === 1)
			validatePublicInstaller(
				JSON.parse(
					readFileSync(join(directory, `public-installer-${target}.json`)),
				),
				identity,
				target,
			);
		const smoke = readFileSync(
			join(directory, `runtime-smoke-${target}.txt`),
			"utf8",
		);
		requireValue(
			smoke.includes(
				"Binary startup/assets/protected API/MCP/shutdown/restart smoke passed",
			) &&
				smoke.includes("Startup 1:") &&
				smoke.includes("Startup 2:"),
			`Missing native runtime smoke: ${target}`,
		);
	}
	for (const item of manifest.desktop?.artifacts ?? [])
		validateDesktopReceipt(
			JSON.parse(readFileSync(join(directory, item.validation.file))),
			identity,
			item.target,
		);
	const temporary = mkdtempSync(join(tmpdir(), "factory-prepared-evidence-"));
	try {
		const archive = join(directory, "validation-receipts.tar.gz");
		const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
			.trim()
			.split("\n");
		requireValue(
			new Set(entries).size === entries.length &&
				entries.every(
					(e) =>
						/^[A-Za-z0-9_./-]+$/.test(e) &&
						!e.startsWith("/") &&
						!e.split("/").some((p) => p === "." || p === "..") &&
						e !== "source-rebuild.tar.gz",
				),
			"Unsafe receipt archive",
		);
		requireValue(
			execFileSync("tar", ["-tvzf", archive], { encoding: "utf8" })
				.trim()
				.split("\n")
				.every((e) => /^[-d]/.test(e)),
			"Receipt archive contains links/special files",
		);
		for (const entry of entries) {
			const path = join(temporary, entry);
			if (entry.endsWith("/")) {
				mkdirSync(path, { recursive: true });
				continue;
			}
			mkdirSync(dirname(path), { recursive: true });
			const fd = openSync(path, "wx");
			try {
				execFileSync("tar", ["-xOzf", archive, entry], {
					stdio: ["ignore", fd, "pipe"],
				});
			} finally {
				closeSync(fd);
			}
		}
		copyFileSync(
			join(directory, "source-rebuild.tar.gz"),
			join(temporary, "source-rebuild.tar.gz"),
		);
		validateEvidence(
			JSON.parse(readFileSync(join(directory, "release-evidence.json"))),
			temporary,
			identity,
		);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
	return { manifest, manifestBytes, candidate, identity, inventory };
}
