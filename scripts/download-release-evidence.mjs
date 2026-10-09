#!/usr/bin/env node
// Maintainer CI transport: downloaded evidence remains subject to publisher checks.
import { execFileSync } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { REPOSITORY, requireValue, sha256 } from "./lib/binary-release.mjs";

const { values } = parseArgs({
	options: {
		sha: { type: "string" },
		"artifact-id": { type: "string" },
		output: { type: "string" },
	},
});
requireValue(
	/^[a-f0-9]{40}$/.test(values.sha),
	"Full immutable candidate SHA required",
);
requireValue(
	/^[0-9]+$/.test(values["artifact-id"]) &&
		values.output &&
		process.env.GH_TOKEN,
	"Evidence artifact ID, fresh output directory and maintainer GH_TOKEN required",
);
const output = resolve(values.output);
requireValue(
	!existsSync(output) || readdirSync(output).length === 0,
	"Evidence output must be empty",
);
const headers = {
	Authorization: `Bearer ${process.env.GH_TOKEN}`,
	Accept: "application/vnd.github+json",
	"X-GitHub-Api-Version": "2022-11-28",
};
const base = `https://api.github.com/repos/${REPOSITORY}/actions/artifacts/${values["artifact-id"]}`;
const metadataResponse = await fetch(base, { headers });
requireValue(
	metadataResponse.ok,
	`Evidence metadata download failed (${metadataResponse.status})`,
);
const artifact = await metadataResponse.json();
requireValue(
	artifact.name === `bobs-factory-release-evidence-${values.sha}` &&
		artifact.workflow_run?.head_sha === values.sha &&
		!artifact.expired &&
		/^sha256:[a-f0-9]{64}$/.test(artifact.digest),
	"Evidence artifact source/name/digest mismatch",
);
const runResponse = await fetch(
	`https://api.github.com/repos/${REPOSITORY}/actions/runs/${artifact.workflow_run.id}`,
	{ headers },
);
requireValue(runResponse.ok, "Evidence workflow provenance unavailable");
const run = await runResponse.json();
requireValue(
	run.repository?.full_name === REPOSITORY &&
		run.head_repository?.full_name === REPOSITORY &&
		run.status === "completed" &&
		run.conclusion === "success",
	"Evidence artifact must come from a successful canonical repository run",
);
const redirect = await fetch(`${base}/zip`, { headers, redirect: "manual" });
requireValue(
	redirect.status === 302,
	`Evidence artifact unavailable (${redirect.status})`,
);
const location = new URL(redirect.headers.get("location"));
requireValue(
	location.protocol === "https:",
	"Evidence download must use HTTPS",
);
const content = await fetch(location);
requireValue(content.ok, "Evidence archive download failed");
const bytes = Buffer.from(await content.arrayBuffer());
requireValue(
	sha256(bytes) === artifact.digest.slice(7),
	"Evidence GitHub artifact digest mismatch",
);
mkdirSync(output, { recursive: true });
const archive = join(output, "evidence.zip");
writeFileSync(archive, bytes);
const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
	.trim()
	.split("\n");
requireValue(
	entries.length === new Set(entries).size &&
		entries.every(
			(file) =>
				/^[A-Za-z0-9_./-]+$/.test(file) &&
				!file.startsWith("/") &&
				!file.split("/").some((part) => part === "." || part === ".."),
		),
	"Unsafe evidence zip inventory",
);
requireValue(
	entries.includes("release-evidence.json") &&
		entries.includes("source-rebuild.tar.gz"),
	"Missing evidence manifest/source material",
);
for (const file of entries) {
	const destination = join(output, file);
	if (file.endsWith("/")) {
		mkdirSync(destination, { recursive: true });
		continue;
	}
	mkdirSync(dirname(destination), { recursive: true });
	const fd = openSync(destination, "wx");
	try {
		execFileSync("unzip", ["-p", archive, file], {
			stdio: ["ignore", fd, "pipe"],
		});
	} finally {
		closeSync(fd);
	}
}
console.log(
	`Retrieved candidate-bound evidence: ${join(output, "release-evidence.json")}`,
);
