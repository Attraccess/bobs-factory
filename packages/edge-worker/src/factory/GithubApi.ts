import { execFile, execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { type AgentRunnerConfig, GitHubTokenStore } from "bobs-factory-core";
import { z } from "zod";
import { repositoryReference } from "./GitProviderReference.js";
import type { ProviderCommand } from "./MergeReadiness.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

/** An in-process provider operation, never a child executable or shell command. */
export const GITHUB_API_COMMAND = "bobs-factory:github-api";
export const GITHUB_AUTH_FILENAME = "github-auth.json";
const authSchema = z.object({
	version: z.literal(1),
	hosts: z.record(
		z.string(),
		z.object({
			token: z.string().min(1),
			account: z.string().min(1),
			apiUrl: z.string().url().optional(),
		}),
	),
});
export type GithubAuthBinding = z.infer<typeof authSchema>["hosts"][string];
const agentTokenSchema = z.array(
	z.object({
		host: z.string().min(1),
		project: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
		token: z
			.string()
			.min(1)
			.refine((token) => !/[\r\n\0]/.test(token)),
		apiUrl: z.string().url().optional(),
	}),
);
function githubAgentTokens(environment: NodeJS.ProcessEnv) {
	try {
		return agentTokenSchema.parse(
			JSON.parse(environment.BOBS_FACTORY_GITHUB_TOKENS ?? "[]"),
		);
	} catch {
		throw new Error("Invalid managed GitHub credential bindings");
	}
}

export function readGithubAuth(
	factoryHome: string,
	host = "github.com",
): GithubAuthBinding | undefined {
	const file = join(factoryHome, GITHUB_AUTH_FILENAME);
	let stat: ReturnType<typeof lstatSync>;
	try {
		stat = lstatSync(file);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw new Error(
			"GitHub credential file cannot be inspected. Restore its private ownership and permissions.",
		);
	}
	if (
		!stat.isFile() ||
		stat.isSymbolicLink() ||
		(process.platform !== "win32" &&
			(stat.mode & 0o077 || stat.uid !== process.getuid?.()))
	)
		throw new Error(
			"GitHub credential file must be a private, owner-controlled regular file (chmod 600).",
		);
	try {
		const binding = authSchema.parse(JSON.parse(readFileSync(file, "utf8")))
			.hosts[host];
		if (binding && /[\r\n\0]/.test(binding.token)) throw new Error();
		return binding;
	} catch {
		throw new Error(
			"GitHub credential file is invalid. Reconnect GitHub in setup.",
		);
	}
}

const requestSchema = z.object({
	host: z.string().min(1),
	project: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
	method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]),
	path: z.string().min(1),
	body: z.unknown().optional(),
});
export type GithubApiRequest = z.infer<typeof requestSchema>;

/** The command boundary retains the run's approved private execution environment. */
export class GithubApi {
	readonly repository: ReturnType<typeof repositoryReference>;
	constructor(
		private command: ProviderCommand,
		repositoryUrl: string,
	) {
		this.repository = repositoryReference(repositoryUrl);
		if (this.repository.project.split("/").length !== 2)
			throw new Error(
				"GitHub repositories require owner/repository coordinates",
			);
	}
	async request<T = any>(
		method: GithubApiRequest["method"],
		path: string,
		body?: unknown,
	): Promise<T> {
		return JSON.parse(
			await this.command(
				GITHUB_API_COMMAND,
				[
					JSON.stringify({
						host: this.repository.host,
						project: this.repository.project,
						method,
						path,
						...(body === undefined ? {} : { body }),
					}),
				],
				30000,
			),
		);
	}
	async graphql<T = any>(
		query: string,
		variables: Record<string, unknown>,
	): Promise<T> {
		const payload = await this.request<any>("POST", "graphql", {
			query,
			variables,
		});
		if (payload.errors?.length)
			throw new Error(
				"GitHub GraphQL request failed; the provider evidence is unavailable",
			);
		return payload;
	}
	async pages<T = any>(path: string): Promise<T[]> {
		const values: T[] = [];
		for (let page = 1; page <= 10000; page++) {
			const result = await this.request<T[]>(
				"GET",
				`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
			);
			if (!Array.isArray(result))
				throw new Error("GitHub returned an invalid paginated response");
			values.push(...result);
			if (result.length < 100) return values;
		}
		throw new Error(
			"GitHub pagination exceeded the inspection limit; no complete receipt is available",
		);
	}
	get pullRequestsPath() {
		return `repos/${this.repository.project}/pulls`;
	}
}

function nativeToken(
	host: string,
	environment: NodeJS.ProcessEnv,
): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(
			"gh",
			["auth", "token", "--hostname", host],
			{ env: environment, timeout: 10000, encoding: "utf8" },
			(error, stdout) => {
				const token = stdout?.trim();
				resolve(!error && token && !/[\r\n\0]/.test(token) ? token : undefined);
			},
		);
	});
}

/** Only native execution may reuse the host's optional gh credential store. */
export async function githubRuntimeCredentials(
	context: Pick<ExecutionContext, "execution" | "factoryHome">,
	host: string,
	project: string,
) {
	const environment = context.execution?.environment ?? process.env;
	if (environment.BOBS_FACTORY_GITHUB_MANAGED_CREDENTIALS === "1") {
		const scopes = JSON.parse(
			environment.BOBS_FACTORY_GITHUB_REPOSITORIES ?? "[]",
		) as { host: string; project: string }[];
		if (
			!Array.isArray(scopes) ||
			!scopes.some(
				(scope) =>
					scope.host === host &&
					scope.project.toLowerCase() === project.toLowerCase(),
			)
		)
			throw new Error("GitHub request is outside the managed repository scope");
	}
	const accepted = context.execution?.githubBindings?.[host];
	if (accepted) {
		if (
			!accepted.projects.some(
				(value) => value.toLowerCase() === project.toLowerCase(),
			)
		)
			throw new Error(
				"GitHub request is outside the accepted execution repository scope",
			);
		return accepted;
	}
	const explicit =
		Boolean(context.execution) ||
		environment.BOBS_FACTORY_GITHUB_EXPLICIT_CREDENTIALS === "1";
	if (
		!explicit &&
		environment.BOBS_FACTORY_GITHUB_MANAGED_CREDENTIALS === "1" &&
		environment.BOBS_FACTORY_GITHUB_TOKENS
	) {
		const binding = githubAgentTokens(environment).find(
			(item) =>
				item.host === host &&
				item.project.toLowerCase() === project.toLowerCase(),
		);
		if (!binding)
			throw new Error(
				"No credential is bound to this managed GitHub repository",
			);
		return {
			token: binding.token,
			apiUrl:
				binding.apiUrl ??
				(host === "github.com"
					? "https://api.github.com"
					: `https://${host}/api/v3`),
		};
	}
	if (!explicit && context.factoryHome) {
		const saved = readGithubAuth(context.factoryHome, host);
		if (saved)
			return {
				token: saved.token,
				apiUrl:
					saved.apiUrl ??
					(host === "github.com"
						? "https://api.github.com"
						: `https://${host}/api/v3`),
			};
	}
	const token =
		host === "github.com"
			? environment.GH_TOKEN ||
				environment.GITHUB_TOKEN ||
				environment.BOBS_FACTORY_GH_TOKEN
			: environment.GH_HOST === host ||
					environment.BOBS_FACTORY_GITHUB_ENTERPRISE_HOST === host
				? environment.GH_ENTERPRISE_TOKEN || environment.GITHUB_ENTERPRISE_TOKEN
				: undefined;
	if (token) {
		let apiUrls: Record<string, string> = {};
		if (environment.BOBS_FACTORY_GITHUB_EXPLICIT_CREDENTIALS === "1") {
			try {
				apiUrls = JSON.parse(environment.BOBS_FACTORY_GITHUB_API_URLS ?? "{}");
			} catch {
				throw new Error("Invalid GitHub execution API binding");
			}
		}
		return {
			token,
			apiUrl:
				apiUrls[host] ??
				(host === "github.com"
					? "https://api.github.com"
					: `https://${host}/api/v3`),
		};
	}
	if (
		context.execution ||
		environment.BOBS_FACTORY_GITHUB_EXPLICIT_CREDENTIALS === "1"
	)
		throw new Error(
			"The selected execution profile has no GitHub credential for this host. Host fallback is disabled.",
		);
	if (context.factoryHome) {
		if (host === "github.com") {
			const installed = new GitHubTokenStore(
				context.factoryHome,
			).getTokenForOrg(project.split("/")[0]!);
			if (installed)
				return { token: installed, apiUrl: "https://api.github.com" };
		}
	}
	const optionalNativeToken = await nativeToken(host, environment);
	if (!optionalNativeToken)
		throw new Error(
			"Connect GitHub in Bob’s Factory setup. GitHub CLI is optional.",
		);
	return {
		token: optionalNativeToken,
		apiUrl:
			host === "github.com"
				? "https://api.github.com"
				: `https://${host}/api/v3`,
	};
}

export async function executeGithubApi(
	context: Pick<ExecutionContext, "signal" | "execution" | "factoryHome">,
	args: string[],
): Promise<string> {
	context.signal.throwIfAborted();
	if (args.length !== 1) throw new Error("Invalid GitHub API request");
	const request = requestSchema.parse(JSON.parse(args[0]!));
	const environment = context.execution?.environment ?? process.env;
	if (
		environment.BOBS_FACTORY_GITHUB_EXPLICIT_CREDENTIALS === "1" ||
		environment.BOBS_FACTORY_GITHUB_MANAGED_CREDENTIALS === "1"
	) {
		let scopes: { host: string; project: string }[];
		try {
			scopes = JSON.parse(environment.BOBS_FACTORY_GITHUB_REPOSITORIES ?? "[]");
		} catch {
			throw new Error("Invalid GitHub execution repository scope");
		}
		if (
			!Array.isArray(scopes) ||
			!scopes.some(
				(scope) =>
					scope.host === request.host &&
					scope.project.toLowerCase() === request.project.toLowerCase(),
			)
		)
			throw new Error(
				"GitHub request is outside the accepted execution repository scope",
			);
	}
	const hostUrl = new URL(`https://${request.host}`);
	if (
		hostUrl.host !== request.host ||
		hostUrl.username ||
		hostUrl.password ||
		hostUrl.pathname !== "/"
	)
		throw new Error("Invalid GitHub host");
	if (
		request.path.startsWith("/") ||
		request.path.includes("\\") ||
		request.path.includes("..") ||
		/^[a-z][a-z0-9+.-]*:/i.test(request.path)
	)
		throw new Error("GitHub API requests require a relative endpoint");
	if (
		request.path !== "graphql" &&
		!request.path.startsWith(`repos/${request.project}/`)
	)
		throw new Error(
			"GitHub API endpoint must belong to the selected repository",
		);
	const credentials = await githubRuntimeCredentials(
		context,
		request.host,
		request.project,
	);
	const base = new URL(credentials.apiUrl);
	if (
		base.protocol !== "https:" ||
		base.username ||
		base.password ||
		base.search ||
		base.hash
	)
		throw new Error("GitHub API bindings require a credential-free HTTPS URL");
	const endpoint =
		request.path === "graphql"
			? new URL(
					base.hostname === "api.github.com"
						? "/graphql"
						: base.pathname.replace(/\/v3\/?$/, "/graphql"),
					base,
				)
			: new URL(request.path, `${base.href.replace(/\/$/, "")}/`);
	if (endpoint.origin !== base.origin)
		throw new Error("GitHub endpoint must stay on the accepted API origin");
	if (
		request.path !== "graphql" &&
		!endpoint.pathname.startsWith(
			new URL(`repos/${request.project}/`, `${base.href.replace(/\/$/, "")}/`)
				.pathname,
		)
	)
		throw new Error(
			"GitHub API endpoint must belong to the selected repository",
		);
	let response: Response;
	try {
		response = await fetch(endpoint, {
			method: request.method,
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${credentials.token}`,
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "bobs-factory",
				...(request.body === undefined
					? {}
					: { "Content-Type": "application/json" }),
			},
			...(request.body === undefined
				? {}
				: { body: JSON.stringify(request.body) }),
			signal: AbortSignal.any([context.signal, AbortSignal.timeout(30000)]),
			redirect: "error",
		});
	} catch {
		context.signal.throwIfAborted();
		throw new Error("GitHub API network request failed or timed out");
	}
	const payload: any =
		response.status === 204 ? {} : await response.json().catch(() => undefined);
	if (!response.ok)
		throw new Error(
			`GitHub API HTTP ${response.status}. ${response.status === 401 ? "Reconnect GitHub in setup." : response.status === 403 || response.status === 429 ? "Check repository permissions, branch rules or API rate limits." : response.status === 409 || response.status === 422 ? "The requested change was rejected; recheck the PR revision and repository rules." : "The provider request could not be completed."}`,
		);
	if (payload === undefined || payload === null || typeof payload !== "object")
		throw new Error("GitHub returned an invalid API response");
	if (payload.errors?.length)
		throw new Error(
			`GitHub GraphQL request failed: ${payload.errors
				.map((item: { message?: string }) =>
					String(item.message ?? "Unknown provider error").replaceAll(
						credentials.token,
						"[redacted]",
					),
				)
				.join("; ")
				.slice(0, 500)}`,
		);
	return JSON.stringify(payload);
}

export interface ManagedGithubGitOptions {
	factoryHome: string;
	directory: string;
	repositoryUrl?: string;
	environment?: NodeJS.ProcessEnv;
	/** An accepted private environment must retain only its selected bindings. */
	explicit?: boolean;
}

/** Temporary process configuration only: never edit stored remotes, Git config or native stores. */
export function managedGithubGitEnvironment(
	options: ManagedGithubGitOptions,
): Record<string, string> | undefined {
	const environment = options.environment ?? process.env;
	if (
		options.explicit ||
		environment.BOBS_FACTORY_GITHUB_EXPLICIT_CREDENTIALS === "1"
	)
		return;
	const helperCommand = environment.BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND;
	if (!helperCommand) return;
	let originUrls: string[];
	try {
		originUrls = execFileSync("git", ["remote", "get-url", "--all", "origin"], {
			cwd: options.directory,
			env: environment,
			encoding: "utf8",
			timeout: 10000,
			stdio: ["ignore", "pipe", "ignore"],
		})
			.trim()
			.split("\n");
	} catch {
		return;
	}
	let reference: ReturnType<typeof repositoryReference>;
	try {
		reference = repositoryReference(originUrls[0]!);
	} catch {
		return;
	}
	if (reference.project.split("/").length !== 2) return;
	const saved = readGithubAuth(options.factoryHome, reference.host);
	const environmentToken =
		reference.host === "github.com"
			? environment.GH_TOKEN ||
				environment.GITHUB_TOKEN ||
				environment.BOBS_FACTORY_GH_TOKEN
			: environment.GH_HOST === reference.host
				? environment.GH_ENTERPRISE_TOKEN || environment.GITHUB_ENTERPRISE_TOKEN
				: undefined;
	const appToken =
		reference.host === "github.com"
			? new GitHubTokenStore(options.factoryHome).getTokenForOrg(
					reference.project.split("/")[0]!,
				)
			: undefined;
	if (!saved && !environmentToken && !appToken) return;
	if (
		options.repositoryUrl &&
		repositoryReference(options.repositoryUrl).url.toLowerCase() !==
			reference.url.toLowerCase()
	)
		throw new Error(
			"Git origin differs from the selected GitHub repository. Restore the selected remote before delivery.",
		);
	let pushUrls: string[];
	try {
		pushUrls = execFileSync(
			"git",
			["remote", "get-url", "--push", "--all", "origin"],
			{
				cwd: options.directory,
				env: environment,
				encoding: "utf8",
				timeout: 10000,
				stdio: ["ignore", "pipe", "ignore"],
			},
		)
			.trim()
			.split("\n");
	} catch {
		throw new Error("Cannot inspect the selected GitHub push destination");
	}
	if (
		originUrls.length !== 1 ||
		pushUrls.length !== 1 ||
		repositoryReference(pushUrls[0]!).url.toLowerCase() !==
			reference.url.toLowerCase()
	)
		throw new Error(
			"The GitHub origin must have one matching fetch and push repository. Reconcile custom push destinations before delivery.",
		);
	const result: Record<string, string> = {
		BOBS_FACTORY_HOME: options.factoryHome,
		BOBS_FACTORY_GITHUB_MANAGED_CREDENTIALS: "1",
		BOBS_FACTORY_GITHUB_REPOSITORIES: JSON.stringify([
			{ host: reference.host, project: reference.project },
		]),
		// Selected credentials travel only in the child process environment. Sandboxed
		// helpers need neither state-directory reads nor an ambient-account fallback.
		BOBS_FACTORY_GITHUB_TOKENS: JSON.stringify([
			{
				host: reference.host,
				project: reference.project,
				token: saved?.token ?? environmentToken ?? appToken,
				...(saved?.apiUrl ? { apiUrl: saved.apiUrl } : {}),
			},
		]),
	};
	const count = Number(environment.GIT_CONFIG_COUNT ?? "0");
	if (!Number.isSafeInteger(count) || count < 0)
		throw new Error("Invalid inherited Git configuration count");
	const canonical = `${reference.url}.git`;
	const overrides: [string, string][] = [
		[`credential.https://${reference.host}.helper`, ""],
		[
			`credential.https://${reference.host}.helper`,
			`!${helperCommand} git-credential`,
		],
		[`credential.https://${reference.host}.useHttpPath`, "true"],
		[`url.${canonical}.insteadOf`, originUrls[0]!],
		...(originUrls[0] === pushUrls[0]
			? []
			: [[`url.${canonical}.insteadOf`, pushUrls[0]!] as [string, string]]),
		[`url.${canonical}.pushInsteadOf`, originUrls[0]!],
	];
	result.GIT_CONFIG_COUNT = String(count + overrides.length);
	overrides.forEach(([key, value], index) => {
		result[`GIT_CONFIG_KEY_${count + index}`] = key;
		result[`GIT_CONFIG_VALUE_${count + index}`] = value;
	});
	return result;
}

/** Assemble exact accepted origin rewrites without redirecting sibling worktree origins. */
export function managedGithubAgentEnvironment(options: {
	factoryHome: string;
	repositories: { directory: string; repositoryUrl?: string }[];
	environment?: NodeJS.ProcessEnv;
}): Record<string, string> | undefined {
	const environment = options.environment ?? process.env;
	const start = Number(environment.GIT_CONFIG_COUNT ?? "0");
	if (!Number.isSafeInteger(start) || start < 0)
		throw new Error("Invalid inherited Git configuration count");
	const overrides: [string, string][] = [],
		scopes: { host: string; project: string }[] = [],
		tokens: z.infer<typeof agentTokenSchema> = [];
	for (const repository of options.repositories) {
		const managed = managedGithubGitEnvironment({
			...repository,
			factoryHome: options.factoryHome,
			environment,
		});
		if (!managed) continue;
		scopes.push(...JSON.parse(managed.BOBS_FACTORY_GITHUB_REPOSITORIES!));
		tokens.push(...githubAgentTokens(managed));
		for (let n = start; n < Number(managed.GIT_CONFIG_COUNT); n++)
			overrides.push([
				managed[`GIT_CONFIG_KEY_${n}`]!,
				managed[`GIT_CONFIG_VALUE_${n}`]!,
			]);
	}
	if (!overrides.length) return;
	const result: Record<string, string> = {
		BOBS_FACTORY_HOME: options.factoryHome,
		BOBS_FACTORY_GITHUB_MANAGED_CREDENTIALS: "1",
		BOBS_FACTORY_GITHUB_REPOSITORIES: JSON.stringify(scopes),
		BOBS_FACTORY_GITHUB_TOKENS: JSON.stringify(tokens),
		GIT_CONFIG_COUNT: String(start + overrides.length),
	};
	for (const [n, [key, value]] of overrides.entries()) {
		result[`GIT_CONFIG_KEY_${start + n}`] = key;
		result[`GIT_CONFIG_VALUE_${start + n}`] = value;
	}
	return result;
}

/** Grant only the trusted helper binary; independent of any credential discovery. */
export function allowGithubHelperExecutable(
	config: AgentRunnerConfig,
	executable: string | undefined,
): void {
	if (executable && isAbsolute(executable)) {
		const sandboxed = config as AgentRunnerConfig & {
			sandbox?: { filesystem?: { allowRead?: string[] } };
			sandboxSettings?: {
				allowRead?: string[];
				allowWrite?: string[];
				filesystem?: { allowRead?: string[] };
			};
		};
		// Permit the trusted binary itself, never the Factory state directory.
		if (sandboxed.sandbox && typeof sandboxed.sandbox === "object")
			sandboxed.sandbox = {
				...sandboxed.sandbox,
				filesystem: {
					...sandboxed.sandbox.filesystem,
					allowRead: [
						...(sandboxed.sandbox.filesystem?.allowRead ?? []),
						executable,
					],
				},
			};
		if (sandboxed.sandboxSettings)
			sandboxed.sandboxSettings = {
				...sandboxed.sandboxSettings,
				...("allowRead" in sandboxed.sandboxSettings ||
				"allowWrite" in sandboxed.sandboxSettings
					? {
							allowRead: [
								...(sandboxed.sandboxSettings.allowRead ?? []),
								executable,
							],
						}
					: {}),
				filesystem: {
					...sandboxed.sandboxSettings.filesystem,
					allowRead: [
						...(sandboxed.sandboxSettings.filesystem?.allowRead ?? []),
						executable,
					],
				},
			};
	}
}

/** Keep managed credentials private to the selected runner, with output/log redaction. */
export function applyManagedGithubAgentEnvironment(
	config: AgentRunnerConfig,
	options: Parameters<typeof managedGithubAgentEnvironment>[0],
): void {
	const environment = options.environment ?? process.env;
	if (
		config.childEnvironment ||
		environment.BOBS_FACTORY_GITHUB_EXPLICIT_CREDENTIALS === "1" ||
		!environment.BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND
	)
		return;
	const managed = managedGithubAgentEnvironment(options);
	config.additionalEnv = {
		...config.additionalEnv,
		BOBS_FACTORY_HOME: options.factoryHome,
		BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND:
			environment.BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND,
		...managed,
	};
	allowGithubHelperExecutable(
		config,
		environment.BOBS_FACTORY_INTERNAL_EXECUTABLE,
	);
	if (!managed?.BOBS_FACTORY_GITHUB_TOKENS) return;
	const secrets = githubAgentTokens(managed).map((binding) => binding.token);
	const previous = config.redact;
	const redact = (value: string) => {
		let result = previous ? previous(value) : value;
		for (const secret of secrets.sort((a, b) => b.length - a.length))
			for (const form of new Set([
				secret,
				JSON.stringify(secret).slice(1, -1),
				encodeURIComponent(secret),
			]))
				result = result.replaceAll(form, "[redacted]");
		return result;
	};
	config.redact = redact;
	const onError = config.onError;
	if (onError)
		config.onError = (error) => onError(new Error(redact(error.message)));
	if (config.logger) {
		const logger = config.logger;
		config.logger = new Proxy(logger, {
			get(target, key) {
				const value = Reflect.get(target, key);
				if (typeof value !== "function") return value;
				return (...args: unknown[]) =>
					Reflect.apply(
						value,
						target,
						args.map((arg) =>
							typeof arg === "string"
								? redact(arg)
								: arg instanceof Error
									? new Error(redact(arg.message))
									: arg && typeof arg === "object"
										? JSON.parse(redact(JSON.stringify(arg)))
										: arg,
						),
					);
			},
		});
	}
}

/** Bridge Factory network commands into the same managed Git environment as worktree preparation. */
export async function githubGitEnvironment(
	context: ExecutionContext,
): Promise<NodeJS.ProcessEnv> {
	if (
		context.execution ||
		(context.run.gitProvider?.type &&
			context.run.gitProvider.type !== "github") ||
		!context.factoryHome
	)
		return {};
	return (
		managedGithubGitEnvironment({
			factoryHome: context.factoryHome,
			directory: context.run.workspace,
			repositoryUrl:
				context.run.gitProvider?.repositoryUrl ??
				(context.run.outputs.repository as { githubUrl?: string } | undefined)
					?.githubUrl,
		}) ?? {}
	);
}
