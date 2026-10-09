#!/usr/bin/env node
// Local immutable preparation. Remote refs are written only by authorized rollout.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	jsonBytes,
	parseReleaseVersion,
	requireValue,
} from "./lib/binary-release.mjs";
import {
	nightlyEligibility,
	releaseChannel,
	validateCandidateMetadata,
} from "./lib/release-channels.mjs";
import {
	discoverChannels,
	githubClient,
	readPublishedManifest,
} from "./lib/release-discovery.mjs";

const { values } = parseArgs({
	options: {
		channel: { type: "string", default: "nightly" },
		version: { type: "string" },
		nightly: { type: "string" },
		source: { type: "string" },
		sequence: { type: "string" },
		output: { type: "string" },
		activate: { type: "boolean", default: false },
	},
});
requireValue(
	values.output && ["stable", "nightly"].includes(values.channel),
	"Provide --output DIRECTORY and --channel stable|nightly",
);
requireValue(
	!values.activate || process.env.BOBS_FACTORY_RELEASE_AUTOMATION === "enabled",
	"Remote candidate creation is disabled pending separately authorized rollout",
);
const output = resolve(values.output);
mkdirSync(output, { recursive: true });
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const { api } = githubClient();
const channels = await discoverChannels(api);
let source, promotedFrom;
if (values.channel === "stable") {
	requireValue(
		/^v[0-9]+\.[0-9]+\.[0-9]+-nightly\.[1-9][0-9]*$/.test(values.nightly ?? ""),
		"Stable preparation requires --nightly EXACT_PUBLISHED_TAG",
	);
	const selected = await readPublishedManifest(
		await api(`releases/tags/${values.nightly}`),
	);
	requireValue(
		selected.manifest.schemaVersion === 2 &&
			selected.manifest.channel === "nightly",
		"Promotion requires a verified schema-2 published nightly",
	);
	const tag = await api(`git/ref/tags/${values.nightly}`);
	requireValue(
		tag.object?.type === "commit" &&
			tag.object.sha === selected.manifest.commit,
		"Selected nightly tag identity mismatch",
	);
	source = selected.manifest.commit;
	promotedFrom = {
		tag: selected.manifest.tag,
		version: selected.manifest.version,
		commit: source,
		manifestSha256: selected.manifestSha256,
	};
} else source = values.source ?? (await api("git/ref/heads/main")).object.sha;
requireValue(
	/^[a-f0-9]{40}$/.test(source),
	"Frozen source must be a full commit SHA",
);
try {
	git("cat-file", "-e", `${source}^{commit}`);
} catch {
	git("fetch", "origin", source);
	git("cat-file", "-e", `${source}^{commit}`);
}
if (values.activate) {
	const remote = git("remote", "get-url", "origin").toLowerCase();
	requireValue(
		[
			"https://github.com/jappyjan/bobs-factory",
			"https://github.com/jappyjan/bobs-factory.git",
			"git@github.com:jappyjan/bobs-factory.git",
			"git@github.com:jappyjan/bobs-factory",
		].includes(remote),
		"Candidate ref must use the canonical repository origin",
	);
}
const pkg = JSON.parse(git("show", `${source}:apps/cli/package.json`));
const sequence = Number(values.sequence);
if (values.channel === "nightly") {
	const eligibility = nightlyEligibility(source, channels.nightly);
	if (!eligibility.eligible) {
		writeFileSync(join(output, "eligibility.json"), jsonBytes(eligibility));
		console.log(JSON.stringify(eligibility));
		process.exit(0);
	}
	requireValue(
		Number.isSafeInteger(sequence) &&
			sequence > (channels.nightly?.manifest.nightlySequence ?? 0),
		"Reserve a new positive monotonic --sequence before preparing a nightly",
	);
}
const core = parseReleaseVersion(pkg.version)?.core.join(".");
const version =
	values.channel === "nightly" ? `${core}-nightly.${sequence}` : values.version;
requireValue(
	releaseChannel(version) === values.channel,
	"Prepared version does not match requested channel",
);
const metadata = validateCandidateMetadata(
	{
		schemaVersion: 1,
		channel: values.channel,
		originatingSourceSha:
			values.channel === "nightly"
				? source
				: (
						await readPublishedManifest(
							await api(`releases/tags/${values.nightly}`),
						)
					).manifest.originatingSourceSha,
		createdAt: new Date().toISOString(),
		...(promotedFrom ? { promotedFrom } : { nightlySequence: sequence }),
	},
	version,
);
// A dedicated temporary index preserves the working tree and the operator's index.
const index = join(output, "candidate.index");
const env = {
	...process.env,
	GIT_INDEX_FILE: index,
	GIT_AUTHOR_NAME: "Bob’s Factory Release",
	GIT_AUTHOR_EMAIL: "release@bobs-factory.invalid",
	GIT_COMMITTER_NAME: "Bob’s Factory Release",
	GIT_COMMITTER_EMAIL: "release@bobs-factory.invalid",
};
const indexedGit = (args, input) =>
	execFileSync("git", args, { encoding: "utf8", env, input }).trim();
indexedGit(["read-tree", source]);
const bytes = `${JSON.stringify({ ...pkg, version, bobsFactoryRelease: metadata }, null, "\t")}\n`;
const blob = indexedGit(["hash-object", "-w", "--stdin"], bytes);
indexedGit([
	"update-index",
	"--cacheinfo",
	`100644,${blob},apps/cli/package.json`,
]);
const tree = indexedGit(["write-tree"]);
const commit = indexedGit(
	["commit-tree", tree, "-p", source],
	`Prepare ${values.channel} ${version}\n`,
);
const ref = `release-candidates/${values.channel}/${values.channel === "nightly" ? sequence : version}`;
const record = { schemaVersion: 1, version, commit, ref, ...metadata };
writeFileSync(join(output, "candidate.json"), jsonBytes(record));
if (values.activate) git("push", "origin", `${commit}:refs/heads/${ref}`);
console.log(JSON.stringify(record));
