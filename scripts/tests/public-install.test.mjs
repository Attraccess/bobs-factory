import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateRecipes } from "../generate-package-recipes.mjs";
import {
	compareReleaseVersions,
	fileRecord,
	jsonBytes,
	REPOSITORY,
	releaseAssetRecords,
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
import { freezeCandidate } from "../lib/release-candidate.mjs";
import { keys, signBytes, testInstaller } from "./release-fixtures.mjs";

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
		`#!/bin/sh\nset -eu\nurl=\noutput=\nwhile [ "$#" -gt 0 ]; do\n case "$1" in https://*) url=$1; shift;; --output) output=$2; shift 2;; *) shift;; esac\ndone\ncase "$url" in https://jappyjan.github.io/bobs-factory/releases/latest.json) file=latest.json;; https://jappyjan.github.io/bobs-factory/releases/latest.json.sig) file=latest.json.sig;; https://jappyjan.github.io/bobs-factory/releases/latest.json.key-id) file=latest.json.key-id;; https://jappyjan.github.io/bobs-factory/releases/nightly.json*) file=\${url##*/};; https://github.com/jappyjan/bobs-factory/releases/download/v*) file=\${url##*/};; *) echo "Untrusted download URL" >&2; exit 1;; esac\ncp "$BOBS_FACTORY_TEST_DOWNLOADS/$file" "$output"\n`,
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
	const bootstrap = join(work, "install.sh");
	writeFileSync(
		bootstrap,
		testInstaller(readFileSync(join(root, "scripts/install.sh"), "utf8")),
	);
	const install = (...args) =>
		spawnSync("sh", [bootstrap, ...args], {
			env,
			encoding: "utf8",
		});
	const cleanup = () => rmSync(work, { recursive: true, force: true });
	function release(nextVersion = version) {
		const name = `bobs-factory-${nextVersion}-${native}`;
		const stage = join(work, name);
		mkdirSync(stage);
		const executable = Buffer.from(
			`#!/bin/sh\necho ${nextVersion}\nif [ -n "$BOBS_FACTORY_TEST_DOWNLOADS" ]; then printf '%s\\n' "$@" > "$BOBS_FACTORY_TEST_DOWNLOADS/executed-args"; fi\n`,
		);
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
			schemaVersion: 2,
			product: "bobs-factory",
			repository: REPOSITORY,
			status: "available",
			version: nextVersion,
			tag: `v${nextVersion}`,
			commit,
			buildRunId: 123,
			channel: nextVersion.includes("nightly")
				? "nightly"
				: nextVersion.includes("beta")
					? "beta"
					: "stable",
			candidateDigest: "d".repeat(64),
			workflowSha: commit,
			installer: fileRecord(join(root, "scripts/install.sh"), "install.sh"),
			verifier,
			source: {
				file: "source-rebuild.tar.gz",
				sha256: "c".repeat(64),
				size: 42,
			},
			targets,
		};

		metadata.assets = [
			...releaseAssetRecords(metadata, false),
			...[
				"candidate.json",
				"release-evidence.json",
				"validation-receipts.tar.gz",
				"build-provenance.json",
				...TARGETS.flatMap((t) => [
					`runtime-smoke-${t}.txt`,
					`native-helpers-${t}.json`,
					`prepared-agent-boundaries-${t}.json`,
				]),
			].map((file) => ({ file, sha256: "e".repeat(64), size: 12 })),
		];
		const channel = metadata.channel;
		const promotion =
			channel === "stable"
				? {
						channel: "nightly",
						version: "1.0.0-nightly.20261009.1",
						tag: "v1.0.0-nightly.20261009.1",
						commit,
						manifestSha256: "a".repeat(64),
						releaseId: 1,
					}
				: undefined;
		const candidate = freezeCandidate({
			channel,
			version: nextVersion,
			commit,
			committedVersion: nextVersion.split("-")[0],
			workflowSha: commit,
			promotion,
			sequence:
				channel === "nightly"
					? Number(nextVersion.split(".").at(-1))
					: undefined,
			date: channel === "nightly" ? "2026-10-09T00:00:00Z" : undefined,
		});
		metadata.candidateDigest = candidate.digest;
		writeFileSync(join(downloads, "candidate.json"), jsonBytes(candidate));
		metadata.assets.find((a) => a.file === "candidate.json").sha256 = sha256(
			jsonBytes(candidate),
		);
		metadata.assets.find((a) => a.file === "candidate.json").size =
			jsonBytes(candidate).length;
		for (const file of ["latest.json", "release.json", "nightly.json"]) {
			writeFileSync(join(downloads, file), jsonBytes(metadata));
			writeFileSync(
				join(downloads, `${file}.sig`),
				signBytes(jsonBytes(metadata)),
			);
			writeFileSync(join(downloads, `${file}.key-id`), "fixture\n");
		}
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
		const ownershipRecord = join(
			f.prefix,
			`lib/bobs-factory/records/bobs-factory-0.2.73-${native}.json`,
		);
		assert.deepEqual(JSON.parse(readFileSync(ownershipRecord, "utf8")), {
			schemaVersion: 1,
			product: "bobs-factory",
			owner: "bobs-factory-installer",
			source: "bootstrap",
			channel: "stable",
			version: "0.2.73",
			target: native,
			commit,
			publisherKeyId: "fixture",
		});
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
		assert.ok(
			readFileSync(ownershipRecord, "utf8").includes('"version": "0.2.73"'),
			"upgrading retains the prior version's ownership record",
		);
	} finally {
		f.cleanup();
	}
});
test("first public beta installs anonymously by default or exact version", () => {
	const f = fixture("1.0.0-beta");
	try {
		validateReleaseManifest({ ...f.current.metadata, channel: "beta" });
		for (const args of [[], ["--version", "1.0.0-beta"]]) {
			const result = f.install(...args);
			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stdout, /verified beta/);
			assert.equal(
				execFileSync(join(f.prefix, "bin/bobs-factory"), {
					encoding: "utf8",
				}).trim(),
				"1.0.0-beta",
			);
		}
		const link = readlinkSync(join(f.prefix, "bin/bobs-factory"));
		const profile = readFileSync(f.profile, "utf8");
		for (const args of [
			["--channel", "stable"],
			["--channel", "stable", "--version", "1.0.0-beta"],
		]) {
			const rejected = f.install(...args);
			assert.notEqual(rejected.status, 0);
			assert.match(rejected.stderr, /Requested channel/);
			assert.equal(readlinkSync(join(f.prefix, "bin/bobs-factory")), link);
			assert.equal(readFileSync(f.profile, "utf8"), profile);
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
			"lib/release-material.mjs",
			"lib/bounded-archive.mjs",
			"lib/release-candidate.mjs",
			"lib/release-signature.mjs",
			"lib/github-release.mjs",
		])
			copyFileSync(
				join(root, "scripts", file),
				join(workspace, "scripts", file),
			);
		mkdirSync(join(workspace, "docs/distribution"), { recursive: true });
		writeFileSync(
			join(workspace, "docs/distribution/release-keys.json"),
			JSON.stringify({ schemaVersion: 1, keys }),
		);
		const metadata = f.current.metadata;
		const bytes = jsonBytes(metadata);
		const assetURL = `https://github.com/${REPOSITORY}/releases/download/${metadata.tag}/release.json`;
		const records = metadata.assets;
		const release = {
			id: 123,
			published_at: "2026-10-09T00:00:00Z",
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
					state: "uploaded",
					name: entry.file,
					size: entry.size,
					digest: `sha256:${entry.sha256}`,
				})),
			],
		};
		const fixtureFile = join(workspace, "transport.json");
		writeFileSync(
			fixtureFile,
			JSON.stringify({
				release,
				content: bytes.toString("utf8"),
				signature: signBytes(bytes).toString("base64"),
				candidate: readFileSync(join(f.downloads, "candidate.json"), "utf8"),
			}),
		);
		const preload = join(workspace, "transport.mjs");

		release.assets.push(
			...["release.json.sig", "release.json.key-id"].map((file) => ({
				name: file,
				state: "uploaded",
				size: readFileSync(join(f.downloads, file)).length,
				digest: `sha256:${sha256(readFileSync(join(f.downloads, file)))}`,
				browser_download_url: assetURL.replace(/release.json$/, file),
			})),
		);
		release.assets[0].state = "uploaded";
		release.assets.find(
			(a) => a.name === "candidate.json",
		).browser_download_url = assetURL.replace(
			/release.json$/,
			"candidate.json",
		);
		writeFileSync(
			fixtureFile,
			JSON.stringify({
				release,
				content: bytes.toString("utf8"),
				signature: signBytes(bytes).toString("base64"),
				candidate: readFileSync(join(f.downloads, "candidate.json"), "utf8"),
			}),
		);
		writeFileSync(
			preload,
			`import {readFileSync} from "node:fs";
      const f=JSON.parse(readFileSync(${JSON.stringify(fixtureFile)},"utf8"));
      globalThis.fetch=async url=>{
        const path=String(url);
        if(path.includes('/git/ref/tags/')) return new Response(JSON.stringify({object:{type:"commit",sha:${JSON.stringify(commit)}}}));
        if(path.endsWith('/repos/jappyjan/bobs-factory')) return new Response(JSON.stringify({full_name:"jappyjan/bobs-factory",private:false,visibility:"public"}));
        if(path.includes('/releases/123/assets?')) return new Response(JSON.stringify(f.release.assets));
        if(path.includes('/releases?')) return new Response(JSON.stringify([f.release]));
        if(path.endsWith('/release.json')) return new Response(f.content);
        if(path.endsWith('/release.json.sig')) return new Response(Buffer.from(f.signature,"base64"));
        if(path.endsWith('/release.json.key-id')) return new Response("fixture\\n");
        if(path.endsWith('/candidate.json')) return new Response(f.candidate);
        throw Error("Unexpected network request: "+url);
      };`,
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
		assert.equal(JSON.parse(previous).channel, "beta");
		assert.equal(JSON.parse(previous).version, "1.0.0-beta");
		writeFileSync(
			fixtureFile,
			JSON.stringify({
				release,
				content: `${bytes.toString("utf8")} `,
				signature: signBytes(bytes).toString("base64"),
				candidate: readFileSync(join(f.downloads, "candidate.json"), "utf8"),
			}),
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
				schemaVersion: 2,
				product: "bobs-factory",
				repository: REPOSITORY,
				status: "pending",
			}),
		);
		rmSync(join(f.downloads, "latest.json.sig"));
		rmSync(join(f.downloads, "latest.json.key-id"));
		const result = f.install();
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /No verified stable release is available/);
		assert.doesNotMatch(result.stderr, /Download failed|cp:/);
		assert.throws(() => readlinkSync(join(f.prefix, "bin/bobs-factory")));
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

test("signed manifests reject tampering, unknown keys and unsigned payloads before installation", () => {
	const f = fixture();
	try {
		assert.equal(f.install("--no-modify-path").status, 0);
		const link = readlinkSync(join(f.prefix, "bin/bobs-factory"));
		const profile = readFileSync(f.profile, "utf8");
		const original = readFileSync(join(f.downloads, "latest.json"));
		for (const [file, bytes] of [
			["latest.json", Buffer.concat([original, Buffer.from(" ")])],
			["latest.json.sig", Buffer.from("wrong")],
			["latest.json.key-id", Buffer.from("unknown\n")],
		]) {
			const before = readFileSync(join(f.downloads, file));
			writeFileSync(join(f.downloads, file), bytes);
			const result = f.install();
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /signature|publisher/);
			assert.equal(readlinkSync(join(f.prefix, "bin/bobs-factory")), link);
			assert.equal(readFileSync(f.profile, "utf8"), profile);
			writeFileSync(join(f.downloads, file), before);
		}
		rmSync(join(f.downloads, "latest.json.sig"));
		assert.notEqual(f.install().status, 0);
		assert.equal(readlinkSync(join(f.prefix, "bin/bobs-factory")), link);
	} finally {
		f.cleanup();
	}
});
test("unsigned pending channels stop with availability guidance and preserve an existing installation", () => {
	const f = fixture();
	try {
		assert.equal(f.install().status, 0);
		const link = readlinkSync(join(f.prefix, "bin/bobs-factory"));
		const profile = readFileSync(f.profile, "utf8");
		for (const [channel, file] of [
			["stable", "latest.json"],
			["nightly", "nightly.json"],
		]) {
			writeFileSync(
				join(f.downloads, file),
				jsonBytes({
					schemaVersion: 2,
					product: "bobs-factory",
					repository: REPOSITORY,
					status: "pending",
				}),
			);
			rmSync(join(f.downloads, `${file}.sig`));
			rmSync(join(f.downloads, `${file}.key-id`));
			const result = f.install("--channel", channel);
			assert.notEqual(result.status, 0);
			assert.match(
				result.stderr,
				new RegExp(`No verified ${channel} release is available`),
			);
			assert.doesNotMatch(result.stderr, /Download failed|cp:/);
			assert.equal(readlinkSync(join(f.prefix, "bin/bobs-factory")), link);
			assert.equal(readFileSync(f.profile, "utf8"), profile);
		}
	} finally {
		f.cleanup();
	}
});

test("nightly installation is opt-in and exact versions must match the selected channel", () => {
	const f = fixture("1.0.0-nightly.20261009.10");
	try {
		assert.notEqual(f.install().status, 0);
		const result = f.install("--channel", "nightly");
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /opt-in prerelease/);
		assert.notEqual(
			f.install("--channel", "stable", "--version", "1.0.0-nightly.20261009.10")
				.status,
			0,
		);
		assert.notEqual(
			f.install("--channel", "nightly", "--version", "1.0.1").status,
			0,
		);
	} finally {
		f.cleanup();
	}
});
test("legacy beta requires signed inventory attestation without rewriting its manifest", () => {
	const f = fixture("1.0.0-beta");
	try {
		const legacy = {
			...f.current.metadata,
			schemaVersion: 1,
			channel: "prerelease",
		};
		delete legacy.assets;
		delete legacy.candidateDigest;
		delete legacy.workflowSha;
		const bytes = jsonBytes(legacy);
		for (const file of ["latest.json", "release.json"]) {
			writeFileSync(join(f.downloads, file), bytes);
			writeFileSync(join(f.downloads, `${file}.sig`), signBytes(bytes));
		}
		assert.notEqual(
			f.install().status,
			0,
			"No attestation must block signed legacy beta",
		);
		const attestation = jsonBytes({
			schemaVersion: 1,
			product: "bobs-factory",
			repository: REPOSITORY,
			version: legacy.version,
			tag: legacy.tag,
			commit: legacy.commit,
			manifest: {
				file: "release.json",
				size: bytes.length,
				sha256: sha256(bytes),
			},
			assets: f.current.metadata.assets,
		});
		writeFileSync(join(f.downloads, "release-attestation.json"), attestation);
		writeFileSync(
			join(f.downloads, "release-attestation.json.sig"),
			signBytes(attestation),
		);
		writeFileSync(
			join(f.downloads, "release-attestation.json.key-id"),
			"fixture\n",
		);
		const result = f.install();
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(readFileSync(join(f.downloads, "release.json")), bytes);
		writeFileSync(
			join(f.downloads, "release-attestation.json"),
			Buffer.concat([attestation, Buffer.from(" ")]),
		);
		assert.notEqual(f.install().status, 0);
	} finally {
		f.cleanup();
	}
});

test("removal validates all ownership before deleting and preserves state and unknown files", () => {
	const f = fixture();
	try {
		assert.equal(f.install().status, 0);
		const remove = () =>
			spawnSync(
				"sh",
				[join(root, "scripts/uninstall-binary.sh"), f.prefix, "--stopped"],
				{ encoding: "utf8" },
			);
		const executable = join(f.prefix, "bin/bobs-factory");
		const link = readlinkSync(executable);
		const foreign = join(f.prefix, "lib/bobs-factory/operator-file");
		writeFileSync(foreign, "keep");
		const receipt = join(
			f.prefix,
			`lib/bobs-factory/records/${f.current.name}.json`,
		);
		const bytes = readFileSync(receipt);
		writeFileSync(
			receipt,
			bytes.toString().replace("bobs-factory-installer", "foreign"),
		);
		assert.notEqual(remove().status, 0);
		assert.equal(readlinkSync(executable), link);
		writeFileSync(receipt, bytes);
		const result = remove();
		assert.equal(result.status, 0, result.stderr);
		assert.throws(() => readlinkSync(executable));
		assert.equal(readFileSync(foreign, "utf8"), "keep");
		assert.equal(
			readFileSync(f.profile, "utf8").includes("Existing user settings"),
			true,
		);
	} finally {
		f.cleanup();
	}
});

test("installer refuses redirected stores and removal refuses foreign links", () => {
	const f = fixture();
	try {
		const external = join(f.work, "external");
		mkdirSync(external);
		mkdirSync(join(f.prefix, "lib"), { recursive: true });
		symlinkSync(external, join(f.prefix, "lib/bobs-factory"));
		assert.notEqual(f.install().status, 0);
		assert.equal(readFileSync(f.profile, "utf8"), "# Existing user settings\n");
		rmSync(join(f.prefix, "lib/bobs-factory"));
		assert.equal(f.install().status, 0);
		rmSync(join(f.prefix, "bin/bobs-factory"));
		symlinkSync("/unrelated/bobs-factory", join(f.prefix, "bin/bobs-factory"));
		const result = spawnSync(
			"sh",
			[join(root, "scripts/uninstall-binary.sh"), f.prefix, "--stopped"],
			{ encoding: "utf8" },
		);
		assert.notEqual(result.status, 0);
		assert.equal(
			readlinkSync(join(f.prefix, "bin/bobs-factory")),
			"/unrelated/bobs-factory",
		);
	} finally {
		f.cleanup();
	}
});

test("settings handoff names the chosen instance without supplying an implicit policy reset", () => {
	const f = fixture("1.0.0-nightly.20261009.10");
	try {
		const home = join(f.work, "state");
		const result = f.install("--channel", "nightly", "--home", home);
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(
			readFileSync(join(f.downloads, "executed-args"), "utf8")
				.trim()
				.split("\n"),
			["--home", home, "update", "settings", "--channel", "nightly"],
		);
		assert.equal(
			f.install(
				"--channel",
				"nightly",
				"--home",
				home,
				"--update-policy",
				"manual",
			).status,
			0,
		);
		assert.deepEqual(
			readFileSync(join(f.downloads, "executed-args"), "utf8")
				.trim()
				.split("\n"),
			[
				"--home",
				home,
				"update",
				"settings",
				"--channel",
				"nightly",
				"--policy",
				"manual",
			],
		);
		assert.equal(f.install("--update-policy", "idle-auto").status, 1);
		assert.match(result.stdout, /nightly/);
	} finally {
		f.cleanup();
	}
});

test("recipes require signed complete published desktop packages and immutable URLs", async () => {
	const f = fixture();
	try {
		const manifest = structuredClone(f.current.metadata);
		manifest.desktop = { schemaVersion: 1, artifacts: [] };
		const contents = new Map();
		for (const target of TARGETS) {
			const [os, arch] = target.split("-");
			const stem = `bobs-factory-desktop-${manifest.version}-${os === "darwin" ? "mac" : "linux"}-${arch}`;
			const record = (ext) => {
				const file = `${stem}.${ext}`;
				const bytes = Buffer.from(file);
				contents.set(file, bytes);
				return { file, size: bytes.length, sha256: sha256(bytes) };
			};
			const archive = record(os === "darwin" ? "dmg" : "AppImage");
			const updateMetadata = record("update.json");
			const validation = record("validation.json");
			manifest.desktop.artifacts.push({
				version: manifest.version,
				commit,
				channel: "stable",
				target,
				platformRequirements: "native validation pending publication",
				archive,
				updateMetadata,
				validation,
			});
			manifest.assets.push(archive, updateMetadata, validation);
			if (os === "linux") manifest.assets.push(record("deb"));
		}
		const base = `https://github.com/${REPOSITORY}/releases/download/${manifest.tag}`;
		const refresh = () => {
			const bytes = jsonBytes(manifest);
			contents.set("release.json", bytes);
			contents.set("release.json.sig", signBytes(bytes));
			contents.set("release.json.key-id", Buffer.from("fixture\n"));
		};
		refresh();
		contents.set(
			"candidate.json",
			readFileSync(join(f.downloads, "candidate.json")),
		);
		const assets = () =>
			[
				...manifest.assets,
				...["release.json", "release.json.sig", "release.json.key-id"].map(
					(file) => ({
						file,
						size: contents.get(file).length,
						sha256: sha256(contents.get(file)),
					}),
				),
			].map((r) => ({
				name: r.file,
				size: r.size,
				digest: `sha256:${r.sha256}`,
				state: "uploaded",
				browser_download_url: `${base}/${r.file}`,
			}));
		const client = {
			api: async (path) =>
				path.startsWith("releases/tags/")
					? {
							id: 1,
							tag_name: manifest.tag,
							prerelease: false,
							published_at: "2026-10-10",
						}
					: { object: { type: "commit", sha: commit } },
			pages: async () => assets(),
			bytes: async (asset) => contents.get(asset.name),
		};
		const recipes = await generateRecipes(client, manifest.version, keys);
		const prepared = JSON.parse(recipes["npm/package.json"]);
		assert.equal(prepared.private, true);
		assert.deepEqual(prepared.factoryRelease, {
			version: manifest.version,
			channel: "stable",
		});
		const recipeFile = join(f.work, "PKGBUILD");
		writeFileSync(recipeFile, recipes["aur/bobs-factory-desktop-bin/PKGBUILD"]);
		execFileSync("bash", ["-n", recipeFile]);

		assert.match(recipes["Casks/bobs-factory.rb"], /mac-#\{arch\}.dmg/);
		assert.match(
			recipes["aur/bobs-factory-desktop-bin/PKGBUILD"],
			/sha256sums_aarch64/,
		);
		const desktop = manifest.desktop;
		delete manifest.desktop;
		manifest.assets = manifest.assets.filter(
			(a) => !a.file.startsWith("bobs-factory-desktop-"),
		);
		refresh();
		const nativeOnly = await generateRecipes(
			client,
			manifest.version,
			keys,
			"npm",
		);
		assert.equal(JSON.parse(nativeOnly["npm/package.json"]).private, true);
		await assert.rejects(
			generateRecipes(client, manifest.version, keys),
			/desktop targets/,
		);
		manifest.desktop = desktop;
		manifest.assets.push(
			...desktop.artifacts.flatMap((item) => [
				item.archive,
				item.updateMetadata,
				item.validation,
			]),
		);
		for (const arch of ["arm64", "x64"]) {
			const file = `bobs-factory-desktop-${manifest.version}-linux-${arch}.deb`;
			const bytes = contents.get(file);
			manifest.assets.push({ file, size: bytes.length, sha256: sha256(bytes) });
		}
		refresh();
		contents.set("release.json.sig", Buffer.from("invalid"));
		await assert.rejects(
			generateRecipes(client, manifest.version, keys),
			/signature/,
		);
		manifest.assets = manifest.assets.filter(
			(a) => !a.file.endsWith("x64.deb"),
		);
		refresh();
		await assert.rejects(
			generateRecipes(client, manifest.version, keys),
			/Missing signed desktop package/,
		);
	} finally {
		f.cleanup();
	}
});
