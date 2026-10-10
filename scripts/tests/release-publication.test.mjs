import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sha256, sha256File } from "../lib/binary-release.mjs";
import { validatePreparedRelease } from "../lib/prepared-release.mjs";
import { withPublicationLock } from "../lib/publication-lock.mjs";
import { verifyManifestSignature } from "../lib/release-signature.mjs";
import { preparedFixture } from "./prepared-fixture.mjs";
import { keys } from "./release-fixtures.mjs";

const transport = fileURLToPath(
	new URL("./publication-transport.mjs", import.meta.url),
);
function setup(channel = "nightly", state = {}) {
	const f = preparedFixture(channel),
		provider = join(f.work, "provider.json"),
		approval = join(f.work, "approval.json");
	writeFileSync(
		provider,
		JSON.stringify({
			assets: [],
			operations: [],
			mainSha: f.identity.commit,
			...state,
		}),
	);
	writeFileSync(
		approval,
		JSON.stringify({
			candidateDigest: f.candidate.digest,
			assetsDigest: f.assetsDigest,
			approvedBy: "fixture-maintainer",
		}),
	);
	const run = (publish = true, extra = []) =>
		spawnSync(
			process.execPath,
			[
				"--import",
				transport,
				join(f.work, "scripts/publish-binary-release.mjs"),
				"--candidate",
				join(f.assets, "candidate.json"),
				"--run-id",
				"123",
				"--output",
				f.output,
				"--resume",
				"--approval",
				approval,
				...(publish ? ["--publish"] : []),
				...extra,
			],
			{
				encoding: "utf8",
				env: {
					...process.env,
					GH_TOKEN: "synthetic-test-token",
					BOBS_FACTORY_RELEASE_SIGNING_KEY_FILE: "",
					BOBS_FACTORY_AUTOMATIC_NIGHTLIES: "enabled",
					BOBS_FACTORY_RELEASE_PUBLICATION_LOCK: "repository",
					BOBS_FACTORY_TEST_PROVIDER: provider,
				},
			},
		);
	return {
		...f,
		provider,
		approval,
		run,
		state: () => JSON.parse(readFileSync(provider)),
	};
}
test("prepared validation rejects modified binary bytes, missing gates and different recipes", () => {
	const f = preparedFixture();
	try {
		validatePreparedRelease(f.assets, f.candidate);
		const path = join(f.assets, "native-helpers-linux-x64.json"),
			bytes = readFileSync(path);
		writeFileSync(path, "corrupt");
		assert.throws(
			() => validatePreparedRelease(f.assets, f.candidate),
			/Prepared asset changed/,
		);
		writeFileSync(path, bytes);
		assert.throws(
			() =>
				validatePreparedRelease(f.assets, {
					...f.candidate,
					digest: "f".repeat(64),
				}),
			/requested identity/,
		);
	} finally {
		f.cleanup();
	}
});
test("publisher dry run makes no remote calls and produces candidate-bound assets digest", () => {
	const f = setup();
	try {
		const r = f.run(false);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(f.state().operations.length, 0);
		const plan = JSON.parse(
			readFileSync(join(f.output, "publication-plan.json")),
		);
		assert.equal(plan.assetsDigest, f.assetsDigest);
		assert.equal(plan.candidateDigest, f.candidate.digest);
	} finally {
		f.cleanup();
	}
});
for (const fault of [
	"tag-after",
	"draft-after",
	"upload-after:build-provenance.json",
	"publish-after",
])
	test(`publisher reconciles ${fault} without duplicate immutable mutations`, () => {
		const f = setup("nightly", { fault });
		try {
			const r = f.run();
			assert.equal(r.status, 0, r.stderr);
			const before = f.state();
			assert.equal(before.release.draft, false);
			assert.equal(before.release.prerelease, true);
			assert.equal(before.release.make_latest, "false");
			assert.equal(before.assets.length, f.records.length);
			const retry = f.run();
			assert.equal(retry.status, 0, retry.stderr);
			const after = f.state();
			assert.deepEqual(after.assets, before.assets);
			const mutations = after.operations
				.slice(before.operations.length)
				.filter((o) => o.method !== "GET");
			assert.deepEqual(mutations, []);
		} finally {
			f.cleanup();
		}
	});
test("partial upload resumes only missing assets and Pages recovery only dispatches synchronization", () => {
	const f = setup("nightly", { fault: "upload-before:candidate.json" });
	try {
		const first = f.run();
		assert.notEqual(first.status, 0);
		const partial = f.state();
		assert.equal(partial.release.draft, true);
		assert.ok(partial.assets.length > 0);
		const second = f.run();
		assert.equal(second.status, 0, second.stderr);
		const after = f.state();
		for (const a of partial.assets)
			assert.equal(after.assets.filter((b) => b.name === a.name).length, 1);
		// Force a fresh failed synchronization receipt while preserving the public provider state.
		const receiptPath = join(f.output, "publication-receipt.json");
		const receipt = JSON.parse(readFileSync(receiptPath));
		receipt.synchronization = "pending";
		writeFileSync(receiptPath, JSON.stringify(receipt));
		writeFileSync(f.provider, JSON.stringify({ ...f.state(), fault: "pages" }));
		const failure = f.run();
		assert.notEqual(failure.status, 0);
		assert.match(failure.stderr, /Publication succeeded/);
		const previous = f.state();
		const recovered = f.run();
		assert.equal(recovered.status, 0, recovered.stderr);
		assert.deepEqual(
			f
				.state()
				.operations.slice(previous.operations.length)
				.filter((o) => o.method !== "GET"),
			[
				{
					method: "POST",
					path: "/repos/jappyjan/bobs-factory/actions/workflows/website.yml/dispatches",
				},
			],
		);
	} finally {
		f.cleanup();
	}
});
test("conflicting tag, candidate and immutable assets are never replaced", () => {
	for (const conflict of ["tag", "candidate", "bytes", "duplicate"]) {
		const f = setup();
		try {
			assert.equal(f.run().status, 0);
			const state = f.state();
			if (conflict === "tag") state.annotation.object.sha = "f".repeat(40);
			if (conflict === "candidate") state.release.body = "other candidate";
			if (conflict === "bytes")
				state.assets[0].digest = `sha256:${"f".repeat(64)}`;
			if (conflict === "duplicate") state.assets.push({ ...state.assets[0] });
			writeFileSync(f.provider, JSON.stringify(state));
			const r = f.run();
			assert.notEqual(r.status, 0);
			assert.deepEqual(
				f
					.state()
					.operations.slice(state.operations.length)
					.filter((o) => o.method !== "GET"),
				[],
			);
		} finally {
			f.cleanup();
		}
	}
});
test("stable approval binds exact signed asset bytes and stable publication sets latest", () => {
	const f = setup("stable");
	try {
		writeFileSync(
			f.approval,
			JSON.stringify({
				candidateDigest: f.candidate.digest,
				assetsDigest: "f".repeat(64),
				approvedBy: "fixture",
			}),
		);
		assert.notEqual(f.run().status, 0);
		assert.equal(f.state().operations.length, 0);
		writeFileSync(
			f.approval,
			JSON.stringify({
				candidateDigest: f.candidate.digest,
				assetsDigest: f.assetsDigest,
				approvedBy: "fixture",
			}),
		);
		const r = f.run();
		assert.equal(r.status, 0, r.stderr);
		assert.equal(f.state().release.make_latest, "true");
		assert.equal(f.state().release.prerelease, false);
	} finally {
		f.cleanup();
	}
});
test("a newer stable signed by an unknown key blocks older tooling before any publication mutation", () => {
	const f = setup("stable"),
		newer = preparedFixture("stable", { stableVersion: "2.0.0" });
	try {
		const bytes = readFileSync(join(newer.assets, "release.json")),
			signature = readFileSync(join(newer.assets, "release.json.sig"));
		// The published signature is valid, but its newly named key is absent
		// from the older candidate's frozen trust store.
		verifyManifestSignature(bytes, signature, "rotated", {
			rotated: keys.fixture,
		});
		const assets = newer.records.map((record) => {
			const content =
				record.file === "release.json.key-id"
					? Buffer.from("rotated\n")
					: readFileSync(join(newer.assets, record.file));
			return {
				name: record.file,
				state: "uploaded",
				size: content.length,
				digest: `sha256:${sha256(content)}`,
				bytes: content.toString("base64"),
				browser_download_url: `https://github.com/jappyjan/bobs-factory/releases/download/${newer.manifest.tag}/${record.file}`,
			};
		});
		writeFileSync(
			f.provider,
			JSON.stringify({
				...f.state(),
				history: [
					{
						id: 100,
						tag_name: newer.manifest.tag,
						draft: false,
						prerelease: false,
						published_at: "2026-10-09T00:00:00Z",
						assets,
					},
				],
			}),
		);
		const result = f.run();
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /must be newer than/);
		assert.deepEqual(
			f.state().operations.filter((o) => o.method !== "GET"),
			[],
		);
	} finally {
		f.cleanup();
		newer.cleanup();
	}
});

for (const fallback of [false, true])
	test(`unverifiable latest nightly blocks preparation and publication${fallback ? " despite an older verified nightly" : ""}`, () => {
		const f = setup(),
			latest = preparedFixture("nightly", { sequence: 9 }),
			older = preparedFixture("nightly", { sequence: 8 });
		try {
			verifyManifestSignature(
				readFileSync(join(latest.assets, "release.json")),
				readFileSync(join(latest.assets, "release.json.sig")),
				"rotated",
				{ rotated: keys.fixture },
			);
			const historical = (fixture, id, keyId = "fixture") => ({
				id,
				tag_name: fixture.manifest.tag,
				commit: fixture.manifest.commit,
				draft: false,
				prerelease: true,
				published_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
				assets: fixture.records.map((record) => {
					const bytes =
						record.file === "release.json.key-id"
							? Buffer.from(`${keyId}\n`)
							: readFileSync(join(fixture.assets, record.file));
					return {
						name: record.file,
						state: "uploaded",
						size: bytes.length,
						digest: `sha256:${sha256(bytes)}`,
						bytes: bytes.toString("base64"),
						browser_download_url: `https://github.com/jappyjan/bobs-factory/releases/download/${fixture.manifest.tag}/${record.file}`,
					};
				}),
			});
			writeFileSync(
				f.provider,
				JSON.stringify({
					...f.state(),
					history: [
						historical(latest, 100, "rotated"),
						...(fallback ? [historical(older, 101)] : []),
					],
				}),
			);
			const publication = f.run();
			assert.notEqual(publication.status, 0);
			assert.match(
				publication.stderr,
				/latest published nightly cannot be verified/,
			);
			const output = join(f.work, "new-candidate.json");
			const preparation = spawnSync(
				process.execPath,
				[
					"--import",
					transport,
					join(f.work, "scripts/prepare-release-candidate.mjs"),
					"--channel",
					"nightly",
					"--output",
					output,
					"--workflow-sha",
					f.identity.workflowSha,
					"--sequence",
					"11",
					"--date",
					"2026-10-09T00:00:00Z",
				],
				{
					encoding: "utf8",
					env: {
						...process.env,
						GH_TOKEN: "synthetic",
						BOBS_FACTORY_TEST_PROVIDER: f.provider,
					},
				},
			);
			assert.notEqual(preparation.status, 0);
			assert.match(
				preparation.stderr,
				/latest published nightly cannot be verified/,
			);
			assert.equal(existsSync(output), false);
			assert.deepEqual(
				f.state().operations.filter((o) => o.method !== "GET"),
				[],
			);
		} finally {
			f.cleanup();
			latest.cleanup();
			older.cleanup();
		}
	});

test("stale nightly candidate does not create a tag or draft", () => {
	const f = setup("nightly", { mainSha: "f".repeat(40) });
	try {
		const r = f.run();
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /stale/);
		assert.deepEqual(
			f.state().operations.filter((o) => o.method !== "GET"),
			[],
		);
	} finally {
		f.cleanup();
	}
});

test("publication lock rejects overlapping versions and releases after failure", async () => {
	let entered = false;
	await assert.rejects(
		withPublicationLock(async () => {
			entered = true;
			await assert.rejects(
				withPublicationLock(async () => {
					assert.fail("Concurrent publication entered");
				}),
				/Another publication/,
			);
			throw new Error("Controlled publisher failure");
		}),
		/Controlled publisher failure/,
	);
	assert.equal(entered, true);
	await withPublicationLock(async () => {});
});

test("fresh preparation consumes exact artifact ZIPs and produces unsigned inspectable assets without mutations", () => {
	const f = preparedFixture("nightly", { gitTooling: true, desktop: true });
	try {
		const zips = join(f.work, "zips");
		mkdirSync(zips);
		const provenance = JSON.parse(
			readFileSync(join(f.assets, "build-provenance.json")),
		);
		for (const [target, artifact] of Object.entries(provenance.artifacts)) {
			const stage = join(f.work, `zip-${target}`);
			mkdirSync(stage);
			const name = `bobs-factory-${f.identity.version}-${target}`;
			for (const file of [`${name}.tar.gz`, `${name}.manifest.json`])
				copyFileSync(join(f.assets, file), join(stage, file));
			for (const receipt of [
				"runtime-smoke",
				"native-helpers",
				"prepared-agent-boundaries",
				"public-installer",
			])
				copyFileSync(
					join(
						f.assets,
						`${receipt}-${target}.${receipt === "runtime-smoke" ? "txt" : "json"}`,
					),
					join(
						stage,
						`${receipt}.${receipt === "runtime-smoke" ? "txt" : "json"}`,
					),
				);
			execFileSync(
				"zip",
				[
					"-q",
					join(zips, `${target}.zip`),
					`${name}.tar.gz`,
					`${name}.manifest.json`,
					"runtime-smoke.txt",
					"native-helpers.json",
					"prepared-agent-boundaries.json",
					"public-installer.json",
				],
				{ cwd: stage },
			);
			artifact.digest = `sha256:${sha256File(join(zips, `${target}.zip`))}`;
		}
		const provider = join(f.work, "provider.json"),
			output = join(f.work, "fresh");
		const contents = {
			"apps/cli/package.json": Buffer.from(
				JSON.stringify({ version: f.identity.committedVersion }),
			).toString("base64"),
			...Object.fromEntries(
				["install.sh", "install-binary.sh"].map((file) => [
					`scripts/${file}`,
					readFileSync(join(f.work, "scripts", file)).toString("base64"),
				]),
			),
		};
		writeFileSync(
			provider,
			JSON.stringify({
				assets: [],
				operations: [],
				buildProvenance: provenance,
				contents,
			}),
		);
		copyFileSync(join(f.work, "receipt.txt"), join(f.assets, "receipt.txt"));
		const r = spawnSync(
			process.execPath,
			[
				"--import",
				transport,
				join(f.work, "scripts/publish-binary-release.mjs"),
				"--candidate",
				join(f.assets, "candidate.json"),
				"--run-id",
				"123",
				"--evidence",
				join(f.assets, "release-evidence.json"),
				"--artifact-zips",
				zips,
				"--output",
				output,
			],
			{
				encoding: "utf8",
				env: {
					...process.env,
					GH_TOKEN: "synthetic",
					BOBS_FACTORY_TEST_PROVIDER: provider,
					BOBS_FACTORY_RELEASE_SIGNING_KEY_FILE: "",
				},
			},
		);
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(
			JSON.parse(readFileSync(provider)).operations.filter(
				(o) => o.method !== "GET",
			),
			[],
		);
		const plan = JSON.parse(
			readFileSync(join(output, "publication-plan.json")),
		);
		assert.equal(plan.candidateDigest, f.candidate.digest);
		assert.match(plan.signature, /blocked/);
		const prepared = validatePreparedRelease(
			join(output, "assets"),
			f.candidate,
		);
		assert.equal(
			prepared.manifest.desktop.artifacts[0].validation.file,
			"desktop-validation.json",
		);
	} finally {
		f.cleanup();
	}
});
