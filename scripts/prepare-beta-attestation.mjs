#!/usr/bin/env node
// Produces additive authentication assets for historical beta; never edits/releases it.
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	fileRecord,
	jsonBytes,
	requireValue,
	sha256,
} from "./lib/binary-release.mjs";
import { validatePreparedRelease } from "./lib/prepared-release.mjs";
import { signManifest } from "./lib/release-signature.mjs";

const { values } = parseArgs({
	options: {
		assets: { type: "string" },
		output: { type: "string" },
		approval: { type: "string" },
		"key-id": { type: "string" },
	},
});
requireValue(
	values.assets &&
		values.output &&
		values.approval &&
		process.env.BOBS_FACTORY_RELEASE_SIGNING_KEY_FILE,
	"Historical beta needs immutable assets, explicit inventory approval and protected signing binding",
);
const directory = resolve(values.assets),
	output = resolve(values.output);
requireValue(
	directory !== output &&
		(!existsSync(output) || readdirSync(output).length === 0),
	"Use a separate empty output; historical assets are never modified",
);
const { manifest, manifestBytes, inventory } = validatePreparedRelease(
	directory,
	undefined,
	{ legacyBeta: true },
);
requireValue(
	manifest.schemaVersion === 1,
	"Only historical beta uses attestation; new releases use schema 2",
);
const assetsDigest = sha256(
	jsonBytes(inventory.sort((a, b) => a.file.localeCompare(b.file))),
);
const approval = JSON.parse(readFileSync(resolve(values.approval)));
requireValue(
	approval.manifestSha256 === sha256(manifestBytes) &&
		approval.assetsDigest === assetsDigest &&
		typeof approval.approvedBy === "string" &&
		approval.approvedBy.trim(),
	"Approval must bind exact historical manifest and full inventory",
);
const privateKey = readFileSync(
	process.env.BOBS_FACTORY_RELEASE_SIGNING_KEY_FILE,
);
const attestation = jsonBytes({
	schemaVersion: 1,
	product: "bobs-factory",
	repository: manifest.repository,
	version: manifest.version,
	tag: manifest.tag,
	commit: manifest.commit,
	manifest: fileRecord(join(directory, "release.json"), "release.json"),
	assets: inventory,
	approvedBy: approval.approvedBy,
});
const signature = signManifest(manifestBytes, privateKey, values["key-id"]);
const attSignature = signManifest(attestation, privateKey, values["key-id"]);
mkdirSync(output, { recursive: true });
for (const [file, bytes] of [
	["release.json.sig", signature],
	["release.json.key-id", `${values["key-id"]}\n`],
	["release-attestation.json", attestation],
	["release-attestation.json.sig", attSignature],
	["release-attestation.json.key-id", `${values["key-id"]}\n`],
])
	writeFileSync(join(output, file), bytes, { flag: "wx" });
console.log(
	`Prepared additive authentication only. No existing archive, manifest or tag was modified. Inventory: ${assetsDigest}`,
);
