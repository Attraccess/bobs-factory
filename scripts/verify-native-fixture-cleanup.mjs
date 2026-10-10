// Disposable Linux runner receipt gate; never signals or removes a process.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.platform, "linux");
const [pending, output] = process.argv.slice(2);
assert(pending && output);
const bytes = readFileSync(pending);
const receipt = JSON.parse(bytes);
const roots = readdirSync(tmpdir())
	.filter((name) => name.startsWith("native-shell-"))
	.map((name) => join(tmpdir(), name));
assert(roots.length, "No retained native shell fixture found");
const survivors = () =>
	execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" })
		.split("\n")
		.filter((line) => roots.some((root) => line.includes(`${root}/`)))
		.map((line) => Number(line.trim().split(/\s+/)[0]));
let alive = survivors();
for (let n = 0; alive.length && n < 100; n++) {
	await new Promise((resolve) => setTimeout(resolve, 100));
	alive = survivors();
}
const passed = alive.length === 0 && receipt.status === "passed";
writeFileSync(
	`${output}.pending`,
	`${JSON.stringify(
		{
			...receipt,
			status: passed ? "passed" : "failed",
			cleanup: { passed: alive.length === 0, survivingPids: alive, roots },
			fixtureReceiptSha256: createHash("sha256").update(bytes).digest("hex"),
			cleanupVerifierSha256: createHash("sha256")
				.update(readFileSync(new URL(import.meta.url)))
				.digest("hex"),
		},
		null,
		2,
	)}\n`,
);
renameSync(`${output}.pending`, output);
assert(passed, "Native fixture result or owned-process cleanup failed");
