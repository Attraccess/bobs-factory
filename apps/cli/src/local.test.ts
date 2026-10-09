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
import open from "open";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { launchLocal } from "./local.js";
import { localRepository, savePrivateJson } from "./onboarding.js";

vi.mock("bobs-factory-edge-worker", () => ({ EdgeWorker: vi.fn() }));
vi.mock("open", () => ({ default: vi.fn(async () => {}) }));
beforeEach(() => {
	vi.clearAllMocks();
});

const roots: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

it("retains operator connection repairs across local restart and preserves project identity", async () => {
	const { EdgeWorker } = await import("bobs-factory-edge-worker");
	const root = mkdtempSync(join(tmpdir(), "factory-local-repair-"));
	roots.push(root);
	const repo = join(root, "repo"),
		home = join(root, "home");
	mkdirSync(repo);
	execFileSync("git", ["init", "-q", "-b", "main", repo]);
	execFileSync("git", [
		"-C",
		repo,
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.test",
		"commit",
		"--allow-empty",
		"-m",
		"Fixture",
	]);
	execFileSync("git", [
		"-C",
		repo,
		"remote",
		"add",
		"origin",
		"git@github.com:example/fixture.git",
	]);
	const bin = join(root, "bin");
	mkdirSync(bin);
	for (const command of ["codex", "opencode"])
		writeFileSync(join(bin, command), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
	vi.spyOn(process, "once").mockReturnValue(process);
	vi.spyOn(console, "log").mockImplementation(() => {});
	const start = vi.fn().mockResolvedValue(undefined),
		setConfigPath = vi.fn();
	vi.mocked(EdgeWorker).mockImplementation(function () {
		return {
			start,
			setConfigPath,
			configureLocalRepository: vi.fn(async () => {}),
		} as unknown as InstanceType<typeof EdgeWorker>;
	});
	const options = {
		repo,
		home,
		port: "3457",
		agent: "opencode",
		model: "old-model",
		open: false,
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
		const path = join(home, "config.json");
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

it("starts guided setup from any folder without Git, an agent or a repository", async () => {
	const { EdgeWorker } = await import("bobs-factory-edge-worker");
	const root = mkdtempSync(join(tmpdir(), "factory-first-launch-"));
	roots.push(root);
	vi.stubEnv("PATH", "");
	vi.spyOn(process, "once").mockReturnValue(process);
	vi.spyOn(console, "log").mockImplementation(() => {});
	const start = vi.fn(async () => {}),
		setConfigPath = vi.fn();
	vi.mocked(EdgeWorker).mockImplementation(function () {
		return { start, setConfigPath } as unknown as InstanceType<
			typeof EdgeWorker
		>;
	});
	await launchLocal({ port: "3457", home: join(root, "home"), open: false });
	expect(EdgeWorker).toHaveBeenCalledWith(
		expect.objectContaining({ repositories: [] }),
		expect.anything(),
	);
	expect(vi.mocked(EdgeWorker).mock.calls[0]?.[0]).not.toHaveProperty(
		"defaultRunner",
	);
	expect(start).toHaveBeenCalledOnce();
	expect(open).not.toHaveBeenCalled();
});

it.each([
	false,
	true,
])("opens a first-launch fragment only with no existing credentials (existing: %s)", async (existing) => {
	const { EdgeWorker } = await import("bobs-factory-edge-worker");
	const root = mkdtempSync(join(tmpdir(), "factory-first-authority-"));
	roots.push(root);
	const home = join(root, "home"),
		auth = join(home, "factory", "auth");
	mkdirSync(auth, { recursive: true });
	const token = "a".repeat(43);
	writeFileSync(
		join(auth, "state.json"),
		JSON.stringify({ credentials: existing ? [{ id: "existing" }] : [] }),
	);
	const grant = JSON.stringify({ token, expires: Date.now() + 600000 });
	writeFileSync(join(auth, "enroll.json"), grant);
	vi.spyOn(process, "once").mockReturnValue(process);
	const log = vi.spyOn(console, "log").mockImplementation(() => {});
	vi.mocked(EdgeWorker).mockImplementation(function () {
		return {
			start: async () => {},
			setConfigPath: () => {},
		} as unknown as InstanceType<typeof EdgeWorker>;
	});
	await launchLocal({ port: "3457", home });
	expect(open).toHaveBeenCalledWith(
		`http://localhost:3457/${existing ? "" : `#setup=${token}`}`,
		{ wait: false },
	);
	expect(JSON.stringify(log.mock.calls).includes(token)).toBe(!existing);
	expect(readFileSync(join(auth, "enroll.json"), "utf8")).toBe(grant);
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

it("explicit --repo preserves the configured ID, integrations and every other repository", async () => {
	const { EdgeWorker } = await import("bobs-factory-edge-worker");
	const root = mkdtempSync(join(tmpdir(), "factory-configured-launch-"));
	roots.push(root);
	const home = join(root, "home"),
		repo = join(root, "project"),
		bin = join(root, "bin");
	mkdirSync(repo);
	mkdirSync(bin);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: repo, stdio: "ignore" });
	git("init", "-b", "main");
	git(
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.test",
		"commit",
		"--allow-empty",
		"-m",
		"Fixture",
	);
	git("remote", "add", "origin", "git@github.com:example/project.git");
	writeFileSync(join(bin, "codex"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
	const selected = {
		...localRepository(repo, home),
		id: "native-project-id",
		linearWorkspaceId: "native-workspace",
	};
	const other = {
		...selected,
		id: "other-project-id",
		repositoryPath: "/another/project",
	};
	savePrivateJson(join(home, "config.json"), {
		repositories: [other, selected],
		defaultRunner: "codex",
	});
	vi.spyOn(process, "once").mockReturnValue(process);
	vi.spyOn(console, "log").mockImplementation(() => {});
	const apply = vi.fn(async () => {});
	vi.mocked(EdgeWorker).mockImplementation(function () {
		return {
			start: async () => {},
			setConfigPath: () => {},
			configureLocalRepository: apply,
		} as unknown as InstanceType<typeof EdgeWorker>;
	});
	await launchLocal({ port: "3457", home, repo, agent: "codex", open: false });
	expect(vi.mocked(EdgeWorker).mock.calls[0]?.[0].repositories).toEqual([
		other,
		selected,
	]);
	expect(apply).toHaveBeenCalledWith(
		expect.objectContaining({
			id: "native-project-id",
			linearWorkspaceId: "native-workspace",
		}),
		"codex",
	);
	const config = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
	expect(config.repositories.map((repo: { id: string }) => repo.id)).toEqual([
		"native-project-id",
		"other-project-id",
	]);
});
