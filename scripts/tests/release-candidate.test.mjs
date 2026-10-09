import assert from "node:assert/strict";
import test from "node:test";
import {
	compareReleaseVersions,
	REPOSITORY,
	selectPublicRelease,
	TARGETS,
	validateBuildProvenance,
} from "../lib/binary-release.mjs";
import {
	candidateIdentity,
	freezeCandidate,
	nightlyEligibility,
	validateCandidate,
} from "../lib/release-candidate.mjs";

const commit = "a".repeat(40),
	workflowSha = "b".repeat(40);
const args = {
	channel: "nightly",
	commit,
	workflowSha,
	committedVersion: "1.0.0-beta",
	sequence: 10,
	date: "2026-10-09T00:00:00Z",
};

test("candidate digest freezes version, recipe and promotion source across retries", () => {
	const nightly = freezeCandidate(args);
	assert.equal(nightly.candidate.version, "1.0.0-nightly.20261009.10");
	assert.deepEqual(
		validateCandidate(JSON.parse(JSON.stringify(nightly))),
		nightly,
	);
	const promotion = {
		channel: "nightly",
		commit,
		version: nightly.candidate.version,
		tag: nightly.candidate.tag,
		manifestSha256: "c".repeat(64),
		releaseId: 4,
	};
	const stable = freezeCandidate({
		...args,
		channel: "stable",
		version: "1.0.0",
		promotion,
	});
	assert.equal(stable.candidate.commit, commit);
	assert.notEqual(stable.digest, nightly.digest);
	for (const change of [
		{ commit: "c".repeat(40) },
		{ workflowSha: commit },
		{ version: "1.0.1" },
		{ recipe: { ...stable.candidate.recipe, versionOverride: "1.0.1" } },
	])
		assert.throws(() =>
			validateCandidate({
				...stable,
				candidate: { ...stable.candidate, ...change },
			}),
		);
	assert.throws(
		() => freezeCandidate({ ...args, channel: "stable", version: "1.0.0" }),
		/verified published nightly/,
	);
	assert.throws(
		() => freezeCandidate({ ...args, date: "2026-02-31T00:00:00Z" }),
		/UTC date/,
	);
	assert.throws(() => freezeCandidate({ ...args, sequence: 0 }), /sequence/);
});
test("nightly eligibility uses successful publication time and never bypasses manual gates", () => {
	const now = Date.parse("2026-10-09T06:00:00Z");
	const last = { commit: "c".repeat(40), publishedAt: "2026-10-09T00:00:00Z" };
	const base = { mainSha: commit, last, isDescendant: true, now };
	assert.equal(nightlyEligibility({ ...base, last: null }).status, "eligible");
	assert.equal(
		nightlyEligibility({ ...base, now: now - 1 }).status,
		"cooldown",
	);
	assert.equal(nightlyEligibility(base).status, "eligible");
	assert.equal(
		nightlyEligibility({ ...base, mainSha: last.commit }).status,
		"unchanged",
	);
	assert.equal(
		nightlyEligibility({ ...base, candidateSha: "d".repeat(40) }).status,
		"stale",
	);
	assert.equal(
		nightlyEligibility({ ...base, isDescendant: false }).status,
		"stale",
	);
	assert.equal(
		nightlyEligibility({ ...base, last: { ...last, publishedAt: "invalid" } })
			.status,
		"blocked",
	);
});
test("stable defaults exclude nightlies and nightly ordering survives a core-version change", () => {
	const r = (version) => ({
		tag_name: `v${version}`,
		draft: false,
		prerelease: version.includes("-"),
		assets: [{ name: "release.json" }],
	});
	const a = r("9.0.0-nightly.20261009.10"),
		b = r("1.0.0-nightly.20261009.11"),
		beta = r("1.0.0-beta"),
		stable = r("1.0.0");
	assert.equal(selectPublicRelease([a, b, beta]), beta);
	assert.equal(selectPublicRelease([a, b, beta], "nightly"), b);
	assert.equal(selectPublicRelease([a, b]), null);
	assert.equal(selectPublicRelease([a, b, beta, stable]), stable);
	assert.equal(compareReleaseVersions("1.0.0", "1.0.0-nightly.20261009.10"), 1);
});
test("native build provenance binds separate workflow SHA and candidate artifact identity", () => {
	const c = freezeCandidate(args),
		identity = candidateIdentity(c, 123);
	const run = {
		id: 123,
		status: "completed",
		conclusion: "success",
		repository: { full_name: REPOSITORY },
		head_repository: { full_name: REPOSITORY },
		head_sha: workflowSha,
		path: ".github/workflows/binary-build.yml",
		event: "workflow_dispatch",
	};
	const jobs = TARGETS.map((t) => ({
		name: `binary (${t})`,
		status: "completed",
		conclusion: "success",
	}));
	const artifacts = TARGETS.map((t) => ({
		name: `bobs-factory-${t}-${c.digest}-1`,
		expired: false,
		digest: `sha256:${"d".repeat(64)}`,
		workflow_run: { id: 123, head_sha: workflowSha },
	}));
	assert.equal(
		Object.keys(validateBuildProvenance(run, jobs, artifacts, identity)).length,
		4,
	);
	assert.throws(
		() =>
			validateBuildProvenance(
				{ ...run, head_sha: commit },
				jobs,
				artifacts,
				identity,
			),
		/Workflow source/,
	);
	assert.throws(
		() =>
			validateBuildProvenance(
				run,
				jobs,
				[{ ...artifacts[0], name: "stable-artifact" }, ...artifacts.slice(1)],
				identity,
			),
		/candidate artifact/,
	);
});
