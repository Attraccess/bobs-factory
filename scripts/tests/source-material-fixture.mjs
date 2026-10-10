// Controlled source/object bytes for validation tests; never release evidence.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileRecord, jsonBytes, TARGETS } from "../lib/binary-release.mjs";
import { RUNTIME_SOURCES } from "../lib/release-material.mjs";

export const fixtureTar = (args, options = {}) =>
	execFileSync("tar", args, {
		...options,
		env: { ...process.env, COPYFILE_DISABLE: "1" },
	});

export function sourceMaterialFixture(directory, identity) {
	mkdirSync(directory, { recursive: true });
	const records = [];
	const add = (kind, file, bytes, revision = identity.commit, target) => {
		if (bytes !== undefined) writeFileSync(join(directory, file), bytes);
		records.push({
			kind,
			target,
			source: "https://example.invalid/controlled-fixture",
			revision,
			...fileRecord(join(directory, file), file),
		});
	};
	const archive = (file, prefix, contents) => {
		const staging = join(directory, "fixture-stage");
		for (const [name, bytes] of Object.entries(contents)) {
			const path = join(staging, prefix, name);
			mkdirSync(join(path, ".."), { recursive: true });
			writeFileSync(path, bytes);
		}
		fixtureTar(["-czf", join(directory, file), "-C", staging, prefix]);
		rmSync(staging, { recursive: true });
	};
	for (const [kind, pin] of Object.entries(RUNTIME_SOURCES)) {
		const contents =
			kind === "bun"
				? {
						"LICENSE.md": "Controlled license fixture, not legal evidence",
						"scripts/build/deps/webkit.ts": RUNTIME_SOURCES.webkit.revision,
						"scripts/build/deps/tinycc.ts": RUNTIME_SOURCES.tinycc.revision,
						"patches/tinycc/tcc.h.patch": "Controlled patch fixture",
					}
				: kind === "webkit"
					? {
							"Source/JavaScriptCore/CMakeLists.txt":
								"Controlled source fixture",
							"Source/WTF/CMakeLists.txt": "Controlled source fixture",
							"Source/JavaScriptCore/COPYING.LIB": "Controlled license fixture",
						}
					: {
							COPYING: "Controlled license fixture",
							"libtcc.c": "Controlled source fixture",
						};
		const file = `${kind}-source.tar.gz`;
		archive(file, `${pin.repo}-${pin.revision}`, contents);
		add(kind, file, undefined, pin.revision);
		records.at(-1).source =
			`https://codeload.github.com/oven-sh/${pin.repo}/tar.gz/${pin.revision}`;
	}
	add(
		"runtime-license",
		"bun-LICENSE.md",
		"Controlled license fixture, not legal evidence",
	);
	add("tinycc-patch", "tinycc-tcc.h.patch", "Controlled patch fixture");
	add(
		"instructions",
		"README.md",
		"Controlled rebuild instructions, never release approval",
	);
	const builds = TARGETS.map((target) => {
		const build = {
			target,
			commit: identity.commit,
			version: identity.version,
			candidateDigest: identity.candidateDigest,
			bunRevision: RUNTIME_SOURCES.bun.revision,
			webkitRevision: RUNTIME_SOURCES.webkit.revision,
			tinyccRevision: RUNTIME_SOURCES.tinycc.revision,
			runtimeSha256: "1".repeat(64),
			executableSha256: "2".repeat(64),
			compiler: { name: "fixture compiler", version: "fixture-only" },
			nativeFlags: ["fixture-only"],
			commands: ["fixture-only; never executed"],
			objectInventory: ["objects/bun.o", "objects/link.rsp"],
		};
		archive(`objects-${target}.tar.gz`, "objects", {
			"bun.o": "controlled object",
			"link.rsp": "controlled response",
		});
		add(
			"objects",
			`objects-${target}.tar.gz`,
			undefined,
			identity.commit,
			target,
		);
		add(
			"build-config",
			`build-${target}.json`,
			JSON.stringify(build),
			identity.commit,
			target,
		);
		add(
			"relink-log",
			`relink-${target}.txt`,
			"Controlled relink fixture; no actual build",
			identity.commit,
			target,
		);
		return build;
	});
	const manifest = {
		schemaVersion: 2,
		commit: identity.commit,
		version: identity.version,
		workflowSha: identity.workflowSha,
		candidateDigest: identity.candidateDigest,
		bunVersion: "1.4.2",
		patches: ["tinycc-tcc.h.patch"],
		records,
		builds,
	};
	writeFileSync(join(directory, "source-materials.json"), jsonBytes(manifest));
	return manifest;
}
