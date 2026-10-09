#!/usr/bin/env node
// Validate both channels completely before replacing any Pages metadata.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonBytes, REPOSITORY } from "./lib/binary-release.mjs";
import { discoverChannels, githubClient } from "./lib/release-discovery.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = join(root, "website/public");
// Discovery is public: never depend on a maintainer token for install availability.
const { api } = githubClient(null);
const channels = await discoverChannels(api);
const pending = (channel) => ({
	schemaVersion: 2,
	product: "bobs-factory",
	repository: REPOSITORY,
	status: "pending",
	channel,
	message: `No verified ${channel} release is available yet.`,
});
const stable = channels.stable?.manifest ?? pending("stable");
const nightly = channels.nightly?.manifest ?? pending("nightly");
// The legacy endpoint preserves beta fallback but can never select nightly.
const latest =
	channels.stable?.manifest ??
	channels.prerelease?.manifest ??
	pending("stable");
if (latest.status === "available" && !latest.channel)
	latest.channel = channels.stable ? "stable" : "prerelease";
mkdirSync(join(publicRoot, "releases"), { recursive: true });
for (const [name, manifest] of Object.entries({ stable, nightly, latest }))
	writeFileSync(join(publicRoot, `releases/${name}.json`), jsonBytes(manifest));
copyFileSync(join(root, "scripts/install.sh"), join(publicRoot, "install.sh"));
console.log(
	`Prepared stable (${stable.status}) and nightly (${nightly.status}) discovery.`,
);
