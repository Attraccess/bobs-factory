import {
	copyFileSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireValue, sha256File } from "./binary-release.mjs";
import { ARCHIVE_LIMITS, inspectArchive } from "./bounded-archive.mjs";
import { canonical, validateCandidate } from "./release-candidate.mjs";

export const sourceFileSha256 = sha256File;

// Only bounded regular bytes are staged; operator archives are never executed.
export function extractEvidenceArchive(archive, output, options = {}) {
	const policy = {
		prefix: "release-evidence/",
		regularOnly: true,
		collect: ["release-evidence/release-evidence.json"],
		limits: options.limits,
	};
	const scanned = inspectArchive(archive, policy);
	const files = scanned.entries.filter((e) => e.type === "0");
	requireValue(
		files.some((e) => e.name === "release-evidence/release-evidence.json") &&
			files.some((e) => e.name === "release-evidence/source-rebuild.tar.gz"),
		"Evidence archive is missing release manifest/source material",
	);
	const temporary = mkdtempSync(join(tmpdir(), "factory-evidence-intake-"));
	const copied = [];
	try {
		inspectArchive(archive, {
			...policy,
			expected: Object.fromEntries(files.map((e) => [e.name, e.size])),
			output: temporary,
		});

		mkdirSync(output, { recursive: true });
		for (const entry of files) {
			const name = entry.name.slice(policy.prefix.length);
			const destination = join(output, name);
			mkdirSync(join(destination, ".."), { recursive: true });
			copyFileSync(join(temporary, name), destination, 1);
			copied.push(destination);
		}
	} catch (error) {
		for (const path of copied) rmSync(path, { force: true });
		throw error;
	} finally {
		rmSync(temporary, { recursive: true, force: true });
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

function validateMaterialIdentity(materials, identity) {
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
}

// Structural/integrity checks do not determine license completeness or execute inputs.
export function validateSourceMaterials(
	materials,
	directory,
	identity,
	options = {},
) {
	validateMaterialIdentity(materials, identity);
	const files = new Set();
	const limits = { ...ARCHIVE_LIMITS, ...options.limits };
	requireValue(
		materials.records.length <= limits.maxMembers,
		"Source material record count limit exceeded",
	);
	let totalBytes = 0;
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
		if (
			[
				"runtime-license",
				"tinycc-patch",
				"instructions",
				"build-config",
				"relink-log",
			].includes(record.kind)
		)
			requireValue(
				record.size <=
					(record.kind === "relink-log"
						? limits.maxTextBytes
						: limits.maxControlBytes),
				"Source material text byte limit exceeded",
			);
		totalBytes += record.size;
		requireValue(
			record.size <= limits.maxMemberBytes &&
				totalBytes <= limits.maxExpandedBytes,
			"Source material byte limit exceeded",
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
	let bunTexts;
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
		const inspected = inspectArchive(join(directory, record.file), {
			prefix,
			collect:
				kind === "bun"
					? [
							"LICENSE.md",
							"scripts/build/deps/webkit.ts",
							"scripts/build/deps/tinycc.ts",
							"patches/tinycc/tcc.h.patch",
						].map((f) => prefix + f)
					: [],
			limits: options.limits,
		});
		const entries = inspected.entries.map((e) => e.name);
		if (kind === "bun") bunTexts = inspected.texts;
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
					bunTexts[`${prefix}scripts/build/deps/${dependency}.ts`].includes(
						RUNTIME_SOURCES[dependency].revision,
					),
					"Bun dependency source pin mismatch",
				);
		}
	}
	const license = one("runtime-license");
	requireValue(
		readFileSync(join(directory, license.file), "utf8") ===
			bunTexts[`bun-${RUNTIME_SOURCES.bun.revision}/LICENSE.md`],
		"Pinned runtime license mismatch",
	);
	const patch = one("tinycc-patch");
	requireValue(
		readFileSync(join(directory, patch.file), "utf8") ===
			bunTexts[
				`bun-${RUNTIME_SOURCES.bun.revision}/patches/tinycc/tcc.h.patch`
			],
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
		const entries = inspectArchive(join(directory, objects.file), {
			prefix: "objects/",
			regularOnly: true,
			limits: options.limits,
		})
			.entries.filter((e) => e.type === "0")
			.map((e) => e.name);
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

export function validateSourceArchive(archive, identity, options = {}) {
	const policy = {
		prefix: "source-rebuild/",
		regularOnly: true,
		flat: true,
		limits: { maxMembers: 256, ...options.limits },
	};
	const scanned = inspectArchive(archive, {
		...policy,
		collect: ["candidate.json", "commit.txt", "source-materials.json"].map(
			(f) => policy.prefix + f,
		),
	});
	const entries = scanned.entries.map((e) => e.name);
	const control = (f) => scanned.texts[policy.prefix + f];
	const frozen = validateCandidate(JSON.parse(control("candidate.json")));
	requireValue(
		frozen.digest === identity.candidateDigest &&
			frozen.candidate.commit === identity.commit &&
			frozen.candidate.workflowSha === identity.workflowSha &&
			frozen.candidate.version === identity.version &&
			control("commit.txt").trim() === identity.commit,
		"Source bundle candidate mismatch",
	);
	const manifest = JSON.parse(control("source-materials.json"));
	validateMaterialIdentity(manifest, identity);
	requireValue(
		Array.isArray(manifest.records) && Array.isArray(manifest.bundled),
		"Generated source bundle inventory required",
	);
	const expected = {};
	requireValue(
		manifest.bundled.length === reserved.size - 1,
		"Generated source bundle inventory required",
	);
	for (const record of [...manifest.records, ...manifest.bundled]) {
		requireValue(
			safeName(record.file) &&
				hash(record.sha256) &&
				Number.isSafeInteger(record.size) &&
				record.size > 0 &&
				!Object.hasOwn(expected, policy.prefix + record.file),
			"Unsafe/duplicate source material filename or size",
		);
		requireValue(
			manifest.records.includes(record)
				? !reserved.has(record.file)
				: reserved.has(record.file) && record.file !== "source-materials.json",
			"Unsafe/duplicate generated bundle record",
		);
		expected[policy.prefix + record.file] = record.size;
	}
	expected[`${policy.prefix}source-materials.json`] = Buffer.byteLength(
		control("source-materials.json"),
	);
	requireValue(
		[...reserved].every((f) => Object.hasOwn(expected, policy.prefix + f)),
		"Generated source bundle inventory required",
	);
	requireValue(
		entries.filter((e) => !e.endsWith("/")).length ===
			Object.keys(expected).length &&
			scanned.entries
				.filter((e) => e.type === "0")
				.every((e) => expected[e.name] === e.size),
		"Missing/uninventoried source bundle bytes or size mismatch",
	);
	const temporary = mkdtempSync(join(tmpdir(), "factory-source-intake-"));
	try {
		// Only inventoried sizes may reach disk, after candidate/control validation.
		inspectArchive(archive, { ...policy, expected, output: temporary });
		validateSourceMaterials(manifest, temporary, identity, options);
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
		const complete = new Set([
			...reserved,
			...manifest.records.map((r) => r.file),
		]);
		requireValue(
			entries.filter((e) => !e.endsWith("/")).length === complete.size &&
				[...complete].every((f) => entries.includes(`source-rebuild/${f}`)),
			"Missing/uninventoried source bundle bytes",
		);
		return manifest;
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}
