import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type {
	ReleaseAsset,
	ReleaseClient,
} from "../../../scripts/lib/github-release.mjs";
import { PublishedUpdateSource } from "../src/updates/PublishedUpdateSource.js";

it("reauthenticates staging with compiled publisher pins before writing or executing downloaded artifacts", async () => {
	const home = mkdtempSync(join(tmpdir(), "published-update-source-"));
	const names = ["release.json", "release.json.sig", "release.json.key-id"];
	const client: ReleaseClient = {
		api: vi.fn(async () => ({
			id: 1,
			tag_name: "v1.1.0",
			draft: false,
			published_at: "2026-10-10T16:00:00.000Z",
		})),
		pages: vi.fn(async () =>
			names.map((name) => ({
				name,
				browser_download_url: `https://github.com/jappyjan/bobs-factory/releases/download/v1.1.0/${name}`,
			})),
		),
		bytes: vi.fn(async (asset: ReleaseAsset) =>
			Buffer.from(
				asset.name === "release.json.key-id"
					? "untrusted-publisher"
					: "untrusted bytes",
			),
		),
	};
	const source = new PublishedUpdateSource(
		home,
		"/previous/owned-runtime",
		"darwin-arm64",
		client,
	);
	try {
		await expect(
			source.stage({
				version: "1.1.0",
				channel: "stable",
				commit: "a".repeat(40),
				target: "darwin-arm64",
				publishedAt: "2026-10-10T16:00:00.000Z",
				manifestSha256: "b".repeat(64),
			}),
		).rejects.toThrow("publisher key");
		expect(
			vi.mocked(client.bytes).mock.calls.map(([asset]) => asset.name),
		).toEqual(names);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
