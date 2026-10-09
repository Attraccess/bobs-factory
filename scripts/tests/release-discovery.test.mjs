import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { sha256 } from "../lib/binary-release.mjs";
import { discoverReleases, githubClient } from "../lib/github-release.mjs";
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
	let corruption = null,
		failed = false;
	const client = githubClient("", async (url) => {
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
test("discovery separates signed stable/nightly, excludes incomplete candidates and aborts network failures", async () => {
	const stable = preparedFixture("stable"),
		nightly = preparedFixture(),
		beta = preparedFixture("beta");
	try {
		const p = provider([stable, nightly, beta]);
		let state = await discoverReleases(p.client, keys);
		assert.equal(state.stable.manifest.channel, "stable");
		assert.equal(state.nightly.manifest.channel, "nightly");
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
