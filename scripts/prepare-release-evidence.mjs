#!/usr/bin/env node
// Imports real reviewed receipts; it never generates passed/waived gate records.
import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	jsonBytes,
	REPOSITORY,
	requireValue,
	validateBuildProvenance,
	validateEvidence,
	validateIdentity,
} from "./lib/binary-release.mjs";
import {
	extractEvidenceArchive,
	sourceFileSha256,
} from "./lib/release-material.mjs";

const { values } = parseArgs({
	options: {
		sha: { type: "string" },
		version: { type: "string" },
		"run-id": { type: "string" },
		url: { type: "string" },
		sha256: { type: "string" },
		archive: { type: "string" },
		output: { type: "string" },
	},
});
const identity = {
	commit: values.sha,
	version: values.version,
	runId: Number(values["run-id"]),
};
validateIdentity(identity.version, identity.commit, identity.runId);
requireValue(
	values.output &&
		/^[a-f0-9]{64}$/.test(values.sha256) &&
		Boolean(values.url) !== Boolean(values.archive),
	"Provide --output EMPTY_DIRECTORY --sha256 HASH and exactly one of --url HTTPS_URL or --archive FILE",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
requireValue(
	execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim() === identity.commit,
	"Evidence workflow must execute exact candidate source",
);
requireValue(
	JSON.parse(
		execFileSync("git", ["show", `${identity.commit}:apps/cli/package.json`], {
			cwd: root,
			encoding: "utf8",
		}),
	).version === identity.version,
	"Exact release version must be committed at candidate",
);
const output = resolve(values.output);
requireValue(
	!existsSync(output) || readdirSync(output).length === 0,
	"Evidence output must be empty",
);
const headers = {
	Accept: "application/vnd.github+json",
	"X-GitHub-Api-Version": "2022-11-28",
	...(process.env.GH_TOKEN
		? { Authorization: `Bearer ${process.env.GH_TOKEN}` }
		: {}),
};
async function api(path) {
	const response = await fetch(
		`https://api.github.com/repos/${REPOSITORY}/${path}`,
		{ headers },
	);
	requireValue(
		response.ok,
		`Evidence build provenance retrieval failed (${response.status})`,
	);
	return response.json();
}
async function pages(path, key) {
	const result = [];
	for (let page = 1; page <= 10; page++) {
		const batch = (await api(`${path}?per_page=100&page=${page}`))[key];
		requireValue(Array.isArray(batch), `Invalid build ${key}`);
		result.push(...batch);
		if (batch.length < 100) return result;
	}
	throw new Error("Incomplete build provenance; pagination limit exceeded");
}
const [run, jobs, artifacts] = await Promise.all([
	api(`actions/runs/${identity.runId}`),
	pages(`actions/runs/${identity.runId}/jobs`, "jobs"),
	pages(`actions/runs/${identity.runId}/artifacts`, "artifacts"),
]);
validateBuildProvenance(run, jobs, artifacts, identity);
mkdirSync(output, { recursive: true });
const archive = join(output, "incoming-evidence.tar.gz");
if (values.url) {
	const url = new URL(values.url);
	requireValue(
		url.protocol === "https:" && !url.username && !url.password,
		"Evidence URL must use HTTPS without embedded credentials",
	);
	const response = await fetch(url); // No repository token is forwarded to supplied storage.
	requireValue(
		response.ok && new URL(response.url).protocol === "https:",
		"Evidence archive HTTPS download failed",
	);
	requireValue(response.body, "Evidence archive response body is missing");
	await pipeline(
		Readable.fromWeb(response.body),
		createWriteStream(archive, { flags: "wx" }),
	);
} else copyFileSync(resolve(values.archive), archive);
requireValue(
	sourceFileSha256(archive) === values.sha256,
	"Supplied evidence archive SHA-256 mismatch",
);
extractEvidenceArchive(archive, output);
validateEvidence(
	JSON.parse(readFileSync(join(output, "release-evidence.json"), "utf8")),
	output,
	identity,
);
unlinkSync(archive);
writeFileSync(
	join(output, "evidence-intake-provenance.json"),
	jsonBytes({
		schemaVersion: 1,
		product: "bobs-factory",
		...identity,
		inputArchiveSha256: values.sha256,
		workflowRunId: process.env.GITHUB_RUN_ID
			? Number(process.env.GITHUB_RUN_ID)
			: null,
		workflowHeadSha: process.env.GITHUB_SHA ?? null,
		binaryRun: run,
		binaryJobs: jobs,
		binaryArtifacts: artifacts,
	}),
);
console.log(
	`Validated candidate-bound reviewed evidence: ${join(output, "release-evidence.json")}. No gate statuses were generated.`,
);
