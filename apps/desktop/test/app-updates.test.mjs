import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileRecord, jsonBytes } from "../../../scripts/lib/binary-release.mjs";
import { preparedFixture } from "../../../scripts/tests/prepared-fixture.mjs";
import { keys, signBytes } from "../../../scripts/tests/release-fixtures.mjs";
import {
	digest,
	packApp,
	tree,
	unpackApp,
	validateEntries,
} from "../src/app-archive.mjs";
import { DesktopAppLifecycle, read, save } from "../src/app-lifecycle.mjs";
import {
	appFingerprint,
	DesktopAppSource,
	installationKind,
	verifyAppProof,
} from "../src/app-source.mjs";
import { appUpdates } from "../src/app-updates.mjs";
import * as services from "../src/update-services.mjs";

const work = () => mkdtempSync(join(tmpdir(), "bob-shell-test-"));
const identity = {
	version: "0.9.0",
	commit: "a".repeat(40),
	target: "linux-arm64",
};
const candidate = {
	...identity,
	version: "1.0.0-nightly.20261009.10",
	channel: "nightly",
	manifestSha256: "a".repeat(64),
	publishedAt: "2026-10-10T00:00:00Z",
};
test("first nightly shell subscribes to nightly idle-auto; saved stable/manual choices survive reopening a nightly app", async () => {
	const w = work(),
		home = join(w, "home"),
		install = join(w, "Bob.AppImage");
	try {
		writeFileSync(install, "fixture");
		const options = {
			home,
			install,
			target: identity.target,
			identity: { ...identity, version: candidate.version, channel: "nightly" },
			port: 3457,
			services,
		};
		const updates = await appUpdates(options);
		assert.equal(updates.status().settings.channel, "nightly");
		assert.equal(updates.status().effectivePolicy, "idle-auto");
		await updates.action(
			"configure",
			{ channel: "stable", policy: "manual" },
			updates.status().revision,
		);
		const reopened = await appUpdates(options);
		assert.equal(reopened.status().settings.channel, "stable");
		assert.equal(reopened.status().effectivePolicy, "manual");
	} finally {
		rmSync(w, { recursive: true, force: true });
	}
});
test("complete app archive preserves framework symlinks and modes; traversal/special ancestry fails before extraction", () => {
	const w = work();
	try {
		mkdirSync(join(w, "app", "Framework", "Versions", "A"), {
			recursive: true,
		});
		writeFileSync(
			join(w, "app", "Framework", "Versions", "A", "binary"),
			"Electron",
			{ mode: 0o755 },
		);
		symlinkSync("A", join(w, "app", "Framework", "Versions", "Current"));
		symlinkSync(
			"Versions/Current/binary",
			join(w, "app", "Framework", "binary"),
		);
		const packed = packApp(join(w, "app"));
		unpackApp(packed, join(w, "unpacked"));
		assert.deepEqual(tree(join(w, "unpacked")), tree(join(w, "app")));
		assert.throws(
			() => validateEntries([{ path: "../escape", kind: "directory" }]),
			/Unsafe/,
		);
		assert.throws(
			() =>
				validateEntries([{ path: "x", kind: "link", link: "../../escape" }]),
			/escapes/,
		);
		assert.throws(
			() =>
				validateEntries([
					{ path: "a", kind: "link", link: "b" },
					{ path: "b", kind: "directory" },
					{ path: "a/evil", kind: "directory" },
				]),
			/beneath link/,
		);
		assert.throws(
			() =>
				validateEntries([
					{ path: "a", kind: "link", link: "b" },
					{ path: "b", kind: "link", link: "a" },
				]),
			/cycle/,
		);
	} finally {
		rmSync(w, { recursive: true, force: true });
	}
});
test("signed app source binds exact payload, channel, target and full inventory; publisher tamper never stages", async () => {
	const f = preparedFixture("nightly", { desktop: true });
	try {
		const item = f.manifest.desktop.artifacts[0];
		item.target = "linux-arm64";
		const bytes = Buffer.from("controlled AppImage payload"),
			file = "controlled.AppImage";
		writeFileSync(join(f.assets, file), bytes);
		item.updateArchive = fileRecord(join(f.assets, file), file);
		const meta = {
			schemaVersion: 1,
			...f.identity,
			product: "bobs-factory-desktop",
			target: item.target,
			format: "AppImage",
			archive: item.updateArchive,
			fingerprint: digest(bytes),
		};
		writeFileSync(join(f.assets, item.updateMetadata.file), jsonBytes(meta));
		item.updateMetadata = fileRecord(
			join(f.assets, item.updateMetadata.file),
			item.updateMetadata.file,
		);
		writeFileSync(
			join(f.assets, item.validation.file),
			jsonBytes({
				product: "bobs-factory",
				status: "passed",
				...f.identity,
				target: item.target,
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
		const records = [
			...f.manifest.assets,
			...["release.json", "release.json.sig", "release.json.key-id"].map(
				(file) => fileRecord(join(f.assets, file), file),
			),
		];
		const release = {
			id: 1,
			tag_name: f.manifest.tag,
			published_at: "2026-10-10T00:00:00Z",
			draft: false,
			prerelease: true,
			assets: records.map((r) => ({
				name: r.file,
				size: r.size,
				digest: `sha256:${r.sha256}`,
				state: "uploaded",
				browser_download_url: `https://github.com/jappyjan/bobs-factory/releases/download/${f.manifest.tag}/${r.file}`,
			})),
		};
		const client = {
			api: async (path) =>
				path.startsWith("git/")
					? { object: { type: "commit", sha: f.identity.commit } }
					: release,
			pages: async () => release.assets,
			bytes: async (asset) => readFileSync(join(f.assets, asset.name)),
		};
		const source = new DesktopAppSource(
			join(f.work, "staging"),
			join(f.work, "Installed.AppImage"),
			"linux-arm64",
			services,
			client,
			keys,
		);
		const selected = await source.discover({
			channel: "nightly",
			pin: f.identity.version,
		});
		const staged = await source.stage(selected);
		assert.equal(
			appFingerprint(staged.executable, "linux-arm64"),
			digest(bytes),
		);
		await assert.rejects(
			() => source.stage({ ...selected, commit: "f".repeat(40) }),
			/changed/,
		);
		await assert.rejects(
			() => source.discover({ channel: "stable", pin: f.identity.version }),
			/channel/,
		);
		writeFileSync(join(f.assets, item.updateArchive.file), "tamper");
		await assert.rejects(() => source.stage(selected), /digest/);
	} finally {
		f.cleanup();
	}
});
function signedProof(fingerprint, target = candidate.target) {
	const f = preparedFixture("nightly", { desktop: true });
	try {
		const item = f.manifest.desktop.artifacts[0];
		item.target = target;
		const metadata = {
			...f.identity,
			schemaVersion: 1,
			product: "bobs-factory-desktop",
			format: target.startsWith("darwin") ? "bobs-app-v1" : "AppImage",
			osSigning: "unsigned",
			target,
			fingerprint,
			archive: item.archive,
		};
		const bytes = jsonBytes(metadata);
		item.updateMetadata = {
			file: item.updateMetadata.file,
			size: bytes.length,
			sha256: digest(bytes),
		};
		f.manifest.assets = f.manifest.assets.map((r) =>
			r.file === item.updateMetadata.file ? item.updateMetadata : r,
		);
		const manifest = jsonBytes(f.manifest),
			signedCandidate = {
				...candidate,
				target,
				manifestSha256: digest(manifest),
			};
		return {
			candidate: signedCandidate,
			proof: {
				manifest: manifest.toString("base64"),
				signature: signBytes(manifest).toString("base64"),
				keyId: "fixture",
				metadata: bytes.toString("base64"),
				fingerprint,
			},
		};
	} finally {
		f.cleanup();
	}
}
test("user-owned DMG app is eligible but unsigned macOS publisher receipts cannot authorize it; external symlink handoff remains", () => {
	const w = work();
	try {
		const app = join(w, "Bob.app");
		mkdirSync(app);
		assert.equal(installationKind(app, "darwin-arm64"), "bob-owned");
		symlinkSync(app, join(w, "External.app"));
		assert.equal(
			installationKind(join(w, "External.app"), "darwin-arm64"),
			"external",
		);
		const signed = signedProof("a".repeat(64), "darwin-arm64");
		assert.throws(
			() =>
				verifyAppProof(signed.proof, signed.candidate, {
					...services,
					trustedKeys: keys,
				}),
			/authentic macOS signing/,
		);
	} finally {
		rmSync(w, { recursive: true, force: true });
	}
});
function setup() {
	const w = work(),
		home = join(w, "home"),
		install = join(w, "UI.AppImage"),
		directory = join(home, "desktop", "updates");
	mkdirSync(directory, { recursive: true });
	writeFileSync(install, "old", { mode: 0o755 });
	const selected = signedProof(digest(Buffer.from("new")));
	const source = {
		discover: async () => selected.candidate,
		stage: async () => {
			const p = join(w, "stage");
			mkdirSync(p, { recursive: true });
			const executable = join(p, "New.AppImage");
			writeFileSync(executable, "new", { mode: 0o755 });
			save(join(p, "verified.json"), {
				...selected,
				metadata: { fingerprint: digest(Buffer.from("new")) },
			});
			return {
				candidate: selected.candidate,
				executable,
				previousExecutable: install,
			};
		},
	};
	const receipt = {
		schema: 1,
		install,
		target: identity.target,
		fingerprint: appFingerprint(install, identity.target),
		...signedProof(appFingerprint(install, identity.target)),
	};
	save(join(directory, "installation.json"), receipt);
	const events = [];
	const s = {
		...services,
		trustedKeys: keys,
		workerOwner: () => undefined,
		lifecycleGuard: async () => () => {},
		FactoryClient: class {},
	};
	const life = new DesktopAppLifecycle(
		{
			home,
			install,
			target: identity.target,
			directory,
			uiPid: 999999,
			uiStamp: "absent",
		},
		s,
	);
	life.stop = async () => events.push("UI exit");
	life.start = async () => events.push("UI launch");
	life.health = async () => events.push("health");
	life.rollback = async (transaction) => {
		events.push("rollback");
		const snapshot = read(transaction.snapshot);
		const { renameSync } = await import("node:fs");
		renameSync(install, `${install}.failed`);
		renameSync(snapshot.previous, install);
		save(life.receipt, snapshot.receipt);
	};
	return {
		w,
		home,
		install,
		events,
		life,
		manager: new services.UpdateManager(
			join(home, "desktop"),
			source,
			life,
			identity,
		),
	};
}
test("nightly app replacement keeps runtime state, old app and policy; failed health rolls back and suppresses candidate", async () => {
	const f = setup();
	try {
		const runtime = join(f.home, "runtime");
		mkdirSync(runtime);
		writeFileSync(
			join(runtime, "sentinel"),
			"checkpoint/native session/auth/worktree untouched",
		);
		f.manager.configure({ channel: "nightly" }, 0);
		await f.manager.tick();
		assert.equal(f.manager.status().transaction.phase, "succeeded");
		assert.equal(readFileSync(f.install, "utf8"), "new");
		assert.equal(
			readFileSync(join(runtime, "sentinel"), "utf8"),
			"checkpoint/native session/auth/worktree untouched",
		);
		assert.deepEqual(f.events, ["UI exit", "UI launch", "health"]);
	} finally {
		rmSync(f.w, { recursive: true, force: true });
	}
	const r = setup();
	try {
		r.life.health = async () => {
			throw Error("candidate failed health");
		};
		r.manager.configure({ channel: "nightly" }, 0);
		await r.manager.tick();
		assert.equal(r.manager.status().transaction.phase, "rolled-back");
		assert.equal(readFileSync(r.install, "utf8"), "old");
		await r.manager.tick();
		assert.equal(r.events.filter((x) => x === "UI exit").length, 1);
		assert.equal(r.manager.status().badCandidates.length, 1);
	} finally {
		rmSync(r.w, { recursive: true, force: true });
	}
});
for (const patch of [
	{ paused: true },
	{ pin: "2.0.0" },
	{ channel: "stable" },
	{ policy: "manual" },
])
	test(`app final authorization rejects raced policy ${JSON.stringify(patch)}`, async () => {
		const f = setup();
		try {
			f.manager.configure({ channel: "nightly" }, 0);
			await f.manager.check();
			await f.manager.stage();
			const preflight = f.life.preflight.bind(f.life);
			f.life.preflight = async (staged) => {
				const result = await preflight(staged);
				f.manager.configure(patch, f.manager.status().revision);
				return result;
			};
			await f.manager.reconcile();
			assert.equal(f.manager.status().transaction.phase, "cancelled");
			assert.equal(f.events.length, 0);
			assert.equal(readFileSync(f.install, "utf8"), "old");
		} finally {
			rmSync(f.w, { recursive: true, force: true });
		}
	});
test("stable requires exact candidate Install; Quit is never consent, stale receipt rejects", async () => {
	const f = setup();
	try {
		f.manager.configure({ channel: "nightly", policy: "manual" }, 0);
		await f.manager.check();
		await f.manager.stage();
		await f.manager.reconcile();
		assert.equal(f.events.length, 0);
		f.manager.requestInstall(
			services.candidateKey(f.manager.status().pending.candidate),
			f.manager.status().revision,
		);
		writeFileSync(f.install, "external replacement");
		await f.manager.reconcile();
		assert.equal(f.events.length, 0);
		assert.equal(f.manager.status().transaction.phase, "recovery-required");
		assert.equal(
			installationKind(join(f.w, "missing.AppImage"), "linux-arm64"),
			"external",
		);
	} finally {
		rmSync(f.w, { recursive: true, force: true });
	}
});
test("forged staged fingerprint/receipt never executes, including self-consistent local tampering", async () => {
	const f = setup();
	try {
		f.manager.configure({ channel: "nightly" }, 0);
		await f.manager.check();
		await f.manager.stage();
		const staged = f.manager.status().pending.staged;
		writeFileSync(staged.executable, "forged app");
		const proofFile = join(f.w, "stage", "verified.json"),
			proof = read(proofFile);
		proof.metadata.fingerprint = digest(Buffer.from("forged app"));
		save(proofFile, proof);
		await f.manager.reconcile();
		assert.equal(f.events.length, 0);
		assert.equal(readFileSync(f.install, "utf8"), "old");
		const receipt = read(f.life.receipt);
		writeFileSync(f.install, "forged install");
		receipt.fingerprint = appFingerprint(f.install, identity.target);
		save(f.life.receipt, receipt);
		assert.throws(() => f.life.assertOwner(), /integrity changed/);
	} finally {
		rmSync(f.w, { recursive: true, force: true });
	}
});
