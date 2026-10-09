#!/usr/bin/env node
// Native CI: use the actual freshly built archive with a controlled download
// transport. No public release, production prefix, home or shell profile is used.
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
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileRecord, jsonBytes, REPOSITORY } from "./lib/binary-release.mjs";
import { releaseChannel } from "./lib/release-channels.mjs";

const { values } = parseArgs({
	options: { artifacts: { type: "string", default: "artifacts" } },
});
const artifacts = resolve(values.artifacts),
	target = `${process.platform}-${process.arch}`;
const pkg = JSON.parse(readFileSync("apps/cli/package.json", "utf8"));
const version = pkg.version;
const name = `bobs-factory-${version}-${target}`;
const sidecar = JSON.parse(
	readFileSync(join(artifacts, `${name}.manifest.json`), "utf8"),
);
const work = mkdtempSync(join(tmpdir(), "factory-public-install-native-"));
try {
	mkdirSync(join(work, "bin"));
	mkdirSync(join(work, "downloads"));
	mkdirSync(join(work, "home"));
	const downloads = join(work, "downloads");
	for (const file of [`${name}.tar.gz`, `${name}.manifest.json`])
		copyFileSync(join(artifacts, file), join(downloads, file));
	copyFileSync(
		"scripts/install-binary.sh",
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
		...pkg.bobsFactoryRelease,
		schemaVersion: pkg.bobsFactoryRelease ? 2 : 1,
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
	// This narrowly scoped manifest is transport test material, never release evidence.
	for (const file of [
		"latest.json",
		"stable.json",
		"nightly.json",
		"release.json",
	])
		writeFileSync(join(downloads, file), jsonBytes(manifest));
	writeFileSync(
		join(work, "bin/curl"),
		`#!/bin/sh\nset -eu\nurl=\noutput=\nwhile [ "$#" -gt 0 ]; do case "$1" in https://*) url=$1; shift;; --output) output=$2; shift 2;; *) shift;; esac; done\ncase "$url" in https://jappyjan.github.io/bobs-factory/releases/*.json|https://github.com/jappyjan/bobs-factory/releases/download/v*) cp "$BOBS_FACTORY_TEST_DOWNLOADS/\${url##*/}" "$output";; *) exit 1;; esac\n`,
		{ mode: 0o755 },
	);
	const prefix = join(work, "prefix");
	const env = {
		...process.env,
		PATH: `${work}/bin:${process.env.PATH}`,
		BOBS_FACTORY_TEST_DOWNLOADS: downloads,
		BOBS_FACTORY_INSTALL_PREFIX: prefix,
	};
	const install = (...args) =>
		spawnSync("sh", ["scripts/install.sh", "--no-modify-path", ...args], {
			env,
			encoding: "utf8",
		});
	const channel = releaseChannel(version);
	const args =
		channel === "prerelease" ? ["--version", version] : ["--channel", channel];
	for (const selected of [args, ["--version", version], args]) {
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
	writeFileSync(join(downloads, "release.json"), jsonBytes(manifest));
	assert.notEqual(install("--version", version).status, 0);
	assert.equal(readlinkSync(join(prefix, "bin/bobs-factory")), link);
	manifest.targets[target] = {
		...good.targets[target],
		archiveSize: good.targets[target].archiveSize + 1,
	};
	writeFileSync(join(downloads, "release.json"), jsonBytes(manifest));
	assert.notEqual(install("--version", version).status, 0);
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
	writeFileSync(join(downloads, "release.json"), jsonBytes(manifest));
	assert.notEqual(install("--version", version).status, 0);
	assert.equal(readlinkSync(join(prefix, "bin/bobs-factory")), link);
	copyFileSync(
		join(artifacts, `${name}.manifest.json`),
		join(downloads, `${name}.manifest.json`),
	);
	delete manifest.targets[target];
	writeFileSync(join(downloads, "release.json"), jsonBytes(manifest));
	assert.notEqual(install("--version", version).status, 0);
	assert.equal(readlinkSync(join(prefix, "bin/bobs-factory")), link);
	writeFileSync(
		join(artifacts, "public-installer.json"),
		jsonBytes({
			schemaVersion: 1,
			product: "bobs-factory",
			validation: "public-installer",
			status: "passed",
			version,
			commit: sidecar.commit,
			target,
			scope: "native-archive-controlled-downloads",
			checks: {
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
