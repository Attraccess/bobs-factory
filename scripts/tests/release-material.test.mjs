import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
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
	candidateIdentity,
	freezeCandidate,
} from "../lib/release-candidate.mjs";
import {
	extractEvidenceArchive,
	validateSourceArchive,
	validateSourceMaterials,
} from "../lib/release-material.mjs";
import {
	fixtureTar,
	sourceMaterialFixture,
} from "./source-material-fixture.mjs";

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
		const candidate = freezeCandidate({
			channel: "nightly",
			commit,
			workflowSha: commit,
			committedVersion: "1.0.0",
			sequence: 42,
			date: "2026-10-10T00:00:00Z",
		});
		const identity = candidateIdentity(candidate);
		const manifest = sourceMaterialFixture(materials, identity);
		const records = manifest.records;
		const candidateFile = join(work, "candidate.json");
		writeFileSync(candidateFile, jsonBytes(candidate));
		validateSourceMaterials(manifest, materials, identity);
		const output = join(work, "output");
		const args = [
			join(root, "scripts/build-release-source.mjs"),
			"--candidate",
			candidateFile,
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
		validateSourceArchive(archive, identity);
		assert.equal(
			fixtureTar(["-xOzf", archive, "source-rebuild/commit.txt"], {
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
			fixtureTar(["-tzf", archive], { encoding: "utf8" }),
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
			() =>
				validateSourceMaterials(manifest, materials, {
					...identity,
					commit: "f".repeat(40),
				}),
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
					identity,
				),
			/required material: webkit/,
		);
		writeFileSync(join(materials, "bun-source.tar.gz"), "corrupt");
		assert.throws(
			() => validateSourceMaterials(manifest, materials, identity),
			/integrity failure|size mismatch/,
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
		fixtureTar(["-czf", archive, "-C", work, "release-evidence"]);
		mkdirSync(join(work, "valid"));
		writeFileSync(
			join(work, "valid/incoming-evidence.tar.gz"),
			"retained input",
		);
		extractEvidenceArchive(archive, join(work, "valid"));
		assert.equal(
			readFileSync(join(work, "valid/incoming-evidence.tar.gz"), "utf8"),
			"retained input",
		);
		mkdirSync(join(work, "conflict"));
		writeFileSync(
			join(work, "conflict/source-rebuild.tar.gz"),
			"preserved prior bytes",
		);
		assert.throws(
			() => extractEvidenceArchive(archive, join(work, "conflict")),
			/EEXIST/,
		);
		assert.equal(
			readFileSync(join(work, "conflict/source-rebuild.tar.gz"), "utf8"),
			"preserved prior bytes",
		);
		assert(!existsSync(join(work, "conflict/release-evidence.json")));

		assert.equal(
			readFileSync(join(work, "valid/release-evidence.json"), "utf8"),
			"{}",
		);
		symlinkSync("/tmp/foreign-file", join(stage, "link"));
		fixtureTar(["-czf", archive, "-C", work, "release-evidence"]);
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
			"lib/bounded-archive.mjs",
			"lib/release-candidate.mjs",
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

test("semantic intake rejects omitted, substituted and tampered rebuild materials even in a valid outer archive", () => {
	const work = mkdtempSync(join(tmpdir(), "factory-source-negatives-"));
	try {
		const candidate = freezeCandidate({
			channel: "nightly",
			commit,
			workflowSha: commit,
			committedVersion: "1.0.0",
			sequence: 43,
			date: "2026-10-10T00:00:00Z",
		});
		const identity = candidateIdentity(candidate);
		const stage = join(work, "source-rebuild");
		const manifest = sourceMaterialFixture(stage, identity);
		for (const [file, bytes] of Object.entries({
			"candidate.json": jsonBytes(candidate),
			"commit.txt": commit,
			"pnpm-lock.yaml": "controlled lock",
			"factory-source.tar.gz": "controlled source",
			"release-tooling.tar.gz": "controlled tooling",
		}))
			writeFileSync(join(stage, file), bytes);
		manifest.bundled = [
			"candidate.json",
			"commit.txt",
			"pnpm-lock.yaml",
			"factory-source.tar.gz",
			"release-tooling.tar.gz",
		].map((file) => fileRecord(join(stage, file), file));
		const archive = join(work, "source.tar.gz");
		const pack = (m) => {
			writeFileSync(join(stage, "source-materials.json"), jsonBytes(m));
			fixtureTar(["-czf", archive, "-C", work, "source-rebuild"]);
		};
		pack(manifest);
		validateSourceArchive(archive, identity);
		for (const kind of [
			"webkit",
			"tinycc",
			"objects",
			"relink-log",
			"build-config",
			"instructions",
			"tinycc-patch",
		]) {
			const bad = structuredClone(manifest);
			bad.records = bad.records.filter((r) => r.kind !== kind);
			pack(bad);
			assert.throws(
				() => validateSourceArchive(archive, identity),
				/required material|uninventoried/,
			);
		}
		const upstreamStage = join(work, "upstream");
		const webkitPrefix = "WebKit-2e2aa2290fac856d6f451ceacb58f7f5b44dd057";
		mkdirSync(upstreamStage);
		fixtureTar([
			"-xzf",
			join(stage, "webkit-source.tar.gz"),
			"-C",
			upstreamStage,
		]);
		symlinkSync(
			"/etc/passwd",
			join(upstreamStage, webkitPrefix, "external-link"),
		);
		fixtureTar([
			"-czf",
			join(stage, "webkit-source.tar.gz"),
			"-C",
			upstreamStage,
			webkitPrefix,
		]);
		const externalLink = structuredClone(manifest);
		Object.assign(
			externalLink.records.find((r) => r.kind === "webkit"),
			fileRecord(join(stage, "webkit-source.tar.gz"), "webkit-source.tar.gz"),
		);
		pack(externalLink);
		assert.throws(
			() => validateSourceArchive(archive, identity),
			/external link targets/,
		);
		rmSync(join(upstreamStage, webkitPrefix, "external-link"));
		fixtureTar([
			"-czf",
			join(stage, "webkit-source.tar.gz"),
			"-C",
			upstreamStage,
			webkitPrefix,
		]);
		Object.assign(
			manifest.records.find((r) => r.kind === "webkit"),
			fileRecord(join(stage, "webkit-source.tar.gz"), "webkit-source.tar.gz"),
		);
		writeFileSync(
			join(stage, "factory-source.tar.gz"),
			"tampered generated source",
		);
		pack(manifest);
		assert.throws(
			() => validateSourceArchive(archive, identity),
			/Generated source bundle integrity failure|size mismatch/,
		);
		writeFileSync(join(stage, "factory-source.tar.gz"), "controlled source");
		const badRevision = structuredClone(manifest);
		badRevision.records.find((r) => r.kind === "webkit").revision = "f".repeat(
			40,
		);
		pack(badRevision);
		assert.throws(
			() => validateSourceArchive(archive, identity),
			/Wrong pinned webkit/,
		);
		const badPath = structuredClone(manifest);
		badPath.records[0].file = "../foreign.tar.gz";
		pack(badPath);
		assert.throws(
			() => validateSourceArchive(archive, identity),
			/Unsafe\/duplicate/,
		);
		const badConfig = structuredClone(manifest);
		badConfig.builds[0].nativeFlags = [];
		pack(badConfig);
		assert.throws(
			() => validateSourceArchive(archive, identity),
			/compiler\/runtime\/native flags/,
		);
		const badObjects = structuredClone(manifest);
		badObjects.builds[0].objectInventory = ["objects/absent.o"];
		writeFileSync(
			join(stage, "build-darwin-arm64.json"),
			JSON.stringify(badObjects.builds[0]),
		);
		Object.assign(
			badObjects.records.find((r) => r.file === "build-darwin-arm64.json"),
			fileRecord(
				join(stage, "build-darwin-arm64.json"),
				"build-darwin-arm64.json",
			),
		);
		pack(badObjects);
		assert.throws(
			() => validateSourceArchive(archive, identity),
			/Object inventory/,
		);
		writeFileSync(
			join(stage, "build-darwin-arm64.json"),
			JSON.stringify(manifest.builds[0]),
		);
		pack(manifest);
		writeFileSync(join(stage, "bun-source.tar.gz"), "substitution");
		pack(manifest);
		assert.throws(
			() => validateSourceArchive(archive, identity),
			/integrity failure|size mismatch/,
		);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});
