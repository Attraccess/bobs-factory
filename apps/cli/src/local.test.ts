import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { launchLocal } from "./local.js";

vi.mock("bobs-factory-edge-worker", () => ({ EdgeWorker: vi.fn() }));

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

it.each([
	"missing",
	"file",
])("identifies a %s repository path and explains recovery without starting a worker", async (kind) => {
	const { EdgeWorker } = await import("bobs-factory-edge-worker");
	const root = mkdtempSync(join(tmpdir(), "factory-local-boundary-"));
	roots.push(root);
	const repo = join(root, "repository");
	if (kind === "file") writeFileSync(repo, "not a directory");
	const error = await launchLocal({
		repo,
		port: "3457",
		agent: "codex",
		home: join(root, "home"),
	}).catch((error: Error) => error);
	expect(error).toBeInstanceOf(Error);
	expect((error as Error).message).toContain(repo);
	expect((error as Error).message).toContain("--repo <path>");
	expect((error as Error).message).not.toContain("posix_spawn");
	expect(EdgeWorker).not.toHaveBeenCalled();
});
