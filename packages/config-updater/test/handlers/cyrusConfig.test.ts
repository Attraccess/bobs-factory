import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleCyrusConfig } from "../../src/handlers/cyrusConfig.js";

vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => false),
	mkdirSync: vi.fn(),
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

describe("handleCyrusConfig", () => {
	const factoryHome = "/test/home";

	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.BOBS_FACTORY_WORKTREES_DIR;
		mockExistsSync.mockReturnValue(false);
		mockReadFileSync.mockReturnValue("");
	});

	afterEach(() => {
		delete process.env.BOBS_FACTORY_WORKTREES_DIR;
	});

	it("defaults repository workspaceBaseDir to factoryHome/worktrees", async () => {
		const result = await handleCyrusConfig(
			{
				repositories: [
					{
						id: "repo-1",
						name: "repo-1",
						repositoryPath: "/repos/repo-1",
						baseBranch: "main",
					},
				],
			},
			factoryHome,
		);

		expect(result.success).toBe(true);
		expect(mockMkdirSync).toHaveBeenCalledWith(factoryHome, {
			recursive: true,
		});
		expect(mockWriteFileSync).toHaveBeenCalledWith(
			"/test/home/config.json",
			expect.stringContaining('"workspaceBaseDir": "/test/home/worktrees"'),
			"utf-8",
		);
	});

	it("uses BOBS_FACTORY_WORKTREES_DIR when set", async () => {
		process.env.BOBS_FACTORY_WORKTREES_DIR = "/tmp/custom-worktrees";

		const result = await handleCyrusConfig(
			{
				repositories: [
					{
						id: "repo-1",
						name: "repo-1",
						repositoryPath: "/repos/repo-1",
						baseBranch: "main",
					},
				],
			},
			factoryHome,
		);

		expect(result.success).toBe(true);
		expect(mockWriteFileSync).toHaveBeenCalledWith(
			"/test/home/config.json",
			expect.stringContaining('"workspaceBaseDir": "/tmp/custom-worktrees"'),
			"utf-8",
		);
	});
});
