import { execFileSync } from "node:child_process";
import { closeSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { requireValue, sha256File } from "./binary-release.mjs";

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

export function validateSourceMaterials(materials, directory, commit) {
	requireValue(
		materials?.schemaVersion === 1 &&
			materials.commit === commit &&
			materials.bunVersion === "1.4.2" &&
			Array.isArray(materials.records),
		"Source material must match exact candidate and pinned Bun runtime",
	);
	const files = new Set();
	for (const record of materials.records) {
		requireValue(
			/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(record.file) &&
				!files.has(record.file) &&
				![
					"commit.txt",
					"README.md",
					"pnpm-lock.yaml",
					"factory-source.tar.gz",
					"source-materials.json",
				].includes(record.file),
			"Unsafe/duplicate source material filename",
		);
		files.add(record.file);
		requireValue(
			typeof record.source === "string" &&
				new URL(record.source).protocol === "https:" &&
				typeof record.revision === "string" &&
				record.revision.trim().length > 0,
			"Every source material requires its HTTPS origin and exact revision",
		);
		requireValue(
			/^[a-f0-9]{64}$/.test(record.sha256) &&
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
	requireValue(
		materials.records.some(
			(record) => record.kind === "bun" && record.file === "bun-source.tar.gz",
		),
		"Pinned Bun source archive is required",
	);
	requireValue(
		materials.records.some((record) => record.kind === "webkit"),
		"Exact patched WebKit/JavaScriptCore source material is required",
	);
	return materials;
}
