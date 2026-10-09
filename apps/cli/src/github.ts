import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolvePath } from "bobs-factory-core";
import {
	executeGithubApi,
	githubRuntimeCredentials,
} from "bobs-factory-edge-worker";

/** Git's credential protocol, dispatched before application logging or env-file bootstrap. */
export async function gitCredential(action: string | undefined, home?: string) {
	if (action !== "get") return;
	let input = "";
	for await (const chunk of process.stdin) {
		input += chunk.toString();
		if (input.length > 8192) throw new Error("Invalid Git credential request");
	}
	const fields = Object.fromEntries(
		input.split("\n").flatMap((line) => {
			const index = line.indexOf("=");
			return index < 0 ? [] : [[line.slice(0, index), line.slice(index + 1)]];
		}),
	);
	if (
		fields.protocol !== "https" ||
		!fields.host ||
		!/^[A-Za-z0-9.-]+(?::\d+)?$/.test(fields.host)
	)
		return;
	const project = (fields.path ?? "").replace(/\.git$/, "");
	if (process.env.BOBS_FACTORY_GITHUB_EXPLICIT_CREDENTIALS === "1") {
		const scopes = JSON.parse(
			process.env.BOBS_FACTORY_GITHUB_REPOSITORIES ?? "[]",
		) as { host: string; project: string }[];
		if (
			!Array.isArray(scopes) ||
			!scopes.some(
				(scope) =>
					scope.host === fields.host &&
					scope.project.toLowerCase() === project.toLowerCase(),
			)
		)
			return;
	}
	const factoryHome = resolve(
		resolvePath(
			home ?? process.env.BOBS_FACTORY_HOME ?? join(homedir(), ".bobs-factory"),
		),
	);
	try {
		const { token } = await githubRuntimeCredentials(
			{ factoryHome },
			fields.host,
			project,
		);
		if (!token || /[\r\n\0]/.test(token))
			throw new Error("Invalid GitHub credential");
		process.stdout.write(`username=x-access-token\npassword=${token}\n\n`);
	} catch {
		// An absent binding lets Git report authentication failure without disclosing credentials.
	}
}

export async function githubApiRequest(options: {
	repo?: string;
	request?: string;
	home: string;
}) {
	if (!options.repo || !options.request)
		throw new Error("Use --repo <GitHub URL> and --request <JSON file>");
	const url = new URL(options.repo);
	const project = url.pathname
		.replace(/^\//, "")
		.replace(/\.git$/, "")
		.replace(/\/$/, "");
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		!/^[\w.-]+\/[\w.-]+$/.test(project)
	)
		throw new Error("Use a credential-free HTTPS GitHub repository URL");
	if (
		!statSync(options.request).isFile() ||
		statSync(options.request).size > 1024 * 1024
	)
		throw new Error("Use a JSON request file smaller than 1 MiB");
	const request = JSON.parse(readFileSync(options.request, "utf8"));
	const result = await executeGithubApi(
		{
			factoryHome: resolve(resolvePath(options.home)),
			signal: AbortSignal.timeout(60000),
		},
		[JSON.stringify({ ...request, host: url.host, project })],
	);
	process.stdout.write(`${result}\n`);
}
