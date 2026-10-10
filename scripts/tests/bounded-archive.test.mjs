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
import { fileRecord } from "../lib/binary-release.mjs";
import { inspectArchive } from "../lib/bounded-archive.mjs";
import {
	extractEvidenceArchive,
	RUNTIME_SOURCES,
	validateSourceArchive,
	validateSourceMaterials,
} from "../lib/release-material.mjs";
import { sourceMaterialFixture } from "./source-material-fixture.mjs";

// Independent USTAR fixtures, including hostile headers and real compressed data.
function tarMember(
	name,
	bytes = Buffer.alloc(0),
	{ type = "0", link = "", size = bytes.length } = {},
) {
	const header = Buffer.alloc(512);
	header.write(name, 0, 100);
	header.write("0000644\0", 100);
	header.write("0000000\0", 108);
	header.write("0000000\0", 116);
	header.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
	header.write("00000000000\0", 136);
	header.fill(32, 148, 156);
	header.write(type, 156);
	header.write(link, 157, 100);
	header.write("ustar\0", 257);
	header.write("00", 263);
	const checksum = header.reduce((sum, byte) => sum + byte, 0);
	header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
	return Buffer.concat([
		header,
		bytes,
		Buffer.alloc((512 - (bytes.length % 512)) % 512),
	]);
}
const packed = (members) =>
	gzipSync(Buffer.concat([...members, Buffer.alloc(1024)]));
function fixture(fn) {
	const work = mkdtempSync(join(tmpdir(), "factory-bounded-archive-test-"));
	try {
		fn(work, (members, name = "source.tar.gz") => {
			const file = join(work, name);
			writeFileSync(file, packed(members));
			return file;
		});
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

test("nested links resolve intermediate symlinks before parent traversal, reject cycles, and accept framework chains", () =>
	fixture((work, archive) => {
		const link = (name, target) =>
			tarMember(name, undefined, { type: "2", link: target });
		mkdirSync(join(work, "source/A/B"), { recursive: true });
		mkdirSync(join(work, "source/C"));
		writeFileSync(join(work, "sentinel"), "actual outside bytes");
		symlinkSync("../../C", join(work, "source/A/B/L"));
		symlinkSync("L/../../sentinel", join(work, "source/A/B/X"));
		assert.equal(
			readFileSync(join(work, "source/A/B/X"), "utf8"),
			"actual outside bytes",
		);
		const escaping = archive([
			tarMember("source/C/", undefined, { type: "5" }),
			link("source/A/B/L", "../../C"),
			link("source/A/B/X", "L/../../sentinel"),
		]);
		assert.throws(
			() => inspectArchive(escaping, { prefix: "source/" }),
			/external link targets/,
		);
		const cycle = archive([link("source/A", "B"), link("source/B", "A")]);
		assert.throws(
			() => inspectArchive(cycle, { prefix: "source/" }),
			/symlink cycle/,
		);
		const safe = archive([
			tarMember(
				"source/Framework/Versions/A/Resources/data",
				Buffer.from("safe"),
			),
			link("source/Framework/Versions/Current", "A"),
			link("source/Framework/Resources", "Versions/Current/Resources"),
		]);
		assert.equal(inspectArchive(safe, { prefix: "source/" }).entries.length, 3);
		// Outer material bundles reject links even when the target would stay inside.
		assert.throws(
			() =>
				validateSourceArchive(
					archive([link("source-rebuild/link", "candidate.json")]),
					{},
				),
			/links\/special files/,
		);
	}));

test("compressed bomb is stopped during decompression without extracting any payload", () =>
	fixture((work, archive) => {
		const bomb = archive([
			tarMember("release-evidence/release-evidence.json", Buffer.from("{}")),
			tarMember(
				"release-evidence/source-rebuild.tar.gz",
				Buffer.alloc(32 * 1024 ** 2),
			),
		]);
		const output = join(work, "output");
		const before = readdirSync(tmpdir()).filter((n) =>
			n.startsWith("factory-evidence-intake-"),
		);
		const start = Date.now();
		assert.throws(
			() =>
				extractEvidenceArchive(bomb, output, {
					limits: { maxExpandedBytes: 1024 ** 2 },
				}),
			(error) => {
				assert.match(error.message, /expanded byte limit/);
				const bytes = Number(/expandedBytes=(\d+)/.exec(error.message)[1]);
				assert(bytes <= 1024 ** 2 + 64 * 1024);
				assert.match(error.message, /writtenBytes=0/);
				return true;
			},
		);
		assert(Date.now() - start < 5_000);
		assert(!existsSync(output));
		assert.deepEqual(
			readdirSync(tmpdir()).filter((n) =>
				n.startsWith("factory-evidence-intake-"),
			),
			before,
		);
	}));

test("member/header/control limits reject before oversized payloads are materialized", () =>
	fixture((_work, archive) => {
		const oversized = archive([
			tarMember("source-rebuild/payload", undefined, { size: 8 * 1024 ** 2 }),
		]);
		assert.throws(
			() =>
				validateSourceArchive(
					oversized,
					{},
					{ limits: { maxMemberBytes: 1024 } },
				),
			/member byte limit.*writtenBytes=0/,
		);
		const hugeControl = archive([
			tarMember("source-rebuild/candidate.json", Buffer.alloc(2 * 1024 ** 2)),
		]);
		assert.throws(
			() => validateSourceArchive(hugeControl, {}),
			/control file byte limit.*writtenBytes=0/,
		);
		const evidenceControl = archive([
			tarMember(
				"release-evidence/release-evidence.json",
				Buffer.alloc(2 * 1024 ** 2),
			),
			tarMember(
				"release-evidence/source-rebuild.tar.gz",
				Buffer.from("fixture"),
			),
		]);
		assert.throws(
			() => extractEvidenceArchive(evidenceControl, "unused-output"),
			/control file byte limit.*writtenBytes=0/,
		);
		const many = archive(
			Array.from({ length: 50 }, (_, i) => tarMember(`source/file-${i}`)),
		);
		assert.throws(
			() =>
				inspectArchive(many, { prefix: "source/", limits: { maxMembers: 10 } }),
			/member count limit.*writtenBytes=0/,
		);
		assert.throws(
			() =>
				inspectArchive(many, {
					prefix: "source/",
					limits: { maxCompressedBytes: 1 },
				}),
			/compressed byte limit/,
		);
	}));

test("unknown outer payload and wrong candidate never reach an extraction directory", () =>
	fixture((_work, archive) => {
		const before = readdirSync(tmpdir()).filter((n) =>
			n.startsWith("factory-source-intake-"),
		);
		const malformed = archive([
			tarMember("source-rebuild/candidate.json", Buffer.from("{}")),
			tarMember("source-rebuild/payload", Buffer.alloc(32 * 1024 ** 2)),
		]);
		assert.throws(() => validateSourceArchive(malformed, {}), /candidate/i);
		assert.deepEqual(
			readdirSync(tmpdir()).filter((n) =>
				n.startsWith("factory-source-intake-"),
			),
			before,
		);
	}));

test("owned intake worker has an enforced deadline and leaves no partial output", () =>
	fixture((work, archive) => {
		const file = archive([
			tarMember("release-evidence/release-evidence.json", Buffer.from("{}")),
			tarMember(
				"release-evidence/source-rebuild.tar.gz",
				Buffer.alloc(32 * 1024 ** 2),
			),
		]);
		const output = join(work, "timeout-output");
		const start = Date.now();
		assert.throws(
			() => extractEvidenceArchive(file, output, { limits: { timeoutMs: 1 } }),
			/Archive intake timeout/,
		);
		assert(Date.now() - start < 5_000);
		assert(!existsSync(output));
	}));

test("nested inspection bounds concatenated gzip streams and accepts bounded normal bytes", () =>
	fixture((work, archive) => {
		const first = packed([tarMember("source/file", Buffer.from("normal"))]);
		const file = join(work, "multistream.gz");
		writeFileSync(
			file,
			Buffer.concat([first, gzipSync(Buffer.alloc(32 * 1024 ** 2))]),
		);
		assert.throws(
			() =>
				inspectArchive(file, {
					prefix: "source/",
					limits: { maxExpandedBytes: 1024 ** 2 },
				}),
			/expanded byte limit/,
		);
		const normal = archive([tarMember("source/file", Buffer.from("normal"))]);
		assert.equal(
			inspectArchive(normal, { prefix: "source/", collect: ["source/file"] })
				.texts["source/file"],
			"normal",
		);
		// A nonzero tar hidden in a second gzip stream cannot bypass the inventory.
		writeFileSync(
			file,
			Buffer.concat([
				first,
				packed([tarMember("source/hidden", Buffer.from("unknown"))]),
			]),
		);
		assert.throws(
			() => inspectArchive(file, { prefix: "source/" }),
			/Trailing\/concatenated tar data/,
		);
	}));

test("semantic runtime source inspection enforces decompression limits on hash-valid nested bytes", () =>
	fixture((work, archive) => {
		const identity = {
			commit: "a".repeat(40),
			workflowSha: "b".repeat(40),
			candidateDigest: "c".repeat(64),
			version: "1.0.0-beta",
		};
		const directory = join(work, "materials");
		const materials = sourceMaterialFixture(directory, identity);
		const prefix = `bun-${RUNTIME_SOURCES.bun.revision}/`;
		const bomb = archive([
			tarMember(`${prefix}payload`, Buffer.alloc(32 * 1024 ** 2)),
		]);
		const bytes = readFileSync(bomb);
		writeFileSync(join(directory, "bun-source.tar.gz"), bytes);
		Object.assign(
			materials.records.find((r) => r.kind === "bun"),
			fileRecord(join(directory, "bun-source.tar.gz"), "bun-source.tar.gz"),
		);
		assert.throws(
			() =>
				validateSourceMaterials(materials, directory, identity, {
					limits: { maxExpandedBytes: 1024 ** 2 },
				}),
			/expanded byte limit.*writtenBytes=0/,
		);
	}));
