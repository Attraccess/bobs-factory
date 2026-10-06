import { createSign } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolvePath } from "cyrus-core";
import { z } from "zod";

export interface GithubAppReference {
	source: "github-app";
	appId: number;
	installationId: number;
	privateKeyFile: string;
	version: string;
	owner: string;
}
/** Authenticate the app and installation explicitly; never pretend an installation token is a user token. */
export async function githubAppBinding(
	ref: GithubAppReference,
	api: string,
	acceptKey?: (key: string) => void,
): Promise<{ token: string; principal: string; privateKey: string }> {
	const path = resolvePath(ref.privateKeyFile);
	if (statSync(path).mode & 0o077)
		throw new Error(
			"GitHub App private key must be accessible only to its owner (chmod 600)",
		);
	const key = readFileSync(path, "utf8");
	acceptKey?.(key);
	const base64 = (value: unknown) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	const now = Math.floor(Date.now() / 1000);
	const payload = `${base64({ alg: "RS256", typ: "JWT" })}.${base64({ iat: now - 60, exp: now + 300, iss: ref.appId })}`;
	let signed: string;
	try {
		signed = createSign("RSA-SHA256").update(payload).sign(key, "base64url");
	} catch {
		throw new Error(
			"Selected GitHub App key is invalid; restore the protected key resource",
		);
	}
	const headers = {
		Authorization: `Bearer ${payload}.${signed}`,
		Accept: "application/vnd.github+json",
	};
	const request = async (endpoint: string, method = "GET") => {
		let result: Response;
		try {
			result = await fetch(`${api.replace(/\/$/, "")}/${endpoint}`, {
				method,
				headers,
				signal: AbortSignal.timeout(15000),
				redirect: "error",
			});
		} catch {
			throw new Error("Cannot validate the selected GitHub App installation");
		}
		if (!result.ok)
			throw new Error(
				"Selected GitHub App key/installation could not authenticate. Host fallback is disabled",
			);
		return result.json();
	};
	const app = z
		.object({ id: z.number(), slug: z.string() })
		.parse(await request("app"));
	const installation = z
		.object({ id: z.number(), app_id: z.number() })
		.parse(await request(`app/installations/${ref.installationId}`));
	if (
		app.id !== ref.appId ||
		installation.id !== ref.installationId ||
		installation.app_id !== ref.appId
	)
		throw new Error(
			"GitHub App or installation principal differs from the accepted binding",
		);
	const result = z
		.object({ token: z.string().min(1) })
		.parse(
			await request(
				`app/installations/${ref.installationId}/access_tokens`,
				"POST",
			),
		);
	if (!result.token)
		throw new Error("GitHub App installation returned no token");
	return {
		token: result.token,
		principal: `app:${app.slug}/installation:${ref.installationId}`,
		privateKey: key,
	};
}
