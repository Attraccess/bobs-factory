import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { desktopRuntime } from "../lib/desktop-runtime.mjs";

test("installer staging rejects a different runtime and tampered executable", () => {
	const directory = mkdtempSync(join(tmpdir(), "desktop-runtime-"));
	const bytes = Buffer.from("native fixture");
	const expected = {
		commit: "a".repeat(40),
		version: "1.0.0",
		target: "darwin-arm64",
	};
	writeFileSync(join(directory, "bobs-factory"), bytes);
	writeFileSync(
		join(directory, "build.json"),
		JSON.stringify({
			...expected,
			product: "bobs-factory",
			executable: {
				size: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			},
		}),
	);
	assert.equal(desktopRuntime(directory, expected).version, "1.0.0");
	assert.throws(
		() => desktopRuntime(directory, { ...expected, target: "linux-x64" }),
		/identity mismatch/,
	);
	writeFileSync(join(directory, "bobs-factory"), "tampered");
	assert.throws(
		() => desktopRuntime(directory, expected),
		/integrity mismatch/,
	);
});
