import {
	createReadStream,
	existsSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	jsonBytes,
	requireValue,
	validatePublicRepository,
} from "./binary-release.mjs";
import { verifyAssetInventory } from "./github-release.mjs";
import { PublicationSkip } from "./release-candidate.mjs";

// Caller holds the repository-wide mutation lock. Provider state is authoritative.
export async function publishPreparedRelease({
	client,
	manifest,
	records,
	assetsDirectory,
	receiptPath,
	recheck,
}) {
	const marker = `<!-- bobs-factory-candidate:${manifest.candidateDigest} -->`;
	const previous = existsSync(receiptPath)
		? JSON.parse(readFileSync(receiptPath, "utf8"))
		: null;
	if (previous)
		requireValue(
			previous.candidateDigest === manifest.candidateDigest &&
				previous.tag === manifest.tag &&
				JSON.stringify(previous.assets) === JSON.stringify(records),
			"Publication receipt conflicts with prepared bytes",
		);
	const receipt = previous ?? {
		schemaVersion: 1,
		candidateDigest: manifest.candidateDigest,
		tag: manifest.tag,
		assets: records,
		stages: [],
		synchronization: "pending",
	};
	const persist = () => {
		writeFileSync(`${receiptPath}.tmp`, jsonBytes(receipt));
		renameSync(`${receiptPath}.tmp`, receiptPath);
	};
	const stage = (name) => {
		if (!receipt.stages.includes(name)) receipt.stages.push(name);
		persist();
	};
	async function eligibility() {
		try {
			await recheck();
		} catch (error) {
			if (error instanceof PublicationSkip) {
				receipt.outcome = "skipped";
				receipt.eligibility = error.result;
				persist();
			}
			throw error;
		}
	}
	async function currentRelease() {
		const releases = await client.pages("releases");
		const matches = releases.filter((r) => r.tag_name === manifest.tag);
		requireValue(matches.length <= 1, "Ambiguous release identity");
		const r = matches[0];
		if (r)
			requireValue(
				r.body?.includes(marker) &&
					r.prerelease === (manifest.channel !== "stable"),
				"Conflicting release candidate identity",
			);
		return r;
	}
	async function verifiedTag(allow404 = false) {
		const ref = await client.api(`git/ref/tags/${manifest.tag}`, { allow404 });
		if (!ref) return null;
		requireValue(
			ref.object?.type === "tag",
			"Release tag lacks frozen candidate identity",
		);
		const annotated = await client.api(`git/tags/${ref.object.sha}`);
		requireValue(
			annotated.tag === manifest.tag &&
				annotated.message?.trim() === marker &&
				annotated.object?.type === "commit" &&
				annotated.object.sha === manifest.commit,
			"Conflicting immutable tag source/candidate",
		);
		receipt.tagId = ref.object.sha;
		return ref;
	}
	validatePublicRepository(await client.api(""));
	let release = await currentRelease();
	let tag = await verifiedTag(true);
	if (!release || release.draft) await eligibility();
	if (!tag) {
		const annotated = await client.api("git/tags", {
			method: "POST",
			body: {
				tag: manifest.tag,
				message: marker,
				object: manifest.commit,
				type: "commit",
			},
		});
		try {
			await client.api("git/refs", {
				method: "POST",
				body: { ref: `refs/tags/${manifest.tag}`, sha: annotated.sha },
			});
		} catch (error) {
			tag = await verifiedTag(true);
			if (!tag) throw error;
		}
		tag = await verifiedTag();
	}
	stage("tag-verified");
	if (!release) {
		try {
			release = await client.api("releases", {
				method: "POST",
				body: {
					tag_name: manifest.tag,
					target_commitish: manifest.commit,
					name: `Bob’s Factory ${manifest.version}`,
					draft: true,
					prerelease: manifest.channel !== "stable",
					make_latest: "false",
					body: `Verified native binaries. Frozen source: ${manifest.commit}\n${marker}`,
				},
			});
		} catch (error) {
			release = await currentRelease();
			if (!release) throw error;
		}
	}
	receipt.releaseId = release.id;
	stage("release-identified");
	let remote = await client.pages(`releases/${release.id}/assets`);
	requireValue(
		new Set(remote.map((a) => a.name)).size === remote.length,
		"Duplicate immutable release assets",
	);
	for (const a of remote)
		requireValue(
			records.some((r) => r.file === a.name),
			"Unexpected immutable release asset",
		);
	for (const record of records) {
		const existing = remote.find((a) => a.name === record.file);
		if (existing) {
			verifyAssetInventory([existing], [record]);
			continue;
		}
		requireValue(
			release.draft,
			"Public release is incomplete; never append automatically",
		);
		try {
			const response = await client.transport(
				`https://uploads.github.com/repos/jappyjan/bobs-factory/releases/${release.id}/assets?name=${encodeURIComponent(record.file)}`,
				{
					method: "POST",
					headers: {
						...client.headers,
						"Content-Type": "application/octet-stream",
						"Content-Length": String(record.size),
					},
					body: createReadStream(join(assetsDirectory, record.file)),
					duplex: "half",
				},
			);
			requireValue(
				response.ok,
				`Upload failed: ${record.file} (${response.status})`,
			);
			verifyAssetInventory([await response.json()], [record]);
		} catch (error) {
			remote = await client.pages(`releases/${release.id}/assets`);
			const uploaded = remote.filter((a) => a.name === record.file);
			if (!uploaded.length) throw error;
			verifyAssetInventory(uploaded, [record], { complete: true });
		}
	}
	remote = await client.pages(`releases/${release.id}/assets`);
	verifyAssetInventory(remote, records, { complete: true });
	stage("remote-inventory-verified");
	tag = await verifiedTag();
	release = await currentRelease();
	if (release.draft) {
		await eligibility();
		validatePublicRepository(await client.api(""));
		try {
			await client.api(`releases/${release.id}`, {
				method: "PATCH",
				body: {
					draft: false,
					prerelease: manifest.channel !== "stable",
					make_latest: manifest.channel === "stable" ? "true" : "false",
				},
			});
		} catch (error) {
			release = await currentRelease();
			if (!release || release.draft) throw error;
		}
		release = await currentRelease();
		requireValue(
			!release.draft && release.published_at,
			"Provider has not confirmed publication",
		);
	}
	verifyAssetInventory(
		await client.pages(`releases/${release.id}/assets`),
		records,
		{ complete: true },
	);
	stage("published");
	if (receipt.synchronization === "dispatched") return receipt;
	try {
		await client.api("actions/workflows/website.yml/dispatches", {
			method: "POST",
			body: { ref: "main" },
		});
		receipt.synchronization = "dispatched";
		stage("discovery-dispatched");
	} catch (error) {
		receipt.synchronization = "failed";
		receipt.synchronizationError = error.message;
		persist();
		throw new Error(
			"Publication succeeded; website synchronization failed. Retry this exact prepared inventory; do not rebuild or move the tag.",
		);
	}
	return receipt;
}
