import {
	compareReleaseVersions,
	parseReleaseVersion,
	requireValue,
	TARGETS,
} from "./binary-release.mjs";

export const NIGHTLY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export function releaseChannel(version) {
	const parsed = parseReleaseVersion(version);
	requireValue(parsed, "Invalid exact release version");
	if (!parsed.prerelease.length) return "stable";
	if (parsed.prerelease[0] !== "nightly") return "prerelease";
	requireValue(
		parsed.prerelease.length === 2 &&
			/^[1-9][0-9]*$/.test(parsed.prerelease[1]) &&
			Number.isSafeInteger(Number(parsed.prerelease[1])),
		"Nightly version must end in nightly.NUMERIC_SEQUENCE",
	);
	return "nightly";
}
export function nightlyEligibility(sourceCommit, last, now = Date.now()) {
	requireValue(
		/^[a-f0-9]{40}$/.test(sourceCommit),
		"Invalid originating source SHA",
	);
	if (!last) return { eligible: true };
	requireValue(
		last.manifest?.channel === "nightly",
		"Invalid last successful nightly",
	);
	const published = Date.parse(last.published_at);
	requireValue(
		Number.isFinite(published) && published <= now,
		"Invalid successful nightly publication time",
	);
	if (last.manifest.originatingSourceSha === sourceCommit)
		return { eligible: false, reason: "main has not changed" };
	if (now - published < NIGHTLY_COOLDOWN_MS)
		return {
			eligible: false,
			reason: "six-hour nightly cooldown",
			nextEligibleAt: new Date(published + NIGHTLY_COOLDOWN_MS).toISOString(),
		};
	return { eligible: true };
}
export function validateCandidateMetadata(metadata, version) {
	const channel = releaseChannel(version);
	requireValue(
		[1, 2].includes(metadata?.schemaVersion) &&
			metadata.channel === channel &&
			["stable", "nightly"].includes(channel) &&
			/^[a-f0-9]{40}$/.test(metadata.originatingSourceSha) &&
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
				metadata.createdAt,
			) &&
			Number.isFinite(Date.parse(metadata.createdAt)),
		"Invalid prepared release candidate metadata",
	);
	if (channel === "nightly")
		requireValue(
			metadata.nightlySequence === Number(version.split("-nightly.")[1]),
			"Nightly sequence must match exact version",
		);
	else {
		const source = metadata.promotedFrom;
		requireValue(
			source?.tag === `v${source.version}` &&
				releaseChannel(source.version) === "nightly" &&
				/^[a-f0-9]{40}$/.test(source.commit) &&
				/^[a-f0-9]{64}$/.test(source.manifestSha256),
			"Stable candidate requires an explicitly selected verified published nightly",
		);
	}
	return metadata;
}
export function manifestAssets(manifest) {
	return [
		manifest.installer,
		manifest.verifier,
		manifest.source,
		...Object.values(manifest.targets).flatMap((target) => [
			{
				file: target.archive,
				sha256: target.archiveSha256,
				size: target.archiveSize,
			},
			{
				file: target.manifest,
				sha256: target.manifestSha256,
				size: target.manifestSize,
			},
		]),
		...(manifest.supportingAssets ?? []),
		...(manifest.desktop?.artifacts ?? []).flatMap((item) => [
			item.archive,
			item.updateMetadata,
			item.validation,
		]),
	];
}
export function validatePublicInventory(release, manifest, manifestRecord) {
	requireValue(
		!release.draft &&
			manifest.status === "available" &&
			manifest.tag === release.tag_name &&
			release.prerelease === (releaseChannel(manifest.version) !== "stable"),
		"Incomplete or wrong-channel published release",
	);
	const expected = [
		...manifestAssets(manifest),
		...(manifestRecord ? [manifestRecord] : []),
	];
	for (const record of expected) {
		const matches =
			release.assets?.filter((asset) => asset.name === record.file) ?? [];
		requireValue(
			matches.length === 1 &&
				matches[0].size === record.size &&
				matches[0].digest === `sha256:${record.sha256}`,
			`Public release asset is missing or inconsistent: ${record.file}`,
		);
	}
}
export function newestChannel(entries, channel) {
	const candidates = entries.filter(
		(entry) => releaseChannel(entry.manifest.version) === channel,
	);
	return (
		candidates.sort((a, b) =>
			channel === "nightly"
				? b.manifest.nightlySequence - a.manifest.nightlySequence
				: compareReleaseVersions(b.manifest.version, a.manifest.version),
		)[0] ?? null
	);
}
export function requiredSupportingFiles() {
	return [
		"release-evidence.json",
		"validation-receipts.tar.gz",
		"build-provenance.json",
		...TARGETS.flatMap((target) => [
			`runtime-smoke-${target}.txt`,
			`native-helpers-${target}.json`,
			`prepared-agent-boundaries-${target}.json`,
			`public-installer-${target}.json`,
		]),
	];
}
