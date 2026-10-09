#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { jsonBytes, requireValue } from "./lib/binary-release.mjs";
import {
	discoverReleases,
	githubClient,
	requireVerifiedNightlyHistory,
} from "./lib/github-release.mjs";
import {
	freezeCandidate,
	nightlyEligibility,
	validateCandidate,
} from "./lib/release-candidate.mjs";

const { values } = parseArgs({
	options: {
		channel: { type: "string" },
		version: { type: "string" },
		output: { type: "string" },
		"workflow-sha": { type: "string" },
		sequence: { type: "string" },
		date: { type: "string" },
	},
});
requireValue(
	["stable", "nightly"].includes(values.channel) && values.output,
	"Provide --channel stable|nightly --output FILE",
);
if (existsSync(values.output)) {
	const retained = validateCandidate(JSON.parse(readFileSync(values.output)));
	requireValue(
		retained.candidate.channel === values.channel &&
			retained.candidate.workflowSha === values["workflow-sha"] &&
			(values.channel !== "stable" ||
				retained.candidate.version === values.version),
		"Retry inputs differ from retained candidate",
	);
	console.log("Retained frozen candidate; no identity regenerated");
	process.exit(0);
}
const client = githubClient();
const state = await discoverReleases(client);
const mainSha = (await client.api("git/ref/heads/main")).object.sha;
let commit = mainSha;
let promotion;
if (values.channel === "stable") {
	requireValue(
		state.nightly,
		"Stable promotion blocked: no complete signed published nightly",
	);
	const n = state.nightly;
	commit = n.manifest.commit;
	promotion = {
		channel: "nightly",
		version: n.manifest.version,
		tag: n.manifest.tag,
		commit,
		manifestSha256: n.manifestSha256,
		releaseId: n.release.id,
		publishedAt: n.release.published_at,
	};
} else {
	const last = requireVerifiedNightlyHistory(state);
	const relation =
		last && commit !== last.manifest.commit
			? await client.api(`compare/${last.manifest.commit}...${commit}`)
			: null;
	const result = nightlyEligibility({
		mainSha,
		last: last
			? { commit: last.manifest.commit, publishedAt: last.release.published_at }
			: null,
		isDescendant: relation?.status === "ahead",
		now: Date.now(),
	});
	console.log(JSON.stringify(result));
	if (result.status !== "eligible")
		process.exit(result.status === "blocked" ? 1 : 0);
	requireValue(
		Number(values.sequence) >
			Number(last?.manifest.version.split(".").at(-1) ?? 0),
		"Nightly sequence must advance across core versions",
	);
}
const pkg = await client.api(`contents/apps/cli/package.json?ref=${commit}`);
const committedVersion = JSON.parse(Buffer.from(pkg.content, "base64")).version;
const record = freezeCandidate({
	channel: values.channel,
	version: values.version,
	commit,
	workflowSha: values["workflow-sha"],
	committedVersion,
	sequence: Number(values.sequence),
	date: values.date,
	promotion,
});
requireValue(
	execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() ===
		record.candidate.workflowSha,
	"Run from exact reviewed release tooling",
);
writeFileSync(values.output, jsonBytes(record), { flag: "wx" });
console.log(`Frozen ${record.candidate.version}: ${record.digest}`);
