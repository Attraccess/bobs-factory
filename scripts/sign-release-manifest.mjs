#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { validatePreparedRelease } from "./lib/prepared-release.mjs";
import { signManifest } from "./lib/release-signature.mjs";

const { values } = parseArgs({
	options: { manifest: { type: "string" }, "key-id": { type: "string" } },
});
if (!values.manifest || !process.env.BOBS_FACTORY_RELEASE_SIGNING_KEY_FILE)
	throw new Error(
		"Provide manifest and protected BOBS_FACTORY_RELEASE_SIGNING_KEY_FILE binding",
	);
const { manifestBytes: bytes } = validatePreparedRelease(
	dirname(resolve(values.manifest)),
);
const sig = signManifest(
	bytes,
	readFileSync(process.env.BOBS_FACTORY_RELEASE_SIGNING_KEY_FILE),
	values["key-id"],
);
writeFileSync(`${values.manifest}.sig`, sig, { flag: "wx" });
writeFileSync(`${values.manifest}.key-id`, `${values["key-id"]}\n`, {
	flag: "wx",
});
