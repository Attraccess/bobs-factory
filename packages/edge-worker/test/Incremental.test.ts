import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { captureEvidence } from "../src/factory/FactoryTools.js";
import { roleProgress } from "../src/factory/Incremental.js";
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
