import { execFileSync } from "node:child_process";
import {
	accessSync,
	constants,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { digest, tree, unpackApp } from "./app-archive.mjs";
export function installationKind(path, target) {
	try {
		const actual = realpathSync(path),
			stat = lstatSync(path);
		if (
			stat.isSymbolicLink() ||
			stat.uid !== process.getuid() ||
			/(?:^|\/)(?:Caskroom|Cellar|nix)(?:\/|$)/.test(actual) ||
			actual.startsWith("/usr/") ||
			actual.startsWith("/snap/")
		)
			return "external";
		if (
			target.startsWith("darwin")
				? !stat.isDirectory() || !path.endsWith(".app")
				: !stat.isFile() || !path.endsWith(".AppImage")
		)
			return "external";
		accessSync(path, constants.W_OK);
		accessSync(dirname(path), constants.W_OK);
		return "bob-owned";
	} catch {
		return "external";
	}
}
export function appFingerprint(path, target) {
	return target.startsWith("darwin")
		? digest(Buffer.from(JSON.stringify(tree(path))))
		: digest(readFileSync(path));
}
export function appExecutable(path, target) {
	return target.startsWith("darwin")
		? join(path, "Contents", "MacOS", "Bob's Factory")
		: path;
}
export function verifyAppProof(proof, candidate, services) {
	const bytes = Buffer.from(proof.manifest, "base64"),
		signature = Buffer.from(proof.signature, "base64");
	services.verifyManifestSignature(
		bytes,
		signature,
		proof.keyId,
		services.trustedKeys,
	);
	const manifest = services.validateReleaseManifest(JSON.parse(bytes)),
		metadataBytes = Buffer.from(proof.metadata, "base64"),
		metadata = JSON.parse(metadataBytes);
	const item = manifest.desktop?.artifacts.find(
		(x) => x.target === candidate.target,
	);
	if (
		!item ||
		manifest.commit !== candidate.commit ||
		manifest.version !== candidate.version ||
		manifest.channel !== candidate.channel ||
		digest(bytes) !== candidate.manifestSha256 ||
		metadataBytes.length !== item.updateMetadata.size ||
		digest(metadataBytes) !== item.updateMetadata.sha256 ||
		metadata.fingerprint !== proof.fingerprint ||
		metadata.schemaVersion !== 1 ||
		metadata.product !== "bobs-factory-desktop" ||
		metadata.channel !== candidate.channel ||
		(!candidate.target.startsWith("darwin") &&
			metadata.format !== "AppImage") ||
		metadata.commit !== candidate.commit ||
		metadata.version !== candidate.version ||
		metadata.target !== candidate.target ||
		metadata.candidateDigest !== manifest.candidateDigest ||
		metadata.workflowSha !== manifest.workflowSha ||
		JSON.stringify(metadata.archive) !==
			JSON.stringify(item.updateArchive ?? item.archive)
	)
		throw Error("App receipt publisher proof mismatch");
	if (
		candidate.target.startsWith("darwin") &&
		(metadata.format !== "bobs-app-v1" ||
			metadata.osSigning !== "developer-id-notarized")
	)
		throw Error("App receipt lacks authentic macOS signing/notarization");
	return metadata;
}
export class DesktopAppSource {
	constructor(
		directory,
		install,
		target,
		services,
		client = services.githubClient(""),
		keys = services.trustedKeys,
	) {
		Object.assign(this, { directory, install, target, services, client, keys });
	}
	candidate(v, channel) {
		const m = v.manifest,
			item = m.desktop?.artifacts.find((x) => x.target === this.target);
		if (m.schemaVersion !== 2 || m.channel !== channel || !item)
			throw Error("No signed app candidate for selected channel/target");
		return {
			version: m.version,
			commit: m.commit,
			channel,
			target: this.target,
			manifestSha256: v.manifestSha256,
			publishedAt: v.release.published_at,
		};
	}
	async verified(version) {
		return this.services.verifyPublishedRelease(
			this.client,
			await this.client.api(`releases/tags/v${version}`),
			this.keys,
		);
	}
	async discover(settings) {
		const v = settings.pin
			? await this.verified(settings.pin)
			: (
					await this.services.discoverReleases(this.client, this.keys, {
						selectedOnly: true,
						allowBetaFallback: false,
					})
				)[settings.channel];
		return v ? this.candidate(v, settings.channel) : undefined;
	}
	async stage(candidate) {
		const v = await this.verified(candidate.version);
		if (
			JSON.stringify(this.candidate(v, candidate.channel)) !==
			JSON.stringify(candidate)
		)
			throw Error("Exact signed app candidate changed");
		const item = v.manifest.desktop.artifacts.find(
			(x) => x.target === this.target,
		);
		const download = async (record) => {
			const asset = v.release.assets.find((a) => a.name === record.file);
			if (
				!asset ||
				asset.size !== record.size ||
				asset.digest !== `sha256:${record.sha256}`
			)
				throw Error("App asset absent from signed inventory");
			const bytes = await this.client.bytes(asset);
			if (bytes.length !== record.size || digest(bytes) !== record.sha256)
				throw Error("App asset digest mismatch");
			return bytes;
		};
		const metadataBytes = await download(item.updateMetadata);
		const metadata = JSON.parse(metadataBytes),
			receipt = JSON.parse(await download(item.validation));
		for (const value of [metadata, receipt])
			if (
				value.version !== candidate.version ||
				value.commit !== candidate.commit ||
				value.channel !== candidate.channel ||
				value.target !== candidate.target ||
				value.candidateDigest !== v.manifest.candidateDigest ||
				value.workflowSha !== v.manifest.workflowSha
			)
				throw Error("App metadata/validation candidate mismatch");
		if (
			receipt.product !== "bobs-factory" ||
			receipt.status !== "passed" ||
			metadata.schemaVersion !== 1 ||
			metadata.product !== "bobs-factory-desktop" ||
			JSON.stringify(metadata.archive) !==
				JSON.stringify(item.updateArchive ?? item.archive)
		)
			throw Error("Invalid app delivery receipt");
		mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		const work = mkdtempSync(join(this.directory, "stage-")),
			bytes = await download(item.updateArchive ?? item.archive);
		let path;
		if (this.target.startsWith("darwin")) {
			if (
				metadata.format !== "bobs-app-v1" ||
				metadata.osSigning !== "developer-id-notarized"
			)
				throw Error("macOS app requires authentic signing/notarization");
			const contents = join(work, "contents");
			unpackApp(bytes, contents);
			path = join(contents, "Bob's Factory.app");
			if (
				!tree(contents).every(
					(entry) =>
						entry.path === "Bob's Factory.app" ||
						entry.path.startsWith("Bob's Factory.app/"),
				)
			)
				throw Error("Unexpected app archive root");
			execFileSync("/usr/bin/codesign", [
				"--verify",
				"--deep",
				"--strict",
				path,
			]);
			execFileSync("/usr/sbin/spctl", ["--assess", "--type", "execute", path]);
		} else {
			if (metadata.format !== "AppImage") throw Error("Unsupported app format");
			path = join(work, "Bob.AppImage");
			writeFileSync(path, bytes, { flag: "wx", mode: 0o755 });
		}
		if (appFingerprint(path, this.target) !== metadata.fingerprint)
			throw Error("Complete app inventory mismatch");
		writeFileSync(
			join(work, "verified.json"),
			JSON.stringify({
				candidate,
				metadata,
				proof: {
					manifest: v.bytes.toString("base64"),
					signature: v.signature.toString("base64"),
					keyId: v.keyId,
					metadata: metadataBytes.toString("base64"),
					fingerprint: metadata.fingerprint,
				},
			}),
			{ mode: 0o600, flush: true },
		);
		return { candidate, executable: path, previousExecutable: this.install };
	}
	async enroll(identity) {
		if (installationKind(this.install, this.target) !== "bob-owned")
			throw Error("Package-manager/manual app update required");
		const v = await this.verified(identity.version),
			c = this.candidate(v, v.manifest.channel);
		if (c.commit !== identity.commit)
			throw Error("Installed app source mismatch");
		const staged = await this.stage(c),
			fingerprint = appFingerprint(staged.executable, this.target);
		if (appFingerprint(this.install, this.target) !== fingerprint)
			throw Error("Installed app differs from authentic release");
		return {
			schema: 1,
			install: this.install,
			target: this.target,
			fingerprint,
			candidate: c,
			proof: JSON.parse(
				readFileSync(
					join(
						dirname(staged.executable),
						this.target.startsWith("darwin") ? ".." : ".",
						"verified.json",
					),
				),
			).proof,
		};
	}
}
