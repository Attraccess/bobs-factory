import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

// An occupied generated ID embeds the digest of the very file containing it.
// Control only that file's digest to reach the collision branches deterministically.
const forced = vi.hoisted(() => new Map<string, string>());
vi.mock("node:crypto", async (original) => {
	const actual = await original<typeof import("node:crypto")>();
	return {
		...actual,
		createHash: (...args: Parameters<typeof actual.createHash>) => {
			const hash = actual.createHash(...args);
			let input: unknown;
			const update = hash.update.bind(hash);
			const digest = hash.digest.bind(hash);
			hash.update = ((value: any, encoding: any) => {
				input = value;
				return update(value, encoding);
			}) as typeof hash.update;
			hash.digest = ((encoding: any) =>
				typeof input === "string" && forced.has(input) && encoding === "hex"
					? forced.get(input)
					: digest(encoding)) as typeof hash.digest;
			return hash;
		},
	};
});

import { createHash } from "node:crypto";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { WorkflowSchema } from "../src/factory/Workflow.js";
import { WorkflowRuntime } from "../src/factory/WorkflowRuntime.js";

const homes: string[] = [];
afterEach(() => {
	forced.clear();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
it.each([
	"root",
	"dependent-root",
	"private-dependency",
])("retains original bytes across restart when a generated %s identity is occupied", (kind) => {
	const home = mkdtempSync(join(tmpdir(), "migration-identity-"));
	homes.push(home);
	const hooks = {
		agent: async () => ({}),
		tool: async () => ({}),
		script: async () => ({}),
	};
	new WorkflowRuntime(home, hooks);
	const definitions = structuredClone(defaultWorkflows);
	const factory = definitions.find((w) => w.id === "factory")!;
	const pipeline = definitions.find((w) => w.id === "factory-pipeline")!;
	if (kind === "dependent-root")
		pipeline.steps[0].prompt = "Customized pipeline";
	else factory.description = "Customized factory";
	const hash = "0123456789".padEnd(64, "a");
	let target = `legacy-factory-${hash.slice(0, 10)}`;
	if (kind === "private-dependency")
		target += `-${createHash("sha256").update("factory-pipeline").digest("hex").slice(0, 8)}`;
	definitions.push(
		WorkflowSchema.parse({
			id: target,
			name: "Existing local definition",
			steps: [
				{
					id: "work",
					name: "Work",
					type: "agent",
					prompt: "Existing custom behavior",
				},
			],
		}),
	);
	const bytes = JSON.stringify({
		workflows: definitions,
		defaultWorkflow: "factory",
	});
	forced.set(bytes, hash);
	const path = join(home, "factory", "workflows.json");
	writeFileSync(path, bytes);
	for (let restart = 0; restart < 2; restart++) {
		expect(() => new WorkflowRuntime(home, hooks)).toThrow(
			kind === "private-dependency"
				? `Migration dependency identity collision: ${target}`
				: `Migration identity collision: ${target}`,
		);
		expect(readFileSync(path, "utf8")).toBe(bytes);
	}
});
