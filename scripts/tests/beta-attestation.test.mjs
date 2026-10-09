import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileRecord, jsonBytes, sha256 } from "../lib/binary-release.mjs";
import { verifyManifestSignature } from "../lib/release-signature.mjs";
import { preparedFixture } from "./prepared-fixture.mjs";
import { keys, privateKey } from "./release-fixtures.mjs";

test("historical beta signing validates old bytes and emits only additive authentication", () => {
	const f = preparedFixture("beta");
	try {
		const legacy = { ...f.manifest, schemaVersion: 1, channel: "prerelease" };
		delete legacy.assets;
		delete legacy.candidateDigest;
		delete legacy.workflowSha;
		writeFileSync(join(f.assets, "release.json"), jsonBytes(legacy));
		const provenance = JSON.parse(
			readFileSync(join(f.assets, "build-provenance.json")),
		);
		provenance.run.head_sha = f.identity.commit;
		for (const [t, a] of Object.entries(provenance.artifacts)) {
			a.name = `bobs-factory-${t}-${f.identity.commit}`;
			a.workflow_run.head_sha = f.identity.commit;
		}
		writeFileSync(
			join(f.assets, "build-provenance.json"),
			jsonBytes(provenance),
		);
		const immutable = new Map(
			readdirSync(f.assets).map((file) => [
				file,
				readFileSync(join(f.assets, file)),
			]),
		);
		const inventory = readdirSync(f.assets)
			.filter(
				(file) =>
					!["release.json", "release.json.sig", "release.json.key-id"].includes(
						file,
					),
			)
			.map((file) => fileRecord(join(f.assets, file), file))
			.sort((a, b) => a.file.localeCompare(b.file));
		const approval = join(f.work, "approval.json"),
			key = join(f.work, "ephemeral.pem"),
			output = join(f.work, "authentication");
		writeFileSync(key, privateKey, { mode: 0o600 });
		const call = () =>
			spawnSync(
				process.execPath,
				[
					join(f.work, "scripts/prepare-beta-attestation.mjs"),
					"--assets",
					f.assets,
					"--output",
					output,
					"--approval",
					approval,
					"--key-id",
					"fixture",
				],
				{
					encoding: "utf8",
					env: { ...process.env, BOBS_FACTORY_RELEASE_SIGNING_KEY_FILE: key },
				},
			);
		writeFileSync(
			approval,
			JSON.stringify({
				manifestSha256: "f".repeat(64),
				assetsDigest: sha256(jsonBytes(inventory)),
				approvedBy: "fixture",
			}),
		);
		assert.notEqual(call().status, 0);
		writeFileSync(
			approval,
			JSON.stringify({
				manifestSha256: sha256(jsonBytes(legacy)),
				assetsDigest: sha256(jsonBytes(inventory)),
				approvedBy: "fixture",
			}),
		);
		const result = call();
		assert.equal(result.status, 0, result.stderr);
		for (const [file, bytes] of immutable)
			assert.deepEqual(readFileSync(join(f.assets, file)), bytes);
		assert.deepEqual(readdirSync(output).sort(), [
			"release-attestation.json",
			"release-attestation.json.key-id",
			"release-attestation.json.sig",
			"release.json.key-id",
			"release.json.sig",
		]);
		verifyManifestSignature(
			jsonBytes(legacy),
			readFileSync(join(output, "release.json.sig")),
			"fixture",
			keys,
		);
		const att = readFileSync(join(output, "release-attestation.json"));
		verifyManifestSignature(
			att,
			readFileSync(join(output, "release-attestation.json.sig")),
			"fixture",
			keys,
		);
		assert.equal(JSON.parse(att).manifest.sha256, sha256(jsonBytes(legacy)));
	} finally {
		f.cleanup();
	}
});
