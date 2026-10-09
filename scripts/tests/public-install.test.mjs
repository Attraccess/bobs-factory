import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	compareReleaseVersions,
	fileRecord,
	jsonBytes,
	REPOSITORY,
	selectPublicRelease,
	sha256,
	TARGETS,
	validateArchive,
	validateBuildProvenance,
	validateEvidence,
	validateIdentity,
	validatePublicationSlot,
	validatePublicRepository,
	validateReleaseManifest,
} from "../lib/binary-release.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const native = `${process.platform}-${process.arch}`;
const commit = "a".repeat(40);
function fixture(version = "0.2.74") {
	const work = mkdtempSync(join(tmpdir(), "factory-public-install-test-"));
	const downloads = join(work, "downloads");
	mkdirSync(downloads);
	const bin = join(work, "mock-bin");
	mkdirSync(bin);
	writeFileSync(
		join(bin, "curl"),
		`#!/bin/sh\nset -eu\nurl=\noutput=\nwhile [ "$#" -gt 0 ]; do\n case "$1" in https://*) url=$1; shift;; --output) output=$2; shift 2;; *) shift;; esac\ndone\ncase "$url" in https://jappyjan.github.io/bobs-factory/releases/latest.json) file=latest.json;; https://github.com/jappyjan/bobs-factory/releases/download/v*) file=\${url##*/};; *) echo "Untrusted download URL" >&2; exit 1;; esac\ncp "$BOBS_FACTORY_TEST_DOWNLOADS/$file" "$output"\n`,
		{ mode: 0o755 },
	);
	const prefix = join(work, "prefix with 'quote");
	const profile = join(work, "profile");
	writeFileSync(profile, "# Existing user settings\n");
	const env = {
		...process.env,
		PATH: `${bin}:${process.env.PATH}`,
		BOBS_FACTORY_TEST_DOWNLOADS: downloads,
		BOBS_FACTORY_INSTALL_PREFIX: prefix,
		BOBS_FACTORY_INSTALL_PROFILE: profile,
		SHELL: "/bin/bash",
	};
	const install = (...args) =>
		spawnSync("sh", [join(root, "scripts/install.sh"), ...args], {
			env,
			encoding: "utf8",
		});
	const cleanup = () => rmSync(work, { recursive: true, force: true });
	function release(nextVersion = version) {
		const name = `bobs-factory-${nextVersion}-${native}`;
		const stage = join(work, name);
		mkdirSync(stage);
		const executable = Buffer.from(`#!/bin/sh\necho ${nextVersion}\n`);
		writeFileSync(join(stage, "bobs-factory"), executable, { mode: 0o755 });
		writeFileSync(join(stage, "LICENSE"), "Apache License 2.0");
		writeFileSync(join(stage, "NOTICE"), "Bob's Factory derived from Cyrus");
		writeFileSync(
			join(stage, "THIRD_PARTY_NOTICES.txt"),
			`Bun 1.4.2 runtime\n${"License text ".repeat(30)}`,
		);
		writeFileSync(
			join(stage, "build.json"),
			jsonBytes({
				schemaVersion: 1,
				product: "bobs-factory",
				version: nextVersion,
				commit,
				dirty: false,
				target: native,
				tooling: { bun: "1.4.2" },
				executable: {
					file: "bobs-factory",
					size: executable.length,
					sha256: sha256(executable),
				},
				resourceDigest: "b".repeat(64),
			}),
		);
		execFileSync("tar", [
			"-czf",
			join(downloads, `${name}.tar.gz`),
			"-C",
			work,
			name,
		]);
		const archive = fileRecord(
			join(downloads, `${name}.tar.gz`),
			`${name}.tar.gz`,
		);
		writeFileSync(
			join(downloads, `${name}.manifest.json`),
			jsonBytes({
				schemaVersion: 1,
				product: "bobs-factory",
				version: nextVersion,
				commit,
				dirty: false,
				target: native,
				...archive,
			}),
		);
		copyFileSync(
			join(root, "scripts/install-binary.sh"),
			join(downloads, "install-binary.sh"),
		);
		const verifier = fileRecord(
			join(downloads, "install-binary.sh"),
			"install-binary.sh",
		);
		const sidecar = fileRecord(
			join(downloads, `${name}.manifest.json`),
			`${name}.manifest.json`,
		);
		const targets = Object.fromEntries(
			TARGETS.map((target) => [
				target,
				{
					archive: `bobs-factory-${nextVersion}-${target}.tar.gz`,
					archiveSha256: archive.sha256,
					archiveSize: archive.size,
					manifest: `bobs-factory-${nextVersion}-${target}.manifest.json`,
					manifestSha256: sidecar.sha256,
					manifestSize: sidecar.size,
				},
			]),
		);
		const metadata = {
			schemaVersion: 1,
			product: "bobs-factory",
			repository: REPOSITORY,
			status: "available",
			version: nextVersion,
			tag: `v${nextVersion}`,
			commit,
			buildRunId: 123,
			installer: fileRecord(join(root, "scripts/install.sh"), "install.sh"),
			verifier,
			source: {
				file: "source-rebuild.tar.gz",
				sha256: "c".repeat(64),
				size: 42,
			},
			targets,
		};
		writeFileSync(join(downloads, "latest.json"), jsonBytes(metadata));
		writeFileSync(join(downloads, "release.json"), jsonBytes(metadata));
		return {
			metadata,
			name,
			stage,
			archive: join(downloads, archive.file),
			sidecar: join(downloads, sidecar.file),
		};
	}
	const current = release();
	return {
		work,
		downloads,
		prefix,
		profile,
		install,
		cleanup,
		release,
		current,
	};
}

test("anonymous install configures PATH once, retains old version, and safely repeats", () => {
	const f = fixture("0.2.73");
	try {
		let result = f.install();
		assert.equal(result.status, 0, result.stderr);
		const before = readFileSync(f.profile, "utf8");
		execFileSync("sh", ["-n", f.profile]);
		const path = execFileSync(
			"sh",
			["-c", '. "$1"; printf "%s" "$PATH"', "test", f.profile],
			{ encoding: "utf8" },
		);
		assert.ok(path.split(":").includes(`${f.prefix}/bin`));
		assert.equal(
			readFileSync(`${f.profile}.bobs-factory-backup`, "utf8"),
			"# Existing user settings\n",
		);
		assert.match(result.stdout, /Start Bob's Factory now:/);
		assert.equal(
			execFileSync(join(f.prefix, "bin/bobs-factory"), {
				encoding: "utf8",
			}).trim(),
			"0.2.73",
		);
		f.release("0.2.74");
		result = f.install();
		assert.equal(result.status, 0, result.stderr);
		const previousFile = join(f.prefix, "lib/bobs-factory/previous-link");
		const previous = readFileSync(previousFile, "utf8");
		assert.match(previous, /0\.2\.73/);
		result = f.install();
		assert.equal(result.status, 0, result.stderr);
		assert.equal(
			readFileSync(previousFile, "utf8"),
			previous,
			"repeat must preserve rollback link",
		);
		assert.equal(
			readFileSync(f.profile, "utf8"),
			before,
			"repeat must not append PATH repeatedly",
		);
		assert.match(readlinkSync(join(f.prefix, "bin/bobs-factory")), /0\.2\.74/);
	} finally {
		f.cleanup();
	}
});
test("first public beta installs anonymously by default or exact version", () => {
	const f = fixture("1.0.0-beta");
	try {
		validateReleaseManifest({ ...f.current.metadata, channel: "prerelease" });
		for (const args of [[], ["--version", "1.0.0-beta"]]) {
			const result = f.install(...args);
			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stdout, /This is a prerelease/);
			assert.equal(
				execFileSync(join(f.prefix, "bin/bobs-factory"), {
					encoding: "utf8",
				}).trim(),
				"1.0.0-beta",
			);
		}
		const result = f.install("--version", "1.0.0-beta.01");
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Invalid version/);
	} finally {
		f.cleanup();
	}
});
test("release selection exposes verified beta before stable and keeps stable thereafter", () => {
	const release = (version, extra = {}) => ({
		tag_name: `v${version}`,
		prerelease: version.includes("-"),
		draft: false,
		assets: [{ name: "release.json" }],
		...extra,
	});
	const beta = release("1.0.0-beta");
	const beta2 = release("1.0.0-beta.2");
	const beta10 = release("1.0.0-beta.10");
	assert.equal(selectPublicRelease([beta10, beta, beta2]), beta10);
	assert.equal(
		selectPublicRelease([
			beta,
			release("1.0.0-rc", { draft: true }),
			release("5.0.0", { assets: [] }),
		]),
		beta,
	);
	const stable = release("0.2.74");
	assert.equal(selectPublicRelease([beta10, stable]), stable);
	assert.equal(selectPublicRelease([]), null);
	assert.throws(
		() => selectPublicRelease([release("1.0.0-beta", { prerelease: false })]),
		/prerelease flag/,
	);
	assert.equal(compareReleaseVersions("1.0.0-beta", "1.0.0"), -1);
	validateIdentity("1.0.0-beta", commit, 123);
	validatePublicationSlot(
		{ version: "1.0.0-beta", commit, runId: 123 },
		null,
		null,
		{ tag_name: "v0.2.74" },
	);
	assert.throws(
		() =>
			validatePublicationSlot(
				{ version: "1.0.0-beta", commit, runId: 123 },
				null,
				null,
				{ tag_name: "v1.0.0" },
			),
		/newer than/,
	);
	for (const version of ["01.0.0", "1.0.0-beta..1", "1.0.0-beta.01", "1.0.0-"])
		assert.throws(
			() => validateIdentity(version, commit, 123),
			/Invalid exact release version/,
		);
});
test("Pages synchronizes a verified beta manifest and preserves prior metadata on digest failure", () => {
	const f = fixture("1.0.0-beta");
	try {
		const workspace = join(f.work, "pages");
		mkdirSync(join(workspace, "scripts/lib"), { recursive: true });
		for (const file of [
			"sync-release-metadata.mjs",
			"install.sh",
			"lib/binary-release.mjs",
		])
			copyFileSync(
				join(root, "scripts", file),
				join(workspace, "scripts", file),
			);
		const metadata = f.current.metadata;
		const bytes = jsonBytes(metadata);
		const assetURL = `https://github.com/${REPOSITORY}/releases/download/${metadata.tag}/release.json`;
		const records = [
			metadata.installer,
			metadata.verifier,
			metadata.source,
			...Object.values(metadata.targets).flatMap((entry) => [
				{
					file: entry.archive,
					sha256: entry.archiveSha256,
					size: entry.archiveSize,
				},
				{
					file: entry.manifest,
					sha256: entry.manifestSha256,
					size: entry.manifestSize,
				},
			]),
		];
		const release = {
			draft: false,
			prerelease: true,
			tag_name: metadata.tag,
			assets: [
				{
					name: "release.json",
					browser_download_url: assetURL,
					size: bytes.length,
					digest: `sha256:${sha256(bytes)}`,
				},
				...records.map((entry) => ({
					name: entry.file,
					size: entry.size,
					digest: `sha256:${entry.sha256}`,
				})),
			],
		};
		const fixtureFile = join(workspace, "transport.json");
		writeFileSync(
			fixtureFile,
			JSON.stringify({ release, content: bytes.toString("utf8") }),
		);
		const preload = join(workspace, "transport.mjs");
		writeFileSync(
			preload,
			`import { readFileSync } from "node:fs"; const fixture = JSON.parse(readFileSync(${JSON.stringify(fixtureFile)}, "utf8")); globalThis.fetch = async (url) => { if (String(url) === ${JSON.stringify(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=100&page=1`)}) return new Response(JSON.stringify([fixture.release])); if (String(url) === ${JSON.stringify(assetURL)}) return new Response(fixture.content); throw new Error("Unexpected network request: " + url); };`,
		);
		const args = [
			"--import",
			preload,
			join(workspace, "scripts/sync-release-metadata.mjs"),
		];
		let result = spawnSync(process.execPath, args, { encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
		const pointer = join(workspace, "website/public/releases/latest.json");
		const previous = readFileSync(pointer, "utf8");
		assert.equal(JSON.parse(previous).channel, "prerelease");
		assert.equal(JSON.parse(previous).version, "1.0.0-beta");
		writeFileSync(
			fixtureFile,
			JSON.stringify({ release, content: `${bytes.toString("utf8")} ` }),
		);
		result = spawnSync(process.execPath, args, { encoding: "utf8" });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /checksum mismatch/);
		assert.equal(readFileSync(pointer, "utf8"), previous);
	} finally {
		f.cleanup();
	}
});
test("checksum mismatch stops before installing or changing shell settings", () => {
	const f = fixture();
	try {
		writeFileSync(f.current.archive, "corrupt");
		const result = f.install();
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /size|checksum/);
		assert.equal(readFileSync(f.profile, "utf8"), "# Existing user settings\n");
	} finally {
		f.cleanup();
	}
});
test("downloaded verifier must match manifest checksum before execution", () => {
	const f = fixture();
	try {
		const sentinel = join(f.work, "executed");
		writeFileSync(
			join(f.downloads, "install-binary.sh"),
			`touch '${sentinel}'\n`,
		);
		const result = f.install();
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /size|checksum/);
		assert.throws(() => readFileSync(sentinel));
	} finally {
		f.cleanup();
	}
});
test("foreign executable and modified immutable installation are preserved", () => {
	const f = fixture();
	try {
		mkdirSync(join(f.prefix, "bin"), { recursive: true });
		writeFileSync(join(f.prefix, "bin/bobs-factory"), "foreign executable");
		let result = f.install();
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /not an owned version link/);
		assert.equal(
			readFileSync(join(f.prefix, "bin/bobs-factory"), "utf8"),
			"foreign executable",
		);
		rmSync(join(f.prefix, "bin/bobs-factory"));
		result = f.install();
		assert.equal(result.status, 0, result.stderr);
		const owned = join(
			f.prefix,
			`lib/bobs-factory/${f.current.name}/bobs-factory`,
		);
		writeFileSync(owned, "modified");
		result = f.install();
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Immutable version differs/);
		assert.equal(readFileSync(owned, "utf8"), "modified");
	} finally {
		f.cleanup();
	}
});
test("pending public release gives clear availability guidance", () => {
	const f = fixture();
	try {
		writeFileSync(
			join(f.downloads, "latest.json"),
			jsonBytes({
				schemaVersion: 1,
				product: "bobs-factory",
				repository: REPOSITORY,
				status: "pending",
			}),
		);
		const result = f.install();
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /first public release is being prepared/);
	} finally {
		f.cleanup();
	}
});

function provenance() {
	const identity = { version: "0.2.74", commit, runId: 123 };
	const run = {
		id: 123,
		status: "completed",
		conclusion: "success",
		repository: { full_name: REPOSITORY },
		head_repository: { full_name: REPOSITORY },
		head_sha: commit,
		path: ".github/workflows/binary-build.yml",
		event: "workflow_dispatch",
	};
	const jobs = TARGETS.map((target) => ({
		name: `binary (${target})`,
		status: "completed",
		conclusion: "success",
	}));
	const artifacts = TARGETS.map((target) => ({
		name: `bobs-factory-${target}-${commit}`,
		expired: false,
		digest: `sha256:${"d".repeat(64)}`,
		workflow_run: { id: 123, head_sha: commit },
	}));
	return { identity, run, jobs, artifacts };
}
test("publication provenance requires exact SHA, canonical workflow, all native jobs and artifact digests", () => {
	const p = provenance();
	assert.equal(
		Object.keys(validateBuildProvenance(p.run, p.jobs, p.artifacts, p.identity))
			.length,
		4,
	);
	assert.throws(
		() =>
			validateBuildProvenance(
				{ ...p.run, head_sha: "f".repeat(40) },
				p.jobs,
				p.artifacts,
				p.identity,
			),
		/reviewed candidate/,
	);
	assert.throws(
		() =>
			validateBuildProvenance(
				{ ...p.run, path: "other.yml" },
				p.jobs,
				p.artifacts,
				p.identity,
			),
		/Unexpected binary build workflow/,
	);
	assert.throws(
		() =>
			validateBuildProvenance(
				p.run,
				[{ ...p.jobs[0], conclusion: "failure" }, ...p.jobs.slice(1)],
				p.artifacts,
				p.identity,
			),
		/native job/,
	);
	assert.throws(
		() =>
			validateBuildProvenance(
				p.run,
				p.jobs,
				[{ ...p.artifacts[0], expired: true }, ...p.artifacts.slice(1)],
				p.identity,
			),
		/provenance/,
	);
	assert.throws(
		() =>
			validateBuildProvenance(
				p.run,
				p.jobs,
				[{ ...p.artifacts[0], digest: null }, ...p.artifacts.slice(1)],
				p.identity,
			),
		/digest/,
	);
});
test("publisher rejects private, internal, unknown-visibility and redirected repositories", () => {
	const publicRepository = {
		full_name: REPOSITORY,
		private: false,
		visibility: "public",
	};
	validatePublicRepository(publicRepository);
	for (const repository of [
		{ ...publicRepository, private: true },
		{ ...publicRepository, visibility: "internal" },
		{ ...publicRepository, visibility: undefined },
		{ ...publicRepository, full_name: "other/bobs-factory" },
	])
		assert.throws(
			() => validatePublicRepository(repository),
			/publicly accessible/,
		);
});
test("publisher never replaces an existing version or moves stable backwards", () => {
	const identity = provenance().identity;
	validatePublicationSlot(identity, null, null, { tag_name: "v0.2.73" });
	assert.throws(
		() => validatePublicationSlot(identity, { id: 123 }, null, null),
		/Immutable version\/tag already exists/,
	);
	assert.throws(
		() =>
			validatePublicationSlot(
				identity,
				null,
				{ object: { sha: commit } },
				null,
			),
		/Immutable version\/tag already exists/,
	);
	assert.throws(
		() =>
			validatePublicationSlot(identity, null, null, { tag_name: "v0.2.74" }),
		/newer than/,
	);
	assert.throws(
		() => validatePublicationSlot(identity, null, null, { tag_name: "v0.3.0" }),
		/newer than/,
	);
});
test("release/archive validation rejects target omissions, source mismatch and unreviewed evidence", () => {
	const f = fixture();
	try {
		const { metadata, archive, sidecar } = f.current;
		validateReleaseManifest(metadata);
		validateArchive(archive, sidecar, { version: "0.2.74", commit }, native);
		const missing = structuredClone(metadata);
		delete missing.targets["linux-arm64"];
		assert.throws(
			() => validateReleaseManifest(missing),
			/four release targets/,
		);
		assert.throws(
			() =>
				validateArchive(
					archive,
					sidecar,
					{ version: "0.2.74", commit: "f".repeat(40) },
					native,
				),
			/reviewed source/,
		);
		assert.throws(
			() =>
				validateEvidence(
					{
						schemaVersion: 1,
						product: "bobs-factory",
						version: "0.2.74",
						commit,
						buildRunId: 123,
					},
					f.work,
					{ version: "0.2.74", commit, runId: 123 },
				),
			/Unresolved release validation/,
		);
	} finally {
		f.cleanup();
	}
});
