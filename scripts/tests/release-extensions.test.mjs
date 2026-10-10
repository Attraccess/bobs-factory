import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	fileRecord,
	jsonBytes,
	validatePublicInstaller,
} from "../lib/binary-release.mjs";
import { validatePreparedRelease } from "../lib/prepared-release.mjs";
import { receiptArchive } from "../lib/receipt-archive.mjs";
import { preparedFixture } from "./prepared-fixture.mjs";

test("controlled installer smoke uses frozen release identity and preserves installation after failures", () => {
	const f = preparedFixture();
	try {
		const result = spawnSync(
			process.execPath,
			["scripts/smoke-public-install.mjs", "--artifacts", f.assets],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
		const receipt = JSON.parse(
			readFileSync(join(f.assets, "public-installer.json")),
		);
		const target = `${process.platform}-${process.arch}`;
		validatePublicInstaller(receipt, f.identity, target);
		assert.throws(
			() =>
				validatePublicInstaller(
					{ ...receipt, candidateDigest: "f".repeat(64) },
					f.identity,
					target,
				),
			/candidate-bound public installer/,
		);
	} finally {
		f.cleanup();
	}
});

test("prepared recovery rejects desktop validation for a different frozen candidate", () => {
	const f = preparedFixture("nightly", { desktop: true });
	try {
		validatePreparedRelease(f.assets, f.candidate);
		const path = join(f.assets, "desktop-validation.json");
		const receipt = JSON.parse(readFileSync(path));
		receipt.candidateDigest = "f".repeat(64);
		writeFileSync(path, jsonBytes(receipt));
		const record = fileRecord(path, "desktop-validation.json");
		f.manifest.desktop.artifacts[0].validation = record;
		f.manifest.assets = f.manifest.assets.map((a) =>
			a.file === record.file ? record : a,
		);
		writeFileSync(join(f.assets, "release.json"), jsonBytes(f.manifest));
		assert.throws(
			() => validatePreparedRelease(f.assets, f.candidate),
			/candidate-bound desktop validation/,
		);
	} finally {
		f.cleanup();
	}
});

test("receipt archive bytes are independent of file ordering and timestamps", () => {
	const f = preparedFixture();
	try {
		const files = ["receipt.txt", "scripts/install.sh"];
		const before = receiptArchive(f.work, files);
		utimesSync(join(f.work, "receipt.txt"), 1000, 1000);
		assert.deepEqual(receiptArchive(f.work, [...files].reverse()), before);
		assert.throws(
			() => receiptArchive(f.work, ["../receipt.txt"]),
			/Unsafe receipt filename/,
		);
	} finally {
		f.cleanup();
	}
});
