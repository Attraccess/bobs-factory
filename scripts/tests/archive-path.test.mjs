import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { fileRecord, jsonBytes } from "../lib/binary-release.mjs";
import { inspectArchive } from "../lib/bounded-archive.mjs";
import { validatePreparedRelease } from "../lib/prepared-release.mjs";
import {
	candidateIdentity,
	freezeCandidate,
} from "../lib/release-candidate.mjs";
import {
	RUNTIME_SOURCES,
	validateSourceArchive,
} from "../lib/release-material.mjs";
import { preparedFixture } from "./prepared-fixture.mjs";
import { sourceMaterialFixture } from "./source-material-fixture.mjs";

// Independent tar bytes can express names that the host filesystem collapses.
function member(name, bytes = Buffer.alloc(0), type = "0", target = "") {
	const header = Buffer.alloc(512);
	Buffer.from(name).copy(header, 0, 0, 100);
	header.write("0000644\0", 100);
	header.write("0000000\0", 108);
	header.write("0000000\0", 116);
	header.write(`${bytes.length.toString(8).padStart(11, "0")}\0`, 124);
	header.write("00000000000\0", 136);
	header.fill(32, 148, 156);
	header.write(type, 156);
	header.write(target, 157, 100);
	header.write("ustar\0", 257);
	header.write("00", 263);
	header.write(
		`${header
			.reduce((sum, b) => sum + b, 0)
			.toString(8)
			.padStart(6, "0")}\0 `,
		148,
	);
	return Buffer.concat([
		header,
		bytes,
		Buffer.alloc((512 - (bytes.length % 512)) % 512),
	]);
}
const link = (name, target) => member(name, undefined, "2", target);
const directory = (name) => member(name, undefined, "5");
function pack(file, members) {
	writeFileSync(
		file,
		gzipSync(Buffer.concat([...members, Buffer.alloc(1024)])),
	);
	return file;
}
function paxField(key, value) {
	const record = `${key}=${value}\n`;
	let length = Buffer.byteLength(record) + 2;
	while (length !== Buffer.byteLength(record) + String(length).length + 1)
		length = Buffer.byteLength(record) + String(length).length + 1;
	return member("PaxHeaders/path", Buffer.from(`${length} ${record}`), "x");
}
const paxPath = (path) => paxField("path", path);
function fixture(fn) {
	const work = mkdtempSync(join(tmpdir(), "factory-archive-path-test-"));
	try {
		fn(work, (members) => pack(join(work, "test.tar.gz"), members));
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

test("member names reject separator aliases before collection, duplicates and link lookup", () =>
	fixture((_work, archive) => {
		for (const name of [
			"source//escape",
			"source/file//",
			"source/./file",
			"source/../file",
			"././source/file",
			"source\\file",
			"/source/file",
			"\ufeffsource/file",
		]) {
			assert.throws(
				() =>
					inspectArchive(archive([link(name, "/outside")]), {
						prefix: "source/",
						collect: ["source/file"],
					}),
				/Unsafe\/duplicate source archive inventory/,
				name,
			);
		}
		assert.throws(
			() =>
				inspectArchive(
					archive([member("source/file"), member("source//file")]),
					{ prefix: "source/" },
				),
			/Unsafe\/duplicate/,
		);
		for (const extension of [
			paxPath("source//escape"),
			member("././@LongLink", Buffer.from("source//escape\0"), "L"),
		])
			assert.throws(
				() =>
					inspectArchive(
						archive([extension, link("source/safe", "/outside")]),
						{
							prefix: "source/",
						},
					),
				/Unsafe\/duplicate/,
			);
		assert.throws(
			() =>
				inspectArchive(
					archive([
						member(Buffer.from([115, 111, 117, 114, 99, 101, 47, 255])),
					]),
					{ prefix: "source/" },
				),
			/encoded data.*valid|encoding/i,
		);
		for (const path of [
			`source/${"a".repeat(256)}`,
			`source/${Array(30).fill("a".repeat(150)).join("/")}`,
		])
			assert.throws(
				() =>
					inspectArchive(archive([paxPath(path), member("source/file")]), {
						prefix: "source/",
					}),
				/Unsafe\/duplicate/,
			);
	}));

test("one GNU root prefix is canonicalized for controls and duplicate detection", () =>
	fixture((_work, archive) => {
		const result = inspectArchive(
			archive([
				directory("./"),
				directory("./source/"),
				member("./source/file", Buffer.from("exact control bytes")),
			]),
			{ prefix: "source/", collect: ["source/file"] },
		);
		assert.equal(result.texts["source/file"], "exact control bytes");
		assert.deepEqual(
			result.entries.map((e) => e.name),
			["source/", "source/file"],
		);
		assert.throws(
			() =>
				inspectArchive(
					archive([member("source/file"), member("./source/file")]),
					{ prefix: "source/" },
				),
			/Unsafe\/duplicate/,
		);
		assert.throws(
			() =>
				inspectArchive(archive([member("source/FILE")]), {
					prefix: "source/",
					collect: ["source/file"],
				}),
			/Ambiguous filesystem alias for archive control/,
		);
		const unicode = inspectArchive(
			archive([
				member("source/新建文件夹/file", Buffer.from("safe")),
				member("source/é", Buffer.from("safe")),
				link("source/alias", "é"),
			]),
			{ prefix: "source/" },
		);
		assert.equal(unicode.entries.length, 3);
	}));

test("portable aliases cover Unicode, implicit prefixes and directory/file collisions on every host", () =>
	fixture((_work, archive) => {
		for (const [first, second] of [
			["source/File", "source/file"],
			["source/é", "source/e\u0301"],
			["source/Σ", "source/ς"],
			["source/ẞ", "source/ss"],
			["source/Dir/a", "source/dir/b"],
			["source/É/a", "source/e\u0301/b"],
		])
			assert.throws(
				() =>
					inspectArchive(archive([member(first), member(second)]), {
						prefix: "source/",
					}),
				/Ambiguous filesystem alias/,
			);
		for (const members of [
			[member("source/Dir"), member("source/dir/file")],
			[member("source/dir/file"), member("source/Dir")],
			[member("source/dir"), member("source/dir/file")],
			[member("source/dir/file"), member("source/dir")],
			[link("source/Dir", "inside"), member("source/dir/file")],
		])
			assert.throws(
				() => inspectArchive(archive(members), { prefix: "source/" }),
				/directory\/file collision/,
			);
		for (const [name, target] of [
			["L", "l"],
			["É", "e\u0301"],
			["Σ", "ς"],
			["ẞ", "ss"],
		])
			assert.throws(
				() =>
					inspectArchive(
						archive([
							directory("source/C/"),
							link(`source/A/B/${name}`, "../../C"),
							link("source/A/B/X", `${target}/../../sentinel`),
						]),
						{ prefix: "source/" },
					),
				/Ambiguous filesystem alias in link target/,
			);
		assert.throws(
			() =>
				inspectArchive(
					archive([
						directory("source/C/"),
						link("source/A/B/L", "../../C"),
						link("source/A/B/X", "../b/L/../../sentinel"),
					]),
					{ prefix: "source/" },
				),
			/Ambiguous filesystem alias in link target/,
		);
		for (const extension of [
			paxField("linkpath", "l/../../sentinel"),
			member("././@LongLink", Buffer.from("l/../../sentinel\0"), "K"),
		])
			assert.throws(
				() =>
					inspectArchive(
						archive([
							directory("source/C/"),
							link("source/A/B/L", "../../C"),
							extension,
							link("source/A/B/X", "safe"),
						]),
						{ prefix: "source/" },
					),
				/Ambiguous filesystem alias in link target/,
			);
		// Hardlinks remain unsupported, including alias-target hardlinks.
		assert.throws(
			() =>
				inspectArchive(
					archive([
						member("source/File"),
						member("source/link", undefined, "1", "source/file"),
					]),
					{ prefix: "source/" },
				),
			/links\/special files/,
		);
		for (const name of ["source/a\u200db", "source/a\u0001b"])
			assert.throws(
				() => inspectArchive(archive([member(name)]), { prefix: "source/" }),
				/Unsafe\/duplicate/,
			);
	}));

test("actual case and Unicode alias sentinel reads are rejected on macOS", (t) =>
	fixture((work, archive) => {
		mkdirSync(join(work, "caseProbe"));
		if (!existsSync(join(work, "CASEPROBE"))) {
			t.skip(
				"Actual read requires a case-insensitive filesystem; portable rejection is tested on every host",
			);
			return;
		}
		for (const [name, target] of [
			["L", "l"],
			["É", "e\u0301"],
		]) {
			const base = join(work, name);
			mkdirSync(join(base, "source/A/B"), { recursive: true });
			mkdirSync(join(base, "source/C"));
			writeFileSync(join(base, "sentinel"), "outside archive bytes");
			symlinkSync("../../C", join(base, `source/A/B/${name}`));
			symlinkSync(`${target}/../../sentinel`, join(base, "source/A/B/X"));
			assert.equal(
				readFileSync(join(base, "source/A/B/X"), "utf8"),
				"outside archive bytes",
			);
			assert.throws(
				() =>
					inspectArchive(
						archive([
							directory("source/C/"),
							link(`source/A/B/${name}`, "../../C"),
							link("source/A/B/X", `${target}/../../sentinel`),
						]),
						{ prefix: "source/" },
					),
				/Ambiguous filesystem alias in link target/,
			);
			assert.equal(
				readFileSync(join(base, "sentinel"), "utf8"),
				"outside archive bytes",
			);
		}
	}));

test("full candidate-bound source intake rejects hash-valid nested case, Unicode and separator alias escapes", () =>
	fixture((work) => {
		const candidate = freezeCandidate({
			channel: "nightly",
			commit: "a".repeat(40),
			workflowSha: "b".repeat(40),
			committedVersion: "1.0.0",
			sequence: 43,
			date: "2026-10-10T00:00:00Z",
		});
		const identity = candidateIdentity(candidate);
		const stage = join(work, "source-rebuild");
		const manifest = sourceMaterialFixture(stage, identity);
		for (const [file, bytes] of Object.entries({
			"candidate.json": jsonBytes(candidate),
			"commit.txt": identity.commit,
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
		const outer = () => {
			writeFileSync(join(stage, "source-materials.json"), jsonBytes(manifest));
			return pack(
				join(work, "outer.tar.gz"),
				readdirSync(stage).map((f) =>
					member(`source-rebuild/${f}`, readFileSync(join(stage, f))),
				),
			);
		};
		validateSourceArchive(outer(), identity);
		const prefix = `WebKit-${RUNTIME_SOURCES.webkit.revision}/`;
		for (const attack of [
			[
				link(`${prefix}A/B/L`, "../../C"),
				link(`${prefix}A/B/X`, "l/../../sentinel"),
			],
			[
				link(`${prefix}A/B/É`, "../../C"),
				link(`${prefix}A/B/X`, "e\u0301/../../sentinel"),
			],
			[link(`${prefix}/escape`, "/outside")],
		]) {
			pack(join(stage, "webkit-source.tar.gz"), [
				...[
					"Source/JavaScriptCore/CMakeLists.txt",
					"Source/WTF/CMakeLists.txt",
					"Source/JavaScriptCore/COPYING.LIB",
				].map((f) => member(prefix + f, Buffer.from("controlled fixture"))),
				directory(`${prefix}C/`),
				...attack,
			]);
			Object.assign(
				manifest.records.find((r) => r.kind === "webkit"),
				fileRecord(join(stage, "webkit-source.tar.gz"), "webkit-source.tar.gz"),
			);
			assert.throws(
				() => validateSourceArchive(outer(), identity),
				/Ambiguous filesystem alias in link target|Unsafe\/duplicate/,
			);
		}
	}));

test("full legacy intake rejects aliased new controls and preserves genuine historical bytes", () => {
	const f = preparedFixture("beta", { legacy: true });
	try {
		const immutable = new Map(
			readdirSync(f.assets).map((file) => [
				file,
				readFileSync(join(f.assets, file)),
			]),
		);
		validatePreparedRelease(f.assets, undefined, { legacyBeta: true });
		for (const [file, bytes] of immutable)
			assert.deepEqual(readFileSync(join(f.assets, file)), bytes);
		const stage = join(f.work, "source-rebuild");
		const genuine = readdirSync(stage).map((file) =>
			member(`source-rebuild/${file}`, readFileSync(join(stage, file))),
		);
		for (const control of [
			member(
				"source-rebuild//source-materials.json",
				jsonBytes({ schemaVersion: 2, candidateDigest: f.candidate.digest }),
			),
			member("source-rebuild//candidate.json", jsonBytes(f.candidate)),
			member("source-rebuild/CANDIDATE.JSON", jsonBytes(f.candidate)),
			paxPath("source-rebuild//candidate.json"),
			member("./source-rebuild/candidate.json", jsonBytes(f.candidate)),
		]) {
			const members = [...genuine, control];
			// A PAX override applies to a following real member.
			if (control[156] === 120)
				members.push(member("source-rebuild/safe", jsonBytes(f.candidate)));
			const source = pack(join(f.assets, "source-rebuild.tar.gz"), members);
			const record = fileRecord(source, "source-rebuild.tar.gz");
			const manifest = { ...f.manifest, source: record };
			const evidence = {
				...JSON.parse(immutable.get("release-evidence.json")),
				source: record,
			};
			writeFileSync(join(f.assets, "release.json"), jsonBytes(manifest));
			writeFileSync(
				join(f.assets, "release-evidence.json"),
				jsonBytes(evidence),
			);
			assert.throws(
				() =>
					validatePreparedRelease(f.assets, undefined, { legacyBeta: true }),
				/Unsafe\/duplicate|New candidate inputs at legacy boundary|Ambiguous filesystem alias for archive control/,
			);
		}
		for (const [file, bytes] of immutable)
			writeFileSync(join(f.assets, file), bytes);
		validatePreparedRelease(f.assets, undefined, { legacyBeta: true });
		for (const [file, bytes] of immutable)
			assert.deepEqual(readFileSync(join(f.assets, file)), bytes);
	} finally {
		f.cleanup();
	}
});
