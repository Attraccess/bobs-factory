// Local TEST ONLY candidates. This never signs, publishes, dispatches CI, or
// produces passed native/release receipts. Use a clean isolated combined tree.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { freezeCandidate } from "./lib/release-candidate.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [outputArg] = process.argv.slice(2);
assert(
	outputArg,
	"Usage: node scripts/prepare-signed-delivery-fixture.mjs EMPTY_OUTPUT",
);
const output = resolve(outputArg);
assert.equal(
	execFileSync("git", ["status", "--porcelain"], {
		cwd: root,
		encoding: "utf8",
	}).trim(),
	"",
	"Native fixture builds require clean frozen source/tooling",
);
mkdirSync(output, { recursive: false });
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
	cwd: root,
	encoding: "utf8",
}).trim();
const committedVersion = JSON.parse(
	readFileSync(join(root, "apps/cli/package.json")),
).version;
const core = committedVersion.split("-")[0];
const parts = core.split(".").map(Number);
parts[2]++;
const selections = [
	...[1101, 1102, 1103].map((sequence) => [
		String(sequence),
		freezeCandidate({
			channel: "nightly",
			commit,
			workflowSha: commit,
			committedVersion,
			sequence,
			date: "2026-10-10T18:00:00Z",
		}),
	]),
	...[
		["stable", core],
		["stable2", parts.join(".")],
	].map(([name, version]) => [
		name,
		freezeCandidate({
			channel: "stable",
			version,
			commit,
			workflowSha: commit,
			committedVersion,
			promotion: {
				channel: "nightly",
				version: `${core}-nightly.20261010.1101`,
				tag: `v${core}-nightly.20261010.1101`,
				commit,
				manifestSha256: "0".repeat(64),
				releaseId: 1101,
			},
		}),
	]),
	[
		"beta",
		freezeCandidate({
			channel: "beta",
			version: `${core}-beta`,
			commit,
			workflowSha: commit,
			committedVersion,
		}),
	],
];
execFileSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
for (const [name, frozen] of selections) {
	const candidate = join(output, `candidate-${name}.json`);
	writeFileSync(candidate, `${JSON.stringify(frozen, null, 2)}\n`);
	execFileSync(
		"npm",
		[
			"exec",
			"--yes",
			"--package=bun@1.4.2",
			"--",
			"bun",
			"scripts/build-binary.ts",
			"--candidate",
			candidate,
			"--release-version",
			frozen.candidate.version,
			"--target",
			`${process.platform}-${process.arch}`,
			"--output",
			join(output, `build-${name}`),
		],
		{ cwd: root, stdio: "inherit" },
	);
}
console.log(`TEST ONLY native fixtures frozen at ${commit} in ${output}`);
