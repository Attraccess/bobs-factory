#!/usr/bin/env node
// Maintainer-only publisher. Defaults to a read-only dry run; never rebuilds.
import { execFileSync } from "node:child_process";
import {
	copyFileSync,
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
	validateLatestVersion,
	validateNativeHelpers,
	validatePreparedAgentBoundaries,
	validatePublicRepository,
	validateReleaseManifest,
} from "./lib/binary-release.mjs";
import { discoverReleases, githubClient } from "./lib/github-release.mjs";
import { validatePreparedRelease } from "./lib/prepared-release.mjs";
import { withPublicationLock } from "./lib/publication-lock.mjs";
import {
	candidateIdentity,
	nightlyEligibility,
	PublicationSkip,
	validateCandidate,
} from "./lib/release-candidate.mjs";
import { publishPreparedRelease } from "./lib/release-publication.mjs";
import {
	signManifest,
	verifyManifestSignature,
} from "./lib/release-signature.mjs";

const { values } = parseArgs({
	options: {
		candidate: { type: "string" },
		"run-id": { type: "string" },
		evidence: { type: "string" },
		output: { type: "string" },
		"artifact-zips": { type: "string" },
		publish: { type: "boolean", default: false },
		resume: { type: "boolean", default: false },
		approval: { type: "string" },
		"key-id": { type: "string" },
	},
});
requireValue(
	values.candidate && values.output,
	"Provide --candidate FILE --output DIRECTORY",
);
const candidate = validateCandidate(
	JSON.parse(readFileSync(resolve(values.candidate), "utf8")),
);
const identity = candidateIdentity(candidate, Number(values["run-id"]));
validateIdentity(identity.version, identity.commit, identity.runId);
requireValue(
	!values.publish || process.env.GH_TOKEN,
	"GH_TOKEN required for publication",
);
const client = githubClient();
const { api, pages, headers } = client;
const output = resolve(values.output);
const evidencePath = values.evidence ? resolve(values.evidence) : undefined;
const evidenceDirectory = evidencePath ? dirname(evidencePath) : undefined;
let evidence;
let selected;
let run;
let jobs;
let artifacts;
if (!values.resume) {
	requireValue(
		evidencePath && (!existsSync(output) || readdirSync(output).length === 0),
		"Provide evidence and an empty output directory, or --resume for exact prepared bytes",
	);
	evidence = validateEvidence(
		JSON.parse(readFileSync(evidencePath, "utf8")),
		evidenceDirectory,
		identity,
	);
	const repository = await api("");
	validatePublicRepository(repository);
	[run, jobs, artifacts] = await Promise.all([
		api(`actions/runs/${identity.runId}`),
		pages(`actions/runs/${identity.runId}/jobs`, "jobs"),
		pages(`actions/runs/${identity.runId}/artifacts`, "artifacts"),
	]);
	selected = validateBuildProvenance(run, jobs, artifacts, identity);
	const pkg = JSON.parse(
		Buffer.from(
			(await api(`contents/apps/cli/package.json?ref=${identity.commit}`))
				.content,
			"base64",
		),
	);
	requireValue(
		pkg.version === identity.committedVersion,
		"Committed package version differs from frozen recipe",
	);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!values.resume) {
	requireValue(
		execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: root,
			encoding: "utf8",
		}).trim() === identity.workflowSha,
		"Publisher must execute frozen tooling revision",
	);
	for (const script of ["install.sh", "install-binary.sh"]) {
		const content = await api(
			`contents/scripts/${script}?ref=${identity.workflowSha}`,
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
		for (const receipt of ["native-helpers", "prepared-agent-boundaries"])
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
	copyFileSync(
		join(assets, "source-rebuild.tar.gz"),
		join(receiptsDirectory, "source-rebuild.tar.gz"),
	);
	for (const file of receiptFiles) {
		const destination = join(receiptsDirectory, file);
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(destination, readFileSync(join(evidenceDirectory, file)));
	}
	execFileSync("tar", [
		"-czf",
		join(assets, "validation-receipts.tar.gz"),
		"-C",
		receiptsDirectory,
		...[...receiptFiles].sort(),
	]);
	writeFileSync(
		join(assets, "build-provenance.json"),
		jsonBytes({
			candidateDigest: candidate.digest,
			run,
			jobs,
			artifacts: selected,
		}),
	);
	copyFileSync(resolve(values.candidate), join(assets, "candidate.json"));
	const release = validateReleaseManifest({
		schemaVersion: 2,
		product: "bobs-factory",
		repository: REPOSITORY,
		status: "available",
		channel: identity.channel,
		candidateDigest: candidate.digest,
		workflowSha: identity.workflowSha,
		version: identity.version,
		tag: `v${identity.version}`,
		commit: identity.commit,
		buildRunId: identity.runId,
		installer: fileRecord(join(assets, "install.sh"), "install.sh"),
		verifier: fileRecord(
			join(assets, "install-binary.sh"),
			"install-binary.sh",
		),
		source: fileRecord(
			join(assets, "source-rebuild.tar.gz"),
			"source-rebuild.tar.gz",
		),
		targets,
		assets: readdirSync(assets)
			.sort()
			.map((file) => fileRecord(join(assets, file), file)),
	});
	writeFileSync(join(assets, "release.json"), jsonBytes(release));
} // preparation never mutates the provider
const assetsDirectory = join(output, "assets");
const { manifest: release, manifestBytes } = validatePreparedRelease(
	assetsDirectory,
	candidate,
);
requireValue(
	release.buildRunId === identity.runId,
	"Prepared build run differs from requested run",
);
if (
	!existsSync(join(assetsDirectory, "release.json.sig")) &&
	process.env.BOBS_FACTORY_RELEASE_SIGNING_KEY_FILE
) {
	const signature = signManifest(
		manifestBytes,
		readFileSync(process.env.BOBS_FACTORY_RELEASE_SIGNING_KEY_FILE),
		values["key-id"],
	);
	writeFileSync(join(assetsDirectory, "release.json.sig"), signature, {
		flag: "wx",
	});
	writeFileSync(
		join(assetsDirectory, "release.json.key-id"),
		`${values["key-id"]}\n`,
		{ flag: "wx" },
	);
}
const signed = existsSync(join(assetsDirectory, "release.json.sig"));
if (signed)
	verifyManifestSignature(
		manifestBytes,
		readFileSync(join(assetsDirectory, "release.json.sig")),
		readFileSync(join(assetsDirectory, "release.json.key-id"), "utf8").trim(),
	);
const records = readdirSync(assetsDirectory)
	.sort()
	.map((file) => fileRecord(join(assetsDirectory, file), file));
const assetsDigest = sha256(jsonBytes(records));
writeFileSync(
	join(output, "publication-plan.json"),
	jsonBytes({
		dryRun: !values.publish,
		...identity,
		assetsDigest,
		assets: records,
		signature: signed ? "verified" : "blocked: signing key not provisioned",
	}),
);
if (!values.publish) {
	console.log(
		`Prepared ${candidate.digest}, assets ${assetsDigest}. ${signed ? "Signature verified" : "Signing is a rollout blocker"}. No remote mutation.`,
	);
} else {
	requireValue(signed, "Publication blocked: signed manifest required");
	requireValue(
		process.env.BOBS_FACTORY_RELEASE_PUBLICATION_LOCK === "repository",
		"Publication requires repository-wide concurrency lock",
	);
	if (identity.channel === "stable") {
		requireValue(
			values.approval,
			"Stable publication requires candidate-bound approval file",
		);
		const approval = JSON.parse(readFileSync(resolve(values.approval), "utf8"));
		requireValue(
			approval.candidateDigest === candidate.digest &&
				approval.assetsDigest === assetsDigest &&
				typeof approval.approvedBy === "string" &&
				approval.approvedBy.trim(),
			"Stable approval does not bind exact candidate and prepared assets",
		);
	} else
		requireValue(
			process.env.BOBS_FACTORY_AUTOMATIC_NIGHTLIES === "enabled",
			"Nightly rollout has not been separately enabled",
		);
	const recheck = async () => {
		const state = await discoverReleases(client);
		if (identity.channel === "stable") {
			for (const release of state.published.filter((r) => !r.prerelease))
				validateLatestVersion(identity.version, release);
		} else {
			const mainSha = (await api("git/ref/heads/main")).object.sha;
			const last = state.nightly;
			const relation =
				last && last.manifest.commit !== identity.commit
					? await api(`compare/${last.manifest.commit}...${identity.commit}`)
					: null;
			const result = nightlyEligibility({
				mainSha,
				candidateSha: identity.commit,
				last: last
					? {
							commit: last.manifest.commit,
							publishedAt: last.release.published_at,
						}
					: null,
				isDescendant: relation?.status === "ahead",
				now: Date.now(),
			});
			if (result.status !== "eligible") {
				if (result.status === "blocked") throw new Error(result.reason);
				throw new PublicationSkip(result);
			}
			requireValue(
				identity.sequence >
					Number(last?.manifest.version.split(".").at(-1) ?? 0),
				"Nightly ordering regressed",
			);
		}
	};
	try {
		await withPublicationLock(() =>
			publishPreparedRelease({
				client,
				manifest: release,
				records,
				assetsDirectory,
				receiptPath: join(output, "publication-receipt.json"),
				recheck,
			}),
		);
	} catch (error) {
		if (error instanceof PublicationSkip) {
			console.log(JSON.stringify({ status: "skipped", ...error.result }));
			process.exit(0);
		}
		throw error;
	}
	console.log("Publication confirmed; discovery synchronization dispatched.");
}
