#!/usr/bin/env node
// Packages reviewed materials. This is not a licensing completeness approval.
import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { fileRecord, jsonBytes, requireValue } from "./lib/binary-release.mjs";
import {
	candidateIdentity,
	validateCandidate,
} from "./lib/release-candidate.mjs";
import {
	validateSourceArchive,
	validateSourceMaterials,
} from "./lib/release-material.mjs";

const { values } = parseArgs({
	options: {
		candidate: { type: "string" },
		sha: { type: "string" },
		materials: { type: "string" },
		output: { type: "string" },
	},
});
requireValue(
	/^[a-f0-9]{40}$/.test(values.sha) &&
		values.candidate &&
		values.materials &&
		values.output,
	"Provide --candidate FILE --sha FULL_SHA --materials REVIEWED_DIRECTORY --output EMPTY_DIRECTORY",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = execFileSync("git", ["rev-parse", `${values.sha}^{commit}`], {
	cwd: root,
	encoding: "utf8",
}).trim();
requireValue(sha === values.sha, "Exact candidate commit unavailable");
const materialsDirectory = resolve(values.materials);
const output = resolve(values.output);
requireValue(
	!existsSync(output) || readdirSync(output).length === 0,
	"Source output must be empty; previous material is never overwritten",
);
const candidate = validateCandidate(
	JSON.parse(readFileSync(resolve(values.candidate), "utf8")),
);
requireValue(candidate.candidate.commit === sha, "Source candidate mismatch");
const materials = validateSourceMaterials(
	JSON.parse(
		readFileSync(join(materialsDirectory, "source-materials.json"), "utf8"),
	),
	materialsDirectory,
	candidateIdentity(candidate),
);
requireValue(
	lstatSync(join(materialsDirectory, "README.md")).isFile() &&
		readFileSync(join(materialsDirectory, "README.md"), "utf8").trim().length >
			0,
	"Reviewed precise rebuild/relink instructions are required",
);
const stage = join(output, "source-rebuild");
mkdirSync(stage, { recursive: true });
writeFileSync(join(stage, "candidate.json"), jsonBytes(candidate));
execFileSync(
	"git",
	[
		"archive",
		"--format=tar.gz",
		`--output=${join(stage, "release-tooling.tar.gz")}`,
		candidate.candidate.workflowSha,
	],
	{ cwd: root },
);
writeFileSync(join(stage, "commit.txt"), `${sha}\n`);
writeFileSync(
	join(stage, "pnpm-lock.yaml"),
	execFileSync("git", ["show", `${sha}:pnpm-lock.yaml`], {
		cwd: root,
		maxBuffer: 16 * 1024 * 1024,
	}),
);
execFileSync(
	"git",
	[
		"archive",
		"--format=tar.gz",
		`--output=${join(stage, "factory-source.tar.gz")}`,
		sha,
	],
	{ cwd: root },
);
for (const record of materials.records)
	copyFileSync(join(materialsDirectory, record.file), join(stage, record.file));
materials.bundled = [
	"commit.txt",
	"candidate.json",
	"pnpm-lock.yaml",
	"factory-source.tar.gz",
	"release-tooling.tar.gz",
].map((file) => fileRecord(join(stage, file), file));
writeFileSync(join(stage, "source-materials.json"), jsonBytes(materials));
const archive = join(output, "source-rebuild.tar.gz");
execFileSync("tar", ["-czf", archive, "-C", output, "source-rebuild"], {
	env: { ...process.env, COPYFILE_DISABLE: "1" },
});
validateSourceArchive(archive, candidateIdentity(candidate));
writeFileSync(
	join(output, "source-record.json"),
	jsonBytes(fileRecord(archive, "source-rebuild.tar.gz")),
);
console.log(
	`Packaged reviewed candidate source materials: ${archive}. Licensing completeness remains a separate release evidence gate.`,
);
