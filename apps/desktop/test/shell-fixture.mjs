// Controlled signed release transport. Test-only keys and outer runtime evidence;
// this is never a public release or Apple signing/notarization receipt.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileRecord, jsonBytes } from "../../../scripts/lib/binary-release.mjs";
import { preparedFixture } from "../../../scripts/tests/prepared-fixture.mjs";
import { keys, signBytes } from "../../../scripts/tests/release-fixtures.mjs";

export { keys };
// Synthetic notices for scripted test payloads only, never native distribution evidence.
export const fixtureElectronLicenses = {
	schemaVersion: 1,
	product: "electron",
	version: "44.7.0",
	files: ["LICENSE", "LICENSES.chromium.html"].map((file) => ({
		file,
		size: 1,
		sha256: "a".repeat(64),
	})),
};
export function appRelease(channel, appBytes, target, options = {}) {
	const f = preparedFixture(channel, { desktop: true, ...options }),
		item = f.manifest.desktop.artifacts[0];
	item.target = target;
	const archive = "fixture.AppImage";
	writeFileSync(join(f.assets, archive), appBytes);
	item.updateArchive = fileRecord(join(f.assets, archive), archive);
	const metadata = {
		...f.identity,
		schemaVersion: 1,
		product: "bobs-factory-desktop",
		target,
		format: "AppImage",
		osSigning: "not-applicable",
		archive: item.updateArchive,
		fingerprint: item.updateArchive.sha256,
		electronLicenses: options.electronLicenses ?? fixtureElectronLicenses,
	};
	writeFileSync(join(f.assets, item.updateMetadata.file), jsonBytes(metadata));
	item.updateMetadata = fileRecord(
		join(f.assets, item.updateMetadata.file),
		item.updateMetadata.file,
	);
	writeFileSync(
		join(f.assets, item.validation.file),
		jsonBytes({
			...f.identity,
			product: "bobs-factory",
			status: "passed",
			target,
			scope: "controlled-app-fixture; outer release evidence simulated",
		}),
	);
	item.validation = fileRecord(
		join(f.assets, item.validation.file),
		item.validation.file,
	);
	for (const r of [item.updateArchive, item.updateMetadata, item.validation])
		f.manifest.assets = [
			...f.manifest.assets.filter((x) => x.file !== r.file),
			r,
		];
	writeFileSync(join(f.assets, "release.json"), jsonBytes(f.manifest));
	writeFileSync(
		join(f.assets, "release.json.sig"),
		signBytes(jsonBytes(f.manifest)),
	);
	f.records = [
		...f.manifest.assets,
		...["release.json", "release.json.sig", "release.json.key-id"].map((file) =>
			fileRecord(join(f.assets, file), file),
		),
	];
	return f;
}
export function fixtureClient(fixtures, services) {
	const releases = fixtures.map((f, i) => ({
		id: i + 1,
		tag_name: f.manifest.tag,
		published_at: "2026-10-10T00:00:00Z",
		draft: false,
		prerelease: f.identity.channel !== "stable",
		assets: f.records.map((r) => ({
			name: r.file,
			size: r.size,
			digest: `sha256:${r.sha256}`,
			state: "uploaded",
			browser_download_url: `https://github.com/jappyjan/bobs-factory/releases/download/${f.manifest.tag}/${r.file}`,
		})),
	}));
	return services.githubClient("", async (url) => {
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
			return new Response(JSON.stringify(releases));
		const tag = p.match(/\/(?:tags|download)\/(v[^/]+)/)?.[1],
			f = fixtures.find((f) => f.manifest.tag === tag);
		if (p.includes("/git/ref/tags/"))
			return new Response(
				JSON.stringify({ object: { type: "commit", sha: f.identity.commit } }),
			);
		if (p.includes("/releases/tags/"))
			return new Response(
				JSON.stringify(releases.find((r) => r.tag_name === tag)),
			);
		const id = p.match(/\/releases\/(\d+)\/assets/)?.[1];
		if (id)
			return new Response(
				JSON.stringify(releases.find((r) => r.id === Number(id)).assets),
			);
		if (u.hostname === "github.com" && f)
			return new Response(readFileSync(join(f.assets, p.split("/").at(-1))));
		throw Error("Unexpected controlled release URL");
	});
}
