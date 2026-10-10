import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { sha256, validateReleaseManifest } from "../lib/binary-release.mjs";
import {
	discoverReleases,
	githubClient,
	requireVerifiedNightlyHistory,
} from "../lib/github-release.mjs";
import { preparedFixture } from "./prepared-fixture.mjs";
import { keys } from "./release-fixtures.mjs";

function provider(fixtures) {
	const releaseList = fixtures.map((f, i) => ({
		id: i + 1,
		tag_name: f.manifest.tag,
		published_at: "2026-10-09T00:00:00Z",
		draft: false,
		prerelease: f.manifest.channel !== "stable",
		assets: f.records.map((r) => ({
			name: r.file,
			state: "uploaded",
			size: r.size,
			digest: `sha256:${r.sha256}`,
			browser_download_url: `https://github.com/jappyjan/bobs-factory/releases/download/${f.manifest.tag}/${r.file}`,
		})),
	}));
	const requests = [];
	let corruption = null,
		failed = false;
	const client = githubClient("synthetic-test-token", async (url, options) => {
		requests.push({ url, options });
		const u = new URL(url),
			p = u.pathname;
		if (p === "/repos/jappyjan/bobs-factory")
			return new Response(
				JSON.stringify({
					full_name: "jappyjan/bobs-factory",
					private: false,
					visibility: "public",
				}),
			);
		if (p === "/repos/jappyjan/bobs-factory/releases")
			return new Response(JSON.stringify(releaseList));
		if (p.includes("/git/ref/tags/"))
			return new Response(
				JSON.stringify({ object: { type: "commit", sha: "a".repeat(40) } }),
			);
		const match = /\/releases\/(\d+)\/assets$/.exec(p);
		if (match)
			return new Response(
				JSON.stringify(releaseList[Number(match[1]) - 1].assets),
			);
		if (u.hostname === "github.com") {
			if (failed) throw new Error("Controlled network outage");
			const file = p.split("/").at(-1),
				tag = p.split("/").at(-2),
				f = fixtures.find((f) => f.manifest.tag === tag);
			if (corruption?.tag === tag && corruption.file === file)
				return new Response(corruption.bytes);
			return new Response(readFileSync(join(f.assets, file)));
		}
		throw Error("Unexpected provider request");
	});
	return {
		client,
		requests,
		releaseList,
		corrupt: (tag, file, bytes) => {
			corruption = { tag, file, bytes };
			const asset = releaseList
				.find((r) => r.tag_name === tag)
				.assets.find((a) => a.name === file);
			asset.size = bytes.length;
			asset.digest = `sha256:${sha256(bytes)}`;
		},
		fail: () => {
			failed = true;
		},
	};
}
test("signed desktop discovery requires intact archive, update metadata and validation inventory", async () => {
	const f = preparedFixture("nightly", { desktop: true });
	try {
		const p = provider([f]);
		assert.equal(
			(await discoverReleases(p.client, keys)).nightly.manifest.desktop
				.artifacts.length,
			1,
		);
		const assets = structuredClone(p.releaseList[0].assets);
		for (const file of [
			"desktop.tar.gz",
			"desktop-update.json",
			"desktop-validation.json",
		]) {
			for (const fault of ["missing", "size", "digest", "duplicate"]) {
				p.releaseList[0].assets = structuredClone(assets);
				const asset = p.releaseList[0].assets.find((a) => a.name === file);
				if (fault === "missing")
					p.releaseList[0].assets = p.releaseList[0].assets.filter(
						(a) => a.name !== file,
					);
				if (fault === "size") asset.size++;
				if (fault === "digest") asset.digest = `sha256:${"f".repeat(64)}`;
				if (fault === "duplicate") p.releaseList[0].assets.push({ ...asset });
				const state = await discoverReleases(p.client, keys);
				assert.equal(state.nightly, null, `${file}: ${fault}`);
				assert.equal(state.rejected.length, 1);
			}
		}
		const incomplete = structuredClone(f.manifest);
		incomplete.assets = incomplete.assets.filter(
			(a) => a.file !== "desktop-validation.json",
		);
		assert.throws(
			() => validateReleaseManifest(incomplete),
			/Signed inventory mismatch/,
		);
		const wrongSource = structuredClone(f.manifest);
		wrongSource.desktop.artifacts[0].commit = "f".repeat(40);
		assert.throws(
			() => validateReleaseManifest(wrongSource),
			/Desktop identity/,
		);
	} finally {
		f.cleanup();
	}
});
test("discovery separates signed stable/nightly, excludes incomplete candidates and aborts network failures", async () => {
	const stable = preparedFixture("stable"),
		nightly = preparedFixture(),
		beta = preparedFixture("beta");
	try {
		const p = provider([stable, nightly, beta]);
		let state = await discoverReleases(p.client, keys);
		assert.equal(state.stable.manifest.channel, "stable");
		assert.equal(state.nightly.manifest.channel, "nightly");
		assert.equal(requireVerifiedNightlyHistory(state), state.nightly);
		p.releaseList[0].draft = true;
		state = await discoverReleases(p.client, keys);
		assert.equal(state.stable.manifest.channel, "beta");
		p.releaseList[2].draft = true;
		state = await discoverReleases(p.client, keys);
		assert.equal(state.stable, null);
		assert.equal(state.nightly.manifest.channel, "nightly");
		p.releaseList[2].draft = false;
		p.corrupt(
			nightly.manifest.tag,
			"release.json",
			Buffer.concat([
				readFileSync(join(nightly.assets, "release.json")),
				Buffer.from(" "),
			]),
		);
		state = await discoverReleases(p.client, keys);
		assert.equal(state.nightly, null);
		assert.throws(
			() => requireVerifiedNightlyHistory(state),
			/latest published nightly cannot be verified/,
		);
		assert.equal(state.stable.manifest.channel, "beta");
		assert.match(state.rejected[0].reason, /signature/);
		p.releaseList[2].assets = p.releaseList[2].assets.filter(
			(a) => a.name !== "native-helpers-linux-arm64.json",
		);
		state = await discoverReleases(p.client, keys);
		assert.equal(state.stable, null);
		assert.ok(
			state.rejected.some((r) => /missing or conflicting/.test(r.reason)),
		);
		p.fail();
		await assert.rejects(discoverReleases(p.client, keys), /download failed/);
	} finally {
		for (const f of [stable, nightly, beta]) f.cleanup();
	}
});

test("nightly history uses global sequence even without manifests and tolerates unverified older history", () => {
	const release = (id, version) => ({
		id,
		tag_name: `v${version}`,
		draft: false,
	});
	const current = release(2, "1.0.0-nightly.20261009.10");
	const nightly = { release: current };
	const state = {
		published: [release(1, "9.0.0-nightly.20261008.9"), current],
		nightly,
	};
	assert.equal(requireVerifiedNightlyHistory(state), nightly);
	assert.equal(
		requireVerifiedNightlyHistory({ published: [], nightly: null }),
		null,
	);
	state.published.push(release(3, "0.1.0-nightly.20261009.11"));
	assert.throws(
		() => requireVerifiedNightlyHistory(state),
		/latest published nightly cannot be verified/,
	);
});

test("channel-only discovery authenticates API calls and skips older verified history", async () => {
	const stable = preparedFixture("stable"),
		nightly = preparedFixture();
	try {
		const p = provider([stable, nightly]);
		for (let i = 0; i < 20; i++) {
			p.releaseList.push({
				...p.releaseList[i % 2],
				id: i + 3,
				tag_name:
					i % 2 ? `v1.0.0-nightly.20261008.${Math.floor(i / 2)}` : `v0.9.${i}`,
			});
		}
		const state = await discoverReleases(p.client, keys, {
			selectedOnly: true,
		});
		assert.equal(state.stable.manifest.version, stable.manifest.version);
		assert.equal(state.nightly.manifest.version, nightly.manifest.version);
		assert.equal(state.published.length, 22);
		const apiRequests = p.requests.filter(
			(r) => new URL(r.url).hostname === "api.github.com",
		);
		assert.equal(
			apiRequests.length,
			6,
			"Only repository/list and assets/tag for each selected channel",
		);
		for (const request of apiRequests)
			assert.equal(
				request.options.headers.Authorization,
				"Bearer synthetic-test-token",
			);
		// Rejection of the newest stable still tries a prior signed candidate.
		const beta = preparedFixture("beta");
		try {
			const fallback = provider([stable, beta, nightly]);
			fallback.corrupt(
				stable.manifest.tag,
				"release.json.key-id",
				Buffer.from("unknown\n"),
			);
			const result = await discoverReleases(fallback.client, keys, {
				selectedOnly: true,
			});
			assert.equal(result.stable.manifest.channel, "beta");
			assert.match(
				result.rejected[0].reason,
				/Unknown or retired publisher key/,
			);
			fallback.fail();
			await assert.rejects(
				discoverReleases(fallback.client, keys, { selectedOnly: true }),
				/download failed/,
			);
		} finally {
			beta.cleanup();
		}
	} finally {
		stable.cleanup();
		nightly.cleanup();
	}
});
