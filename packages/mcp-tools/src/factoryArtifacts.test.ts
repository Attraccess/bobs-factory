import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	factoryArtifactLimit,
	resolveFactoryResultArtifact,
	submitFactoryResultArtifact,
} from "./factoryArtifacts.js";

const directories: string[] = [];
afterEach(() =>
	directories.splice(0).forEach((directory) => {
		rmSync(directory, { recursive: true, force: true });
	}),
);
function binding() {
	const directory = mkdtempSync(join(tmpdir(), "factory-artifact-boundary-"));
	directories.push(directory);
	return {
		directory,
		runId: "run",
		stepKey: "pipeline/guide",
		headSha: "head",
		baseSha: "base",
	};
}
it("rejects changed, cross-run, cross-role and stale-revision candidates while retaining inline support", async () => {
	const current = binding();
	writeFileSync(join(current.directory, "guide.json"), '{"complete":true}');
	const envelope = await submitFactoryResultArtifact(current, "guide.json");
	await expect(
		resolveFactoryResultArtifact(current, envelope),
	).resolves.toEqual({ complete: true });
	for (const replacement of [
		{ runId: "other" },
		{ stepKey: "pipeline/review" },
		{ headSha: "old" },
		{ baseSha: "old-base" },
	])
		await expect(
			resolveFactoryResultArtifact(current, {
				factoryArtifact: { ...envelope.factoryArtifact, ...replacement },
			}),
		).rejects.toThrow("different run, role or revision");
	writeFileSync(join(current.directory, "guide.json"), '{"complete":false}');
	await expect(resolveFactoryResultArtifact(current, envelope)).rejects.toThrow(
		"changed after submission",
	);
	await expect(
		resolveFactoryResultArtifact(current, { inline: true }),
	).resolves.toEqual({ inline: true });
});
it("rejects escaping, missing, linked and oversized result files", async () => {
	const current = binding();
	const outside = binding();
	writeFileSync(join(outside.directory, "secret.json"), '{"outside":true}');
	symlinkSync(
		join(outside.directory, "secret.json"),
		join(current.directory, "linked.json"),
	);
	writeFileSync(
		join(current.directory, "large.json"),
		Buffer.alloc(factoryArtifactLimit + 1, 32),
	);
	for (const path of [
		"../secret.json",
		join(outside.directory, "secret.json"),
		"missing.json",
		"linked.json",
		"large.json",
	])
		await expect(submitFactoryResultArtifact(current, path)).rejects.toThrow();
});
