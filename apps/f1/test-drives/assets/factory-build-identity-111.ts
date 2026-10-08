import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Targeted packaging smoke, separate from the mocked runtime F1 drive.
const root = mkdtempSync(join(tmpdir(), "factory-build-identity-"));
try {
	const identities = [];
	for (const [index, commit] of ["a".repeat(40), "b".repeat(40)].entries()) {
		const outdir = join(root, String(index));
		const result = await Bun.build({
			entrypoints: [
				new URL(
					"../../../../packages/core/src/runtime-identity.ts",
					import.meta.url,
				).pathname,
			],
			outdir,
			target: "bun",
			define: {
				BOBS_FACTORY_BUILD_IDENTITY: JSON.stringify({
					version: "0.2.73",
					commit,
					dirty: false,
					target: "darwin-arm64",
					resourceDigest: "c".repeat(64),
					packaged: true,
				}),
			},
		});
		assert(result.success, String(result.logs));
		const { factoryRuntimeIdentity } = await import(
			join(outdir, "runtime-identity.js")
		);
		assert.equal(factoryRuntimeIdentity.commit, commit);
		assert.equal(factoryRuntimeIdentity.version, "0.2.73");
		assert.equal(factoryRuntimeIdentity.packaged, true);
		assert(Object.isFrozen(factoryRuntimeIdentity));
		identities.push(factoryRuntimeIdentity);
	}
	assert.notDeepEqual(identities[0], identities[1]);
	console.log(
		"PASS: two compiled runtime identities retain distinct commits at the same version; no checkout identity is inferred.",
	);
} finally {
	rmSync(root, { recursive: true, force: true });
}
