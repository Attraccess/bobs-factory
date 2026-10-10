#!/usr/bin/env node
// Native CI: use the actual freshly built archive with a controlled download
// transport. No public release, production prefix, home or shell profile is used.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { fileRecord, jsonBytes, REPOSITORY } from "./lib/binary-release.mjs";
import { releaseChannel } from "./lib/release-candidate.mjs";

import { signBytes, testInstaller } from "./tests/release-fixtures.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
	options: { artifacts: { type: "string", default: "artifacts" } },
});
const artifacts = resolve(values.artifacts),
	target = `${process.platform}-${process.arch}`;
const candidates = readdirSync(artifacts).filter((file) =>
	file.endsWith(`-${target}.manifest.json`),
);
assert.equal(candidates.length, 1, "Expected one native archive sidecar");
const sidecar = JSON.parse(
	readFileSync(join(artifacts, candidates[0]), "utf8"),
);
const version = sidecar.version;
const name = `bobs-factory-${version}-${target}`;
const work = mkdtempSync(join(tmpdir(), "factory-public-install-native-"));
try {
	mkdirSync(join(work, "bin"));
	mkdirSync(join(work, "downloads"));
	mkdirSync(join(work, "home"));
	const downloads = join(work, "downloads");
	for (const file of [`${name}.tar.gz`, `${name}.manifest.json`])
		copyFileSync(join(artifacts, file), join(downloads, file));
	copyFileSync(
		join(root, "scripts/install-binary.sh"),
		join(downloads, "install-binary.sh"),
	);
	const verifier = fileRecord(
		join(downloads, "install-binary.sh"),
		"install-binary.sh",
	);
	const record = fileRecord(
		join(downloads, `${name}.manifest.json`),
		`${name}.manifest.json`,
	);
	const manifest = {
		schemaVersion: 2,
		channel: releaseChannel(version),
		candidateDigest: sidecar.candidateDigest,
		workflowSha: sidecar.workflowSha,
		product: "bobs-factory",
		repository: REPOSITORY,
		status: "available",
		version,
		tag: `v${version}`,
		commit: sidecar.commit,
		verifier,
		targets: {
			[target]: {
				archive: sidecar.file,
				archiveSha256: sidecar.sha256,
				archiveSize: sidecar.size,
				manifest: record.file,
				manifestSha256: record.sha256,
				manifestSize: record.size,
			},
		},
	};
	// Synthetic signing keys exercise OpenSSL with the real native archive.
	// This transport fixture is never published or used as release approval.
	const bootstrap = join(work, "install.sh");
	writeFileSync(
		bootstrap,
		testInstaller(readFileSync(join(root, "scripts/install.sh"), "utf8")),
	);
	const metadataFiles = ["latest.json", "nightly.json", "release.json"];
	const updateManifest = () => {
		const bytes = jsonBytes(manifest);
		for (const file of metadataFiles) {
			writeFileSync(join(downloads, file), bytes);
			writeFileSync(join(downloads, `${file}.sig`), signBytes(bytes));
			writeFileSync(join(downloads, `${file}.key-id`), "fixture\n");
		}
	};
	updateManifest();
	writeFileSync(
		join(work, "bin/curl"),
		`#!/bin/sh\nset -eu\nurl=\noutput=\nwhile [ "$#" -gt 0 ]; do case "$1" in https://*) url=$1; shift;; --output) output=$2; shift 2;; *) shift;; esac; done\ncase "$url" in https://jappyjan.github.io/bobs-factory/releases/*|https://github.com/jappyjan/bobs-factory/releases/download/v*) cp "$BOBS_FACTORY_TEST_DOWNLOADS/\${url##*/}" "$output";; *) exit 1;; esac\n`,
		{ mode: 0o755 },
	);
	const prefix = join(work, "prefix");
	const env = {
		...process.env,
		HOME: join(work, "home"),
		PATH: `${work}/bin:${process.env.PATH}`,
		BOBS_FACTORY_TEST_DOWNLOADS: downloads,
		BOBS_FACTORY_INSTALL_PREFIX: prefix,
	};
	const install = (...args) =>
		spawnSync("sh", [bootstrap, "--no-modify-path", ...args], {
			env,
			encoding: "utf8",
		});
	const channel = releaseChannel(version);
	const args = channel === "beta" ? [] : ["--channel", channel];
	const exactArgs = [...args, "--version", version];
	if (channel === "beta") {
		for (const selected of [
			["--channel", "stable"],
			["--channel", "stable", "--version", version],
		]) {
			const result = install(...selected);
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /Requested channel/);
		}
	}
	for (const selected of [args, exactArgs, args]) {
		const result = install(...selected);
		assert.equal(result.status, 0, result.stderr);
		const installed = fileRecord(
			join(prefix, `lib/bobs-factory/${name}/bobs-factory`),
			"bobs-factory",
		);
		const embedded = JSON.parse(
			execFileSync(
				"tar",
				["-xOzf", join(artifacts, `${name}.tar.gz`), `${name}/build.json`],
				{ encoding: "utf8" },
			),
		);
		assert.equal(installed.sha256, embedded.executable.sha256);
	}
	const link = readlinkSync(join(prefix, "bin/bobs-factory"));
	const good = structuredClone(manifest);
	manifest.targets[target].archiveSha256 = "0".repeat(64);
	updateManifest();
	assert.notEqual(install(...exactArgs).status, 0);
	assert.equal(readlinkSync(join(prefix, "bin/bobs-factory")), link);
	manifest.targets[target] = {
		...good.targets[target],
		archiveSize: good.targets[target].archiveSize + 1,
	};
	updateManifest();
	assert.notEqual(install(...exactArgs).status, 0);
	assert.equal(readlinkSync(join(prefix, "bin/bobs-factory")), link);
	const wrongSidecar = { ...sidecar, commit: "0".repeat(40) };
	writeFileSync(
		join(downloads, `${name}.manifest.json`),
		jsonBytes(wrongSidecar),
	);
	const wrongRecord = fileRecord(
		join(downloads, `${name}.manifest.json`),
		`${name}.manifest.json`,
	);
	manifest.targets[target] = {
		...good.targets[target],
		manifestSha256: wrongRecord.sha256,
		manifestSize: wrongRecord.size,
	};
	updateManifest();
	assert.notEqual(install(...exactArgs).status, 0);
	assert.equal(readlinkSync(join(prefix, "bin/bobs-factory")), link);
	copyFileSync(
		join(artifacts, `${name}.manifest.json`),
		join(downloads, `${name}.manifest.json`),
	);
	delete manifest.targets[target];
	updateManifest();
	assert.notEqual(install(...exactArgs).status, 0);
	assert.equal(readlinkSync(join(prefix, "bin/bobs-factory")), link);
	manifest.targets = good.targets;
	updateManifest();
	writeFileSync(
		join(downloads, "release.json.sig"),
		Buffer.from("invalid-signature"),
	);
	assert.notEqual(install(...exactArgs).status, 0);
	assert.equal(readlinkSync(join(prefix, "bin/bobs-factory")), link);

	const ownershipRecord = JSON.parse(
		readFileSync(join(prefix, `lib/bobs-factory/records/${name}.json`), "utf8"),
	);
	assert.equal(ownershipRecord.owner, "bobs-factory-installer");
	assert.equal(ownershipRecord.channel, channel);
	assert.equal(ownershipRecord.commit, sidecar.commit);
	assert.equal(ownershipRecord.target, target);
	const state = join(env.HOME, "retained-state");
	writeFileSync(state, "operator state");
	const unknown = join(prefix, "lib/bobs-factory/operator-file");
	writeFileSync(unknown, "retain");
	const remove = () =>
		spawnSync(
			"sh",
			[join(root, "scripts/uninstall-binary.sh"), prefix, "--stopped"],
			{ env, encoding: "utf8" },
		);
	rmSync(join(prefix, "bin/bobs-factory"));
	symlinkSync("/unrelated/bobs-factory", join(prefix, "bin/bobs-factory"));
	assert.notEqual(remove().status, 0);
	assert.equal(
		readlinkSync(join(prefix, "bin/bobs-factory")),
		"/unrelated/bobs-factory",
	);
	rmSync(join(prefix, "bin/bobs-factory"));
	symlinkSync(link, join(prefix, "bin/bobs-factory"));
	const removed = remove();
	assert.equal(removed.status, 0, removed.stderr);
	assert.equal(existsSync(join(prefix, `lib/bobs-factory/${name}`)), false);
	assert.equal(readFileSync(state, "utf8"), "operator state");
	assert.equal(readFileSync(unknown, "utf8"), "retain");
	updateManifest();
	const reinstalled = install(...exactArgs);
	assert.equal(reinstalled.status, 0, reinstalled.stderr);
	writeFileSync(
		join(artifacts, "public-installer.json"),
		jsonBytes({
			schemaVersion: 1,
			product: "bobs-factory",
			validation: "public-installer",
			status: "passed",
			version,
			commit: sidecar.commit,
			candidateDigest: sidecar.candidateDigest,
			workflowSha: sidecar.workflowSha,
			target,
			scope: "native-archive-controlled-downloads",
			checks: {
				badSignaturePreservesInstallation: "passed",
				ownershipReceipt: "passed",
				foreignRemovalRefused: "passed",
				ownedRemovalRetainsState: "passed",
				reinstallAfterRemoval: "passed",
				channelResolution: "passed",
				exactVersion: "passed",
				repeatInstall: "passed",
				badHashPreservesInstallation: "passed",
				badSizePreservesInstallation: "passed",
				badSourcePreservesInstallation: "passed",
				unavailableTargetPreservesInstallation: "passed",
			},
		}),
	);
} finally {
	rmSync(work, { recursive: true, force: true });
}
