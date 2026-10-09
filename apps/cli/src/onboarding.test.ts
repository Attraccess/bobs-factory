import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCursorInstallation } from "bobs-factory-cursor-runner";
import { afterEach, expect, it, vi } from "vitest";
import {
	LocalOnboarding,
	loadLocalConfig,
	localRepository,
	savePrivateJson,
} from "./onboarding.js";

vi.mock("bobs-factory-cursor-runner", () => ({
	resolveCursorInstallation: vi.fn(),
}));

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.mocked(resolveCursorInstallation).mockReset();
});
function fixture() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-onboarding-")));
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
	return { root, home, repo, git, apply: vi.fn(async () => {}) };
}
function githubEvidence() {
	return {
		data: {
			repository: {
				nameWithOwner: "example/project",
				viewerPermission: "WRITE",
				defaultBranchRef: {
					target: { oid: "project-head", statusCheckRollup: null },
				},
				pullRequests: { nodes: [] },
			},
		},
	};
}
it("fresh setup needs a project and does not silently select a coding agent", () => {
	const f = fixture(),
		setup = new LocalOnboarding(f.home, f.apply);
	const status = setup.status();
	expect(status).toMatchObject({
		required: true,
		runner: undefined,
		project: undefined,
	});
	expect(f.apply).not.toHaveBeenCalled();
	expect(existsSync(join(f.home, "config.json"))).toBe(false);
});
it("validates the checkout, saves private setup and resumes the same project and agent", async () => {
	const f = fixture(),
		setup = new LocalOnboarding(f.home, f.apply);
	await setup.configure({ repositoryPath: f.repo, runner: "codex" });
	expect(f.apply).toHaveBeenCalledWith(
		expect.objectContaining({
			repositoryPath: f.repo,
			githubUrl: "https://github.com/example/project",
			baseBranch: "main",
		}),
		"codex",
	);
	expect(statSync(join(f.home, "config.json")).mode & 0o077).toBe(0);
	expect(new LocalOnboarding(f.home, f.apply).status()).toMatchObject({
		required: false,
		runner: "codex",
		project: { path: f.repo },
	});
});
it("keeps existing repository integrations, unknown config metadata and other projects", async () => {
	const f = fixture(),
		repository = localRepository(f.repo, f.home);
	savePrivateJson(join(f.home, "config.json"), {
		repositories: [
			{
				...repository,
				id: "integrated",
				linearWorkspaceId: "actual-linear",
				workspaceBaseDir: "/operator/worktrees",
				customMetadata: "keep",
			},
		],
		linearWorkspaces: { "actual-linear": { linearToken: "keep-token" } },
		operatorMetadata: { keep: true },
	});
	const setup = new LocalOnboarding(f.home, f.apply);
	await setup.configure({ repositoryPath: f.repo, runner: "codex" });
	const saved = JSON.parse(readFileSync(join(f.home, "config.json"), "utf8"));
	expect(saved).toMatchObject({
		operatorMetadata: { keep: true },
		linearWorkspaces: { "actual-linear": { linearToken: "keep-token" } },
		repositories: [
			{
				id: "integrated",
				linearWorkspaceId: "actual-linear",
				workspaceBaseDir: "/operator/worktrees",
				customMetadata: "keep",
			},
		],
	});
});
it("refuses invalid Git state before saving setup or starting a workflow", async () => {
	const f = fixture(),
		setup = new LocalOnboarding(f.home, f.apply);
	f.git("checkout", "--detach");
	await expect(
		setup.configure({ repositoryPath: f.repo, runner: "codex" }),
	).rejects.toThrow("branch");
	expect(f.apply).not.toHaveBeenCalled();
	expect(existsSync(join(f.home, "config.json"))).toBe(false);
});
it("does not overwrite corrupt existing configuration", () => {
	const f = fixture();
	mkdirSync(f.home);
	writeFileSync(join(f.home, "config.json"), "broken config");
	expect(() => loadLocalConfig(f.home)).toThrow("preserved");
	expect(readFileSync(join(f.home, "config.json"), "utf8")).toBe(
		"broken config",
	);
});
it("saves only a verified GitHub connection privately and never returns its token", async () => {
	const f = fixture(),
		setup = new LocalOnboarding(f.home, f.apply);
	await setup.configure({ repositoryPath: f.repo, runner: "codex" });
	vi.stubGlobal(
		"fetch",
		vi
			.fn()
			.mockResolvedValueOnce(Response.json({ login: "person" }))
			.mockResolvedValueOnce(Response.json({ permissions: { push: true } }))
			.mockResolvedValueOnce(Response.json(githubEvidence())),
	);
	const status = await setup.connectGithub({ token: "private-token" });
	expect(status.github).toEqual({ connected: true, account: "person" });
	expect(JSON.stringify(status)).not.toContain("private-token");
	expect(statSync(join(f.home, "github-auth.json")).mode & 0o077).toBe(0);
	expect(
		JSON.parse(readFileSync(join(f.home, "github-auth.json"), "utf8")),
	).toMatchObject({
		version: 1,
		hosts: { "github.com": { account: "person", token: "private-token" } },
	});
});
it("checks PR and CI reads without mutations and accepts capable existing token types", async () => {
	const f = fixture(),
		setup = new LocalOnboarding(f.home, f.apply);
	await setup.configure({ repositoryPath: f.repo, runner: "codex" });
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(Response.json({ login: "person" }))
		.mockResolvedValueOnce(Response.json({ permissions: { push: true } }))
		.mockResolvedValueOnce(Response.json(githubEvidence()));
	vi.stubGlobal("fetch", fetch);
	await setup.connectGithub({ token: "github_pat_capable_existing_token" });
	expect(
		fetch.mock.calls.map(([url, options]) => [url, options.method]),
	).toEqual([
		["https://api.github.com/user", "GET"],
		["https://api.github.com/repos/example/project", "GET"],
		["https://api.github.com/graphql", "POST"],
	]);
	const request = JSON.parse(fetch.mock.calls[2]![1].body);
	expect(request.variables).toEqual({ owner: "example", name: "project" });
	expect(request.query.startsWith("query FactoryGithubSetup(")).toBe(true);
	expect(
		fetch.mock.calls.every(([, options]) => options.redirect === "error"),
	).toBe(true);
	expect(setup.status().github.account).toBe("person");
});
it("rejects unsupported CI-read tokens before replacing a working saved connection", async () => {
	const f = fixture(),
		setup = new LocalOnboarding(f.home, f.apply);
	await setup.configure({ repositoryPath: f.repo, runner: "codex" });
	const path = join(f.home, "github-auth.json");
	savePrivateJson(path, {
		version: 1,
		hosts: { "github.com": { token: "existing", account: "retained" } },
	});
	const before = readFileSync(path, "utf8");
	vi.stubGlobal(
		"fetch",
		vi
			.fn()
			.mockResolvedValueOnce(Response.json({ login: "person" }))
			.mockResolvedValueOnce(Response.json({ permissions: { push: true } }))
			.mockResolvedValueOnce(
				Response.json({
					data: githubEvidence().data,
					errors: [{ message: "Resource not accessible: unsupported-token" }],
				}),
			),
	);
	await expect(
		setup.connectGithub({ token: "unsupported-token" }),
	).rejects.toThrow(
		"Use a classic personal access token with repo scope; fine-grained tokens can lack check access. Your token was not saved.",
	);
	expect(readFileSync(path, "utf8")).toBe(before);
	expect(setup.status().github.account).toBe("retained");
});
it("requires actual selected-project commit evidence before saving a connection", async () => {
	const f = fixture(),
		setup = new LocalOnboarding(f.home, f.apply);
	await setup.configure({ repositoryPath: f.repo, runner: "codex" });
	vi.stubGlobal(
		"fetch",
		vi
			.fn()
			.mockResolvedValueOnce(Response.json({ login: "person" }))
			.mockResolvedValueOnce(Response.json({ permissions: { push: true } }))
			.mockResolvedValueOnce(
				Response.json({
					data: {
						repository: {
							nameWithOwner: "example/project",
							viewerPermission: "WRITE",
							defaultBranchRef: null,
							pullRequests: { nodes: [] },
						},
					},
				}),
			),
	);
	await expect(setup.connectGithub({ token: "private-token" })).rejects.toThrow(
		"first commit",
	);
	expect(existsSync(join(f.home, "github-auth.json"))).toBe(false);
});
it("does not persist rejected or read-only GitHub tokens", async () => {
	const f = fixture(),
		setup = new LocalOnboarding(f.home, f.apply);
	await setup.configure({ repositoryPath: f.repo, runner: "codex" });
	vi.stubGlobal(
		"fetch",
		vi
			.fn()
			.mockResolvedValueOnce(Response.json({ login: "person" }))
			.mockResolvedValueOnce(Response.json({ permissions: { push: false } })),
	);
	await expect(
		setup.connectGithub({ token: "read-only-token" }),
	).rejects.toThrow("write access");
	expect(existsSync(join(f.home, "github-auth.json"))).toBe(false);
});

it("does not offer Cursor when only its launcher is installed", async () => {
	const f = fixture();
	const bin = (process.env.PATH ?? "").split(":")[0]!;
	writeFileSync(join(bin, "agent"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	vi.mocked(resolveCursorInstallation).mockImplementation(() => {
		throw new Error("SDK missing");
	});
	const setup = new LocalOnboarding(f.home, f.apply);
	expect(
		setup.status().agents.find((agent) => agent.id === "cursor"),
	).toMatchObject({ installed: false, note: expect.stringContaining("Node") });
	await expect(
		setup.configure({ repositoryPath: f.repo, runner: "cursor" }),
	).rejects.toThrow("Install the selected coding agent");
	expect(f.apply).not.toHaveBeenCalled();
});

it("offers Cursor after its SDK and compatible Node runtime are prepared", () => {
	const f = fixture();
	const bin = (process.env.PATH ?? "").split(":")[0]!;
	writeFileSync(join(bin, "agent"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	vi.mocked(resolveCursorInstallation).mockReturnValue({
		sdk: "/prepared/sdk",
		node: process.execPath,
		version: "1.0.19",
	});
	expect(
		new LocalOnboarding(f.home, f.apply)
			.status()
			.agents.find((agent) => agent.id === "cursor"),
	).toMatchObject({ installed: true });
});
