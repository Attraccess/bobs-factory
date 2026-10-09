import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
	jsonBytes,
	selectPublicRelease,
	sha256,
	TARGETS,
	validateReleaseManifest,
} from "../lib/binary-release.mjs";
import { receiptArchive } from "../lib/receipt-archive.mjs";
import {
	NIGHTLY_COOLDOWN_MS,
	newestChannel,
	nightlyEligibility,
	releaseChannel,
	requiredSupportingFiles,
} from "../lib/release-channels.mjs";
import {
	githubClient,
	readPublishedManifest,
} from "../lib/release-discovery.mjs";
import {
	publicationMarker,
	publishStagedRelease,
} from "../lib/release-publication.mjs";

const commit = "a".repeat(40),
	source = "b".repeat(40);
const now = Date.parse("2026-10-09T12:00:00Z");
const last = {
	published_at: new Date(now - NIGHTLY_COOLDOWN_MS).toISOString(),
	manifest: {
		channel: "nightly",
		originatingSourceSha: source,
		nightlySequence: 2,
	},
};
test("nightly cooldown applies at publication time, changed main and numeric ordering", () => {
	assert.equal(releaseChannel("1.0.0-beta"), "prerelease");
	assert.equal(releaseChannel("1.0.0-nightly.10"), "nightly");
	assert.throws(
		() => releaseChannel("1.0.0-nightly.today"),
		/NUMERIC_SEQUENCE/,
	);
	assert.equal(nightlyEligibility(commit, last, now).eligible, true);
	assert.equal(nightlyEligibility(commit, last, now - 1).eligible, false);
	assert.equal(
		nightlyEligibility(source, last, now).reason,
		"main has not changed",
	);
	assert.throws(
		() => nightlyEligibility(commit, { ...last, published_at: "invalid" }, now),
		/publication time/,
	);
	const entries = [2, 10].map((n) => ({
		manifest: { version: `1.0.0-nightly.${n}`, nightlySequence: n },
	}));
	assert.equal(newestChannel(entries, "nightly").manifest.nightlySequence, 10);
	assert.equal(
		selectPublicRelease(
			entries.map((e) => ({
				tag_name: `v${e.manifest.version}`,
				prerelease: true,
				assets: [{ name: "release.json" }],
			})),
		),
		null,
	);
});
function transportFixture(channel = "nightly") {
	const identity = {
		version: channel === "nightly" ? "1.0.0-nightly.10" : "1.0.0",
		commit,
		runId: 123,
	};
	const manifest = {
		...identity,
		channel,
		tag: `v${identity.version}`,
		originatingSourceSha: commit,
		nightlySequence: 10,
	};
	const records = ["release.json", "archive.tar.gz", "evidence.json"].map(
		(file) => ({ file, sha256: "c".repeat(64), size: 42 }),
	);
	let tag,
		release,
		assets = [],
		dispatchFails = false,
		uploads = 0,
		failAtUpload;
	const calls = [];
	const marker = publicationMarker(identity, records);
	const api = async (path, opts = {}) => {
		calls.push({ path, ...opts });
		if (path.startsWith("git/ref/tags/")) return tag ?? null;
		if (path.startsWith("releases/tags/")) return release ?? null;
		if (path.endsWith("/assets")) return assets;
		if (path === "releases/latest") return { tag_name: "v0.9.0" };
		if (path === "environments/stable-release")
			return {
				protection_rules: [
					{
						type: "required_reviewers",
						prevent_self_review: true,
						reviewers: [{}],
					},
				],
			};
		if (path === "git/refs") {
			tag = { object: { type: "commit", sha: opts.body.sha } };
			return tag;
		}
		if (path === "releases" && opts.method === "POST") {
			release = { id: 1, ...opts.body };
			return release;
		}
		if (path === "releases/1" && opts.method === "PATCH") {
			release = {
				...release,
				...opts.body,
				published_at: new Date(now).toISOString(),
			};
			return release;
		}
		if (path.includes("dispatches")) {
			if (dispatchFails) throw new Error("Pages unavailable");
			return null;
		}
		throw new Error(`Unexpected API ${path}`);
	};
	const upload = async (_id, record) => {
		uploads++;
		if (uploads === failAtUpload) throw new Error("interrupted upload");
		const asset = {
			name: record.file,
			size: record.size,
			digest: `sha256:${record.sha256}`,
			state: "uploaded",
		};
		assets.push(asset);
		return asset;
	};
	const run = (options) =>
		publishStagedRelease({
			identity,
			manifest,
			records,
			api,
			upload,
			lastNightly: async () => last,
			now: () => now,
			...options,
		});
	return {
		run,
		calls,
		records,
		manifest,
		identity,
		marker,
		get assets() {
			return assets;
		},
		get uploads() {
			return uploads;
		},
		get release() {
			return release;
		},
		setTag: (v) => {
			tag = v;
		},
		failUpload: (n) => {
			failAtUpload = n;
		},
		failPages: (v) => {
			dispatchFails = v;
		},
		setRelease: (v) => {
			release = v;
		},
	};
}
test("dry run validates inventory and cooldown without mutating requests", async () => {
	const f = transportFixture();
	await f.run({ dryRun: true });
	assert.ok(f.calls.every((call) => !call.method || call.method === "GET"));
	await assert.rejects(
		f.run({
			dryRun: true,
			lastNightly: async () => ({
				...last,
				published_at: new Date(now).toISOString(),
			}),
		}),
		/cooldown/,
	);
	assert.equal(f.uploads, 0);
});
test("interrupted upload resumes only missing identical assets; completed retry only dispatches Pages", async () => {
	const f = transportFixture();
	f.failUpload(2);
	await assert.rejects(f.run({ dryRun: false }), /interrupted/);
	assert.equal(f.release.draft, true);
	assert.equal(f.assets.length, 1);
	await f.run({ dryRun: false });
	assert.equal(f.assets.length, 3);
	assert.equal(f.uploads, 4);
	assert.equal(f.release.make_latest, "false");
	const before = f.calls.length;
	await f.run({
		dryRun: false,
		lastNightly: async () => {
			throw new Error("completed identity must bypass cooldown");
		},
	});
	assert.equal(f.uploads, 4);
	assert.deepEqual(
		f.calls
			.slice(before)
			.filter((c) => c.method === "POST")
			.map((c) => c.path),
		["actions/workflows/website.yml/dispatches"],
	);
});
test("post-publication Pages failure is recoverable without replacing release assets", async () => {
	const f = transportFixture();
	f.failPages(true);
	await assert.rejects(f.run({ dryRun: false }), /Pages unavailable/);
	assert.equal(f.release.draft, false);
	assert.equal(f.uploads, 3);
	f.failPages(false);
	assert.equal((await f.run({ dryRun: false })).alreadyPublished, true);
	assert.equal(f.uploads, 3);
});
test("conflicting tag, foreign publication, duplicates and changed bytes stop recovery", async () => {
	const f = transportFixture();
	f.setTag({ object: { type: "commit", sha: source } });
	await assert.rejects(f.run({ dryRun: false }), /tag conflict/);
	const g = transportFixture();
	g.failUpload(2);
	await assert.rejects(g.run({ dryRun: false }));
	g.assets[0].digest = `sha256:${"f".repeat(64)}`;
	await assert.rejects(g.run({ dryRun: false }), /asset conflict/);
	g.assets[0].digest = `sha256:${g.records[0].sha256}`;
	g.assets.push({ ...g.assets[0] });
	await assert.rejects(g.run({ dryRun: false }), /Duplicate immutable asset/);
	const h = transportFixture();
	h.setTag({ object: { type: "commit", sha: commit } });
	h.setRelease({
		id: 1,
		draft: true,
		tag_name: h.manifest.tag,
		body: "foreign",
		prerelease: true,
	});
	await assert.rejects(h.run({ dryRun: false }), /another immutable/);
});
test("eligibility is rechecked after upload and stable requires protected human approval", async () => {
	const f = transportFixture();
	let calls = 0;
	await assert.rejects(
		f.run({
			dryRun: false,
			lastNightly: async () =>
				++calls < 3
					? last
					: { ...last, published_at: new Date(now).toISOString() },
		}),
		/cooldown/,
	);
	assert.equal(f.release.draft, true);
	const stable = transportFixture("stable");
	await assert.rejects(
		stable.run({ dryRun: false }),
		/protected stable-release/,
	);
	await stable.run({ dryRun: false, approvedStable: true });
	assert.equal(stable.release.make_latest, "true");
});
test("GitHub release pagination fails visibly when complete discovery cannot be obtained", async () => {
	let requests = 0;
	const { api } = githubClient(null, async () => {
		requests++;
		return new Response(JSON.stringify(Array(100).fill({})));
	});
	await assert.rejects(api("releases", { paginate: true }), /pagination limit/);
	assert.equal(requests, 10);
});
test("receipt archives have reproducible bytes and can be read by tar", () => {
	const work = mkdtempSync(join(tmpdir(), "factory-receipts-"));
	try {
		mkdirSync(join(work, "nested"));
		writeFileSync(join(work, "nested/check.txt"), "real receipt");
		const one = receiptArchive(work, ["nested/check.txt"]);
		writeFileSync(join(work, "nested/check.txt"), "real receipt");
		assert.deepEqual(one, receiptArchive(work, ["nested/check.txt"]));
		writeFileSync(join(work, "receipts.tar.gz"), one);
		assert.equal(
			execFileSync(
				"tar",
				["-xOzf", join(work, "receipts.tar.gz"), "nested/check.txt"],
				{ encoding: "utf8" },
			),
			"real receipt",
		);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});
test("candidate preparation freezes an old nightly, edits only version metadata, and never writes remote refs in dry run", async (t) => {
	const work = mkdtempSync(join(tmpdir(), "factory-candidate-"));
	try {
		const git = (...args) =>
			execFileSync("git", args, { cwd: work, encoding: "utf8" }).trim();
		git("init", "-q");
		git("config", "user.name", "Test");
		git("config", "user.email", "test@example.invalid");
		mkdirSync(join(work, "apps/cli"), { recursive: true });
		mkdirSync(join(work, "scripts/lib"), { recursive: true });
		for (const file of [
			"prepare-release-candidate.mjs",
			"lib/binary-release.mjs",
			"lib/release-channels.mjs",
			"lib/release-discovery.mjs",
		])
			copyFileSync(resolve("scripts", file), join(work, "scripts", file));
		writeFileSync(
			join(work, "apps/cli/package.json"),
			JSON.stringify({
				name: "bobs-factory",
				version: "1.0.0",
				dependencies: { fixed: "1.0.0" },
			}),
		);
		git("add", ".");
		git("commit", "-qm", "source");
		const frozen = git("rev-parse", "HEAD");
		writeFileSync(join(work, "new-main.txt"), "newer main payload");
		git("add", ".");
		git("commit", "-qm", "new main");
		const current = git("rev-parse", "HEAD");
		const preload = join(work, "transport.mjs");
		writeFileSync(
			preload,
			`globalThis.fetch = async (url, opts) => { if (opts.method !== 'GET') throw new Error('remote mutation'); if (String(url).includes('/releases?')) return new Response('[]'); throw new Error('unexpected request '+url); };`,
		);
		const result = spawnSync(
			process.execPath,
			[
				"--import",
				preload,
				"scripts/prepare-release-candidate.mjs",
				"--source",
				frozen,
				"--sequence",
				"10",
				"--output",
				join(work, "prepared"),
			],
			{ cwd: work, encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
		const candidate = JSON.parse(
			readFileSync(join(work, "prepared/candidate.json"), "utf8"),
		);
		assert.equal(candidate.originatingSourceSha, frozen);
		assert.equal(git("rev-parse", "HEAD"), current);
		assert.equal(
			git("diff", "--name-only", frozen, candidate.commit),
			"apps/cli/package.json",
		);
		assert.notEqual(
			spawnSync("git", ["cat-file", "-e", `${candidate.commit}:new-main.txt`], {
				cwd: work,
			}).status,
			0,
		);
		const pkg = JSON.parse(
			git("show", `${candidate.commit}:apps/cli/package.json`),
		);
		assert.equal(pkg.version, "1.0.0-nightly.10");
		assert.deepEqual(pkg.dependencies, { fixed: "1.0.0" });
		const record = (file) => ({ file, sha256: "c".repeat(64), size: 42 });
		const manifest = validateReleaseManifest({
			...pkg.bobsFactoryRelease,
			schemaVersion: 2,
			product: "bobs-factory",
			repository: "jappyjan/bobs-factory",
			status: "available",
			version: pkg.version,
			tag: `v${pkg.version}`,
			commit: candidate.commit,
			buildRunId: 123,
			installer: record("install.sh"),
			verifier: record("install-binary.sh"),
			source: record("source-rebuild.tar.gz"),
			supportingAssets: requiredSupportingFiles().map(record),
			targets: Object.fromEntries(
				TARGETS.map((target) => [
					target,
					{
						archive: `bobs-factory-${pkg.version}-${target}.tar.gz`,
						archiveSha256: "c".repeat(64),
						archiveSize: 42,
						manifest: `bobs-factory-${pkg.version}-${target}.manifest.json`,
						manifestSha256: "c".repeat(64),
						manifestSize: 42,
					},
				]),
			),
		});
		const bytes = jsonBytes(manifest);
		const url = `https://github.com/jappyjan/bobs-factory/releases/download/${manifest.tag}/release.json`;
		const assets = [
			manifest.installer,
			manifest.verifier,
			manifest.source,
			...manifest.supportingAssets,
			...Object.values(manifest.targets).flatMap((target) => [
				record(target.archive),
				record(target.manifest),
			]),
		].map((item) => ({
			name: item.file,
			size: item.size,
			digest: `sha256:${item.sha256}`,
		}));
		assets.push({
			name: "release.json",
			size: bytes.length,
			digest: `sha256:${sha256(bytes)}`,
			browser_download_url: url,
		});
		const desktopManifest = structuredClone(manifest);
		desktopManifest.desktop = {
			schemaVersion: 1,
			artifacts: [
				{
					version: manifest.version,
					commit: manifest.commit,
					channel: manifest.channel,
					target: "darwin-arm64",
					platformRequirements: "macOS ARM64",
					archive: record("desktop.tar.gz"),
					updateMetadata: record("desktop-update.json"),
					validation: record("desktop-validation.json"),
				},
			],
		};
		const desktopBytes = jsonBytes(validateReleaseManifest(desktopManifest));
		const desktopRelease = {
			tag_name: manifest.tag,
			draft: false,
			prerelease: true,
			assets: [
				...assets.filter((asset) => asset.name !== "release.json"),
				...[
					"desktop.tar.gz",
					"desktop-update.json",
					"desktop-validation.json",
				].map((name) => ({
					name,
					size: 42,
					digest: `sha256:${"c".repeat(64)}`,
				})),
				{
					name: "release.json",
					size: desktopBytes.length,
					digest: `sha256:${sha256(desktopBytes)}`,
					browser_download_url: url,
				},
			],
		};
		await t.test(
			"published desktop inventory requires an intact validation receipt",
			async () => {
				const transport = async () => new Response(desktopBytes);
				assert.deepEqual(
					(await readPublishedManifest(desktopRelease, transport)).manifest,
					desktopManifest,
				);
				for (const fault of ["missing", "size", "digest", "duplicate"]) {
					const broken = structuredClone(desktopRelease);
					const validation = broken.assets.find(
						(asset) => asset.name === "desktop-validation.json",
					);
					if (fault === "missing")
						broken.assets = broken.assets.filter(
							(asset) => asset !== validation,
						);
					if (fault === "size") validation.size++;
					if (fault === "digest")
						validation.digest = `sha256:${"d".repeat(64)}`;
					if (fault === "duplicate") broken.assets.push({ ...validation });
					await assert.rejects(
						readPublishedManifest(broken, transport),
						/Public release asset is missing or inconsistent: desktop-validation\.json/,
						fault,
					);
				}
			},
		);
		const published = {
			tag_name: manifest.tag,
			draft: false,
			prerelease: true,
			assets,
		};
		const fixture = join(work, "promotion-transport.json");
		writeFileSync(
			fixture,
			JSON.stringify({ published, bytes: bytes.toString("utf8") }),
		);
		writeFileSync(
			preload,
			`import { readFileSync } from 'node:fs'; const f=JSON.parse(readFileSync(${JSON.stringify(fixture)}, 'utf8')); globalThis.fetch = async (url, opts={}) => { if (opts.method && opts.method !== 'GET') throw new Error('remote mutation'); url=String(url); if(url.includes('/releases?')) return new Response(JSON.stringify([f.published])); if(url.includes('/releases/tags/')) return new Response(JSON.stringify(f.published)); if(url.includes('/git/ref/tags/')) return new Response(JSON.stringify({object:{type:'commit',sha:${JSON.stringify(candidate.commit)}}})); if(url === ${JSON.stringify(url)}) return new Response(f.bytes); throw new Error('unexpected request '+url); };`,
		);
		const promotion = spawnSync(
			process.execPath,
			[
				"--import",
				preload,
				"scripts/prepare-release-candidate.mjs",
				"--channel",
				"stable",
				"--nightly",
				manifest.tag,
				"--version",
				"1.0.0",
				"--output",
				join(work, "stable"),
			],
			{ cwd: work, encoding: "utf8" },
		);
		assert.equal(promotion.status, 0, promotion.stderr);
		const stable = JSON.parse(
			readFileSync(join(work, "stable/candidate.json"), "utf8"),
		);
		assert.equal(stable.promotedFrom.commit, candidate.commit);
		assert.equal(stable.originatingSourceSha, frozen);
		assert.equal(git("rev-parse", `${stable.commit}^`), candidate.commit);
		assert.equal(
			git("diff", "--name-only", candidate.commit, stable.commit),
			"apps/cli/package.json",
		);
		assert.notEqual(
			spawnSync("git", ["cat-file", "-e", `${stable.commit}:new-main.txt`], {
				cwd: work,
			}).status,
			0,
		);
		const missing = structuredClone(manifest);
		missing.supportingAssets.pop();
		assert.throws(() => validateReleaseManifest(missing), /evidence inventory/);
		const wrongSequence = { ...manifest, nightlySequence: 2 };
		assert.throws(() => validateReleaseManifest(wrongSequence), /sequence/);
		const duplicate = structuredClone(manifest);
		duplicate.supportingAssets[0] = duplicate.supportingAssets[1];
		assert.throws(
			() => validateReleaseManifest(duplicate),
			/evidence inventory/,
		);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});
