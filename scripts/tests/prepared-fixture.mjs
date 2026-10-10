// Simulated native receipts for transport/publication tests. Never release evidence.
import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	fileRecord,
	jsonBytes,
	REPOSITORY,
	sha256,
	TARGETS,
} from "../lib/binary-release.mjs";
import {
	candidateIdentity,
	freezeCandidate,
	validateCandidate,
} from "../lib/release-candidate.mjs";
import { keys, signBytes, testInstaller } from "./release-fixtures.mjs";

import {
	fixtureTar,
	sourceMaterialFixture,
} from "./source-material-fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export function preparedFixture(
	channel = "nightly",
	{
		gitTooling = false,
		stableVersion = "1.0.0",
		sequence = 10,
		desktop = false,
		legacy = false,
		frozenCandidate,
	} = {},
) {
	const work = mkdtempSync(join(tmpdir(), "factory-publication-fixture-"));
	const scripts = join(work, "scripts");
	cpSync(join(root, "scripts"), scripts, { recursive: true });
	mkdirSync(join(work, "docs/distribution"), { recursive: true });
	writeFileSync(
		join(work, "docs/distribution/release-keys.json"),
		jsonBytes({ schemaVersion: 1, keys }),
	);
	writeFileSync(
		join(scripts, "install.sh"),
		testInstaller(readFileSync(join(scripts, "install.sh"), "utf8")),
	);
	let workflowSha = "b".repeat(40);
	if (gitTooling) {
		const git = (...args) =>
			execFileSync("git", args, {
				cwd: work,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}).trim();
		git("init");
		git("add", "scripts", "docs");
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"-m",
			"Controlled tooling fixture",
		);
		workflowSha = git("rev-parse", "HEAD");
	}
	const candidate = frozenCandidate
		? validateCandidate(frozenCandidate)
		: freezeCandidate({
				channel,
				version:
					channel === "stable"
						? stableVersion
						: channel === "beta"
							? "1.0.0-beta"
							: undefined,
				commit: "a".repeat(40),
				workflowSha,
				committedVersion: "1.0.0-beta",
				sequence,
				date: "2026-10-09T00:00:00Z",
				...(channel === "stable"
					? {
							promotion: {
								channel: "nightly",
								version: "1.0.0-nightly.20261009.9",
								tag: "v1.0.0-nightly.20261009.9",
								commit: "a".repeat(40),
								manifestSha256: "c".repeat(64),
								releaseId: 9,
							},
						}
					: {}),
			});
	const identity = legacy
		? {
				version: candidate.candidate.version,
				tag: candidate.candidate.tag,
				commit: candidate.candidate.commit,
				runId: 123,
			}
		: candidateIdentity(candidate, 123);
	const candidateFields = legacy
		? {}
		: { candidateDigest: candidate.digest, workflowSha: identity.workflowSha };
	const output = join(work, "prepared"),
		assets = join(output, "assets");
	mkdirSync(assets, { recursive: true });
	const receipt = join(work, "receipt.txt");
	writeFileSync(
		receipt,
		"Controlled simulated evidence fixture; no real native validation performed.\n",
	);
	const gate = {
		status: "passed",
		receipt: { file: "receipt.txt", sha256: sha256(readFileSync(receipt)) },
	};
	fixtureTar([
		"-czf",
		join(assets, "validation-receipts.tar.gz"),
		"-C",
		work,
		"receipt.txt",
	]);
	const targets = {};
	for (const target of TARGETS) {
		const name = `bobs-factory-${identity.version}-${target}`,
			stage = join(work, name);
		mkdirSync(stage);
		const binary = Buffer.from(`#!/bin/sh\necho ${identity.version}\n`);
		const build = {
			schemaVersion: 1,
			product: "bobs-factory",
			version: identity.version,
			commit: identity.commit,
			target,
			dirty: false,
			...candidateFields,
			committedVersion: identity.committedVersion,
			tooling: { bun: "1.4.2" },
			resourceDigest: "e".repeat(64),
			executable: {
				file: "bobs-factory",
				sha256: sha256(binary),
				size: binary.length,
			},
		};
		writeFileSync(join(stage, "bobs-factory"), binary, { mode: 0o755 });
		writeFileSync(join(stage, "build.json"), jsonBytes(build));
		writeFileSync(join(stage, "LICENSE"), "Apache License 2.0");
		writeFileSync(join(stage, "NOTICE"), "Derived from Cyrus");
		writeFileSync(
			join(stage, "THIRD_PARTY_NOTICES.txt"),
			`Bun 1.4.2\n${"Fixture license ".repeat(30)}`,
		);
		fixtureTar(["-czf", join(assets, `${name}.tar.gz`), "-C", work, name]);
		const archive = fileRecord(
			join(assets, `${name}.tar.gz`),
			`${name}.tar.gz`,
		);
		writeFileSync(
			join(assets, `${name}.manifest.json`),
			jsonBytes({
				schemaVersion: 1,
				product: "bobs-factory",
				version: identity.version,
				commit: identity.commit,
				target,
				dirty: false,
				...candidateFields,
				committedVersion: identity.committedVersion,
				...archive,
			}),
		);
		const sidecar = fileRecord(
			join(assets, `${name}.manifest.json`),
			`${name}.manifest.json`,
		);
		targets[target] = {
			archive: archive.file,
			archiveSha256: archive.sha256,
			archiveSize: archive.size,
			manifest: sidecar.file,
			manifestSha256: sidecar.sha256,
			manifestSize: sidecar.size,
		};
		const native = {
			schemaVersion: 1,
			product: "bobs-factory",
			validation: "native-helpers",
			status: "passed",
			version: identity.version,
			commit: identity.commit,
			target,
			dirty: false,
			...candidateFields,
			executableSha256: build.executable.sha256,
			resourceDigest: build.resourceDigest,
			platform: {
				os: target.split("-")[0],
				arch: target.split("-")[1],
				release: "fixture",
				systemVersion: "fixture",
				cpuModel: "fixture",
				libc: target.startsWith("linux") ? "glibc 2.39" : "not-applicable",
			},
			scope: {
				transport: "controlled-local-https",
				credentials: "synthetic-scoped",
				agentInference: "none",
			},
			requestCount: 4,
			checks: Object.fromEntries(
				[
					"gitCredentialScoped",
					"gitCredentialForeignRejected",
					"restApiScoped",
					"graphqlApiScoped",
					"apiForeignRejected",
					"missingCredentialNoFallback",
					"http201CiRetry",
					"helperWithoutPath",
					"cursorPermission",
				].map((k) => [k, "passed"]),
			),
		};
		const prepared = {
			...native,
			validation: "prepared-agent-boundaries",
			scope: {
				agents: "synthetic-sdk-and-mocked-adapters",
				authenticatedProviders: false,
				agentInference: "none",
			},
			compiledCursorIpcCreateResume: "passed",
			adapterCheckout: { commit: identity.commit, dirty: false },
			adapters: Object.fromEntries(
				["claude", "codex", "gemini", "opencode", "cursor"].map((r) => [
					r,
					{
						status: "passed",
						passed: 1,
						skipped: 0,
						files: ["fixture.test.ts"],
						reportSha256: "f".repeat(64),
					},
				]),
			),
		};
		writeFileSync(
			join(assets, `native-helpers-${target}.json`),
			jsonBytes(native),
		);
		writeFileSync(
			join(assets, `prepared-agent-boundaries-${target}.json`),
			jsonBytes(prepared),
		);
		if (channel !== "beta")
			writeFileSync(
				join(assets, `public-installer-${target}.json`),
				jsonBytes({
					schemaVersion: 1,
					product: "bobs-factory",
					validation: "public-installer",
					status: "passed",
					version: identity.version,
					commit: identity.commit,
					target,
					candidateDigest: candidate.digest,
					workflowSha: identity.workflowSha,
					scope: "native-archive-controlled-downloads",
					checks: Object.fromEntries(
						[
							"channelResolution",
							"exactVersion",
							"repeatInstall",
							"badHashPreservesInstallation",
							"badSizePreservesInstallation",
							"badSourcePreservesInstallation",
							"unavailableTargetPreservesInstallation",
							"badSignaturePreservesInstallation",
						].map((c) => [c, "passed"]),
					),
				}),
			);
		writeFileSync(
			join(assets, `runtime-smoke-${target}.txt`),
			"Startup 1:\nStartup 2:\nBinary startup/assets/protected API/MCP/shutdown/restart smoke passed\n",
		);
	}
	const source = join(work, "source-rebuild");
	mkdirSync(source);
	for (const [name, bytes] of [
		["commit.txt", identity.commit],
		...(!legacy ? [["candidate.json", jsonBytes(candidate)]] : []),
		["README.md", "Fixture rebuild instructions"],
		["pnpm-lock.yaml", "Fixture lock"],
		...(!legacy
			? [["release-tooling.tar.gz", "Simulated frozen tooling"]]
			: []),
		["factory-source.tar.gz", "Simulated committed source"],
	])
		writeFileSync(join(source, name), bytes);
	if (legacy) {
		writeFileSync(
			join(source, "bun-source.tar.gz"),
			"Historical controlled runtime source",
		);
		writeFileSync(
			join(source, "source-materials.json"),
			jsonBytes({
				schemaVersion: 1,
				commit: identity.commit,
				bunVersion: "1.4.2",
				records: [
					fileRecord(join(source, "bun-source.tar.gz"), "bun-source.tar.gz"),
				],
			}),
		);
	} else {
		const material = sourceMaterialFixture(source, identity);
		material.bundled = [
			"commit.txt",
			"candidate.json",
			"pnpm-lock.yaml",
			"factory-source.tar.gz",
			"release-tooling.tar.gz",
		].map((file) => fileRecord(join(source, file), file));
		writeFileSync(join(source, "source-materials.json"), jsonBytes(material));
	}

	fixtureTar([
		"-czf",
		join(assets, "source-rebuild.tar.gz"),
		"-C",
		work,
		"source-rebuild",
	]);
	const sourceRecord = fileRecord(
		join(assets, "source-rebuild.tar.gz"),
		"source-rebuild.tar.gz",
	);
	const evidence = {
		schemaVersion: 1,
		product: "bobs-factory",
		version: identity.version,
		commit: identity.commit,
		buildRunId: 123,
		...candidateFields,
		reviewedCandidate: gate,
		fullPayloadF1: gate,
		migrationPreservation: gate,
		licensingAndSource: gate,
		source: sourceRecord,
		targets: Object.fromEntries(
			TARGETS.map((t) => [t, { nativeHelpers: gate, preparedAgents: gate }]),
		),
	};
	if (desktop) {
		writeFileSync(join(assets, "desktop.tar.gz"), "Simulated desktop archive");
		writeFileSync(
			join(assets, "desktop-update.json"),
			"Simulated update metadata",
		);
		writeFileSync(
			join(assets, "desktop-validation.json"),
			jsonBytes({
				product: "bobs-factory",
				status: "passed",
				version: identity.version,
				commit: identity.commit,
				channel,
				target: "darwin-arm64",
				...candidateFields,
			}),
		);
		evidence.desktop = {
			schemaVersion: 1,
			artifacts: [
				{
					version: identity.version,
					commit: identity.commit,
					channel,
					target: "darwin-arm64",
					platformRequirements: "Simulated macOS ARM64",
					archive: fileRecord(join(assets, "desktop.tar.gz"), "desktop.tar.gz"),
					updateMetadata: fileRecord(
						join(assets, "desktop-update.json"),
						"desktop-update.json",
					),
					validation: fileRecord(
						join(assets, "desktop-validation.json"),
						"desktop-validation.json",
					),
				},
			],
		};
	}
	writeFileSync(join(assets, "release-evidence.json"), jsonBytes(evidence));
	if (!legacy)
		writeFileSync(join(assets, "candidate.json"), jsonBytes(candidate));
	const run = {
		id: 123,
		status: "completed",
		conclusion: "success",
		repository: { full_name: REPOSITORY },
		head_repository: { full_name: REPOSITORY },
		head_sha: legacy ? identity.commit : identity.workflowSha,
		path: ".github/workflows/binary-build.yml",
		event: "workflow_dispatch",
		run_attempt: 1,
	};
	const jobs = TARGETS.map((t) => ({
		name: `binary (${t})`,
		status: "completed",
		conclusion: "success",
	}));
	const artifacts = Object.fromEntries(
		TARGETS.map((t, i) => [
			t,
			{
				id: i + 1,
				name: legacy
					? `bobs-factory-${t}-${identity.commit}`
					: `bobs-factory-${t}-${candidate.digest}-1`,
				expired: false,
				digest: `sha256:${"d".repeat(64)}`,
				workflow_run: {
					id: 123,
					head_sha: legacy ? identity.commit : identity.workflowSha,
				},
			},
		]),
	);
	writeFileSync(
		join(assets, "build-provenance.json"),
		jsonBytes({ ...candidateFields, run, jobs, artifacts }),
	);
	for (const name of ["install.sh", "install-binary.sh"])
		writeFileSync(join(assets, name), readFileSync(join(scripts, name)));
	const manifest = {
		schemaVersion: legacy ? 1 : 2,
		...(channel !== "beta" ? { publicInstallerValidation: 1 } : {}),
		product: "bobs-factory",
		repository: REPOSITORY,
		status: "available",
		channel: legacy ? "prerelease" : channel,
		...candidateFields,
		version: identity.version,
		tag: identity.tag,
		commit: identity.commit,
		buildRunId: 123,
		installer: fileRecord(join(assets, "install.sh"), "install.sh"),
		verifier: fileRecord(
			join(assets, "install-binary.sh"),
			"install-binary.sh",
		),
		source: sourceRecord,
		targets,
		...(desktop ? { desktop: evidence.desktop } : {}),
		...(!legacy
			? {
					assets: readdirSync(assets)
						.sort()
						.map((f) => fileRecord(join(assets, f), f)),
				}
			: {}),
	};
	writeFileSync(join(assets, "release.json"), jsonBytes(manifest));
	writeFileSync(
		join(assets, "release.json.sig"),
		signBytes(jsonBytes(manifest)),
	);
	writeFileSync(join(assets, "release.json.key-id"), "fixture\n");
	const records = readdirSync(assets)
		.sort()
		.map((f) => fileRecord(join(assets, f), f));
	return {
		work,
		output,
		assets,
		candidate,
		identity,
		manifest,
		records,
		assetsDigest: sha256(jsonBytes(records)),
		cleanup: () => rmSync(work, { recursive: true, force: true }),
	};
}
