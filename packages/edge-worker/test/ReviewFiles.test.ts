import { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { FactoryServer } from "../src/factory/FactoryServer.js";
import {
	createReviewSnapshot,
	finalizeGuideFiles,
	guideDigest,
	readReviewManifest,
	readReviewPatch,
	resolveGuideSnapshot,
} from "../src/factory/ReviewFiles.js";
import {
	type ExecutionContext,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";

const directories: string[] = [];
afterEach(() => {
	for (const dir of directories.splice(0))
		rmSync(dir, { recursive: true, force: true });
});
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "review-files-"));
	directories.push(home);
	const repo = join(home, "repo");
	mkdirSync(repo);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
	git("init", "-q");
	git("config", "user.email", "fixture@example.com");
	git("config", "user.name", "Fixture");
	const put = (path: string, text: string | Buffer) =>
		writeFileSync(join(repo, path), text);
	put("old name.ts", "one\ntwo\nthree\nfour\nfive\nsix\n");
	put("deleted.ts", "removed\n");
	put("mode.sh", "echo hello\n");
	put("edit.ts", "one\ntwo\nthree\n");
	git("add", ".");
	git("commit", "-qm", "Base");
	const baseSha = git("rev-parse", "HEAD");
	renameSync(join(repo, "old name.ts"), join(repo, "renamed ü.ts"));
	rmSync(join(repo, "deleted.ts"));
	chmodSync(join(repo, "mode.sh"), 0o755);
	put("edit.ts", "one\nnew\nmore\nthree");
	put("binary.png", Buffer.from([0, 1, 2, 3]));
	put(
		"long.spec.ts",
		Array.from({ length: 620 }, (_, i) => `line ${i}`).join("\n"),
	);
	put("bounded.txt", "x".repeat(2200000));
	git("add", ".");
	git("commit", "-qm", "Changes");
	const headSha = git("rev-parse", "HEAD");
	return {
		home,
		repo,
		git,
		put,
		baseSha,
		headSha,
		evidence: join(home, "evidence"),
	};
}
it("captures complete immutable files, statistics, renames, binary, mode and bounded patches across branch advancement and restart", async () => {
	const f = fixture(),
		ref = await createReviewSnapshot(
			f.evidence,
			"run",
			f.repo,
			f.baseSha,
			f.headSha,
		),
		manifest = await readReviewManifest(f.evidence, "run", ref);
	expect(manifest.files.map((file) => file.path)).toEqual([
		"binary.png",
		"bounded.txt",
		"deleted.ts",
		"edit.ts",
		"long.spec.ts",
		"mode.sh",
		"renamed ü.ts",
	]);
	expect(manifest.files.find((f) => f.path === "renamed ü.ts")).toMatchObject({
		status: "R",
		oldPath: "old name.ts",
		additions: 0,
		deletions: 0,
	});
	const binary = manifest.files.find((f) => f.binary)!;
	expect(binary.additions).toBeNull();
	expect(await readReviewPatch(f.evidence, manifest, binary.id)).toMatchObject({
		patch: null,
		reason: expect.stringContaining("Binary"),
	});
	expect(manifest.files.find((f) => f.path === "mode.sh")).toMatchObject({
		oldMode: "100644",
		newMode: "100755",
	});
	expect(
		manifest.files.find((f) => f.path === "bounded.txt")?.unavailable,
	).toMatch(/2 MB/);
	const edit = manifest.files.find((f) => f.path === "edit.ts")!,
		patch = await readReviewPatch(f.evidence, manifest, edit.id);
	expect(patch.patch).toMatch(/No newline at end of file/);
	f.put("edit.ts", "later\n");
	f.git("add", ".");
	f.git("commit", "-qm", "Advance head");
	f.git("branch", "later-base");
	expect(
		await createReviewSnapshot(f.evidence, "run", f.repo, f.baseSha, f.headSha),
	).toEqual(ref);
	expect(
		await readReviewPatch(
			f.evidence,
			await readReviewManifest(f.evidence, "run", ref),
			edit.id,
		),
	).toEqual(patch);
	await expect(readReviewManifest(f.evidence, "other", ref)).rejects.toThrow(
		"does not match",
	);
	await expect(
		readReviewPatch(f.evidence, manifest, "../../edit.ts"),
	).rejects.toThrow("not in");
	await expect(
		createReviewSnapshot(f.evidence, "run", f.repo, "1".repeat(40), f.headSha),
	).rejects.toThrow();
	const storedPatch = join(
		f.evidence,
		"review-files",
		ref.snapshotId,
		`${edit.id}.patch`,
	);
	rmSync(storedPatch);
	writeFileSync(join(f.home, "outside.patch"), patch.patch!);
	symlinkSync(join(f.home, "outside.patch"), storedPatch);
	await expect(readReviewPatch(f.evidence, manifest, edit.id)).rejects.toThrow(
		"regular files",
	);
	rmSync(storedPatch);
	writeFileSync(
		join(f.evidence, "review-files", ref.snapshotId, `${edit.id}.patch`),
		"tampered",
	);
	await expect(readReviewPatch(f.evidence, manifest, edit.id)).rejects.toThrow(
		"integrity",
	);
});
it("keeps patches file-local across file/folder replacements and descendant renames with literal filenames", async () => {
	const f = fixture();
	const names = ["foo", "literal[?]*.ts", "ü😀", "-^!].ts"];
	for (const name of names) f.put(name, `old ${name}\n`);
	mkdirSync(join(f.repo, "inverse"));
	f.put("inverse/child.ts", "old child\n");
	f.put("rename", "rename contents\n");
	f.git("add", ".");
	f.git("commit", "-qm", "Replacement base");
	const base = f.git("rev-parse", "HEAD");
	for (const name of names) {
		rmSync(join(f.repo, name));
		mkdirSync(join(f.repo, name));
		f.put(`${name}/child.ts`, `new ${name}\n`);
	}
	rmSync(join(f.repo, "inverse"), { recursive: true });
	f.put("inverse", "new parent\n");
	renameSync(join(f.repo, "rename"), join(f.repo, "moved"));
	mkdirSync(join(f.repo, "rename"));
	renameSync(join(f.repo, "moved"), join(f.repo, "rename/child.ts"));
	f.git("add", ".");
	f.git("commit", "-qm", "Replace files and folders");
	const ref = await createReviewSnapshot(
		f.evidence,
		"run",
		f.repo,
		base,
		f.git("rev-parse", "HEAD"),
	);
	const manifest = await readReviewManifest(f.evidence, "run", ref);
	expect(manifest.files).toHaveLength(names.length * 2 + 3);
	for (const file of manifest.files) {
		const { patch } = await readReviewPatch(f.evidence, manifest, file.id);
		expect(patch!.split(/^diff --git /m)).toHaveLength(2);
		if (names.includes(file.path)) {
			expect(file.status).toBe("D");
			expect(patch).toContain(`-old ${file.path}\n`);
			expect(patch).not.toContain(`+new ${file.path}\n`);
		}
		if (file.path === "rename/child.ts") {
			expect(file).toMatchObject({ status: "R", oldPath: "rename" });
			expect(patch).toContain("rename from rename\nrename to rename/child.ts");
		}
	}
});
it("ignores partial staging writes, binds runtime-owned revision data and refuses dirty or changed finalization", async () => {
	const f = fixture();
	mkdirSync(join(f.evidence, "review-files", ".staging-interrupted"), {
		recursive: true,
	});
	const context = {
		run: { id: "run", workspace: f.repo },
		evidenceDir: f.evidence,
		progress: { reviewScope: { baseSha: f.baseSha, headSha: f.headSha } },
	} as ExecutionContext;
	const output = (await finalizeGuideFiles(context, {
		reviewFiles: { snapshotId: "forged" },
	})) as { reviewFiles: { snapshotId: string } };
	expect(output.reviewFiles.snapshotId).toMatch(/^[a-f0-9]{64}$/);
	expect(
		readFileSync(
			join(
				f.evidence,
				"review-files",
				output.reviewFiles.snapshotId,
				"manifest.json",
			),
			"utf8",
		),
	).toContain(f.headSha);
	f.put("edit.ts", "dirty");
	await expect(finalizeGuideFiles(context, {})).rejects.toThrow(
		"Worktree changed",
	);
	f.git("add", ".");
	f.git("commit", "-qm", "New head");
	await expect(finalizeGuideFiles(context, {})).rejects.toThrow(
		"Worktree changed",
	);
});
it("authorizes API requests against retained guide identity and never substitutes a current diff for missing history", async () => {
	const f = fixture();
	const runtime = new WorkflowRuntime(f.home, {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const run = runtime.create({
		id: "run",
		triggerOrigin: {
			type: "manual",
			workflowId: "factory",
			at: new Date().toISOString(),
		},
		title: "Review",
		repositoryId: "repo",
		workspace: f.repo,
		input: "",
		workflow: runtime.listWorkflows().find((w) => w.id === "factory")!,
	});
	const evidence = join(runtime.directory, "evidence", run.id),
		ref = await createReviewSnapshot(
			evidence,
			run.id,
			f.repo,
			f.baseSha,
			f.headSha,
		);
	run.outputs.guide = { summary: "guide", reviewFiles: ref };
	const hash = guideDigest(run.outputs.guide);
	const server = new FactoryServer(runtime, {
		repositories: () => [],
		sessions: () => [],
		entries: () => [],
		start: async () => run,
		stop: () => {},
	});
	const get = (url: string) =>
		server.app.inject({ url, headers: { host: "localhost" } });
	try {
		const result = await get(`/api/runs/run/review-files?guide=${hash}`);
		expect(result.statusCode).toBe(200);
		const file = result.json().files[0];
		expect(
			(
				await get(
					`/api/runs/run/review-files/${ref.snapshotId}/${file.id}?guide=${hash}`,
				)
			).statusCode,
		).toBe(200);
		expect(
			(
				await get(
					`/api/runs/run/review-files/${"0".repeat(64)}/${file.id}?guide=${hash}`,
				)
			).statusCode,
		).toBe(409);
		expect(
			(await get(`/api/runs/run/review-files?guide=${"0".repeat(64)}`))
				.statusCode,
		).toBe(409);
		expect(
			(
				await server.app.inject({
					url: `/api/runs/run/review-files?guide=${hash}`,
					headers: { host: "evil.example" },
				})
			).statusCode,
		).toBe(403);
		run.outputs.guide = { summary: "legacy" };
		await expect(
			resolveGuideSnapshot(run, evidence, guideDigest(run.outputs.guide)),
		).rejects.toThrow("Historical guide revision");
		run.history = [
			{
				step: "pipeline/ci",
				at: "1",
				output: { baseSha: f.baseSha, headSha: f.headSha },
			},
			{ step: "pipeline/guide", at: "2", output: run.outputs.guide },
			{ step: "pipeline/handoff", at: "3", output: { headSha: f.headSha } },
		];
		expect(
			await resolveGuideSnapshot(run, evidence, guideDigest(run.outputs.guide)),
		).toEqual(ref);
		await expect(
			resolveGuideSnapshot(
				{ ...run, outputs: { guide: { summary: "other" } }, history: [] },
				evidence,
				guideDigest({ summary: "other" }),
			),
		).rejects.toThrow("Historical");
		// A reconstructed reference survives removal of the old worktree.
		expect(
			await resolveGuideSnapshot(
				{ ...run, workspace: "/does-not-exist" },
				evidence,
				guideDigest(run.outputs.guide),
			),
		).toEqual(ref);
		rmSync(join(evidence, "historical-guides"), { recursive: true });
		run.history[0]!.output = { baseSha: f.baseSha, headSha: "1".repeat(40) };
		await expect(
			resolveGuideSnapshot(run, evidence, guideDigest(run.outputs.guide)),
		).rejects.toThrow("Exact historical");
	} finally {
		await server.app.close();
	}
});
