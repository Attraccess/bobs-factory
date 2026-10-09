#!/usr/bin/env node
// Pins are reviewed code, never downloaded trust. --check is used by CI.
import { readFileSync, writeFileSync } from "node:fs";
import { installerWithKeys } from "./lib/installer-pins.mjs";
import { trustedKeys } from "./lib/release-signature.mjs";

const path = new URL("./install.sh", import.meta.url);
const old = readFileSync(path, "utf8");
const next = installerWithKeys(old, trustedKeys);
if (process.argv.includes("--check")) {
	if (old !== next) throw new Error("Run node scripts/sync-release-keys.mjs");
} else writeFileSync(path, next);
