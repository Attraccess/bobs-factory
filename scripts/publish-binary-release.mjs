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
	validatePublicationSlot,
	validatePublicRepository,
	validateReleaseManifest,
} from "./lib/binary-release.mjs";

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
const headers = {
	Accept: "application/vnd.github+json",
	"X-GitHub-Api-Version": "2022-11-28",
	...(process.env.GH_TOKEN
		? { Authorization: `Bearer ${process.env.GH_TOKEN}` }
		: {}),
};
async function api(path, { method = "GET", body, allow404 = false } = {}) {
	const response = await fetch(
		`https://api.github.com/repos/${REPOSITORY}${path ? `/${path}` : ""}`,
		{
			method,
			headers: {
				...headers,
				...(body ? { "Content-Type": "application/json" } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		},
	);
	if (allow404 && response.status === 404) return null;
	requireValue(
		response.ok,
		`GitHub ${method} ${path} failed (${response.status})`,
	);
	return response.status === 204 ? null : response.json();
}
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
const [repository, run, jobs, artifacts, existingRelease, existingTag, latest] =
	await Promise.all([
		api(""),
		api(`actions/runs/${identity.runId}`),
		pages(`actions/runs/${identity.runId}/jobs`, "jobs"),
		pages(`actions/runs/${identity.runId}/artifacts`, "artifacts"),
		api(`releases/tags/v${identity.version}`, { allow404: true }),
		api(`git/ref/tags/v${identity.version}`, { allow404: true }),
		api("releases/latest", { allow404: true }),
	]);
validatePublicRepository(repository);
validatePublicationSlot(identity, existingRelease, existingTag, latest);
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
	jsonBytes({ run, jobs, artifacts: selected }),
);
const release = validateReleaseManifest({
	schemaVersion: 1,
	product: "bobs-factory",
	repository: REPOSITORY,
	status: "available",
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
if (!values.publish) {
	console.log(
		`Dry run passed. Reviewed public assets: ${assets}. No tag or release was created.`,
	);
} else {
	// Recheck immediately before mutation. GitHub also rejects competing tag creation.
	validatePublicRepository(await api(""));
	requireValue(
		!(await api(`releases/tags/${release.tag}`, { allow404: true })) &&
			!(await api(`git/ref/tags/${release.tag}`, { allow404: true })),
		"Version was published during validation; refusing overwrite",
	);
	await api("git/refs", {
		method: "POST",
		body: { ref: `refs/tags/${release.tag}`, sha: identity.commit },
	});
	let draft;
	let published;
	try {
		draft = await api("releases", {
			method: "POST",
			body: {
				tag_name: release.tag,
				target_commitish: identity.commit,
				name: `Bob's Factory ${identity.version}`,
				draft: true,
				prerelease: identity.version.includes("-"),
				body: `Verified native binaries for all four macOS/Linux targets.\n\nReviewed source: ${identity.commit}\nBinary build: https://github.com/${REPOSITORY}/actions/runs/${identity.runId}\n\nInstall: https://jappyjan.github.io/bobs-factory/#start\nChecksums, native smoke receipts, source/rebuild material and release validation accompany the assets.`,
			},
		});
		for (const file of readdirSync(assets).sort()) {
			const bytes = readFileSync(join(assets, file));
			const response = await fetch(
				`https://uploads.github.com/repos/${REPOSITORY}/releases/${draft.id}/assets?name=${encodeURIComponent(file)}`,
				{
					method: "POST",
					headers: {
						...headers,
						"Content-Type": "application/octet-stream",
						"Content-Length": String(bytes.length),
					},
					body: bytes,
				},
			);
			requireValue(response.ok, `Upload failed: ${file} (${response.status})`);
			const uploaded = await response.json();
			requireValue(
				uploaded.size === bytes.length &&
					uploaded.state === "uploaded" &&
					uploaded.digest === `sha256:${sha256(bytes)}`,
				`Uploaded asset integrity failure: ${file}`,
			);
		}
		const tag = await api(`git/ref/tags/${release.tag}`);
		requireValue(
			tag.object?.type === "commit" && tag.object.sha === identity.commit,
			"Release tag changed during upload; retaining draft for inspection",
		);
		validateLatestVersion(
			identity.version,
			await api("releases/latest", { allow404: true }),
		);
		validatePublicRepository(await api(""));
		published = await api(`releases/${draft.id}`, {
			method: "PATCH",
			body: {
				draft: false,
				make_latest: identity.version.includes("-") ? "false" : "true",
			},
		});
		console.log(
			`Published ${published.html_url}. Previous releases were retained.`,
		);
		// GITHUB_TOKEN-created release events do not trigger other workflows.
		// Dispatch explicitly only after the validated assets become public.
		await api("actions/workflows/website.yml/dispatches", {
			method: "POST",
			body: { ref: "main" },
		});
		console.log(
			"Dispatched website deployment to synchronize the shared release manifest.",
		);
	} catch (error) {
		if (published)
			console.error(
				`Release is public at ${published.html_url}, but website synchronization failed. Run website.yml manually; do not republish or move the version tag.`,
			);
		else
			console.error(
				`Publication stopped. Retained immutable tag ${release.tag}${draft ? ` and draft release ${draft.html_url}` : ""}; inspect the staged assets before recovery. Never overwrite the version.`,
			);
		throw error;
	}
}
