import {
	jsonBytes,
	requireValue,
	sha256,
	validateLatestVersion,
} from "./binary-release.mjs";
import { nightlyEligibility, releaseChannel } from "./release-channels.mjs";

export function publicationMarker(identity, records) {
	const digest = sha256(
		jsonBytes({
			version: identity.version,
			commit: identity.commit,
			runId: identity.runId,
			assets: [...records].sort((a, b) => a.file.localeCompare(b.file)),
		}),
	);
	return `<!-- bobs-factory-publication-v1:${digest} -->`;
}
export function validateAssetInventory(assets, records, complete = false) {
	requireValue(Array.isArray(assets), "Invalid release asset list");
	const expected = new Map(records.map((record) => [record.file, record]));
	requireValue(
		expected.size === records.length,
		"Duplicate staged release assets",
	);
	const names = new Set();
	for (const asset of assets) {
		requireValue(
			!names.has(asset.name),
			`Duplicate immutable asset: ${asset.name}`,
		);
		names.add(asset.name);
		const record = expected.get(asset.name);
		requireValue(
			record &&
				asset.state === "uploaded" &&
				asset.size === record.size &&
				asset.digest === `sha256:${record.sha256}`,
			`Immutable asset conflict: ${asset.name}; use a new candidate/version`,
		);
	}
	if (complete)
		requireValue(
			names.size === expected.size,
			"Incomplete release inventory; retaining draft",
		);
	return records.filter((record) => !names.has(record.file));
}
// The caller holds the repository-wide publication lock. All mutations are here;
// staged artifacts and evidence are already validated by the publisher.
export async function publishStagedRelease({
	api,
	upload,
	identity,
	manifest,
	records,
	lastNightly,
	approvedStable = false,
	receipt = () => {},
	dryRun = true,
	now = () => Date.now(),
}) {
	const channel = releaseChannel(identity.version);
	const marker = publicationMarker(identity, records);
	const tagPath = `git/ref/tags/${manifest.tag}`;
	const releasePath = `releases/tags/${manifest.tag}`;
	async function state() {
		const tag = await api(tagPath, { allow404: true });
		const release = await api(releasePath, { allow404: true });
		if (tag)
			requireValue(
				tag.object?.type === "commit" && tag.object.sha === identity.commit,
				"Immutable tag conflict; use a new candidate/version",
			);
		if (release)
			requireValue(
				tag &&
					release.tag_name === manifest.tag &&
					release.body?.includes(marker) &&
					release.prerelease === (channel !== "stable"),
				"Release belongs to another immutable publication identity",
			);
		const assets = release
			? await api(`releases/${release.id}/assets`, { paginate: true })
			: [];
		validateAssetInventory(assets, records, release && !release.draft);
		return { tag, release, assets };
	}
	async function eligibility() {
		if (channel === "nightly") {
			const last = await lastNightly();
			// Numeric ordering is independent of the base SemVer and UTC timestamps.
			requireValue(
				!last || manifest.nightlySequence > last.manifest.nightlySequence,
				"Nightly sequence must move forwards",
			);
			const result = nightlyEligibility(
				manifest.originatingSourceSha,
				last,
				now(),
			);
			requireValue(
				result.eligible,
				`Nightly publication blocked: ${result.reason}`,
			);
		} else {
			validateLatestVersion(
				identity.version,
				await api("releases/latest", { allow404: true }),
			);
			if (channel === "stable" && !dryRun) {
				requireValue(
					approvedStable,
					"Stable publication requires the protected stable-release approval environment",
				);
				const environment = await api("environments/stable-release");
				requireValue(
					environment.protection_rules?.some(
						(rule) =>
							rule.type === "required_reviewers" &&
							rule.prevent_self_review === true &&
							rule.reviewers?.length > 0,
					),
					"Configure stable-release with required reviewers and prevent self-review before stable publication",
				);
			}
		}
	}
	let current = await state();
	if (current.release && !current.release.draft) {
		receipt("already-published", { releaseId: current.release.id });
		if (!dryRun)
			await api("actions/workflows/website.yml/dispatches", {
				method: "POST",
				body: { ref: "main" },
			});
		return { alreadyPublished: true, release: current.release };
	}
	await eligibility();
	if (dryRun)
		return {
			dryRun: true,
			missing: validateAssetInventory(current.assets, records),
			marker,
		};
	// Resolve identity and cooldown again immediately before the first write.
	current = await state();
	await eligibility();
	if (!current.tag)
		await api("git/refs", {
			method: "POST",
			body: { ref: `refs/tags/${manifest.tag}`, sha: identity.commit },
		});
	receipt("tag-verified", { tag: manifest.tag, commit: identity.commit });
	let draft = current.release;
	if (!draft)
		draft = await api("releases", {
			method: "POST",
			body: {
				tag_name: manifest.tag,
				target_commitish: identity.commit,
				name: `Bob's Factory ${identity.version}`,
				draft: true,
				prerelease: channel !== "stable",
				make_latest: "false",
				body: `Verified ${channel} candidate: ${identity.commit}\nBuild run: ${identity.runId}\n${marker}`,
			},
		});
	receipt("draft-verified", { releaseId: draft.id });
	for (const record of validateAssetInventory(current.assets, records)) {
		const asset = await upload(draft.id, record);
		validateAssetInventory([asset], [record], true);
		receipt("asset-verified", { file: record.file, sha256: record.sha256 });
	}
	current = await state();
	requireValue(
		current.release?.id === draft.id && current.release.draft,
		"Release state changed during upload",
	);
	validateAssetInventory(current.assets, records, true);
	await eligibility();
	const published = await api(`releases/${draft.id}`, {
		method: "PATCH",
		body: {
			draft: false,
			make_latest: channel === "stable" ? "true" : "false",
		},
	});
	requireValue(published.draft === false, "GitHub did not confirm publication");
	receipt("published", {
		releaseId: draft.id,
		publishedAt: published.published_at,
	});
	// A failure here is retried through the identical-publication path above.
	await api("actions/workflows/website.yml/dispatches", {
		method: "POST",
		body: { ref: "main" },
	});
	receipt("discovery-dispatched", { releaseId: draft.id });
	return { release: published };
}
