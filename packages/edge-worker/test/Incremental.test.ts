import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { captureEvidence } from "../src/factory/FactoryTools.js";
import {
	completedAgentResult,
	dependencyCovers,
	dependencyHashes,
	roleProgress,
} from "../src/factory/Incremental.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";

const homes: string[] = [];
afterEach(() => {
	for (const path of homes.splice(0))
		rmSync(path, { recursive: true, force: true });
});
function context() {
	const workspace = mkdtempSync(join(tmpdir(), "factory-delta-"));
	homes.push(workspace);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: workspace, encoding: "utf8" }).trim();
	git("init", "-b", "main");
	git("config", "user.email", "fixture@example.test");
	git("config", "user.name", "Fixture");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(workspace, "a.txt"), "A");
	writeFileSync(join(workspace, "b.txt"), "B");
	git("add", ".");
	git("commit", "-m", "chore: initial");
	const evidenceDir = join(workspace, ".git", "evidence");
	mkdirSync(evidenceDir);
	const context = {
		run: {
			workspace,
			step: "pipeline/capture",
			history: [],
			outputs: {
				"visual-scope": {
					areas: [
						{
							name: "A",
							states: ["desktop"],
							dependencies: ["a.txt"],
							changed: false,
						},
					],
				},
				"visual-gate": { approved: true },
			},
		},
		step: { id: "capture" },
		evidenceDir,
	} as unknown as ExecutionContext;
	return { context, workspace, git };
}
it("keeps per-role results and exposes only new history and exact revision changes", async () => {
	const { context: ctx, workspace, git } = context();
	const first = await roleProgress(ctx);
	expect(first).toMatchObject({ visit: 1, uncertain: true });
	ctx.run.roleRevisions = { "pipeline/capture": first.currentRevision! };
	ctx.run.history = [
		{ step: "pipeline/capture", at: "", output: { screenshots: [] } },
	];
	const unchanged = await roleProgress(ctx);
	expect(unchanged.unchangedCode).toBe(true);
	writeFileSync(join(workspace, "b.txt"), "Changed");
	git("add", ".");
	git("commit", "-m", "fix: b");
	const changed = await roleProgress(ctx);
	expect(changed.changedFiles).toEqual(["b.txt"]);
	expect(changed.diff).toContain("+Changed");
	expect(changed.previousOutput).toEqual({ screenshots: [] });
	expect(changed.visit).toBe(2);
	writeFileSync(join(workspace, "a.txt"), "dirty");
	expect((await roleProgress(ctx)).uncertain).toBe(true);
});
it("fingerprints recursive dependency groups, additions/deletions and missing paths without escaping the repository", () => {
	const { workspace } = context();
	mkdirSync(join(workspace, "area"));
	writeFileSync(join(workspace, "area", "view.ts"), "View");
	const paths = ["area/**", "a.txt", "deleted.ts"];
	const first = dependencyHashes(workspace, paths);
	expect(dependencyHashes(workspace, paths.toReversed())).toEqual(first);
	expect(first["area/view.ts"]).toMatch(/^[a-f0-9]{64}$/);
	expect(dependencyCovers("area/view.ts", "area/**")).toBe(true);
	expect(dependencyCovers("other/view.ts", "area/**")).toBe(false);
	writeFileSync(join(workspace, "area", "new.ts"), "New");
	expect(dependencyHashes(workspace, paths)).not.toEqual(first);
	rmSync(join(workspace, "area", "view.ts"));
	expect(dependencyHashes(workspace, paths)["area/view.ts"]).toBeUndefined();
	expect(() => dependencyHashes(workspace, ["../outside/**"])).toThrow(
		"repository files",
	);
	symlinkSync(tmpdir(), join(workspace, "escape"));
	expect(() => dependencyHashes(workspace, ["escape/**"])).toThrow(
		"repository files",
	);
});

it("fingerprints repository directory links while rejecting cycles and outside targets", () => {
	const { workspace } = context();
	mkdirSync(join(workspace, "docs"));
	mkdirSync(join(workspace, "docs", "media"));
	mkdirSync(join(workspace, "docs", "de"));
	writeFileSync(join(workspace, "docs", "media", "icon.svg"), "Icon");
	symlinkSync("../media", join(workspace, "docs", "de", "_media"));
	const first = dependencyHashes(workspace, ["docs/**"]);
	expect(first["docs/de/_media/icon.svg"]).toBe(first["docs/media/icon.svg"]);
	writeFileSync(join(workspace, "docs", "media", "icon.svg"), "Changed");
	expect(dependencyHashes(workspace, ["docs/**"])).not.toEqual(first);
	symlinkSync("..", join(workspace, "docs", "de", "cycle"));
	expect(() => dependencyHashes(workspace, ["docs/**"])).toThrow("Cyclic");
	rmSync(join(workspace, "docs", "de", "cycle"));
	symlinkSync(tmpdir(), join(workspace, "docs", "de", "outside"));
	expect(() => dependencyHashes(workspace, ["docs/**"])).toThrow(
		"repository files",
	);
});

it("recovers completed output only on its saved clean revision", async () => {
	const { context: ctx, workspace, git } = context();
	ctx.log = vi.fn();
	const revision = (await roleProgress(ctx)).currentRevision!;
	ctx.resumeAgent = {
		runner: "codex",
		sessionId: "saved",
		result: { output: { screenshots: [] }, revision },
	};
	expect(await completedAgentResult(ctx)).toEqual({
		output: { screenshots: [] },
	});
	writeFileSync(join(workspace, "a.txt"), "Changed");
	expect(await completedAgentResult(ctx)).toBeUndefined();
	git("add", ".");
	git("commit", "-m", "fix: changed revision");
	expect(await completedAgentResult(ctx)).toBeUndefined();
});
it("reuses unchanged verified evidence, rejecting affected, unexplained, dirty or unapproved evidence", async () => {
	const { context: ctx, workspace, git } = context();
	const path = join(ctx.evidenceDir, "old.png");
	writeFileSync(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
	ctx.progress = await roleProgress(ctx);
	const first = captureEvidence(ctx, {
		screenshots: [{ path, caption: "A", area: "A", state: "desktop" }],
	});
	ctx.run.roleRevisions = { "pipeline/capture": ctx.progress.currentRevision! };
	ctx.run.history = [{ step: "pipeline/capture", output: first, at: "" }];
	ctx.progress = await roleProgress(ctx);
	expect(captureEvidence(ctx, first)).toMatchObject({
		screenshots: [{ reused: true }],
	});
	ctx.run.outputs["visual-gate"] = { approved: false };
	ctx.run.outputs["visual-review"] = {
		acceptedScreenshots: [
			{
				area: "A",
				state: "desktop",
				imageSha256: (first as any).screenshots[0].imageSha256,
			},
		],
	};
	expect(captureEvidence(ctx, first)).toMatchObject({
		screenshots: [{ reused: true }],
	});
	ctx.run.outputs["visual-review"] = { acceptedScreenshots: [] };
	expect(() => captureEvidence(ctx, first)).toThrow("reuse is not verified");
	ctx.run.outputs["visual-gate"] = { approved: true };
	writeFileSync(join(workspace, "b.txt"), "Changed");
	git("add", ".");
	git("commit", "-m", "fix: nonvisual");
	ctx.progress = await roleProgress(ctx);
	expect(() => captureEvidence(ctx, first)).toThrow("not verified");
	(ctx.run.outputs["visual-scope"] as any).nonVisualFiles = ["b.txt"];
	expect(captureEvidence(ctx, first)).toMatchObject({
		screenshots: [{ reused: true }],
	});
	writeFileSync(join(workspace, "a.txt"), "Different");
	git("add", ".");
	git("commit", "-m", "fix: visual");
	ctx.progress = await roleProgress(ctx);
	expect(() => captureEvidence(ctx, first)).toThrow("not verified");
	ctx.run.outputs["visual-gate"] = { approved: false };
	ctx.progress.unchangedCode = true;
	expect(() => captureEvidence(ctx, first)).toThrow("not verified");
});
