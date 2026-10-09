#!/usr/bin/env node
// Maintainer-only publisher. Defaults to a read-only dry run; never rebuilds.
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	copyFileSync,
	createReadStream,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	fileRecord,
	jsonBytes,
	REPOSITORY,
	requireValue,
	sha256,
	TARGETS,
	validateArchive,
	validateArtifactZip,
	validateBuildProvenance,
	validateEvidence,
	validateIdentity,
	validateNativeHelpers,
	validatePreparedAgentBoundaries,
	validatePublicRepository,
	validateReleaseManifest,
} from "./lib/binary-release.mjs";
import { receiptArchive } from "./lib/receipt-archive.mjs";
import {
	releaseChannel,
	requiredSupportingFiles,
	validateCandidateMetadata,
} from "./lib/release-channels.mjs";
import {
	discoverChannels,
	githubClient,
	readPublishedManifest,
} from "./lib/release-discovery.mjs";
import { publishStagedRelease } from "./lib/release-publication.mjs";

const { values } = parseArgs({
	options: {
		sha: { type: "string" },
		version: { type: "string" },
		"run-id": { type: "string" },
		evidence: { type: "string" },
		output: { type: "string" },
		"artifact-zips": { type: "string" },
		publish: { type: "boolean", default: false },
	},
});
const identity = {
	version: values.version,
	commit: values.sha,
	runId: Number(values["run-id"]),
};
validateIdentity(identity.version, identity.commit, identity.runId);
requireValue(
	values.evidence && values.output,
	"Provide --evidence FILE and a fresh --output DIRECTORY",
);
requireValue(
	!values.publish || process.env.GH_TOKEN,
	"GH_TOKEN is required only for maintainer publication/artifact download",
);
const output = resolve(values.output);
requireValue(
	!existsSync(output) || readdirSync(output).length === 0,
	"Output must be an empty directory; existing release material is never replaced",
);
const evidencePath = resolve(values.evidence);
const evidenceDirectory = dirname(evidencePath);
const evidence = validateEvidence(
	JSON.parse(readFileSync(evidencePath, "utf8")),
	evidenceDirectory,
	identity,
);
const { api, headers } = githubClient();
async function pages(path, key) {
	const result = [];
	for (let page = 1; page <= 10; page++) {
		const value = await api(
			`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
		);
		const items = value[key];
		requireValue(Array.isArray(items), `Invalid GitHub ${key} response`);
		result.push(...items);
		if (items.length < 100) return result;
	}
	throw new Error(`Too many ${key}; refusing incomplete provenance`);
}
const [repository, run, jobs, artifacts] = await Promise.all([
	api(""),
	api(`actions/runs/${identity.runId}`),
	pages(`actions/runs/${identity.runId}/jobs`, "jobs"),
	pages(`actions/runs/${identity.runId}/artifacts`, "artifacts"),
]);
validatePublicRepository(repository);
// Existing immutable attempts are checked against the complete staged hash inventory below.
const selected = validateBuildProvenance(run, jobs, artifacts, identity);
const packageContent = await api(
	`contents/apps/cli/package.json?ref=${identity.commit}`,
);
const pkg = JSON.parse(
	Buffer.from(packageContent.content, "base64").toString("utf8"),
);
requireValue(
	pkg.version === identity.version,
	"CLI version is not committed at the reviewed candidate SHA",
);
const candidate = pkg.bobsFactoryRelease;
requireValue(
	candidate,
	"Release candidate metadata is required; prepare an immutable candidate first",
);
validateCandidateMetadata(candidate, identity.version);
requireValue(
	!values.publish ||
		candidate.channel !== "nightly" ||
		process.env.BOBS_FACTORY_RELEASE_AUTOMATION === "enabled",
	"Nightly publication is disabled pending separately authorized rollout",
);
const parent =
	candidate.channel === "stable"
		? candidate.promotedFrom.commit
		: candidate.originatingSourceSha;
const comparison = await api(`compare/${parent}...${identity.commit}`);
requireValue(
	comparison.status === "ahead" &&
		comparison.total_commits === 1 &&
		comparison.files?.length === 1 &&
		comparison.files[0].filename === "apps/cli/package.json",
	"Candidate must contain only approved version metadata over its frozen source",
);
const parentContent = await api(`contents/apps/cli/package.json?ref=${parent}`);
const parentPackage = JSON.parse(
	Buffer.from(parentContent.content, "base64").toString("utf8"),
);
const payloadPackage = { ...pkg };
delete payloadPackage.version;
delete payloadPackage.bobsFactoryRelease;
const sourcePackage = { ...parentPackage };
delete sourcePackage.version;
delete sourcePackage.bobsFactoryRelease;
requireValue(
	JSON.stringify(payloadPackage) === JSON.stringify(sourcePackage),
	"Candidate changes non-version package metadata",
);
if (candidate.channel === "stable") {
	const selectedNightly = await readPublishedManifest(
		await api(`releases/tags/${candidate.promotedFrom.tag}`),
	);
	requireValue(
		selectedNightly.manifest.schemaVersion === 2 &&
			selectedNightly.manifest.channel === "nightly" &&
			selectedNightly.manifest.commit === parent &&
			selectedNightly.manifest.version === candidate.promotedFrom.version &&
			selectedNightly.manifestSha256 ===
				candidate.promotedFrom.manifestSha256 &&
			selectedNightly.manifest.originatingSourceSha ===
				candidate.originatingSourceSha,
		"Selected promotion source no longer matches its verified nightly identity",
	);
	const sourceTag = await api(`git/ref/tags/${candidate.promotedFrom.tag}`);
	requireValue(
		sourceTag.object?.type === "commit" && sourceTag.object.sha === parent,
		"Selected nightly tag differs from the verified manifest",
	);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const script of ["install.sh", "install-binary.sh"]) {
	const content = await api(
		`contents/scripts/${script}?ref=${identity.commit}`,
	);
	const committed = Buffer.from(content.content, "base64");
	requireValue(
		sha256(committed) === sha256(readFileSync(join(root, "scripts", script))),
		`Publisher ${script} differs from candidate source; run the candidate's tooling`,
	);
}
mkdirSync(output, { recursive: true });
const incoming = join(output, "incoming");
const assets = join(output, "assets");
mkdirSync(incoming);
mkdirSync(assets);
const targets = {};
for (const target of TARGETS) {
	const artifact = selected[target];
	const zipPath = values["artifact-zips"]
		? join(resolve(values["artifact-zips"]), `${target}.zip`)
		: join(incoming, `${target}.zip`);
	if (!values["artifact-zips"]) {
		requireValue(
			process.env.GH_TOKEN,
			"Provide --artifact-zips or GH_TOKEN for authenticated maintainer CI-artifact retrieval; end users never need this token",
		);
		const redirect = await fetch(
			`https://api.github.com/repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`,
			{ headers, redirect: "manual" },
		);
		requireValue(
			redirect.status === 302,
			`Artifact download unavailable: ${target} (${redirect.status})`,
		);
		const location = new URL(redirect.headers.get("location"));
		requireValue(
			location.protocol === "https:",
			"Artifact download must use HTTPS",
		);
		// Do not forward the repository token to the signed artifact host.
		const response = await fetch(location);
		requireValue(response.ok, `Artifact download failed: ${target}`);
		writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
	}
	const name = `bobs-factory-${identity.version}-${target}`;
	const extracted = join(incoming, target);
	mkdirSync(extracted);
	validateArtifactZip(
		zipPath,
		artifact,
		(file) => openSync(join(extracted, file), "wx"),
		identity,
		target,
	);
	const manifest = validateArchive(
		join(extracted, `${name}.tar.gz`),
		join(extracted, `${name}.manifest.json`),
		identity,
		target,
	);
	const build = JSON.parse(
		execFileSync(
			"tar",
			["-xOzf", join(extracted, `${name}.tar.gz`), `${name}/build.json`],
			{ encoding: "utf8" },
		),
	);
	validateNativeHelpers(
		JSON.parse(readFileSync(join(extracted, "native-helpers.json"), "utf8")),
		identity,
		target,
		build,
	);
	validatePreparedAgentBoundaries(
		JSON.parse(
			readFileSync(join(extracted, "prepared-agent-boundaries.json"), "utf8"),
		),
		identity,
		target,
		build,
	);
	const smoke = readFileSync(join(extracted, "runtime-smoke.txt"), "utf8");
	requireValue(
		smoke.includes(
			"Binary startup/assets/protected API/MCP/shutdown/restart smoke passed",
		) &&
			smoke.includes("Startup 1:") &&
			smoke.includes("Startup 2:"),
		`Missing native runtime smoke receipt: ${target}`,
	);
	for (const suffix of [".tar.gz", ".manifest.json"])
		copyFileSync(
			join(extracted, `${name}${suffix}`),
			join(assets, `${name}${suffix}`),
		);
	copyFileSync(
		join(extracted, "runtime-smoke.txt"),
		join(assets, `runtime-smoke-${target}.txt`),
	);
	const installerReceipt = JSON.parse(
		readFileSync(join(extracted, "public-installer.json"), "utf8"),
	);
	requireValue(
		installerReceipt.validation === "public-installer" &&
			installerReceipt.status === "passed" &&
			installerReceipt.scope === "native-archive-controlled-downloads" &&
			installerReceipt.version === identity.version &&
			installerReceipt.commit === identity.commit &&
			installerReceipt.target === target &&
			[
				"channelResolution",
				"exactVersion",
				"repeatInstall",
				"badHashPreservesInstallation",
				"badSizePreservesInstallation",
				"badSourcePreservesInstallation",
				"unavailableTargetPreservesInstallation",
			].every((check) => installerReceipt.checks?.[check] === "passed"),
		`Missing candidate-bound public installer validation: ${target}`,
	);
	for (const receipt of [
		"native-helpers",
		"prepared-agent-boundaries",
		"public-installer",
	])
		copyFileSync(
			join(extracted, `${receipt}.json`),
			join(assets, `${receipt}-${target}.json`),
		);
	const sidecar = fileRecord(
		join(assets, `${name}.manifest.json`),
		`${name}.manifest.json`,
	);
	targets[target] = {
		archive: manifest.file,
		archiveSha256: manifest.sha256,
		archiveSize: manifest.size,
		manifest: sidecar.file,
		manifestSha256: sidecar.sha256,
		manifestSize: sidecar.size,
	};
}
for (const script of ["install.sh", "install-binary.sh"])
	copyFileSync(join(root, "scripts", script), join(assets, script));
copyFileSync(
	join(evidenceDirectory, "source-rebuild.tar.gz"),
	join(assets, "source-rebuild.tar.gz"),
);
copyFileSync(evidencePath, join(assets, "release-evidence.json"));
const receiptFiles = new Set();
function collectReceipts(value) {
	if (!value || typeof value !== "object") return;
	if (value.receipt?.file) receiptFiles.add(value.receipt.file);
	for (const child of Object.values(value)) collectReceipts(child);
}
collectReceipts(evidence);
const receiptsDirectory = join(output, "receipts");
mkdirSync(receiptsDirectory);
for (const file of receiptFiles) {
	const destination = join(receiptsDirectory, file);
	mkdirSync(dirname(destination), { recursive: true });
	writeFileSync(destination, readFileSync(join(evidenceDirectory, file)), {
		mode: 0o644,
	});
}
writeFileSync(
	join(assets, "validation-receipts.tar.gz"),
	receiptArchive(receiptsDirectory, receiptFiles),
);
writeFileSync(
	join(assets, "build-provenance.json"),
	jsonBytes({ run, jobs, artifacts: selected }),
);
if (evidence.desktop) {
	for (const item of evidence.desktop.artifacts ?? []) {
		for (const record of [item.archive, item.updateMetadata, item.validation]) {
			requireValue(
				/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(record?.file) &&
					!existsSync(join(assets, record.file)),
				"Unsafe or conflicting delivered desktop filename",
			);
			const actual = fileRecord(
				join(evidenceDirectory, record.file),
				record.file,
			);
			requireValue(
				actual.sha256 === record.sha256 && actual.size === record.size,
				"Delivered desktop integrity mismatch",
			);
			copyFileSync(
				join(evidenceDirectory, record.file),
				join(assets, record.file),
			);
		}
		const validation = JSON.parse(
			readFileSync(join(assets, item.validation.file), "utf8"),
		);
		requireValue(
			validation.product === "bobs-factory" &&
				validation.status === "passed" &&
				validation.version === identity.version &&
				validation.commit === identity.commit &&
				validation.target === item.target &&
				validation.channel === candidate.channel,
			"Missing candidate-bound desktop validation; retain desktop delivery as blocked",
		);
	}
}
const release = validateReleaseManifest({
	...candidate,
	schemaVersion: 2,
	product: "bobs-factory",
	repository: REPOSITORY,
	status: "available",
	channel: releaseChannel(identity.version),
	...(evidence.desktop ? { desktop: evidence.desktop } : {}),
	supportingAssets: requiredSupportingFiles().map((file) =>
		fileRecord(join(assets, file), file),
	),
	version: identity.version,
	tag: `v${identity.version}`,
	commit: identity.commit,
	buildRunId: identity.runId,
	installer: fileRecord(join(assets, "install.sh"), "install.sh"),
	verifier: fileRecord(join(assets, "install-binary.sh"), "install-binary.sh"),
	source: fileRecord(
		join(assets, "source-rebuild.tar.gz"),
		"source-rebuild.tar.gz",
	),
	targets,
});
writeFileSync(join(assets, "release.json"), jsonBytes(release));
writeFileSync(
	join(output, "publication-plan.json"),
	jsonBytes({
		dryRun: !values.publish,
		repository: REPOSITORY,
		...identity,
		tag: release.tag,
		assets: readdirSync(assets)
			.sort()
			.map((file) => fileRecord(join(assets, file), file)),
	}),
);
const records = readdirSync(assets)
	.sort()
	.map((file) => fileRecord(join(assets, file), file));
validatePublicRepository(await api(""));
const result = await publishStagedRelease({
	api,
	identity,
	manifest: release,
	records,
	dryRun: !values.publish,
	approvedStable: process.env.BOBS_FACTORY_STABLE_RELEASE_APPROVED === "true",
	lastNightly: async () => (await discoverChannels(api)).nightly,
	receipt: (phase, detail) =>
		appendFileSync(
			join(output, "publication-phases.jsonl"),
			`${JSON.stringify({ phase, ...identity, at: new Date().toISOString(), ...detail })}\n`,
		),
	upload: async (id, record) => {
		const response = await fetch(
			`https://uploads.github.com/repos/${REPOSITORY}/releases/${id}/assets?name=${encodeURIComponent(record.file)}`,
			{
				method: "POST",
				headers: {
					...headers,
					"Content-Type": "application/octet-stream",
					"Content-Length": String(record.size),
				},
				body: createReadStream(join(assets, record.file)),
				duplex: "half",
			},
		);
		requireValue(
			response.ok,
			`Upload failed: ${record.file} (${response.status})`,
		);
		return response.json();
	},
});
console.log(JSON.stringify(result));
