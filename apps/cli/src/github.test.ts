import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { gitCredential, githubApiRequest } from "./github.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});
function fixture(input: string) {
	const home = mkdtempSync(join(tmpdir(), "factory-git-credential-"));
	roots.push(home);
	writeFileSync(
		join(home, "github-auth.json"),
		JSON.stringify({
			version: 1,
			hosts: { "github.com": { token: "browser-token", account: "test-user" } },
		}),
		{ mode: 0o600 },
	);
	vi.stubEnv("GH_TOKEN", "");
	vi.stubEnv("GITHUB_TOKEN", "");
	vi.stubEnv("GH_ENTERPRISE_TOKEN", "");
	vi.stubEnv("GITHUB_ENTERPRISE_TOKEN", "");
	vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(
		async function* () {
			yield Buffer.from(input);
		},
	);
	const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
	return { home, write };
}
it("implements Git's get protocol from the private public-host binding", async () => {
	const f = fixture(
		"protocol=https\nhost=github.com\npath=example/project.git\n\n",
	);
	await gitCredential("get", f.home);
	expect(f.write).toHaveBeenCalledWith(
		"username=x-access-token\npassword=browser-token\n\n",
	);
});
it("private execution never inherits the browser's token or falls back to native credentials", async () => {
	const f = fixture(
		"protocol=https\nhost=github.com\npath=example/project.git\n\n",
	);
	vi.stubEnv("BOBS_FACTORY_GITHUB_EXPLICIT_CREDENTIALS", "1");
	vi.stubEnv(
		"BOBS_FACTORY_GITHUB_REPOSITORIES",
		JSON.stringify([{ host: "github.com", project: "example/project" }]),
	);
	await gitCredential("get", f.home);
	expect(f.write).not.toHaveBeenCalled();
});
it("private execution releases only the accepted host and repository's injected token", async () => {
	const f = fixture(
		"protocol=https\nhost=github.com\npath=outside/project.git\n\n",
	);
	vi.stubEnv("BOBS_FACTORY_GITHUB_EXPLICIT_CREDENTIALS", "1");
	vi.stubEnv(
		"BOBS_FACTORY_GITHUB_REPOSITORIES",
		JSON.stringify([{ host: "github.com", project: "example/project" }]),
	);
	vi.stubEnv("GH_TOKEN", "explicit-token");
	await gitCredential("get", f.home);
	expect(f.write).not.toHaveBeenCalled();
});
it("prints only a repository-scoped API result and sends no token to redirected endpoints", async () => {
	const f = fixture("");
	const request = join(f.home, "request.json");
	writeFileSync(
		request,
		JSON.stringify({ method: "GET", path: "repos/example/project/pulls" }),
	);
	const fetch = vi.fn(async () => Response.json([{ number: 1 }]));
	vi.stubGlobal("fetch", fetch);
	await githubApiRequest({
		home: f.home,
		repo: "https://github.com/example/project",
		request,
	});
	expect(fetch).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({ redirect: "error" }),
	);
	expect(f.write).toHaveBeenCalledWith('[{"number":1}]\n');
	expect(JSON.stringify(f.write.mock.calls)).not.toContain("browser-token");
});
