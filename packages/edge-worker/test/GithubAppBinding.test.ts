import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { githubAppBinding } from "../src/factory/GithubAppBinding.js";

const directories: string[] = [];
afterEach(() => {
	vi.unstubAllGlobals();
	for (const dir of directories.splice(0))
		rmSync(dir, { recursive: true, force: true });
});
function fixture() {
	const home = mkdtempSync(join(tmpdir(), "factory-app-"));
	directories.push(home);
	const { publicKey, privateKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
	});
	const path = join(home, "key.pem");
	writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }), {
		mode: 0o600,
	});
	return {
		publicKey,
		ref: {
			source: "github-app" as const,
			appId: 41,
			installationId: 57,
			privateKeyFile: path,
			version: "v1",
			owner: "Bob app",
		},
	};
}
it("validates the app and installation before minting a repository token, using the declared key", async () => {
	const { ref, publicKey } = fixture();
	const urls: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, options: RequestInit) => {
			urls.push(url);
			const jwt = (
				options.headers as Record<string, string>
			).Authorization.slice(7).split(".");
			expect(
				verify(
					"RSA-SHA256",
					Buffer.from(jwt.slice(0, 2).join(".")),
					publicKey,
					Buffer.from(jwt[2]!, "base64url"),
				),
			).toBe(true);
			expect(JSON.parse(Buffer.from(jwt[1]!, "base64url").toString()).iss).toBe(
				41,
			);
			return Response.json(
				url.endsWith("/app")
					? { id: 41, slug: "bob" }
					: url.endsWith("/access_tokens")
						? { token: "private-installation-token" }
						: { id: 57, app_id: 41 },
			);
		}),
	);
	let accepted = false;
	const binding = await githubAppBinding(
		ref,
		"https://github.example/api/v3",
		() => {
			accepted = true;
			expect(urls).toEqual([]);
		},
	);
	expect(accepted).toBe(true);
	expect(binding.principal).toBe("app:bob/installation:57");
	expect(binding.token).toBe("private-installation-token");
	expect(urls).toEqual([
		"https://github.example/api/v3/app",
		"https://github.example/api/v3/app/installations/57",
		"https://github.example/api/v3/app/installations/57/access_tokens",
	]);
});
it("blocks a different installation principal and changed accepted key before token minting", async () => {
	const { ref } = fixture();
	const fetch = vi.fn(async (url: string) =>
		Response.json(
			url.endsWith("/app") ? { id: 41, slug: "bob" } : { id: 58, app_id: 41 },
		),
	);
	vi.stubGlobal("fetch", fetch);
	await expect(githubAppBinding(ref, "https://api.github.com")).rejects.toThrow(
		"principal differs",
	);
	expect(fetch).toHaveBeenCalledTimes(2);
	fetch.mockClear();
	await expect(
		githubAppBinding(ref, "https://api.github.com", () => {
			throw new Error("Accepted key changed");
		}),
	).rejects.toThrow("Accepted key changed");
	expect(fetch).not.toHaveBeenCalled();
});
