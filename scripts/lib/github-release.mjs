import {
	REPOSITORY,
	releaseAssetRecords,
	requireValue,
	selectPublicRelease,
	sha256,
	validatePublicRepository,
	validateReleaseManifest,
} from "./binary-release.mjs";
import { releaseChannel, validateCandidate } from "./release-candidate.mjs";
import { verifyManifestSignature } from "./release-signature.mjs";
export function githubClient(token = process.env.GH_TOKEN, transport = fetch) {
	const headers = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		...(token ? { Authorization: `Bearer ${token}` } : {}),
	};
	const base = `https://api.github.com/repos/${REPOSITORY}`;
	async function api(path, { method = "GET", body, allow404 = false } = {}) {
		const response = await transport(`${base}${path ? `/${path}` : ""}`, {
			method,
			headers: {
				...headers,
				...(body ? { "Content-Type": "application/json" } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		}).catch((error) => {
			throw new Error(`GitHub ${method} ${path} failed (transport)`, {
				cause: error,
			});
		});
		if (allow404 && response.status === 404) return null;
		requireValue(
			response.ok,
			`GitHub ${method} ${path} failed (${response.status})`,
		);
		return response.status === 204
			? null
			: response.json().catch((error) => {
					throw new Error(`GitHub ${method} ${path} failed (invalid JSON)`, {
						cause: error,
					});
				});
	}
	async function pages(path, key) {
		const result = [];
		for (let page = 1; page <= 100; page++) {
			const value = await api(
				`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
			);
			const batch = key ? value[key] : value;
			requireValue(Array.isArray(batch), "Invalid paginated provider response");
			result.push(...batch);
			if (batch.length < 100) return result;
		}
		throw new Error(
			"Provider pagination exceeds 10,000 entries; refusing incomplete state",
		);
	}
	async function bytes(asset) {
		requireValue(
			asset.browser_download_url?.startsWith(
				`https://github.com/${REPOSITORY}/releases/download/`,
			) &&
				asset.state === "uploaded" &&
				/^sha256:[a-f0-9]{64}$/.test(asset.digest),
			"Unverified public asset URL/digest",
		);
		const response = await transport(asset.browser_download_url).catch(
			(error) => {
				throw new Error("Public asset download failed", { cause: error });
			},
		);
		requireValue(response.ok, "Public asset download failed");
		const bytes = Buffer.from(
			await response.arrayBuffer().catch((error) => {
				throw new Error("Public asset download failed", { cause: error });
			}),
		);
		requireValue(
			bytes.length === asset.size && sha256(bytes) === asset.digest.slice(7),
			"Published asset checksum mismatch",
		);
		return bytes;
	}
	return { api, pages, bytes, headers, transport };
}
export function verifyAssetInventory(
	assets,
	records,
	{ complete = false } = {},
) {
	requireValue(
		new Set(assets.map((a) => a.name)).size === assets.length,
		"Duplicate immutable release assets",
	);
	for (const r of records) {
		const a = assets.find((a) => a.name === r.file);
		requireValue(
			a &&
				a.state === "uploaded" &&
				a.size === r.size &&
				a.digest === `sha256:${r.sha256}`,
			`Immutable asset missing or conflicting: ${r.file}`,
		);
	}
	if (complete)
		requireValue(
			assets.length === records.length,
			"Unexpected immutable release assets",
		);
}
export async function verifyPublishedRelease(client, release, keys) {
	requireValue(
		!release.draft && release.published_at,
		"Release is not published",
	);
	const assets = await client.pages(`releases/${release.id}/assets`);
	const asset = (file) => {
		const a = assets.filter((a) => a.name === file);
		requireValue(a.length === 1, `Missing signature or manifest: ${file}`);
		requireValue(
			a[0].browser_download_url ===
				`https://github.com/${REPOSITORY}/releases/download/${release.tag_name}/${file}`,
			"Unexpected immutable asset download URL",
		);
		return a[0];
	};
	const bytes = await client.bytes(asset("release.json"));
	const signature = await client.bytes(asset("release.json.sig"));
	const keyId = (await client.bytes(asset("release.json.key-id")))
		.toString("utf8")
		.trim();
	verifyManifestSignature(bytes, signature, keyId, keys);
	const manifest = validateReleaseManifest(JSON.parse(bytes.toString("utf8")));
	requireValue(
		manifest.status === "available" &&
			manifest.tag === release.tag_name &&
			release.prerelease === manifest.version.includes("-"),
		"Manifest tag/channel mismatch",
	);
	let records = releaseAssetRecords(manifest);
	let attestation;
	if (manifest.schemaVersion === 1) {
		requireValue(
			/-beta(?:\.\d+)?$/.test(manifest.version),
			"Only historical beta supports signed attestation",
		);
		const attBytes = await client.bytes(asset("release-attestation.json"));
		verifyManifestSignature(
			attBytes,
			await client.bytes(asset("release-attestation.json.sig")),
			(await client.bytes(asset("release-attestation.json.key-id")))
				.toString()
				.trim(),
			keys,
		);
		attestation = JSON.parse(attBytes);
		requireValue(
			attestation.schemaVersion === 1 &&
				attestation.product === "bobs-factory" &&
				attestation.repository === manifest.repository &&
				attestation.tag === manifest.tag &&
				attestation.commit === manifest.commit &&
				attestation.version === manifest.version &&
				attestation.manifest?.file === "release.json" &&
				attestation.manifest?.sha256 === sha256(bytes) &&
				attestation.manifest.size === bytes.length &&
				Array.isArray(attestation.assets),
			"Historical beta attestation mismatch",
		);
		records = attestation.assets;
		for (const r of releaseAssetRecords(manifest))
			requireValue(
				records.some(
					(a) =>
						a.file === r.file && a.sha256 === r.sha256 && a.size === r.size,
				),
				"Beta inventory mismatch",
			);
		for (const file of [
			"release-evidence.json",
			"validation-receipts.tar.gz",
			"build-provenance.json",
			...["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"].flatMap(
				(t) => [
					`runtime-smoke-${t}.txt`,
					`native-helpers-${t}.json`,
					`prepared-agent-boundaries-${t}.json`,
				],
			),
		])
			requireValue(
				records.some((a) => a.file === file),
				"Incomplete beta evidence inventory",
			);
	}
	verifyAssetInventory(assets, records);
	if (manifest.schemaVersion === 2) {
		const frozen = validateCandidate(
			JSON.parse(await client.bytes(asset("candidate.json"))),
		);
		requireValue(
			frozen.digest === manifest.candidateDigest &&
				frozen.candidate.commit === manifest.commit &&
				frozen.candidate.version === manifest.version &&
				frozen.candidate.workflowSha === manifest.workflowSha,
			"Published candidate identity mismatch",
		);
	}
	const tag = await client.api(`git/ref/tags/${release.tag_name}`);
	let object = tag.object;
	for (let i = 0; object?.type === "tag" && i < 5; i++)
		object = (await client.api(`git/tags/${object.sha}`)).object;
	requireValue(
		object?.type === "commit" && object.sha === manifest.commit,
		"Published tag source mismatch",
	);
	return {
		release: { ...release, assets },
		manifest,
		bytes,
		signature,
		keyId,
		attestation,
		manifestSha256: sha256(bytes),
	};
}
export async function discoverReleases(
	client,
	keys,
	{ selectedOnly = false, allowBetaFallback = true } = {},
) {
	validatePublicRepository(await client.api(""));
	const releases = await client.pages("releases");
	const verified = [];
	const rejected = [];
	async function verify(release) {
		if (
			release.draft ||
			!release.tag_name?.startsWith("v") ||
			!release.assets?.some((a) => a.name === "release.json")
		)
			return;
		try {
			verified.push(await verifyPublishedRelease(client, release, keys));
		} catch (error) {
			// Transport failure cannot turn into an empty channel or stale successful build.
			if (
				/download failed|GitHub .* failed|checksum mismatch/.test(error.message)
			)
				throw error;
			rejected.push({ tag: release.tag_name, reason: error.message });
		}
	}
	if (selectedOnly) {
		// Fully verify the newest usable target in each channel, without spending
		// provider quota on older releases once that target is established.
		for (const channel of ["stable", "nightly"]) {
			let remaining =
				channel === "stable" && !allowBetaFallback
					? releases.filter((r) => !r.prerelease)
					: [...releases];
			while (remaining.length) {
				const release = selectPublicRelease(remaining, channel);
				if (!release) break;
				await verify(release);
				if (verified.some((v) => v.release.id === release.id)) break;
				remaining = remaining.filter((r) => r.id !== release.id);
			}
		}
	} else {
		for (const release of releases) await verify(release);
	}
	const select = (channel) => {
		const r = selectPublicRelease(
			verified
				.map((v) => v.release)
				.filter(
					(r) => channel !== "stable" || allowBetaFallback || !r.prerelease,
				),
			channel,
		);
		return verified.find((v) => v.release.id === r?.id) ?? null;
	};
	return {
		// Provider publication history remains authoritative for ordering, even
		// when this frozen tool's pinned keys cannot verify a newer release.
		published: releases.filter((r) => !r.draft),
		stable: select("stable"),
		nightly: select("nightly"),
		verified,
		rejected,
	};
}

// Eligibility needs the newest published source and clock, not a discovery
// fallback. Include incomplete releases: missing assets cannot erase history.
export function requireVerifiedNightlyHistory(state) {
	const published = state.published.filter(
		(r) => !r.draft && releaseChannel(r.tag_name?.slice(1)) === "nightly",
	);
	if (!published.length) return null;
	const last = state.nightly;
	const sequence = (r) => BigInt(r.tag_name.split(".").at(-1));
	requireValue(
		last &&
			published.every(
				(r) =>
					sequence(r) < sequence(last.release) ||
					(sequence(r) === sequence(last.release) && r.id === last.release.id),
			),
		"Nightly preparation/publication blocked: latest published nightly cannot be verified; refresh trusted release tooling or repair release evidence",
	);
	return last;
}

// Stable promotion is an operator selection, independent of nightly eligibility.
export function selectVerifiedPromotionNightly(state, tag) {
	requireValue(
		tag?.startsWith("v") && releaseChannel(tag.slice(1)) === "nightly",
		"Stable promotion requires --nightly-tag with an exact published nightly tag",
	);
	const selected = state.verified.filter(
		(n) => n.manifest.tag === tag && n.manifest.channel === "nightly",
	);
	requireValue(
		selected.length === 1,
		"Stable promotion blocked: selected nightly is not a complete signed published release",
	);
	return selected[0];
}
