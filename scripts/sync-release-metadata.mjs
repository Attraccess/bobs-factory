#!/usr/bin/env node
// Verify both channels fully before writing the website build's public pointers.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonBytes, REPOSITORY } from "./lib/binary-release.mjs";
import { discoverReleases, githubClient } from "./lib/github-release.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const state = await discoverReleases(githubClient(), undefined, {
	selectedOnly: true,
});
const directory = join(root, "website/public/releases");
const outputs = [];
for (const [channel, name] of [
	["stable", "latest"],
	["stable", "stable"],
	["nightly", "nightly"],
]) {
	const selected = state[channel];
	const pending = jsonBytes({
		schemaVersion: 2,
		product: "bobs-factory",
		repository: REPOSITORY,
		status: "pending",
		message: `No verified ${channel} release is available. Publisher signing and complete validation are required.`,
	});
	outputs.push([`${name}.json`, selected?.bytes ?? pending]);
	if (selected) {
		outputs.push(
			[`${name}.json.sig`, selected.signature],
			[`${name}.json.key-id`, `${selected.keyId}\n`],
		);
	}
}
// The deploy workflow publishes this directory only if the complete website build succeeds.
mkdirSync(directory, { recursive: true });
for (const [file, bytes] of outputs)
	writeFileSync(join(directory, file), bytes);
for (const name of ["latest", "stable", "nightly"])
	if (!outputs.some(([file]) => file === `${name}.json.sig`)) {
		rmSync(join(directory, `${name}.json.sig`), { force: true });
		rmSync(join(directory, `${name}.json.key-id`), { force: true });
	}
copyFileSync(
	join(root, "scripts/install.sh"),
	join(root, "website/public/install.sh"),
);
console.log(
	JSON.stringify({
		stable: state.stable?.manifest.version ?? "unavailable",
		nightly: state.nightly?.manifest.version ?? "unavailable",
		rejected: state.rejected,
	}),
);
