import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { submitFactoryResultArtifact } from "bobs-factory-mcp-tools";
import { afterEach, expect, it } from "vitest";
import { validateFactoryResult } from "../src/factory/FactoryResults.js";
import {
	validateGuideCoverage,
	validateGuideGeneration,
} from "../src/factory/Guide.js";
import { OutputValidationError } from "../src/factory/OutputValidation.js";
import {
	resolveRoleResult,
	roleResultArtifactBinding,
} from "../src/factory/ResultArtifacts.js";
import { finalizeGuideFiles } from "../src/factory/ReviewFiles.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";

const directories: string[] = [];
afterEach(() =>
	directories.splice(0).forEach((directory) => {
		rmSync(directory, { recursive: true, force: true });
	}),
);

function fixture(count = 3781) {
	const workspace = mkdtempSync(join(tmpdir(), "factory-large-guide-"));
	directories.push(workspace);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.test");
	git("config", "commit.gpgsign", "false");
	git("commit", "--allow-empty", "-m", "base");
	const baseSha = git("rev-parse", "HEAD");
	mkdirSync(join(workspace, "feature"));
	const files = Array.from(
		{ length: count },
		(_, i) => `feature/file-${i}.bin`,
	);
	for (const file of files)
		writeFileSync(join(workspace, file), Buffer.from([0, 1, 2]));
	git("add", ".");
	git("commit", "-m", "Add complete feature");
	const headSha = git("rev-parse", "HEAD");
	const evidenceDir = join(workspace, ".git", "evidence");
	mkdirSync(evidenceDir);
	const context = {
		run: {
			id: "large-guide-run",
			repositoryId: "repo",
			workspace,
			outputs: {},
			history: [],
			humanDecisions: [],
		},
		step: { id: "guide", prompt: "Feature guide" },
		stepKey: "pipeline/guide",
		evidenceDir,
		progress: {
			currentRevision: { headSha, dirty: false },
			reviewScope: { headSha, baseSha, files, source: "whole-pr" },
		},
	} as unknown as ExecutionContext;
	const guide = {
		goal: "Bound file size",
		summary: "The complete feature scope",
		tldr: "Review the complete change",
		decision: {
			status: "ready",
			summary: "Verified",
			summaryShort: "Verified whole scope",
		},
		scope: {
			kind: "nonvisual",
			rationale: "Changes code across all feature modules",
			files: "runtime",
		},
		system: {
			lanes: [
				{ id: "input", name: "Input" },
				{ id: "policy", name: "Policy" },
				{ id: "delivery", name: "Delivery" },
			],
			parts: [
				{
					id: "limit",
					label: "File size limit",
					laneId: "policy",
					status: "changed",
				},
			],
			before: [],
			after: [],
		},
		requirements: [
			{
				criterion: "Limit every feature file",
				status: "supported",
				evidence: ["Complete file inventory and passing checks"],
			},
		],
		behavior: [],
		checks: ["All feature modules checked"],
		risks: [],
		reviewInstructions: ["Inspect each changed feature module"],
		chapters: [
			{
				id: "limits",
				title: "File size limits",
				summary: "All feature modules",
				before: "No bound",
				after: "Bounded file size",
				tldr: "Every module receives the same bound",
				beforeShort: "No bound",
				afterShort: "Bounded",
				risk: { level: "low", text: "Consistent limit" },
				keyChecks: [{ do: "Open a module", expect: "16000-character bound" }],
				systemPartIds: ["limit"],
				requirementIndexes: [0],
				fileIndexes: files.map((_, i) => i),
				screenshots: [],
				diagrams: [],
				reviewChecks: ["Check all modules"],
				risks: [],
				evidence: ["Exact inventory checked"],
			},
		],
	};
	return { context, guide, files };
}

it("finalizes a 3,781-file artifact guide using runtime-owned indexed coverage", async () => {
	const { context, guide, files } = fixture();
	const binding = roleResultArtifactBinding(context);
	mkdirSync(binding.directory, { recursive: true });
	writeFileSync(join(binding.directory, "guide.json"), JSON.stringify(guide));
	const envelope = await submitFactoryResultArtifact(binding, "guide.json");
	const resolved = await resolveRoleResult(context, envelope);
	const validated = validateFactoryResult("guide", resolved);
	validateGuideGeneration(validated);
	validateGuideCoverage(context, validated);
	const finalized = (await finalizeGuideFiles(context, validated)) as any;
	expect(finalized.chapters[0].files).toEqual(files);
	expect(finalized.scope.files).toEqual(files);
	expect(finalized.reviewFiles).toMatchObject({
		headSha: binding.headSha,
		baseSha: binding.baseSha,
	});
}, 20000);

it("retains the rejected malformed artifact payload after its source file is overwritten", async () => {
	const { context, guide } = fixture(2);
	const binding = roleResultArtifactBinding(context);
	mkdirSync(binding.directory, { recursive: true });
	const malformed = { ...guide, chapters: [null] };
	context.run.outputs.guide = { summary: "Previously accepted guide" };
	const accepted = structuredClone(context.run.outputs.guide);
	writeFileSync(
		join(binding.directory, "broken.json"),
		JSON.stringify(malformed),
	);
	const envelope = await submitFactoryResultArtifact(binding, "broken.json");
	const rejected = await resolveRoleResult(context, envelope).catch(
		(error) => error,
	);
	writeFileSync(join(binding.directory, "broken.json"), JSON.stringify(guide));
	expect(rejected).toMatchObject({
		output: malformed,
		issues: [expect.objectContaining({ message: expect.any(String) })],
	});
	expect(context.run.outputs.guide).toEqual(accepted);
});

it("retains legitimate shared files across chapters while preserving whole-PR coverage", async () => {
	const { context, guide } = fixture(2);
	const repeated = {
		...guide,
		chapters: [
			...guide.chapters,
			{ ...guide.chapters[0], id: "duplicate", fileIndexes: [0] },
		],
	};
	const resolved = validateFactoryResult(
		"guide",
		await resolveRoleResult(context, repeated),
	);
	expect(() => validateGuideCoverage(context, resolved)).not.toThrow();
	expect((resolved as any).chapters[1].files).toEqual([
		context.progress!.reviewScope!.files[0],
	]);
});

it("rejects duplicate runtime indexes within a chapter", async () => {
	const { context, guide } = fixture(2);
	const repeated = {
		...guide,
		chapters: [{ ...guide.chapters[0], fileIndexes: [0, 0, 1] }],
	};
	await expect(resolveRoleResult(context, repeated)).rejects.toBeInstanceOf(
		OutputValidationError,
	);
});
