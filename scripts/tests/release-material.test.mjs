import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	fileRecord,
	jsonBytes,
	validateEvidence,
} from "../lib/binary-release.mjs";
import {
	extractEvidenceArchive,
	validateSourceMaterials,
} from "../lib/release-material.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
	cwd: root,
	encoding: "utf8",
}).trim();
test("source packaging binds exact committed factory source and reviewed runtime material without approving gates", () => {
	const work = mkdtempSync(join(tmpdir(), "factory-source-material-test-"));
	try {
		const materials = join(work, "materials");
		mkdirSync(materials);
		const records = [
			["bun", "bun-source.tar.gz"],
			["webkit", "webkit-source.tar.gz"],
			["dependency", "dependency-source.tar.gz"],
		].map(([kind, file]) => {
			writeFileSync(
				join(materials, file),
				`fixture ${kind} source, not release material`,
			);
			return {
				kind,
				source: "https://example.invalid/source",
				revision: "fixture-only",
				...fileRecord(join(materials, file), file),
			};
		});
		const manifest = { schemaVersion: 1, commit, bunVersion: "1.4.2", records };
		writeFileSync(
			join(materials, "source-materials.json"),
			jsonBytes(manifest),
		);
		writeFileSync(
			join(materials, "README.md"),
			"Fixture only. Not a release licensing approval.",
		);
		validateSourceMaterials(manifest, materials, commit);
		validateSourceMaterials(
			{
				...manifest,
				records: records.filter((record) => record.kind !== "dependency"),
			},
			materials,
			commit,
		); // Other source obligations are determined by the licensing review.
		const output = join(work, "output");
		const args = [
			join(root, "scripts/build-release-source.mjs"),
			"--sha",
			commit,
			"--materials",
			materials,
			"--output",
			output,
		];
		const result = spawnSync(process.execPath, args, { encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
		const archive = join(output, "source-rebuild.tar.gz");
		assert.equal(
			execFileSync("tar", ["-xOzf", archive, "source-rebuild/commit.txt"], {
				encoding: "utf8",
			}).trim(),
			commit,
		);
		assert.deepEqual(
			readFileSync(join(output, "source-rebuild/pnpm-lock.yaml")),
			execFileSync("git", ["show", `${commit}:pnpm-lock.yaml`], {
				cwd: root,
				maxBuffer: 16 * 1024 * 1024,
			}),
		);
		assert.match(
			execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }),
			/factory-source\.tar\.gz/,
		);
		assert.notEqual(
			spawnSync(process.execPath, args).status,
			0,
			"previous source material must not be replaced",
		);
		assert.throws(
			() =>
				validateEvidence(
					{
						schemaVersion: 1,
						product: "bobs-factory",
						version: "1.0.0-beta",
						commit,
						buildRunId: 123,
						source: fileRecord(archive, "source-rebuild.tar.gz"),
					},
					output,
					{ version: "1.0.0-beta", commit, runId: 123 },
				),
			/Unresolved release validation/,
		);
		assert.throws(
			() => validateSourceMaterials(manifest, materials, "f".repeat(40)),
			/exact candidate/,
		);
		assert.throws(
			() =>
				validateSourceMaterials(
					{
						...manifest,
						records: records.filter((record) => record.kind !== "webkit"),
					},
					materials,
					commit,
				),
			/WebKit/,
		);
		writeFileSync(join(materials, "bun-source.tar.gz"), "corrupt");
		assert.throws(
			() => validateSourceMaterials(manifest, materials, commit),
			/integrity failure/,
		);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});
test("evidence archive import rejects links and never extracts traversal bytes", () => {
	const work = mkdtempSync(join(tmpdir(), "factory-evidence-import-test-"));
	try {
		const stage = join(work, "release-evidence");
		mkdirSync(stage);
		writeFileSync(join(stage, "release-evidence.json"), "{}");
		writeFileSync(join(stage, "source-rebuild.tar.gz"), "fixture");
		const archive = join(work, "evidence.tar.gz");
		execFileSync("tar", ["-czf", archive, "-C", work, "release-evidence"]);
		extractEvidenceArchive(archive, join(work, "valid"));
		assert.equal(
			readFileSync(join(work, "valid/release-evidence.json"), "utf8"),
			"{}",
		);
		symlinkSync("/tmp/foreign-file", join(stage, "link"));
		execFileSync("tar", ["-czf", archive, "-C", work, "release-evidence"]);
		assert.throws(
			() => extractEvidenceArchive(archive, join(work, "invalid")),
			/links\/special files/,
		);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});
test("evidence intake rejects a dirty version edit before retrieving build provenance", () => {
	const work = mkdtempSync(join(tmpdir(), "factory-evidence-version-test-"));
	try {
		mkdirSync(join(work, "apps/cli"), { recursive: true });
		mkdirSync(join(work, "scripts/lib"), { recursive: true });
		for (const file of [
			"prepare-release-evidence.mjs",
			"lib/binary-release.mjs",
			"lib/release-material.mjs",
		])
			writeFileSync(
				join(work, "scripts", file),
				readFileSync(join(root, "scripts", file)),
			);
		const packageFile = join(work, "apps/cli/package.json");
		writeFileSync(packageFile, JSON.stringify({ version: "0.2.74" }));
		const git = (...args) =>
			execFileSync("git", args, {
				cwd: work,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}).trim();
		git("init");
		git("add", "apps/cli/package.json");
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"-m",
			"Fixture committed version",
		);
		const candidate = git("rev-parse", "HEAD");
		writeFileSync(packageFile, JSON.stringify({ version: "1.0.0-beta" }));
		const preload = join(work, "network.mjs");
		writeFileSync(
			preload,
			'globalThis.fetch = () => { throw new Error("Unexpected network access"); };',
		);
		const result = spawnSync(
			process.execPath,
			[
				"--import",
				preload,
				join(work, "scripts/prepare-release-evidence.mjs"),
				"--sha",
				candidate,
				"--version",
				"1.0.0-beta",
				"--run-id",
				"123",
				"--archive",
				join(work, "not-downloaded.tar.gz"),
				"--sha256",
				"a".repeat(64),
				"--output",
				join(work, "output"),
			],
			{ env: { ...process.env, GH_TOKEN: "" }, encoding: "utf8" },
		);
		assert.notEqual(result.status, 0);
		assert.match(
			result.stderr,
			/Exact release version must be committed at candidate/,
		);
		assert.doesNotMatch(result.stderr, /Unexpected network access/);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});
