import { createHash } from "node:crypto";

const check = (ok, message) => {
	if (!ok) throw new Error(message);
};
const sha = (value, size = 40) =>
	typeof value === "string" && new RegExp(`^[a-f0-9]{${size}}$`).test(value);
export const canonical = (value) =>
	JSON.stringify(value, (_, v) =>
		v && typeof v === "object" && !Array.isArray(v)
			? Object.fromEntries(
					Object.keys(v)
						.sort()
						.map((k) => [k, v[k]]),
				)
			: v,
	);
export const candidateDigest = (candidate) =>
	createHash("sha256").update(canonical(candidate)).digest("hex");
export function releaseChannel(version) {
	if (/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
		return "stable";
	if (
		/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-nightly\.[1-9]\d{7}\.[1-9]\d*$/.test(
			version,
		)
	)
		return "nightly";
	if (
		/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta(?:\.(0|[1-9]\d*))?$/.test(
			version,
		)
	)
		return "beta";
	return null;
}
export function validateCandidate(record) {
	const c = record?.candidate;
	check(
		c?.schemaVersion === 1 &&
			c.product === "bobs-factory" &&
			c.repository === "jappyjan/bobs-factory",
		"Invalid frozen candidate",
	);
	check(
		sha(c.commit) && sha(c.workflowSha) && sha(c.recipe?.toolingSha),
		"Candidate source/workflow/tooling must be immutable SHAs",
	);
	check(
		c.workflowSha === c.recipe.toolingSha &&
			c.recipe.bun === "1.4.2" &&
			c.recipe.node === "24.18.0" &&
			c.recipe.schemaVersion === 1,
		"Unsupported frozen release recipe",
	);
	check(
		releaseChannel(c.version) === c.channel &&
			c.tag === `v${c.version}` &&
			c.recipe.versionOverride === c.version,
		"Candidate version/channel/recipe mismatch",
	);
	check(
		typeof c.committedVersion === "string" &&
			/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[A-Za-z0-9.-]+)?$/.test(
				c.committedVersion,
			),
		"Missing committed package version",
	);
	check(
		JSON.stringify(c.targets) ===
			JSON.stringify([
				"darwin-arm64",
				"darwin-x64",
				"linux-x64",
				"linux-arm64",
			]),
		"Candidate requires all four native targets",
	);
	if (c.channel === "nightly") {
		check(
			Number.isSafeInteger(c.sequence) &&
				c.sequence > 0 &&
				c.version.endsWith(`.${c.sequence}`),
			"Invalid allocated nightly sequence",
		);
		const utc = c.version.split("-nightly.")[1].split(".")[0];
		const parsedDate = new Date(
			`${utc.slice(0, 4)}-${utc.slice(4, 6)}-${utc.slice(6, 8)}T00:00:00Z`,
		);
		check(
			Number.isFinite(parsedDate.getTime()) &&
				parsedDate.toISOString().slice(0, 10).replaceAll("-", "") === utc,
			"Invalid nightly UTC date",
		);
		check(
			c.version.split("-")[0] === c.committedVersion.split("-")[0],
			"Nightly core differs from committed package",
		);
	}
	if (c.channel === "stable")
		check(
			c.promotion?.channel === "nightly" &&
				c.promotion.commit === c.commit &&
				sha(c.promotion.manifestSha256, 64) &&
				Number.isSafeInteger(c.promotion.releaseId) &&
				c.promotion.releaseId > 0 &&
				releaseChannel(c.promotion.version) === "nightly" &&
				c.promotion.tag === `v${c.promotion.version}`,
			"Stable requires a frozen verified published nightly",
		);
	check(
		sha(record.digest, 64) && record.digest === candidateDigest(c),
		"Candidate digest mismatch",
	);
	return record;
}
export function freezeCandidate({
	channel,
	version,
	commit,
	workflowSha,
	committedVersion,
	sequence,
	date,
	promotion,
}) {
	if (channel === "nightly") {
		check(
			Number.isSafeInteger(sequence) &&
				sequence > 0 &&
				/^\d{4}-\d{2}-\d{2}T/.test(date),
			"Allocate sequence and UTC creation date once",
		);
		version = `${committedVersion.split("-")[0]}-nightly.${date.slice(0, 10).replaceAll("-", "")}.${sequence}`;
	}
	const candidate = {
		schemaVersion: 1,
		product: "bobs-factory",
		repository: "jappyjan/bobs-factory",
		channel,
		version,
		tag: `v${version}`,
		commit,
		committedVersion,
		workflowSha,
		recipe: {
			schemaVersion: 1,
			toolingSha: workflowSha,
			bun: "1.4.2",
			node: "24.18.0",
			versionOverride: version,
		},
		targets: ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"],
		...(channel === "nightly" ? { sequence } : {}),
		...(promotion ? { promotion } : {}),
	};
	return validateCandidate({ candidate, digest: candidateDigest(candidate) });
}
export function nightlyEligibility({
	mainSha,
	candidateSha = mainSha,
	last,
	isDescendant,
	now,
}) {
	if (!sha(mainSha) || !sha(candidateSha) || !Number.isFinite(now))
		return { status: "blocked", reason: "Missing immutable source or clock" };
	if (mainSha !== candidateSha)
		return {
			status: "stale",
			reason: "Main advanced after this candidate was frozen",
		};
	if (!last) return { status: "eligible" };
	if (last.commit === candidateSha)
		return { status: "unchanged", reason: "Main is already published" };
	if (isDescendant !== true)
		return {
			status: "stale",
			reason: "Candidate does not advance the published source",
		};
	const published = Date.parse(last.publishedAt);
	if (!Number.isFinite(published) || published > now)
		return { status: "blocked", reason: "Invalid successful publication time" };
	if (now - published < 6 * 60 * 60 * 1000)
		return {
			status: "cooldown",
			retryAt: new Date(published + 6 * 60 * 60 * 1000).toISOString(),
		};
	return { status: "eligible" };
}
export const candidateIdentity = (record, runId) => {
	validateCandidate(record);
	return { ...record.candidate, candidateDigest: record.digest, runId };
};

export class PublicationSkip extends Error {
	constructor(result) {
		super(`Nightly publication skipped: ${result.status}`);
		this.result = result;
	}
}
