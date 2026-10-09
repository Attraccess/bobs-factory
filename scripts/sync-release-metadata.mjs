#!/usr/bin/env node
// Pages and Nix use the same public release asset, never hardcoded build IDs.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	jsonBytes,
	REPOSITORY,
	requireValue,
	selectPublicRelease,
	sha256,
	validateReleaseManifest,
} from "./lib/binary-release.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = join(root, "website/public");
mkdirSync(join(publicRoot, "releases"), { recursive: true });
copyFileSync(join(root, "scripts/install.sh"), join(publicRoot, "install.sh"));
const releases = [];
for (let page = 1; page <= 10; page++) {
	const response = await fetch(
		`https://api.github.com/repos/${REPOSITORY}/releases?per_page=100&page=${page}`,
		{
			headers: {
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
		},
	);
	requireValue(
		response.ok,
		`Could not resolve published releases (${response.status}); refusing stale metadata`,
	);
	const batch = await response.json();
	requireValue(Array.isArray(batch), "Invalid published release list");
	releases.push(...batch);
	if (batch.length < 100) break;
	requireValue(
		page < 10,
		"Too many releases; refusing incomplete public metadata",
	);
}
const release = selectPublicRelease(releases);
let manifest;
if (!release) {
	manifest = {
		schemaVersion: 1,
		product: "bobs-factory",
		repository: REPOSITORY,
		status: "pending",
		message: "The first public binary release is being prepared.",
	};
} else {
	const matches = release.assets.filter(
		(asset) => asset.name === "release.json",
	);
	requireValue(
		matches.length === 1,
		"Latest public release has no unambiguous release manifest",
	);
	const asset = matches[0];
	const expectedURL = `https://github.com/${REPOSITORY}/releases/download/${release.tag_name}/release.json`;
	requireValue(
		asset.browser_download_url === expectedURL &&
			/^sha256:[a-f0-9]{64}$/.test(asset.digest),
		"Unverified public release manifest asset",
	);
	const content = await fetch(expectedURL);
	requireValue(
		content.ok,
		`Could not retrieve public manifest (${content.status})`,
	);
	const bytes = Buffer.from(await content.arrayBuffer());
	requireValue(
		bytes.length === asset.size && sha256(bytes) === asset.digest.slice(7),
		"Published manifest checksum mismatch",
	);
	manifest = validateReleaseManifest(JSON.parse(bytes.toString("utf8")));
	requireValue(
		manifest.status === "available" && manifest.tag === release.tag_name,
		"Published manifest does not match release tag",
	);
	manifest.channel = release.prerelease ? "prerelease" : "stable";
	for (const entry of [
		manifest.installer,
		manifest.verifier,
		manifest.source,
		...Object.values(manifest.targets).flatMap((target) => [
			{
				file: target.archive,
				sha256: target.archiveSha256,
				size: target.archiveSize,
			},
			{
				file: target.manifest,
				sha256: target.manifestSha256,
				size: target.manifestSize,
			},
		]),
	]) {
		const assets = release.assets.filter(
			(candidate) => candidate.name === entry.file,
		);
		requireValue(
			assets.length === 1 &&
				assets[0].size === entry.size &&
				assets[0].digest === `sha256:${entry.sha256}`,
			`Public release asset is missing or inconsistent: ${entry.file}`,
		);
	}
}
writeFileSync(join(publicRoot, "releases/latest.json"), jsonBytes(manifest));
console.log(`Prepared public installation metadata: ${manifest.status}`);
