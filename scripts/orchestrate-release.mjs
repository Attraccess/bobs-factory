#!/usr/bin/env node
// Repository-wide workflow lock covers preparation and publication. Separate native
// build/evidence workflows retain their own candidate locks and read-only scopes.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	jsonBytes,
	requireValue,
	validateIdentity,
} from "./lib/binary-release.mjs";
import {
	nightlyEligibility,
	validateCandidateMetadata,
} from "./lib/release-channels.mjs";
import { discoverChannels, githubClient } from "./lib/release-discovery.mjs";

const { values } = parseArgs({
	options: {
		channel: { type: "string", default: "nightly" },
		nightly: { type: "string" },
		version: { type: "string" },
		output: { type: "string" },
		activate: { type: "boolean", default: false },
	},
});
requireValue(values.output, "Provide --output DIRECTORY");
requireValue(
	!values.activate || process.env.BOBS_FACTORY_RELEASE_AUTOMATION === "enabled",
	"Release automation remains disabled pending rollout approval",
);
const output = resolve(values.output);
mkdirSync(output, { recursive: true });
const { api } = githubClient();
const channels = await discoverChannels(api);
const source = (await api("git/ref/heads/main")).object.sha; // Capture main once.
if (values.channel === "nightly") {
	const eligibility = nightlyEligibility(source, channels.nightly);
	if (!eligibility.eligible) {
		console.log(JSON.stringify(eligibility));
		process.exit(0);
	}
}
// Reservations are permanent immutable candidate branches, including failed builds.
// Reuse the same candidate identity when a build or evidence collection is retried.
const refs = await api("git/matching-refs/heads/release-candidates/", {
	paginate: true,
});
let maxSequence = channels.nightly?.manifest.nightlySequence ?? 0;
let candidate;
for (const ref of refs) {
	const match =
		/^refs\/heads\/release-candidates\/nightly\/([1-9][0-9]*)$/.exec(ref.ref);
	if (match) maxSequence = Math.max(maxSequence, Number(match[1]));
	if (!ref.ref.startsWith(`refs/heads/release-candidates/${values.channel}/`))
		continue;
	const content = await api(
		`contents/apps/cli/package.json?ref=${ref.object.sha}`,
	);
	const pkg = JSON.parse(
		Buffer.from(content.content, "base64").toString("utf8"),
	);
	const metadata = validateCandidateMetadata(
		pkg.bobsFactoryRelease,
		pkg.version,
	);
	if (
		(values.channel === "nightly" &&
			metadata.originatingSourceSha === source) ||
		(values.channel === "stable" &&
			metadata.promotedFrom.tag === values.nightly &&
			pkg.version === values.version)
	) {
		requireValue(
			!candidate,
			"Ambiguous reserved candidate for this source/version",
		);
		candidate = {
			...metadata,
			version: pkg.version,
			commit: ref.object.sha,
			ref: ref.ref.slice("refs/heads/".length),
		};
	}
}
if (!candidate) {
	const args = [
		"scripts/prepare-release-candidate.mjs",
		"--channel",
		values.channel,
		"--output",
		join(output, "prepared"),
	];
	if (values.channel === "nightly")
		args.push("--source", source, "--sequence", String(maxSequence + 1));
	else
		args.push(
			"--nightly",
			values.nightly ?? "",
			"--version",
			values.version ?? "",
		);
	if (values.activate) args.push("--activate");
	execFileSync(process.execPath, args, { stdio: "inherit" });
	candidate = JSON.parse(
		readFileSync(join(output, "prepared/candidate.json"), "utf8"),
	);
}
writeFileSync(join(output, "candidate.json"), jsonBytes(candidate));
if (!values.activate) {
	console.log(
		"Read-only preparation complete. No remote ref, build dispatch or release write.",
	);
	process.exit(0);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function workflowRuns(workflow) {
	const runs = [];
	for (let page = 1; page <= 10; page++) {
		const response = await api(
			`actions/workflows/${workflow}/runs?head_sha=${candidate.commit}&per_page=100&page=${page}`,
		);
		requireValue(
			Array.isArray(response.workflow_runs),
			"Invalid workflow run list",
		);
		runs.push(...response.workflow_runs);
		if (response.workflow_runs.length < 100) return runs;
	}
	throw new Error("Workflow pagination exceeded; refusing incomplete evidence");
}
const runs = await workflowRuns("binary-build.yml");
let build =
	runs.find((run) => run.conclusion === "success") ??
	runs.find((run) => run.status !== "completed");
if (!build) {
	await api("actions/workflows/binary-build.yml/dispatches", {
		method: "POST",
		body: {
			ref: candidate.ref,
			inputs: {
				candidate_sha: candidate.commit,
				version: candidate.version,
				dry_run: "true",
			},
		},
	});
}
const deadline = Date.now() + 45 * 60 * 1000;
while (!build || build.status !== "completed") {
	requireValue(
		Date.now() < deadline,
		"Native build deadline exceeded; retry the reserved candidate",
	);
	await sleep(15000);
	build =
		(await workflowRuns("binary-build.yml")).find(
			(run) => run.status !== "completed" || run.conclusion === "success",
		) ?? (await workflowRuns("binary-build.yml"))[0];
}
requireValue(
	build.conclusion === "success",
	"Native build failed; no publication or discovery changes",
);
validateIdentity(candidate.version, candidate.commit, build.id);
writeFileSync(join(output, "build.json"), jsonBytes(build));
const evidenceRuns = (await workflowRuns("release-evidence.yml")).filter(
	(run) => run.conclusion === "success",
);
let evidenceDirectory;
for (const run of evidenceRuns) {
	const artifacts = await api(`actions/runs/${run.id}/artifacts`);
	for (const artifact of artifacts.artifacts ?? []) {
		if (
			artifact.name !== `bobs-factory-release-evidence-${candidate.commit}` ||
			artifact.expired
		)
			continue;
		const directory = join(output, `evidence-${artifact.id}`);
		execFileSync(
			process.execPath,
			[
				"scripts/download-release-evidence.mjs",
				"--sha",
				candidate.commit,
				"--artifact-id",
				String(artifact.id),
				"--output",
				directory,
			],
			{ stdio: "inherit" },
		);
		const evidence = JSON.parse(
			readFileSync(join(directory, "release-evidence.json"), "utf8"),
		);
		if (
			evidence.buildRunId === build.id &&
			evidence.version === candidate.version
		) {
			evidenceDirectory = directory;
			break;
		}
	}
	if (evidenceDirectory) break;
}
requireValue(
	evidenceDirectory,
	`Required reviewed evidence is missing. Import real candidate-bound review, full-payload F1 assessment, migration and license/source receipts using release-evidence.yml for candidate ${candidate.commit}, version ${candidate.version}, build ${build.id}. Retry this reserved candidate after intake; compilation does not satisfy those gates.`,
);
// Execute the frozen candidate tooling, never newer main's installer/publisher.
const worktree = join(output, "publisher");
execFileSync(
	"git",
	["worktree", "add", "--detach", worktree, candidate.commit],
	{ stdio: "inherit" },
);
try {
	execFileSync(
		process.execPath,
		[
			"scripts/publish-binary-release.mjs",
			"--sha",
			candidate.commit,
			"--version",
			candidate.version,
			"--run-id",
			String(build.id),
			"--evidence",
			join(evidenceDirectory, "release-evidence.json"),
			"--output",
			join(output, "publication"),
			"--publish",
		],
		{ cwd: worktree, stdio: "inherit" },
	);
} finally {
	execFileSync("git", ["worktree", "remove", worktree], { stdio: "inherit" });
}
