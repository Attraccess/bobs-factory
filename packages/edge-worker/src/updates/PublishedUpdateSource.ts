import { execFile } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import releaseKeys from "../../../../docs/distribution/release-keys.json" with {
	type: "json",
};
import {
	discoverReleases,
	githubClient,
	type ReleaseAsset,
	type ReleaseClient,
	type VerifiedRelease,
	verifyPublishedRelease,
} from "../../../../scripts/lib/github-release.mjs";
import type {
	InstalledUpdate,
	StagedUpdate,
	UpdateCandidate,
	UpdateSettings,
	UpdateSource,
} from "./UpdateManager.js";

const runFile = promisify(execFile);

/** Public, credential-free canonical discovery; no generic latest or prerelease
 * ordering. The existing release verifier checks signatures, complete signed
 * inventory, frozen source identity and provider tag before choosing a target. */
export class PublishedUpdateSource implements UpdateSource {
	constructor(
		private readonly directory: string,
		private readonly previousExecutable: string,
		private readonly target: string,
		private readonly client: ReleaseClient = githubClient("", (url, options) =>
			fetch(url, { ...options, signal: AbortSignal.timeout(60_000) }),
		),
		private readonly keys: Record<string, unknown> = releaseKeys.keys,
	) {}
	private candidate(
		value: VerifiedRelease,
		channel: UpdateSettings["channel"],
	): UpdateCandidate {
		if (!value.manifest.targets[this.target])
			throw new Error(`Release has no ${this.target} artifact`);
		return {
			version: value.manifest.version,
			commit: value.manifest.commit,
			channel,
			target: this.target as UpdateCandidate["target"],
			manifestSha256: value.manifestSha256,
			publishedAt: value.release.published_at,
		};
	}
	async discover(settings: UpdateSettings, _installed: InstalledUpdate) {
		if (settings.pin) {
			const release = await this.client.api(`releases/tags/v${settings.pin}`);
			const verified = await verifyPublishedRelease(
				this.client,
				release,
				this.keys,
			);
			const nightly = verified.manifest.channel === "nightly";
			if (nightly !== (settings.channel === "nightly"))
				throw new Error("Pinned version belongs to another channel.");
			return this.candidate(verified, settings.channel);
		}
		const state = await discoverReleases(this.client, this.keys, {
			selectedOnly: true,
		});
		const value = settings.channel === "nightly" ? state.nightly : state.stable;
		return value ? this.candidate(value, settings.channel) : undefined;
	}
	async stage(candidate: UpdateCandidate): Promise<StagedUpdate> {
		// Reauthenticate immutable release rather than trusting cached local metadata.
		const verified = await verifyPublishedRelease(
			this.client,
			await this.client.api(`releases/tags/v${candidate.version}`),
			this.keys,
		);
		const selected = this.candidate(verified, candidate.channel);
		if (JSON.stringify(selected) !== JSON.stringify(candidate))
			throw new Error("Published candidate changed; check again.");
		const target = verified.manifest.targets[candidate.target]!;
		mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		const work = mkdtempSync(join(this.directory, "stage-"));
		const asset = (name: string, size: number, hash: string): ReleaseAsset => {
			const entry = verified.release.assets.find(
				(entry) => entry.name === name,
			);
			if (!entry || entry.size !== size || entry.digest !== `sha256:${hash}`)
				throw new Error("Asset is not bound to the signed release");
			return entry;
		};
		const downloads = [
			asset(target.archive, target.archiveSize, target.archiveSha256),
			asset(target.manifest, target.manifestSize, target.manifestSha256),
			asset(
				verified.manifest.verifier.file,
				verified.manifest.verifier.size,
				verified.manifest.verifier.sha256,
			),
		];
		for (const entry of downloads)
			writeFileSync(join(work, entry.name), await this.client.bytes(entry), {
				flag: "wx",
				mode: 0o600,
			});
		const sidecar = JSON.parse(
			readFileSync(join(work, target.manifest), "utf8"),
		);
		if (
			sidecar.commit !== candidate.commit ||
			sidecar.version !== candidate.version ||
			sidecar.target !== candidate.target
		)
			throw new Error(
				"Archive manifest identity does not match selected release",
			);
		const prefix = join(work, "runtime");
		await runFile(
			"sh",
			[
				join(work, verified.manifest.verifier.file),
				join(work, target.archive),
				join(work, target.manifest),
				prefix,
			],
			{ timeout: 120_000 },
		);
		const executable = join(
			prefix,
			"lib",
			"bobs-factory",
			`bobs-factory-${candidate.version}-${candidate.target}`,
			"bobs-factory",
		);
		// An isolated version probe cannot open the production home or launch agents.
		const probeHome = mkdtempSync(join(tmpdir(), "bobs-update-probe-"));
		try {
			const { stdout } = await runFile(
				executable,
				["--home", probeHome, "--version"],
				{ timeout: 30_000, env: { PATH: process.env.PATH, HOME: probeHome } },
			);
			if (stdout.trim() !== candidate.version)
				throw new Error("Staged executable version probe failed");
		} finally {
			rmSync(probeHome, { recursive: true, force: true });
		}

		return {
			candidate,
			executable,
			previousExecutable: this.previousExecutable,
		};
	}
}
