import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ensureGhWrapperSupportsCyrusToken,
	ensureGitHubCredentialHelper,
	handleGitHubTokens,
} from "../../src/handlers/githubTokens.js";

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

function validPayload() {
	return {
		tokens: [
			{
				installationId: "111",
				organization: "OrgOne",
				accountType: "Organization",
				token: "ghs_one",
				expiresAt: new Date(Date.now() + 3600_000).toISOString(),
			},
			{
				installationId: "222",
				organization: null,
				accountType: "User",
				token: "ghs_two",
				expiresAt: new Date(Date.now() + 3600_000).toISOString(),
			},
		],
	};
}

describe("handleGitHubTokens", () => {
	let factoryHome: string;

	beforeEach(() => {
		vi.clearAllMocks();
		factoryHome = mkdtempSync(join(tmpdir(), "cyrus-github-tokens-"));
	});

	afterEach(() => {
		rmSync(factoryHome, { recursive: true, force: true });
	});

	it("persists tokens to github-tokens.json and returns success", async () => {
		const response = await handleGitHubTokens(validPayload(), factoryHome);

		expect(response.success).toBe(true);
		if (response.success) {
			expect(response.data?.tokensCount).toBe(2);
		}

		const filePath = join(factoryHome, "github-tokens.json");
		expect(existsSync(filePath)).toBe(true);
		const written = JSON.parse(readFileSync(filePath, "utf-8"));
		expect(written.version).toBe(1);
		expect(written.tokens).toHaveLength(2);
		expect(written.tokens[0].organization).toBe("OrgOne");
		expect(written.tokens[1].organization).toBeNull();
	});

	it("preserves host Git and gh authentication without installing Node helpers", async () => {
		const response = await handleGitHubTokens(validPayload(), factoryHome);
		expect(response.success).toBe(true);
		if (response.success) expect(response.data?.ghAuthConfigured).toBe(false);
		expect(existsSync(join(factoryHome, "scripts"))).toBe(false);
		expect(mockedExecFileSync).not.toHaveBeenCalled();
	});

	it("is idempotent across repeated pushes", async () => {
		const first = await handleGitHubTokens(validPayload(), factoryHome);
		const second = await handleGitHubTokens(validPayload(), factoryHome);
		expect(first.success).toBe(true);
		expect(second.success).toBe(true);
		// Each push re-runs the same replace-all + add + gh auth sequence
		// (3 git calls + 1 gh call each)
		expect(mockedExecFileSync).not.toHaveBeenCalled();
	});

	it("rejects a payload without a tokens array", async () => {
		const response = await handleGitHubTokens({ nope: true }, factoryHome);
		expect(response.success).toBe(false);
		if (!response.success) {
			expect(response.error).toBe("GitHub tokens payload validation failed");
		}
		expect(existsSync(join(factoryHome, "github-tokens.json"))).toBe(false);
		expect(mockedExecFileSync).not.toHaveBeenCalled();
	});

	it("rejects token entries missing required fields", async () => {
		const response = await handleGitHubTokens(
			{ tokens: [{ installationId: "111", organization: "OrgOne" }] },
			factoryHome,
		);
		expect(response.success).toBe(false);
		expect(existsSync(join(factoryHome, "github-tokens.json"))).toBe(false);
	});
});

describe("ensureGitHubCredentialHelper", () => {
	let factoryHome: string;

	beforeEach(() => {
		vi.clearAllMocks();
		factoryHome = mkdtempSync(join(tmpdir(), "cyrus-cred-helper-"));
	});

	afterEach(() => {
		rmSync(factoryHome, { recursive: true, force: true });
	});

	it("returns the installed script path", () => {
		const scriptPath = ensureGitHubCredentialHelper(factoryHome);
		expect(scriptPath).toBe(
			join(factoryHome, "scripts", "git-credential-cyrus.cjs"),
		);
		expect(existsSync(scriptPath)).toBe(true);
	});
});

describe("ensureGhWrapperSupportsCyrusToken", () => {
	const OLD_WRAPPER = `#!/usr/bin/env bash
exec env -u GITHUB_TOKEN -u GH_TOKEN /usr/bin/gh "$@"
`;
	let home: string;

	beforeEach(() => {
		vi.clearAllMocks();
		home = mkdtempSync(join(tmpdir(), "cyrus-gh-wrapper-"));
	});

	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
	});

	function writeWrapper(content: string): string {
		const binDir = join(home, ".local", "bin");
		mkdirSync(binDir, { recursive: true });
		const wrapperPath = join(binDir, "gh");
		writeFileSync(wrapperPath, content, { mode: 0o755 });
		return wrapperPath;
	}

	it("rewrites an old strip-everything wrapper to honor BOBS_FACTORY_GH_TOKEN", () => {
		const wrapperPath = writeWrapper(OLD_WRAPPER);

		expect(ensureGhWrapperSupportsCyrusToken(home)).toBe(true);

		const updated = readFileSync(wrapperPath, "utf8");
		expect(updated).toContain("BOBS_FACTORY_GH_TOKEN");
		expect(updated).toContain('GH_TOKEN="$BOBS_FACTORY_GH_TOKEN"');
		expect(updated).toContain("-u GITHUB_TOKEN");
		expect(statSync(wrapperPath).mode & 0o111).not.toBe(0);
	});

	it("upgrades the interim BOBS_FACTORY_GH_TOKEN-only wrapper to the resolver", () => {
		const interim = `#!/usr/bin/env bash
if [ -n "\${BOBS_FACTORY_GH_TOKEN:-}" ]; then
  exec env -u GITHUB_TOKEN GH_TOKEN="$BOBS_FACTORY_GH_TOKEN" /usr/bin/gh "$@"
fi
exec env -u GITHUB_TOKEN -u GH_TOKEN /usr/bin/gh "$@"
`;
		const wrapperPath = writeWrapper(interim);

		expect(ensureGhWrapperSupportsCyrusToken(home)).toBe(true);
		expect(readFileSync(wrapperPath, "utf8")).toContain("gh-cyrus.cjs");
	});

	it("leaves an already-updated wrapper untouched", () => {
		const wrapperPath = writeWrapper(OLD_WRAPPER);
		expect(ensureGhWrapperSupportsCyrusToken(home)).toBe(true);
		const afterFirst = readFileSync(wrapperPath, "utf8");

		expect(ensureGhWrapperSupportsCyrusToken(home)).toBe(false);
		expect(readFileSync(wrapperPath, "utf8")).toBe(afterFirst);
	});

	it("does not touch a wrapper with an unrecognized shape", () => {
		const custom = '#!/bin/sh\nexec /opt/custom/gh "$@"\n';
		const wrapperPath = writeWrapper(custom);

		expect(ensureGhWrapperSupportsCyrusToken(home)).toBe(false);
		expect(readFileSync(wrapperPath, "utf8")).toBe(custom);
	});

	it("is a no-op when no wrapper exists (self-host)", () => {
		expect(ensureGhWrapperSupportsCyrusToken(home)).toBe(false);
	});

	it("preserves the host gh wrapper during a token push", async () => {
		const wrapperPath = writeWrapper(OLD_WRAPPER);
		const nestedCyrusHome = join(home, ".bobs-factory");
		mkdirSync(nestedCyrusHome, { recursive: true });

		const response = await handleGitHubTokens(
			{
				tokens: [
					{
						installationId: "111",
						organization: "OrgOne",
						accountType: "Organization",
						token: "ghs_one",
						expiresAt: new Date(Date.now() + 3600_000).toISOString(),
					},
				],
			},
			nestedCyrusHome,
		);

		expect(response.success).toBe(true);
		expect(readFileSync(wrapperPath, "utf8")).toBe(OLD_WRAPPER);
	});
});
