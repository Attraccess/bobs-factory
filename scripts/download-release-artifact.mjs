#!/usr/bin/env node
// Authenticated CI transport. Extract regular bytes only; never execute artifact code.
import { execFileSync } from "node:child_process";
import {
	closeSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { jsonBytes, requireValue, sha256File } from "./lib/binary-release.mjs";
import { githubClient } from "./lib/github-release.mjs";
import { validateCandidate } from "./lib/release-candidate.mjs";

const { values } = parseArgs({
	options: {
		"artifact-id": { type: "string" },
		"run-id": { type: "string" },
		kind: { type: "string" },
		output: { type: "string" },
	},
});
requireValue(
	["evidence", "prepared"].includes(values.kind) &&
		values.output &&
		process.env.GH_TOKEN,
	"Provide kind, output and authenticated maintainer token",
);
const client = githubClient();
let id = Number(values["artifact-id"]);
if (values["run-id"]) {
	requireValue(!id, "Choose artifact ID or evidence run ID");
	const artifacts = await client.pages(
		`actions/runs/${Number(values["run-id"])}/artifacts`,
		"artifacts",
	);
	const matches = artifacts.filter((a) =>
		a.name.startsWith("bobs-factory-release-evidence-"),
	);
	requireValue(
		values.kind === "evidence" && matches.length === 1,
		"Missing or ambiguous evidence artifact",
	);
	id = matches[0].id;
}
requireValue(Number.isSafeInteger(id) && id > 0, "Invalid artifact ID");
const artifact = await client.api(`actions/artifacts/${id}`);
requireValue(
	!artifact.expired && /^sha256:[a-f0-9]{64}$/.test(artifact.digest),
	"Expired or unverifiable artifact",
);
const run = await client.api(`actions/runs/${artifact.workflow_run.id}`);
const path =
	values.kind === "evidence"
		? ".github/workflows/release-evidence.yml"
		: ".github/workflows/binary-release.yml";
requireValue(
	run.repository?.full_name === "jappyjan/bobs-factory" &&
		run.head_repository?.full_name === "jappyjan/bobs-factory" &&
		run.path === path &&
		["workflow_dispatch", "workflow_run"].includes(run.event) &&
		run.status === "completed" &&
		(run.conclusion === "success" || values.kind === "prepared"),
	"Artifact producer must be successful canonical release workflow",
);
const output = resolve(values.output);
requireValue(
	!existsSync(output) || readdirSync(output).length === 0,
	"Artifact output must be empty",
);
mkdirSync(output, { recursive: true });
const base = `https://api.github.com/repos/jappyjan/bobs-factory/actions/artifacts/${id}/zip`;
const redirect = await client.transport(base, {
	headers: client.headers,
	redirect: "manual",
});
requireValue(redirect.status === 302, "Artifact transport did not redirect");
const location = new URL(redirect.headers.get("location"));
requireValue(
	location.protocol === "https:",
	"Artifact transport must use HTTPS",
);
const response = await client.transport(location);
requireValue(response.ok && response.body, "Artifact download failed");
const archive = join(output, "incoming.zip");
await pipeline(
	Readable.fromWeb(response.body),
	createWriteStream(archive, { flags: "wx" }),
);
requireValue(
	sha256File(archive) === artifact.digest.slice(7),
	"Artifact digest mismatch",
);
const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
	.trim()
	.split("\n");
requireValue(
	new Set(entries).size === entries.length &&
		entries.every(
			(e) =>
				/^[A-Za-z0-9_./-]+$/.test(e) &&
				!e.startsWith("/") &&
				!e.split("/").some((p) => p === "." || p === "..") &&
				e !== "incoming.zip",
		),
	"Unsafe artifact inventory",
);
for (const entry of entries) {
	const path = join(output, entry);
	if (entry.endsWith("/")) {
		mkdirSync(path, { recursive: true });
		continue;
	}
	mkdirSync(dirname(path), { recursive: true });
	const fd = openSync(path, "wx");
	try {
		execFileSync("unzip", ["-p", archive, entry], {
			stdio: ["ignore", fd, "pipe"],
		});
	} finally {
		closeSync(fd);
	}
}
const candidate = validateCandidate(
	JSON.parse(
		readFileSync(
			join(
				output,
				values.kind === "prepared" ? "assets/candidate.json" : "candidate.json",
			),
		),
	),
);
const nameMatches =
	values.kind === "evidence"
		? artifact.name === `bobs-factory-release-evidence-${candidate.digest}`
		: artifact.name === `bobs-factory-prepared-release-${candidate.digest}` ||
			new RegExp(
				`^bobs-factory-publication-receipt-${candidate.digest}-[1-9][0-9]*$`,
			).test(artifact.name);
requireValue(
	nameMatches &&
		run.head_sha === candidate.candidate.workflowSha &&
		artifact.workflow_run.head_sha === candidate.candidate.workflowSha,
	"Artifact frozen candidate/workflow mismatch",
);
writeFileSync(
	join(output, "artifact-provenance.json"),
	jsonBytes({ artifact, run }),
);
console.log(
	`Retrieved verified transport for ${candidate.digest}; release validation is still required`,
);
