import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	fileRecord,
	jsonBytes,
	REPOSITORY,
	sha256,
	TARGETS,
} from "../lib/binary-release.mjs";
import { signBytes, testInstaller } from "./release-fixtures.mjs";

const commit = "a".repeat(40);
const native = `${process.platform}-${process.arch}`;

export function trialBootstrapFixture(version, { slowCurl = false } = {}) {
	const work = mkdtempSync(join(tmpdir(), "factory-trial-bootstrap-test-"));
	const downloads = join(work, "downloads");
	const home = join(work, "home");
	const temp = join(work, "temp");
	for (const directory of [downloads, home, temp])
		mkdirSync(directory, { recursive: true });
	const name = `bobs-factory-${version}-${native}`;
	const stage = join(work, name);
	mkdirSync(stage);
	const executable = Buffer.from(
		`#!/bin/sh\nprintf '%s\\n' 'runtime-${version}'\n`,
	);
	writeFileSync(join(stage, "bobs-factory"), executable, { mode: 0o755 });
	writeFileSync(join(stage, "LICENSE"), "Apache License 2.0\n");
	writeFileSync(join(stage, "NOTICE"), "Bob's Factory derived from Cyrus\n");
	writeFileSync(
		join(stage, "THIRD_PARTY_NOTICES.txt"),
		"Controlled test runtime\n",
	);
	writeFileSync(
		join(stage, "build.json"),
		jsonBytes({
			schemaVersion: 1,
			product: "bobs-factory",
			version,
			commit,
			target: native,
			sha256: sha256(executable),
			size: executable.length,
		}),
	);
	const archiveName = `${name}.tar.gz`;
	const archivePath = join(downloads, archiveName);
	execFileSync("tar", ["-czf", archivePath, "-C", work, name]);
	const archive = fileRecord(archivePath, archiveName);
	const sidecarName = `${name}.manifest.json`;
	const sidecarPath = join(downloads, sidecarName);
	writeFileSync(
		sidecarPath,
		jsonBytes({
			schemaVersion: 1,
			product: "bobs-factory",
			version,
			commit,
			dirty: false,
			target: native,
			...archive,
		}),
	);
	const sidecar = fileRecord(sidecarPath, sidecarName);
	const verifierPath = new URL(
		"../../scripts/install-binary.sh",
		import.meta.url,
	);
	const verifierName = "install-binary.sh";
	const verifierPathOnDisk = join(downloads, verifierName);
	writeFileSync(verifierPathOnDisk, readFileSync(verifierPath));
	const verifier = fileRecord(verifierPathOnDisk, verifierName);
	const targets = Object.fromEntries(
		TARGETS.map((target) => [
			target,
			{
				archive: archiveName.replace(native, target),
				archiveSha256: archive.sha256,
				archiveSize: archive.size,
				manifest: sidecarName.replace(native, target),
				manifestSha256: sidecar.sha256,
				manifestSize: sidecar.size,
			},
		]),
	);
	const channel = version.includes("nightly")
		? "nightly"
		: version.includes("beta")
			? "beta"
			: "stable";
	const metadata = {
		schemaVersion: 2,
		product: "bobs-factory",
		repository: REPOSITORY,
		status: "available",
		version,
		tag: `v${version}`,
		commit,
		buildRunId: 123,
		channel,
		candidateDigest: "d".repeat(64),
		workflowSha: commit,
		installer: fileRecord(
			new URL("../../scripts/install.sh", import.meta.url),
			"install.sh",
		),
		verifier,
		source: { file: "source-rebuild.tar.gz", sha256: "c".repeat(64), size: 42 },
		targets,
	};
	for (const file of ["latest.json", "nightly.json", "release.json"]) {
		const bytes = jsonBytes(metadata);
		writeFileSync(join(downloads, file), bytes);
		writeFileSync(join(downloads, `${file}.sig`), signBytes(bytes));
		writeFileSync(join(downloads, `${file}.key-id`), "fixture\n");
	}
	const bootstrapPath = join(downloads, "install.sh");
	writeFileSync(
		bootstrapPath,
		testInstaller(
			readFileSync(
				new URL("../../scripts/install.sh", import.meta.url),
				"utf8",
			),
		),
		{ mode: 0o700 },
	);
	const curlPid = join(work, "curl.pid");
	const bin = join(work, "bin");
	mkdirSync(bin);
	const curlScript = slowCurl
		? `#!/bin/sh\nprintf '%s' "$$" > '${curlPid}'\nexec sleep 30\n`
		: `#!/bin/sh\nset -eu\nurl=\noutput=\nwhile [ "$#" -gt 0 ]; do case "$1" in --output) output=$2; shift 2;; https://*) url=$1; shift;; *) shift;; esac; done\nfile=\${url##*/}\ncp '${downloads}/'$file "$output"\n`;
	writeFileSync(join(bin, "curl"), curlScript, { mode: 0o755 });
	const preload = join(work, "transport.mjs");
	writeFileSync(
		preload,
		`import {readFileSync} from 'node:fs';globalThis.fetch=async url=>{const body=readFileSync(${JSON.stringify(bootstrapPath)},'utf8');const response=new Response(body);Object.defineProperty(response,'url',{value:String(url)});return response;};`,
	);
	const npmHome = join(work, "package");
	const packageBin = join(npmHome, "bin");
	mkdirSync(packageBin, { recursive: true });
	writeFileSync(
		join(npmHome, "package.json"),
		JSON.stringify({
			name: "bobs-factory-trial-test",
			version: "0.1.0",
			type: "module",
			bin: { "bobs-factory-trial": "./bin/launcher.mjs" },
			files: ["bin/"],
			private: true,
		}),
	);
	writeFileSync(
		join(packageBin, "launcher.mjs"),
		readFileSync(
			new URL(
				"../../distribution/npm/bobs-factory-trial/bin/bobs-factory-trial.mjs",
				import.meta.url,
			),
		),
		{ mode: 0o755 },
	);
	const env = {
		...process.env,
		HOME: home,
		TMPDIR: temp,
		PATH: `${bin}:${process.env.PATH}`,
		NODE_OPTIONS: `--import=${preload}`,
	};
	return {
		bootstrapPath,
		curlPid,
		downloads,
		env,
		home,
		launcher: join(packageBin, "launcher.mjs"),
		packageDir: npmHome,
		packageJson: join(npmHome, "package.json"),
		temp,
		work,
		cleanup: () => rmSync(work, { recursive: true, force: true }),
	};
}
