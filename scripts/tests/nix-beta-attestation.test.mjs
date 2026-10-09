import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { jsonBytes, sha256 } from "../lib/binary-release.mjs";
import { preparedFixture } from "./prepared-fixture.mjs";

const validator = fileURLToPath(
	new URL("../../nix/validate-beta-attestation.jq", import.meta.url),
);

test("Nix beta inventory validation requires complete, manifest-bound records", async (t) => {
	const f = preparedFixture("beta");
	try {
		const release = { ...f.manifest, schemaVersion: 1, channel: "prerelease" };
		delete release.assets;
		delete release.candidateDigest;
		delete release.workflowSha;
		const manifest = join(f.work, "manifest.json");
		const attestation = join(f.work, "attestation.json");
		writeFileSync(manifest, jsonBytes(release));
		const bytes = readFileSync(manifest);
		const complete = {
			schemaVersion: 1,
			product: release.product,
			repository: release.repository,
			version: release.version,
			tag: release.tag,
			commit: release.commit,
			manifest: {
				file: "release.json",
				sha256: sha256(bytes),
				size: bytes.length,
			},
			assets: f.manifest.assets,
		};
		const validate = (value) => {
			writeFileSync(attestation, jsonBytes(value));
			return spawnSync(
				"jq",
				[
					"-e",
					"--slurpfile",
					"release",
					manifest,
					"--arg",
					"manifestHash",
					sha256(bytes),
					"--argjson",
					"manifestSize",
					String(bytes.length),
					"-f",
					validator,
					attestation,
				],
				{ encoding: "utf8" },
			);
		};
		const rejects = (value, message) => {
			const result = validate(value);
			assert.equal(result.error, undefined, "jq must execute");
			assert.notEqual(result.status, 0, message);
		};
		await t.test("complete historical beta inventory passes", () => {
			const result = validate(complete);
			assert.equal(result.status, 0, result.stderr);
			assert.equal(result.stdout.trim(), "true");
		});
		await t.test(
			"three signed placeholder records cannot stand in for the inventory",
			() => {
				rejects(
					{
						...complete,
						assets: [
							"release-evidence.json",
							"validation-receipts.tar.gz",
							"build-provenance.json",
						].map((file) => ({ file, sha256: "f".repeat(64), size: 1 })),
					},
					"incomplete QA reproduction",
				);
			},
		);
		await t.test("every required asset must be present", () => {
			// candidate.json is optional for historical schema-1 releases.
			for (const record of complete.assets.filter(
				(a) => a.file !== "candidate.json",
			)) {
				rejects(
					{
						...complete,
						assets: complete.assets.filter((a) => a.file !== record.file),
					},
					record.file,
				);
			}
		});
		await t.test("identity and exact manifest bytes must match", () => {
			for (const field of [
				"schemaVersion",
				"product",
				"repository",
				"version",
				"tag",
				"commit",
			]) {
				rejects({ ...complete, [field]: "wrong" }, field);
			}
			for (const [field, value] of [
				["file", "other.json"],
				["size", bytes.length + 1],
				["sha256", "f".repeat(64)],
			]) {
				rejects(
					{ ...complete, manifest: { ...complete.manifest, [field]: value } },
					`manifest ${field}`,
				);
			}
		});
		await t.test(
			"archive, sidecar and installer/source digests and sizes must match",
			() => {
				const boundNames = [
					release.installer.file,
					release.verifier.file,
					release.source.file,
					...Object.values(release.targets).flatMap((target) => [
						target.archive,
						target.manifest,
					]),
				];
				for (const file of boundNames) {
					for (const [field, value] of [
						["sha256", "f".repeat(64)],
						["size", 1],
					]) {
						rejects(
							{
								...complete,
								assets: complete.assets.map((a) =>
									a.file === file ? { ...a, [field]: value } : a,
								),
							},
							`${file} ${field}`,
						);
					}
				}
			},
		);
		await t.test("malformed and ambiguous records fail", () => {
			const receipt = complete.assets.find(
				(a) => a.file === "release-evidence.json",
			);
			for (const size of [0, -1, 1.5, "1", null, 9007199254740992]) {
				rejects(
					{
						...complete,
						assets: complete.assets.map((a) =>
							a === receipt ? { ...a, size } : a,
						),
					},
					`size ${size}`,
				);
			}
			for (const sha of [null, "z".repeat(64), "f".repeat(63)]) {
				rejects(
					{
						...complete,
						assets: complete.assets.map((a) =>
							a === receipt ? { ...a, sha256: sha } : a,
						),
					},
					`hash ${sha}`,
				);
			}
			for (const record of [
				receipt,
				{ ...receipt, file: "../outside.json" },
				{ ...receipt, file: "release.json" },
				null,
			]) {
				rejects(
					{ ...complete, assets: [...complete.assets, record] },
					"duplicate, unsafe, circular or null record",
				);
			}
		});
	} finally {
		f.cleanup();
	}
});
