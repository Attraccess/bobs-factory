#!/usr/bin/env node
// Read-only publication verification; emit reviewable recipes, never publish.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { jsonBytes, REPOSITORY, requireValue } from "./lib/binary-release.mjs";
import { githubClient, verifyPublishedRelease } from "./lib/github-release.mjs";

export async function generateRecipes(client, version, keys) {
	requireValue(
		/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-nightly\.[0-9.]+)?$/.test(
			version,
		),
		"Select an exact stable/nightly version",
	);
	const release = await client.api(`releases/tags/v${version}`);
	const verified = await verifyPublishedRelease(client, release, keys);
	const { manifest, manifestSha256, keyId } = verified;
	requireValue(
		manifest.version === version &&
			["stable", "nightly"].includes(manifest.channel),
		"Recipe version/channel mismatch",
	);
	requireValue(
		manifest.schemaVersion === 2 && manifest.desktop?.artifacts.length === 4,
		"All four verified desktop targets are required",
	);
	const base = `https://github.com/${REPOSITORY}/releases/download/${manifest.tag}`;
	const files = {};
	for (const target of [
		"darwin-arm64",
		"darwin-x64",
		"linux-arm64",
		"linux-x64",
	]) {
		const item = manifest.desktop.artifacts.find(
			(item) => item.target === target,
		);
		requireValue(item, `Missing desktop target: ${target}`);
		const [os, arch] = target.split("-");
		const expected = `bobs-factory-desktop-${version}-${os === "darwin" ? "mac" : "linux"}-${arch}`;
		const formats = os === "darwin" ? ["dmg"] : ["AppImage", "deb"];
		for (const ext of formats) {
			const file = `${expected}.${ext}`;
			const record = manifest.assets.find((a) => a.file === file);
			requireValue(record, `Missing signed desktop package: ${file}`);
			if (ext === "dmg" || ext === "AppImage")
				requireValue(
					item.archive.file === file,
					`Desktop archive contract mismatch: ${target}`,
				);
			const asset = verified.release.assets.find((a) => a.name === file);
			requireValue(
				asset?.browser_download_url === `${base}/${file}`,
				"Package URL must be immutable and project-owned",
			);
			await client.bytes(asset); // verifies real published bytes as well as signed inventory
			files[`${target}.${ext}`] = record;
		}
	}
	const nightly = manifest.channel === "nightly";
	const cask = `bobs-factory${nightly ? "@nightly" : ""}`;
	const aur = `bobs-factory-desktop${nightly ? "-nightly" : ""}-bin`;
	const pkgver = version.replaceAll("-", "_");
	const stamp = `Verified ${manifest.tag}; source ${manifest.commit}; manifest SHA256 ${manifestSha256}; publisher ${keyId}`;
	const brew = `# ${stamp}
cask "${cask}" do
  arch arm: "arm64", intel: "x64"
  version "${version}"
  sha256 arm: "${files["darwin-arm64.dmg"].sha256}", intel: "${files["darwin-x64.dmg"].sha256}"
  url "${base}/bobs-factory-desktop-#{version}-mac-#{arch}.dmg"
  name "Bob's Factory"
  desc "Factory dashboard with a managed local runtime"
  homepage "https://jappyjan.github.io/bobs-factory/"
  depends_on macos: ">= :ventura"
  conflicts_with cask: "bobs-factory${nightly ? "" : "@nightly"}"
  app "Bob's Factory.app"
  # Homebrew owns replacement/removal. No service enrollment or state deletion.
end
`;
	const source = (arch) => `${base}/${files[`linux-${arch}.deb`].file}`;
	const pkgbuild = `# ${stamp}
# Generated from the complete signed published release; do not use latest URLs.
pkgname=${aur}
pkgver=${pkgver}
pkgrel=1
pkgdesc="Bob's Factory desktop and managed native runtime"
arch=('x86_64' 'aarch64')
url='https://jappyjan.github.io/bobs-factory/'
license=('Apache-2.0')
depends=('glibc>=2.35' 'gtk3' 'nss' 'alsa-lib' 'libxss' 'libxtst' 'xdg-utils')
options=('!strip')
provides=('bobs-factory-desktop')
conflicts=('bobs-factory-desktop')
source_x86_64=('${source("x64")}')
sha256sums_x86_64=('${files["linux-x64.deb"].sha256}')
source_aarch64=('${source("arm64")}')
sha256sums_aarch64=('${files["linux-arm64.deb"].sha256}')
package() {
  # Extract payload only; do not execute DEB maintainer scripts or enroll services.
  cd "$srcdir"
  local deb
  case "$CARCH" in x86_64) deb='${files["linux-x64.deb"].file}';; aarch64) deb='${files["linux-arm64.deb"].file}';; esac
  bsdtar -xf "$deb" --include 'data.tar.*'
  bsdtar -xf data.tar.* -C "$pkgdir"
}
`;
	const srcinfo = `pkgbase = ${aur}
\tpkgdesc = Bob's Factory desktop and managed native runtime
\tpkgver = ${pkgver}
\tpkgrel = 1
\turl = https://jappyjan.github.io/bobs-factory/
\tarch = x86_64
\tarch = aarch64
\tlicense = Apache-2.0
${["glibc>=2.35", "gtk3", "nss", "alsa-lib", "libxss", "libxtst", "xdg-utils"].map((d) => `\tdepends = ${d}\n`).join("")}\tprovides = bobs-factory-desktop
\tconflicts = bobs-factory-desktop
\toptions = !strip
\tsource_x86_64 = ${source("x64")}
\tsha256sums_x86_64 = ${files["linux-x64.deb"].sha256}
\tsource_aarch64 = ${source("arm64")}
\tsha256sums_aarch64 = ${files["linux-arm64.deb"].sha256}

pkgname = ${aur}
`;
	const npmRoot = new URL(
		"../distribution/npm/bobs-factory-trial/",
		import.meta.url,
	);
	const npmPackage = JSON.parse(
		readFileSync(new URL("package.json", npmRoot), "utf8"),
	);
	npmPackage.version = version;
	npmPackage.factoryRelease = { version, channel: manifest.channel };
	npmPackage.private = true; // operator must prove registry ownership before authorizing publication
	return {
		"npm/package.json": jsonBytes(npmPackage),
		"npm/bin/bobs-factory-trial.mjs": readFileSync(
			new URL("bin/bobs-factory-trial.mjs", npmRoot),
		),
		"npm/LICENSE": readFileSync(new URL("LICENSE", npmRoot)),
		"npm/README.md": readFileSync(new URL("README.md", npmRoot)),
		[`Casks/${cask}.rb`]: brew,
		[`aur/${aur}/PKGBUILD`]: pkgbuild,
		[`aur/${aur}/.SRCINFO`]: srcinfo,
		"verification.json": jsonBytes({
			schemaVersion: 1,
			version,
			channel: manifest.channel,
			commit: manifest.commit,
			candidateDigest: manifest.candidateDigest,
			manifestSha256,
			publisherKeyId: keyId,
			files,
			publication: "not-performed",
		}),
	};
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const { values } = parseArgs({
		options: { version: { type: "string" }, output: { type: "string" } },
	});
	requireValue(
		values.version && values.output,
		"Usage: generate-package-recipes.mjs --version EXACT_VERSION --output NEW_DIRECTORY",
	);
	const recipes = await generateRecipes(githubClient(), values.version);
	const output = resolve(values.output);
	mkdirSync(output); // refuse replacing an existing reviewed recipe set
	for (const [file, bytes] of Object.entries(recipes)) {
		mkdirSync(join(output, file, ".."), { recursive: true });
		writeFileSync(join(output, file), bytes, { flag: "wx" });
	}
	console.log(
		`Prepared ${values.version} recipes in ${output}; no tap/AUR publication performed.`,
	);
}
