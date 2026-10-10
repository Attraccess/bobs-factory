import { execFileSync } from "node:child_process";
import {
	closeSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { requireValue, sha256File } from "./binary-release.mjs";
import { canonical, validateCandidate } from "./release-candidate.mjs";

export const sourceFileSha256 = sha256File;

// Only regular bytes are extracted; an operator-supplied archive is never executed.
export function extractEvidenceArchive(archive, output) {
	const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
		.trim()
		.split("\n");
	requireValue(
		entries.length === new Set(entries).size &&
			entries.every(
				(entry) =>
					entry.startsWith("release-evidence/") &&
					/^[A-Za-z0-9_./-]+$/.test(entry) &&
					!entry.split("/").some((part) => part === "." || part === ".."),
			),
		"Unsafe/duplicate evidence archive inventory",
	);
	const types = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8" })
		.trim()
		.split("\n");
	requireValue(
		types.every((line) => /^[d-]/.test(line)),
		"Evidence archive contains links/special files",
	);
	requireValue(
		entries.includes("release-evidence/release-evidence.json") &&
			entries.includes("release-evidence/source-rebuild.tar.gz"),
		"Evidence archive is missing release manifest/source material",
	);
	for (const entry of entries) {
		const destination = join(output, entry.slice("release-evidence/".length));
		if (entry.endsWith("/")) {
			mkdirSync(destination, { recursive: true });
			continue;
		}
		mkdirSync(dirname(destination), { recursive: true });
		const fd = openSync(destination, "wx");
		try {
			execFileSync("tar", ["-xOzf", archive, entry], {
				stdio: ["ignore", fd, "pipe"],
			});
		} finally {
			closeSync(fd);
		}
	}
}

export const RUNTIME_SOURCES = {
	bun: { revision: "744846f844374847c902b5e7fd59b4342a51ef99", repo: "bun" },
	webkit: {
		revision: "2e2aa2290fac856d6f451ceacb58f7f5b44dd057",
		repo: "WebKit",
	},
	tinycc: {
		revision: "05f0fafaa3be31e31d7b4b5c17dc60f62c991171",
		repo: "tinycc",
	},
};
const targets = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"];
const text = (v) => typeof v === "string" && v.trim().length > 0;
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const safeName = (v) =>
	typeof v === "string" && /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(v);
const reserved = new Set([
	"commit.txt",
	"pnpm-lock.yaml",
	"factory-source.tar.gz",
	"source-materials.json",
	"candidate.json",
	"release-tooling.tar.gz",
]);

function archiveEntries(path, prefix, regularOnly = false) {
	const entries = execFileSync("tar", ["-tzf", path], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	})
		.trim()
		.split("\n");
	requireValue(
		entries.length === new Set(entries).size &&
			entries.every(
				(e) =>
					e.startsWith(prefix) &&
					!e.includes("\\") &&
					!e.split("/").some((p) => p === "." || p === ".."),
			),
		"Unsafe/duplicate source archive inventory",
	);
	const types = execFileSync("tar", ["-tvzf", path], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	})
		.trim()
		.split("\n");
	requireValue(
		types.every((line) => {
			if (/^[d-]/.test(line)) return true;
			if (regularOnly || !line.startsWith("l")) return false;
			const start = line.indexOf(prefix);
			if (start < 0) return false;
			const [member, target] = line.slice(start).split(" -> ");
			if (!target || target.startsWith("/") || target.includes("\\"))
				return false;
			return posix
				.resolve("/", posix.dirname(member), target)
				.startsWith(`/${prefix}`);
		}),
		"Source archive contains links/special files or external link targets",
	);

	return entries;
}
function archiveText(path, entry) {
	return execFileSync("tar", ["-xOzf", path, entry], {
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
	});
}

// Structural/integrity checks do not determine license completeness or execute inputs.
export function validateSourceMaterials(materials, directory, identity) {
	requireValue(
		materials?.schemaVersion === 2 &&
			materials.commit === identity.commit &&
			materials.version === identity.version &&
			materials.workflowSha === identity.workflowSha &&
			hash(materials.candidateDigest) &&
			materials.candidateDigest === identity.candidateDigest &&
			materials.bunVersion === "1.4.2" &&
			Array.isArray(materials.records),
		"Source material must match exact candidate and pinned Bun runtime (schema 2 required)",
	);
	const files = new Set();
	for (const record of materials.records) {
		requireValue(
			safeName(record.file) &&
				!files.has(record.file) &&
				!reserved.has(record.file),
			"Unsafe/duplicate source material filename",
		);
		files.add(record.file);
		const origin = new URL(record.source);
		requireValue(
			origin.protocol === "https:" &&
				!origin.username &&
				!origin.password &&
				text(record.revision),
			"Every source material requires its HTTPS origin and exact revision",
		);
		requireValue(
			hash(record.sha256) &&
				Number.isSafeInteger(record.size) &&
				record.size > 0,
			"Source material requires SHA-256 and size",
		);
		const path = join(directory, record.file);
		requireValue(
			lstatSync(path).isFile(),
			"Source material must be a regular file",
		);
		requireValue(
			lstatSync(path).size === record.size &&
				sourceFileSha256(path) === record.sha256,
			`Source material integrity failure: ${record.file}`,
		);
	}
	const one = (kind, target) => {
		const records = materials.records.filter(
			(r) => r.kind === kind && r.target === target,
		);
		requireValue(
			records.length === 1,
			`Exactly one required material: ${kind}${target ? `/${target}` : ""}`,
		);
		return records[0];
	};
	for (const [kind, pin] of Object.entries(RUNTIME_SOURCES)) {
		const record = one(kind);
		requireValue(
			record.file === `${kind}-source.tar.gz` &&
				record.revision === pin.revision &&
				[
					`https://codeload.github.com/oven-sh/${pin.repo}/tar.gz/${pin.revision}`,
					`https://github.com/oven-sh/${pin.repo}/tree/${pin.revision}`,
				].includes(record.source),
			`Wrong pinned ${kind} source`,
		);
		const prefix = `${pin.repo}-${pin.revision}/`;
		const entries = archiveEntries(join(directory, record.file), prefix);
		const required =
			kind === "bun"
				? [
						"LICENSE.md",
						"scripts/build/deps/webkit.ts",
						"scripts/build/deps/tinycc.ts",
						"patches/tinycc/tcc.h.patch",
					]
				: kind === "webkit"
					? [
							"Source/JavaScriptCore/CMakeLists.txt",
							"Source/WTF/CMakeLists.txt",
							"Source/JavaScriptCore/COPYING.LIB",
						]
					: ["COPYING", "libtcc.c"];
		for (const file of required)
			requireValue(
				entries.includes(prefix + file),
				`Missing ${kind} source: ${file}`,
			);
		if (kind === "bun") {
			for (const dependency of ["webkit", "tinycc"])
				requireValue(
					archiveText(
						join(directory, record.file),
						`${prefix}scripts/build/deps/${dependency}.ts`,
					).includes(RUNTIME_SOURCES[dependency].revision),
					"Bun dependency source pin mismatch",
				);
		}
	}
	const license = one("runtime-license");
	requireValue(
		readFileSync(join(directory, license.file), "utf8") ===
			archiveText(
				join(directory, "bun-source.tar.gz"),
				`bun-${RUNTIME_SOURCES.bun.revision}/LICENSE.md`,
			),
		"Pinned runtime license mismatch",
	);
	const patch = one("tinycc-patch");
	requireValue(
		readFileSync(join(directory, patch.file), "utf8") ===
			archiveText(
				join(directory, "bun-source.tar.gz"),
				`bun-${RUNTIME_SOURCES.bun.revision}/patches/tinycc/tcc.h.patch`,
			),
		"Pinned TinyCC patch mismatch",
	);
	const instructions = one("instructions");
	requireValue(
		instructions.file === "README.md" &&
			text(readFileSync(join(directory, instructions.file), "utf8")),
		"Precise rebuild/relink instructions required",
	);
	requireValue(
		Array.isArray(materials.patches) &&
			materials.patches.every((f) => files.has(f)) &&
			materials.patches.includes(patch.file),
		"Inventory all applied patches; pinned TinyCC patch required",
	);
	requireValue(
		Array.isArray(materials.builds) &&
			materials.builds.length === targets.length,
		"All native target rebuild inputs required",
	);
	for (const target of targets) {
		const builds = materials.builds.filter((b) => b.target === target);
		requireValue(
			builds.length === 1,
			`Missing/duplicate native build configuration: ${target}`,
		);
		const build = builds[0];
		requireValue(
			hash(build.runtimeSha256) &&
				hash(build.executableSha256) &&
				text(build.compiler?.name) &&
				text(build.compiler?.version) &&
				build.commit === identity.commit &&
				build.version === identity.version &&
				build.candidateDigest === identity.candidateDigest &&
				build.bunRevision === RUNTIME_SOURCES.bun.revision &&
				build.webkitRevision === RUNTIME_SOURCES.webkit.revision &&
				build.tinyccRevision === RUNTIME_SOURCES.tinycc.revision &&
				Array.isArray(build.nativeFlags) &&
				build.nativeFlags.length > 0 &&
				build.nativeFlags.every(text) &&
				Array.isArray(build.commands) &&
				build.commands.length > 0 &&
				build.commands.every(text),
			`Exact compiler/runtime/native flags/commands required: ${target}`,
		);
		for (const kind of ["objects", "relink-log", "build-config"])
			one(kind, target);
		const config = one("build-config", target);
		requireValue(
			canonical(
				JSON.parse(readFileSync(join(directory, config.file), "utf8")),
			) === canonical(build),
			`Build configuration mismatch: ${target}`,
		);
		const objects = one("objects", target);
		requireValue(
			objects.revision === identity.commit &&
				config.revision === identity.commit &&
				one("relink-log", target).revision === identity.commit,
			`Rebuild input source mismatch: ${target}`,
		);
		const entries = archiveEntries(
			join(directory, objects.file),
			"objects/",
			true,
		).filter((e) => !e.endsWith("/"));
		requireValue(
			Array.isArray(build.objectInventory) &&
				build.objectInventory.length > 0 &&
				JSON.stringify([...entries].sort()) ===
					JSON.stringify([...build.objectInventory].sort()) &&
				entries.some((e) => /\.(o|obj|a)$/.test(e)) &&
				entries.some((e) => /\.(rsp|response)$/.test(e)),
			`Object inventory/link response missing or mismatched: ${target}`,
		);
		requireValue(
			text(
				readFileSync(join(directory, one("relink-log", target).file), "utf8"),
			),
			`Relink verification log required: ${target}`,
		);
	}
	return materials;
}

export function validateSourceArchive(archive, identity) {
	const entries = archiveEntries(archive, "source-rebuild/", true);
	const temporary = mkdtempSync(join(tmpdir(), "factory-source-intake-"));
	try {
		// Outer bundle is flat and regular-only. Never extract or run nested sources.
		for (const entry of entries.filter((e) => !e.endsWith("/"))) {
			const name = entry.slice("source-rebuild/".length);
			requireValue(safeName(name), "Unsafe source bundle path");
			const fd = openSync(join(temporary, name), "wx");
			try {
				execFileSync("tar", ["-xOzf", archive, entry], {
					stdio: ["ignore", fd, "pipe"],
				});
			} finally {
				closeSync(fd);
			}
		}
		const frozen = validateCandidate(
			JSON.parse(readFileSync(join(temporary, "candidate.json"), "utf8")),
		);
		requireValue(
			frozen.digest === identity.candidateDigest &&
				frozen.candidate.commit === identity.commit &&
				frozen.candidate.workflowSha === identity.workflowSha &&
				frozen.candidate.version === identity.version &&
				readFileSync(join(temporary, "commit.txt"), "utf8").trim() ===
					identity.commit,
			"Source bundle candidate mismatch",
		);
		const manifest = JSON.parse(
			readFileSync(join(temporary, "source-materials.json"), "utf8"),
		);
		validateSourceMaterials(manifest, temporary, identity);
		requireValue(
			Array.isArray(manifest.bundled) &&
				manifest.bundled.length === reserved.size - 1,
			"Generated source bundle inventory required",
		);
		const seen = new Set();
		for (const record of manifest.bundled) {
			requireValue(
				reserved.has(record.file) &&
					record.file !== "source-materials.json" &&
					!seen.has(record.file),
				"Unsafe/duplicate generated bundle record",
			);
			seen.add(record.file);
			requireValue(
				hash(record.sha256) &&
					lstatSync(join(temporary, record.file)).size === record.size &&
					sourceFileSha256(join(temporary, record.file)) === record.sha256,
				"Generated source bundle integrity failure",
			);
		}
		const expected = new Set([
			...reserved,
			...manifest.records.map((r) => r.file),
		]);
		requireValue(
			entries.filter((e) => !e.endsWith("/")).length === expected.size &&
				[...expected].every((f) => entries.includes(`source-rebuild/${f}`)),
			"Missing/uninventoried source bundle bytes",
		);
		return manifest;
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}
