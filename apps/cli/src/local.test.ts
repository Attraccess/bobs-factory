import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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

it("retains operator connection repairs across local restart and protects repository identity", async () => {
	const { EdgeWorker } = await import("bobs-factory-edge-worker");
	const root = mkdtempSync(join(tmpdir(), "factory-local-repair-"));
	roots.push(root);
	const repo = join(root, "repo"),
		home = join(root, "home");
	mkdirSync(repo);
	execFileSync("git", ["init", "-q", "-b", "main", repo]);
	const start = vi.fn().mockResolvedValue(undefined),
		setConfigPath = vi.fn();
	vi.mocked(EdgeWorker).mockImplementation(function () {
		return { start, setConfigPath } as unknown as InstanceType<
			typeof EdgeWorker
		>;
	});
	const options = {
		repo,
		home,
		port: "3457",
		agent: "opencode",
		model: "old-model",
	};
	const signals = new Map(
		["SIGINT", "SIGTERM"].map((signal) => [
			signal,
			new Set(process.listeners(signal)),
		]),
	);
	const previousPort = process.env.BOBS_FACTORY_FACTORY_PORT;
	try {
		await launchLocal(options);
		const path = join(home, "local-config.json");
		const saved = JSON.parse(readFileSync(path, "utf8"));
		Object.assign(saved.repositories[0], {
			mcpConfigPath: [join(home, "repair.json")],
			allowedTools: ["mcp__taskbot__get_ticket"],
			disallowedTools: ["mcp__taskbot__delete_ticket"],
		});
		saved.strictMcpConfig = true;
		saved.repositories[0].githubUrl = "https://github.com/example/fixture";
		writeFileSync(path, JSON.stringify(saved));
		await launchLocal({ ...options, agent: "codex", model: "new-model" });
		const effective = vi.mocked(EdgeWorker).mock.calls.at(-1)?.[0];
		expect(effective).toMatchObject({
			defaultRunner: "codex",
			codexDefaultModel: "new-model",
			strictMcpConfig: true,
		});
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(effective);

		expect(
			vi.mocked(EdgeWorker).mock.calls.at(-1)?.[0].repositories[0],
		).toMatchObject(saved.repositories[0]);
		expect(setConfigPath).toHaveBeenLastCalledWith(path);
		const other = join(root, "other");
		execFileSync("git", ["init", "-q", "-b", "main", other]);
		await expect(launchLocal({ ...options, repo: other })).rejects.toThrow(
			"different local repository",
		);
		await launchLocal({ ...options, agent: "codex", model: undefined });
		expect(
			JSON.parse(readFileSync(path, "utf8")).codexDefaultModel,
		).toBeUndefined();
		expect(start).toHaveBeenCalledTimes(3);
	} finally {
		for (const [signal, before] of signals)
			for (const listener of process.listeners(signal))
				if (!before.has(listener)) process.removeListener(signal, listener);
		if (previousPort === undefined)
			delete process.env.BOBS_FACTORY_FACTORY_PORT;
		else process.env.BOBS_FACTORY_FACTORY_PORT = previousPort;
		vi.mocked(EdgeWorker).mockReset();
	}
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
