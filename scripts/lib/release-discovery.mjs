import {
	REPOSITORY,
	requireValue,
	sha256,
	validateReleaseManifest,
} from "./binary-release.mjs";
import {
	newestChannel,
	releaseChannel,
	validatePublicInventory,
} from "./release-channels.mjs";

export function githubClient(token = process.env.GH_TOKEN, transport = fetch) {
	const headers = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		...(token ? { Authorization: `Bearer ${token}` } : {}),
	};
	async function api(
		path,
		{ method = "GET", body, allow404 = false, paginate = false } = {},
	) {
		if (paginate) {
			const items = [];
			for (let page = 1; page <= 10; page++) {
				const batch = await api(
					`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
				);
				requireValue(Array.isArray(batch), "Invalid GitHub paginated response");
				items.push(...batch);
				if (batch.length < 100) return items;
			}
			throw new Error(
				"GitHub pagination limit exceeded; refusing incomplete discovery",
			);
		}
		const response = await transport(
			`https://api.github.com/repos/${REPOSITORY}${path ? `/${path}` : ""}`,
			{
				method,
				headers: {
					...headers,
					...(body ? { "Content-Type": "application/json" } : {}),
				},
				body: body ? JSON.stringify(body) : undefined,
			},
		);
		if (allow404 && response.status === 404) return null;
		requireValue(
			response.ok,
			`GitHub ${method} ${path} failed (${response.status})`,
		);
		return response.status === 204 ? null : response.json();
	}
	return { api, headers };
}
export async function readPublishedManifest(release, transport = fetch) {
	const matches =
		release?.assets?.filter((asset) => asset.name === "release.json") ?? [];
	requireValue(
		matches.length === 1 && release && !release.draft,
		"Missing, draft or ambiguous published manifest",
	);
	const asset = matches[0];
	const url = `https://github.com/${REPOSITORY}/releases/download/${release.tag_name}/release.json`;
	requireValue(
		asset.browser_download_url === url &&
			/^sha256:[a-f0-9]{64}$/.test(asset.digest),
		"Unverified public release manifest asset",
	);
	const response = await transport(url);
	requireValue(
		response.ok,
		`Could not retrieve public manifest (${response.status})`,
	);
	const bytes = Buffer.from(await response.arrayBuffer());
	requireValue(
		bytes.length === asset.size && sha256(bytes) === asset.digest.slice(7),
		"Published manifest checksum mismatch",
	);
	const manifest = validateReleaseManifest(JSON.parse(bytes.toString("utf8")));
	requireValue(
		manifest.schemaVersion === 2 ||
			releaseChannel(manifest.version) !== "nightly",
		"Legacy manifests cannot declare nightly candidates",
	);
	validatePublicInventory(release, manifest, {
		file: "release.json",
		size: bytes.length,
		sha256: sha256(bytes),
	});
	return { ...release, manifest, manifestSha256: sha256(bytes) };
}
export async function discoverChannels(api, transport = fetch) {
	const releases = await api("releases", { paginate: true });
	const entries = [];
	for (const release of releases) {
		if (
			release.draft ||
			!release.assets?.some((asset) => asset.name === "release.json")
		)
			continue;
		// Assets are independently paginated: the embedded list may be truncated.
		if (release.assets.length >= 100)
			release.assets = await api(`releases/${release.id}/assets`, {
				paginate: true,
			});
		entries.push(await readPublishedManifest(release, transport));
	}
	return {
		stable: newestChannel(entries, "stable"),
		nightly: newestChannel(entries, "nightly"),
		prerelease: newestChannel(entries, "prerelease"),
	};
}
