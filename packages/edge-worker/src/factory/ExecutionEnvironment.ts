import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { inspectCodexNativeLogin } from "bobs-factory-codex-runner";
import type {
	AgentRunnerConfig,
	McpServerConfig,
	RunnerType,
} from "bobs-factory-core";
import { ProjectArtifactLease, resolvePath } from "bobs-factory-core";
import { codexSystemMcp } from "./CodexSystemSources.js";
import {
	executionCapabilities,
	validateProfileRunner,
} from "./ExecutionCapabilities.js";
import type {
	CredentialReference,
	ExecutionSnapshot,
} from "./ExecutionProfiles.js";
import { executionSettings } from "./ExecutionSettings.js";
import { allowGithubHelperExecutable } from "./GithubApi.js";
import { githubAppBinding } from "./GithubAppBinding.js";

export interface ResolvedExecutionEnvironment {
	/** Private provider bindings. Never serialize into runs, API responses or receipts. */
	githubBindings?: Record<
		string,
		{ token: string; apiUrl: string; projects: string[] }
	>;
	environment: Record<string, string>;
	mcp: Record<string, McpServerConfig>;
	root: string;
	settings: import("bobs-factory-core").JsonObject;
	repositoryInstructions?: string;
	git?: {
		author: string;
		committer: string;
		signing: string;
		fingerprint?: string;
		commits: boolean;
		tags: boolean;
	};
	runner: RunnerType;
	disabledMcp: string[];
	redact(text: string): string;
	accounts: { host: string; account: string; verified: boolean }[];
}

const safeEnvironment =
	/^(PATH|LANG|LC_[A-Z_]+|TZ|TMPDIR|TMP|TEMP|TERM|COLORTERM|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|REQUESTS_CA_BUNDLE|PIP_CERT|CURL_CA_BUNDLE|CARGO_HTTP_CAINFO|AWS_CA_BUNDLE|DENO_CERT|HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy)$/;
const environmentOf = (source: NodeJS.ProcessEnv): Record<string, string> =>
	Object.fromEntries(
		Object.entries(source).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
function privateFile(file: string, value: string): void {
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	writeFileSync(file, value, { mode: 0o600 });
	chmodSync(file, 0o600);
}
function run(
	binary: string,
	args: string[],
	cwd: string,
	env: Record<string, string>,
): string {
	try {
		return execFileSync(binary, args, {
			cwd,
			env,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 15000,
		}).trim();
	} catch {
		throw new Error(
			`Execution preflight failed for ${binary}. Check selected resources and repository configuration.`,
		);
	}
}
function inspectProject(
	cwd: string,
	runner: RunnerType,
	owned: Set<string> = new Set(),
): void {
	// Source suppression is version-specific. Refuse sources whose auth/plugin discovery
	// cannot be controlled, instead of interpreting arbitrary settings as safe.
	const sources: Record<RunnerType, string[]> = {
		claude: [".env"],
		codex: [".codex/config.toml", ".env"],
		gemini: [
			".gemini/settings.json",
			".gemini/extensions",
			".gemini/.env",
			".env",
		],
		cursor: [
			".cursor/mcp.json",
			".cursor/cli.json",
			".cursor/settings.json",
			".cursor/hooks.json",
			".cursor/plugins",
			".env",
		],
		opencode: [".env"],
	};
	for (const name of sources[runner])
		if (existsSync(join(cwd, name)) && !owned.has(join(cwd, name)))
			throw new Error(
				`${runner} execution profile rejects unapproved project source ${name}. Use a clean project or Legacy execution.`,
			);
	const system: Record<RunnerType, string[]> = {
		claude: [
			"/Library/Application Support/ClaudeCode/managed-settings.json",
			"/Library/Application Support/ClaudeCode/managed-mcp.json",
			"/etc/claude-code/managed-settings.json",
			"/etc/claude-code/managed-mcp.json",
		],
		codex: ["/etc/codex/requirements.toml"],
		gemini: [
			"/Library/Application Support/GeminiCli/settings.json",
			"/etc/gemini-cli/settings.json",
		],
		cursor: [],
		opencode: ["/etc/opencode/opencode.json"],
	};
	for (const file of system[runner])
		if (existsSync(file))
			throw new Error(
				`${runner} execution profile needs a compatible managed policy. Unsupported source: ${file}`,
			);
}

/** Private materialization. Never attach this object to a run or a session snapshot. */
export class ExecutionEnvironmentResolver {
	private host: Record<string, string>;
	private hostHome: string;
	constructor(
		private directory: string,
		host: NodeJS.ProcessEnv = process.env,
	) {
		this.host = environmentOf(host);
		this.hostHome = host.HOME ?? homedir();
	}
	private credential(ref: CredentialReference, secrets: Set<string>): string {
		let value: string | undefined;
		if (ref.source === "github-app")
			throw new Error(
				"GitHub App credentials are supported only for GitHub repository bindings",
			);
		if (ref.source === "env") value = this.host[ref.name];
		else if (ref.source === "file") {
			const file = resolvePath(ref.path);
			if (!existsSync(file) || !statSync(file).isFile())
				throw new Error(
					"Selected credential file is missing. Restore the protected resource.",
				);
			if (process.platform !== "win32" && statSync(file).mode & 0o077)
				throw new Error(
					"Selected credential file must be accessible only to its owner (chmod 600).",
				);
			value = readFileSync(file, "utf8").trim();
		} else {
			value = run(
				ref.source,
				ref.source === "glab"
					? ["config", "get", "token", "--host", ref.host]
					: [
							"auth",
							"token",
							"--hostname",
							ref.host,
							...(ref.account ? ["--user", ref.account] : []),
						],
				this.hostHome,
				{
					...this.host,
					...(ref.configDirectory
						? {
								[ref.source === "gh" ? "GH_CONFIG_DIR" : "GLAB_CONFIG_DIR"]:
									resolvePath(ref.configDirectory),
							}
						: {}),
					// Named store selection must not accidentally use an ambient token.
					GH_TOKEN: "",
					GITHUB_TOKEN: "",
					GH_ENTERPRISE_TOKEN: "",
					GITHUB_ENTERPRISE_TOKEN: "",
					GITLAB_TOKEN: "",
					GITLAB_ACCESS_TOKEN: "",
					OAUTH_TOKEN: "",
				},
			);
		}
		if (!value || /[\r\n\0]/.test(value))
			throw new Error(
				"Selected credential is missing or invalid. Restore the named resource; host fallback is disabled.",
			);
		secrets.add(value);
		return value;
	}
	private pin(root: string, ref: CredentialReference, value: string): void {
		// Private digest, never API/history evidence. A reference version change must
		// be explicitly accepted in a new profile; recovery uses the saved version.
		const key = createHash("sha256").update(JSON.stringify(ref)).digest("hex");
		const file = join(root, "bindings", `${key}.json`);
		const digest = createHash("sha256").update(value).digest("hex");
		if (
			existsSync(file) &&
			JSON.parse(readFileSync(file, "utf8")).digest !== digest
		)
			throw new Error(
				"Credential changed for an accepted resource version. Restore it or launch with an explicitly revised binding.",
			);
		privateFile(file, JSON.stringify({ digest }));
	}
	async resolve(
		snapshot: ExecutionSnapshot,
		id: string,
		cwd: string,
		runner: RunnerType,
		job = "main",
		repositoryWorkspaces: string[] = [cwd],
	): Promise<ResolvedExecutionEnvironment> {
		if (!/^[\w-]+$/.test(id)) throw new Error("Invalid execution root ID");
		if (!/^[\w-]+$/.test(job)) throw new Error("Invalid execution job ID");
		if (!snapshot.tools)
			throw new Error(
				"Select a tool profile with declared sources before enabling an identity profile; automatic host discovery is unsupported",
			);
		const disabledMcp = runner === "codex" ? codexSystemMcp() : [];
		const identity = snapshot.identity;
		const tools = snapshot.tools;
		const auth = identity?.runners[runner];
		if (
			auth?.kind === "setup-token" &&
			(runner !== "claude" || auth.provider !== "anthropic")
		)
			throw new Error(
				"Setup-token authentication is supported only for Claude",
			);
		if (
			auth &&
			runner !== "opencode" &&
			auth.provider !==
				{
					claude: "anthropic",
					codex: "openai",
					gemini: "google",
					cursor: "cursor",
				}[runner]
		)
			throw new Error(
				"Runner credential provider does not match the selected runner",
			);
		if (!auth && tools)
			throw new Error(
				`Private ${runner} tools require an explicit API credential binding. Native login-cache relocation is unsupported; select an identity profile with an explicit credential reference.`,
			);
		validateProfileRunner({ factoryHome: this.directory }, snapshot, runner);
		const native = auth?.kind === "native-login";
		const root = join(this.directory, "execution-private", id);
		const owned = ["cursor", "gemini"].includes(runner)
			? ProjectArtifactLease.recoverOwnedArtifacts(
					cwd,
					runner,
					ProjectArtifactLease.sharedDirectory,
				)
			: undefined;
		inspectProject(cwd, runner, owned);
		mkdirSync(root, { recursive: true, mode: 0o700 });
		chmodSync(root, 0o700);
		const secrets = new Set<string>();
		const githubBindings: NonNullable<
			ResolvedExecutionEnvironment["githubBindings"]
		> = {};
		const credential = (ref: CredentialReference, pin = true) => {
			const value = this.credential(ref, secrets);
			if (pin) this.pin(root, ref, value);
			return value;
		};
		const env =
			identity || tools
				? Object.fromEntries(
						Object.entries(this.host).filter(([key]) =>
							safeEnvironment.test(key),
						),
					)
				: { ...this.host };
		if (this.host.BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND)
			env.BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND =
				this.host.BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND;
		env.BOBS_FACTORY_HOME = dirname(this.directory);
		env.BOBS_FACTORY_GITHUB_EXPLICIT_CREDENTIALS = "1";
		// These locate prepared tools, not credentials or host configuration.
		// Expand SDK home paths before assigning the private runner HOME.
		if (runner === "cursor") {
			for (const key of [
				"BOBS_FACTORY_CURSOR_SDK_PATH",
				"BOBS_FACTORY_CURSOR_NODE",
			]) {
				const value = this.host[key];
				if (value)
					env[key] = value.startsWith("~/")
						? join(this.hostHome, value.slice(2))
						: value;
			}
		}
		const home = join(root, "jobs", job, runner, "home");
		mkdirSync(home, { recursive: true, mode: 0o700 });
		if (identity || tools) {
			env.HOME = home;
			for (const [key, suffix] of Object.entries({
				XDG_CONFIG_HOME: "config",
				XDG_DATA_HOME: "data",
				XDG_CACHE_HOME: "cache",
				XDG_STATE_HOME: "state",
			})) {
				env[key] = join(home, suffix);
				mkdirSync(env[key]!, { recursive: true, mode: 0o700 });
			}
		}
		if (identity) {
			const gitCwd = repositoryWorkspaces[0] ?? cwd;
			env.GIT_TERMINAL_PROMPT = "0";
			const overrides: [string, string][] = [["user.useConfigOnly", "true"]];
			for (const [kind, setting] of [
				["AUTHOR", identity.author],
				["COMMITTER", identity.committer],
			] as const) {
				const effectiveIdentity =
					setting.mode === "share"
						? run("git", ["var", `GIT_${kind}_IDENT`], gitCwd, this.host)
						: undefined;
				const match = effectiveIdentity?.match(/^(.*) <([^<>]*)> \d+ [+-]\d+$/);
				if (effectiveIdentity && !match)
					throw new Error("Cannot resolve the effective shared Git identity");
				const value = match
					? { name: match[1]!, email: match[2]! }
					: setting.value!;
				env[`GIT_${kind}_NAME`] = value.name;
				env[`GIT_${kind}_EMAIL`] = value.email;
			}
			env.GIT_CONFIG_NOSYSTEM = "1";
			env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
			privateFile(env.GIT_CONFIG_GLOBAL, "");
			for (const repositoryWorkspace of repositoryWorkspaces) {
				const localKeys = run(
					"git",
					["config", "--name-only", "--list"],
					repositoryWorkspace,
					env,
				).split("\n");
				if (
					localKeys.some((key) =>
						/^(include|includeif|url\.|http\.|credential\.|core\.sshcommand|gpg\.|user\.signingkey)/i.test(
							key,
						),
					)
				)
					throw new Error(
						"Repository-local Git authentication, includes, headers or signing conflict with the selected execution profile. Remove the conflicting settings or use Legacy execution.",
					);
				const commonGitDirectory = run(
					"git",
					["rev-parse", "--path-format=absolute", "--git-common-dir"],
					repositoryWorkspace,
					env,
				);
				if (existsSync(join(commonGitDirectory, "glab-cli", "config.yml")))
					throw new Error(
						"Repository-local glab authentication/configuration conflicts with the selected profile",
					);
			}
			const aliases = identity.repositories.flatMap((binding) =>
				binding.ssh ? [binding.ssh.alias] : [],
			);
			if (
				new Set(aliases).size !== aliases.length ||
				identity.repositories.some(
					(binding) =>
						binding.ssh &&
						identity.repositories.some(
							(other) => other !== binding && other.host === binding.ssh!.alias,
						),
				)
			)
				throw new Error(
					"SSH aliases must identify exactly one repository host binding",
				);
			const destinations: { host: string; project: string }[] = [];
			for (const repositoryWorkspace of repositoryWorkspaces) {
				const remotes = run("git", ["remote"], repositoryWorkspace, env)
					.split("\n")
					.filter(Boolean);
				for (const name of remotes)
					for (const url of [false, true].flatMap((push) =>
						run(
							"git",
							["remote", "get-url", ...(push ? ["--push"] : []), "--all", name],
							repositoryWorkspace,
							env,
						).split("\n"),
					)) {
						const parsed = url.startsWith("https://")
							? new URL(url)
							: undefined;
						const host =
							parsed?.hostname ??
							(url.startsWith("ssh://")
								? new URL(url).hostname
								: /^(?:[^@]+@)?([^:]+):/.exec(url)?.[1]);
						if (parsed?.username || parsed?.password)
							throw new Error(
								"Remote URLs containing credentials are unsupported for execution profiles.",
							);
						if (
							!host ||
							!identity.repositories.some(
								(binding) =>
									binding.host === host || binding.ssh?.alias === host,
							)
						)
							throw new Error(
								"Repository has an unbound remote destination. Add an explicit host binding before starting.",
							);
						const binding = identity.repositories.find(
							(b) => b.host === host || b.ssh?.alias === host,
						)!;
						if (!parsed && !binding.ssh)
							throw new Error(
								"SSH remotes require an explicit key/agent, host mapping and known_hosts binding",
							);
						if (
							url.startsWith("ssh://") &&
							new URL(url).port &&
							Number(new URL(url).port) !== binding.ssh?.port
						)
							throw new Error(
								"SSH remote port differs from the selected host binding",
							);
						const project = (
							parsed?.pathname ??
							(url.startsWith("ssh://")
								? new URL(url).pathname
								: url.slice(url.indexOf(":") + 1))
						)
							.replace(/^\//, "")
							.replace(/\.git$/, "");
						destinations.push({ host: binding.host, project });
					}
			}

			if (
				new Set(identity.repositories.map((binding) => binding.host)).size !==
				identity.repositories.length
			)
				throw new Error(
					"Each repository host requires one unambiguous account binding",
				);
			if (
				identity.repositories.filter(
					(b) => b.provider === "github" && b.host !== "github.com",
				).length > 1 ||
				identity.repositories.filter((b) => b.provider === "gitlab").length > 1
			)
				throw new Error(
					"This resolver supports one enterprise GitHub and one GitLab host per execution context",
				);
			const accounts: ResolvedExecutionEnvironment["accounts"] = [];
			overrides.push(
				["credential.helper", ""],
				["core.askPass", ""],
				["http.extraHeader", ""],
			);
			env.GIT_ASKPASS = "/usr/bin/false";
			env.SSH_ASKPASS = "/usr/bin/false";
			for (const binding of identity.repositories) {
				// Provider principal introspection pins the account, allowing same-account
				// token rotation. Unverifiable runner keys retain explicit version pinning.
				let token: string;
				const api =
					binding.apiUrl ??
					(binding.provider === "github"
						? binding.host === "github.com"
							? "https://api.github.com"
							: `https://${binding.host}/api/v3`
						: `https://${binding.host}/api/v4`);
				if (
					binding.credential.source === "gh" ||
					binding.credential.source === "glab"
				) {
					if (
						binding.credential.account &&
						binding.credential.account !== binding.account
					)
						throw new Error(
							"Named credential account differs from the repository account binding",
						);
				}
				if (new URL(api).protocol !== "https:")
					throw new Error("Provider API bindings require HTTPS");
				let appPrincipal: string | undefined;
				if (binding.credential.source === "github-app") {
					if (binding.provider !== "github")
						throw new Error(
							"GitHub App bindings require a GitHub repository provider",
						);
					const app = await githubAppBinding(binding.credential, api, (key) => {
						secrets.add(key);
						this.pin(root, binding.credential, key);
					});
					token = app.token;
					appPrincipal = app.principal;
					secrets.add(token);
					secrets.add(app.privateKey);
				} else token = credential(binding.credential, false);
				let response: Response;
				try {
					response = await fetch(
						`${api.replace(/\/$/, "")}/${appPrincipal ? "installation/repositories" : "user"}`,
						{
							headers: { Authorization: `Bearer ${token}` },
							signal: AbortSignal.timeout(15000),
							redirect: "error",
						},
					);
				} catch {
					throw new Error(
						`Cannot validate the selected ${binding.host} account. Restore connectivity or the credential.`,
					);
				}
				if (!response.ok)
					throw new Error(
						`Selected ${binding.host} credential could not authenticate. Host fallback is disabled.`,
					);
				const user = (await response.json()) as {
					login?: string;
					username?: string;
				};
				const account = appPrincipal ?? user.login ?? user.username;
				if (account !== binding.account)
					throw new Error(
						`Selected ${binding.host} credential does not match the accepted account.`,
					);
				for (const remote of destinations.filter(
					(destination) => destination.host === binding.host,
				)) {
					const project =
						binding.provider === "gitlab"
							? remote.project.replace(
									`${new URL(api).pathname
										.replace(/\/api\/v4\/?$/, "")
										.replace(/^\//, "")}/`,
									"",
								)
							: remote.project;
					const endpoint =
						binding.provider === "github"
							? `repos/${project}`
							: `projects/${encodeURIComponent(project)}`;
					let access: Response;
					try {
						access = await fetch(`${api.replace(/\/$/, "")}/${endpoint}`, {
							headers: { Authorization: `Bearer ${token}` },
							signal: AbortSignal.timeout(15000),
							redirect: "error",
						});
					} catch {
						throw new Error(
							"Repository access validation failed for the selected account",
						);
					}
					if (!access.ok)
						throw new Error(
							"Selected repository account cannot access an accepted remote repository",
						);
				}
				accounts.push({ host: binding.host, account, verified: true });
				if (binding.provider === "github")
					githubBindings[binding.host] = {
						token,
						apiUrl: api,
						projects: destinations
							.filter((destination) => destination.host === binding.host)
							.map((destination) => destination.project),
					};
				const tokenName = `FACTORY_REPOSITORY_TOKEN_${accounts.length}`;
				env[tokenName] = token;
				const helper = join(root, `credential-${accounts.length}.cjs`);
				privateFile(
					helper,
					`const fs=require('node:fs');const data=fs.readFileSync(0,'utf8');const fields=Object.fromEntries(data.trim().split('\\n').map(x=>{const n=x.indexOf('=');return [x.slice(0,n),x.slice(n+1)]}));if(process.argv[2]==='get'&&fields.protocol==='https'&&fields.host===${JSON.stringify(binding.host)})process.stdout.write('username=${binding.provider === "github" ? "x-access-token" : "oauth2"}\\npassword='+process.env[${JSON.stringify(tokenName)}]+'\\n');`,
				);
				overrides.push([
					`credential.https://${binding.host}.helper`,
					env.BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND &&
					binding.provider === "github"
						? `!${env.BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND} git-credential`
						: `!node '${helper.replace(/'/g, "'\\''")}'`,
				]);
				if (binding.provider === "github")
					overrides.push([
						`credential.https://${binding.host}.useHttpPath`,
						"true",
					]);
				env[
					binding.provider === "github"
						? binding.host === "github.com"
							? "GH_TOKEN"
							: "GH_ENTERPRISE_TOKEN"
						: "GITLAB_TOKEN"
				] = token;
				env[binding.provider === "github" ? "GH_HOST" : "GITLAB_HOST"] =
					binding.host;
				if (binding.provider === "github" && binding.host !== "github.com")
					env.BOBS_FACTORY_GITHUB_ENTERPRISE_HOST = binding.host;
				if (binding.provider === "gitlab") {
					env.GITLAB_API_HOST = new URL(api).host;
					env.GLAB_API_PROTOCOL = "https";
					env.GITLAB_SUBFOLDER = new URL(api).pathname
						.replace(/\/api\/v4\/?$/, "")
						.replace(/^\//, "");
				}
			}
			env.GH_CONFIG_DIR = join(home, "gh");
			env.BOBS_FACTORY_GITHUB_REPOSITORIES = JSON.stringify(
				destinations.filter((destination) => githubBindings[destination.host]),
			);
			env.BOBS_FACTORY_GITHUB_API_URLS = JSON.stringify(
				Object.fromEntries(
					Object.entries(githubBindings).map(([host, binding]) => [
						host,
						binding.apiUrl,
					]),
				),
			);
			env.GLAB_CONFIG_DIR = join(home, "glab");
			env.GLAB_USE_KEYRING = "false";
			env.USE_KEYRING = "false";
			env.GLAB_ENABLE_CI_AUTOLOGIN = "false";
			mkdirSync(env.GH_CONFIG_DIR, { recursive: true, mode: 0o700 });
			mkdirSync(env.GLAB_CONFIG_DIR, { recursive: true, mode: 0o700 });
			const primaryGithub = identity.repositories.find(
				(binding) =>
					binding.provider === "github" &&
					binding.host === destinations[0]?.host,
			);
			if (primaryGithub) env.GH_HOST = primaryGithub.host;
			const sshConfig = join(root, "ssh", "config");
			const ssh = identity.repositories.flatMap((binding) =>
				binding.ssh ? [binding.ssh] : [],
			);
			const quote = (value: string) =>
				`"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
			privateFile(
				sshConfig,
				ssh
					.map(
						(item) =>
							`Host ${item.alias} ${identity.repositories.find((binding) => binding.ssh === item)!.host}\n HostName ${item.hostname}\n User ${item.user}\n Port ${item.port}\n IdentityFile ${quote(resolvePath(item.key))}\n IdentityAgent ${item.agent ? quote(resolvePath(item.agent)) : "none"}\n UserKnownHostsFile ${quote(resolvePath(item.knownHosts))}\n IdentitiesOnly yes\n StrictHostKeyChecking yes\n BatchMode yes\n`,
					)
					.join("\n") +
					"\nHost *\n BatchMode yes\n IdentityAgent none\n IdentityFile none\n IdentitiesOnly yes\n StrictHostKeyChecking yes\n PKCS11Provider none\n IgnoreUnknown UseKeychain\n UseKeychain no\n",
			);
			for (const item of ssh) {
				let greeting = "";
				try {
					greeting = execFileSync("ssh", ["-F", sshConfig, "-T", item.alias], {
						env,
						encoding: "utf8",
						timeout: 15000,
						stdio: ["ignore", "pipe", "pipe"],
					});
				} catch (error) {
					const failure = error as {
						stdout?: Buffer | string;
						stderr?: Buffer | string;
					};
					greeting =
						String(failure.stdout ?? "") + String(failure.stderr ?? "");
				}
				const account =
					/Hi ([a-zA-Z0-9_-]+)!/.exec(greeting)?.[1] ??
					/Welcome to GitLab, @([a-zA-Z0-9_-]+)!/.exec(greeting)?.[1];
				const accepted = identity.repositories.find(
					(binding) => binding.ssh === item,
				)!.account;
				if (account !== accepted)
					throw new Error(
						"Selected SSH key/agent did not authenticate as the accepted repository account. Prepare headless access or select HTTPS",
					);
			}
			env.GIT_SSH_COMMAND = `ssh -F '${sshConfig.replace(/'/g, "'\\''")}'`;
			const policy = identity.signing;
			if (policy.format === "share") {
				env.GNUPGHOME = this.host.GNUPGHOME ?? join(this.hostHome, ".gnupg");
				if (this.host.SSH_AUTH_SOCK)
					env.SSH_AUTH_SOCK = this.host.SSH_AUTH_SOCK;
				for (const key of [
					"commit.gpgsign",
					"tag.gpgsign",
					"gpg.format",
					"gpg.program",
					"gpg.ssh.program",
					"gpg.ssh.allowedSignersFile",
					"gpg.ssh.revocationFile",
					"user.signingkey",
				]) {
					try {
						overrides.push([
							key,
							execFileSync(
								"git",
								[
									"config",
									...(["commit.gpgsign", "tag.gpgsign"].includes(key)
										? ["--bool"]
										: []),
									"--get",
									key,
								],
								{
									env: this.host,
									cwd: gitCwd,
									encoding: "utf8",
									stdio: ["ignore", "pipe", "pipe"],
								},
							).trim(),
						]);
					} catch (error) {
						if ((error as { status?: number }).status !== 1)
							throw new Error(
								"Invalid or unreadable shared Git signing policy",
							);
						// Git exits 1 only when this policy is unset.
					}
				}
			} else {
				overrides.push(
					["gpg.ssh.defaultKeyCommand", ""],
					[
						"commit.gpgsign",
						String(policy.format !== "disabled" && policy.commits),
					],
					["tag.gpgsign", String(policy.format !== "disabled" && policy.tags)],
				);
				if (policy.format === "ssh") {
					overrides.push(
						["gpg.format", "ssh"],
						["gpg.ssh.program", "ssh-keygen"],
						["user.signingkey", resolvePath(policy.key)],
					);
					if (policy.agent) env.SSH_AUTH_SOCK = resolvePath(policy.agent);
					if (policy.allowedSigners)
						overrides.push([
							"gpg.ssh.allowedSignersFile",
							resolvePath(policy.allowedSigners),
						]);
				} else if (policy.format === "openpgp") {
					env.GNUPGHOME = resolvePath(policy.home);
					overrides.push(
						["gpg.format", "openpgp"],
						["gpg.program", "gpg"],
						["user.signingkey", policy.fingerprint],
					);
				}
			}
			for (let n = 0; n < overrides.length; n++) {
				const [name, value] = overrides[n]!;
				if (
					name === "gpg.ssh.allowedSignersFile" ||
					name === "gpg.ssh.revocationFile" ||
					(name === "user.signingkey" &&
						new Map(overrides).get("gpg.format") === "ssh" &&
						!value.startsWith("key::"))
				)
					overrides[n] = [name, resolvePath(value)];
			}
			const effective = new Map(overrides);
			let fingerprint: string | undefined;
			const signingKey = effective.get("user.signingkey");
			if (signingKey && effective.get("gpg.format") === "ssh") {
				if (signingKey.startsWith("key::"))
					throw new Error(
						"Shared inline SSH signing keys are unsupported. Declare a key file and optional agent instead",
					);
				try {
					fingerprint = execFileSync(
						"ssh-keygen",
						["-lf", resolvePath(signingKey)],
						{
							env,
							encoding: "utf8",
							timeout: 15000,
							stdio: ["ignore", "pipe", "pipe"],
						},
					)
						.trim()
						.split(/\s+/)[1];
				} catch {
					throw new Error(
						"Selected SSH signing key cannot be fingerprinted. Restore the declared key file",
					);
				}
				const keyMaterial = readFileSync(resolvePath(signingKey), "utf8");
				secrets.add(keyMaterial);
				this.pin(
					root,
					{
						source: "file",
						path: resolvePath(signingKey),
						version: `profile-${identity.revision}`,
						owner: identity.name,
					},
					keyMaterial,
				);
			} else if (signingKey) fingerprint = signingKey;
			if (
				effective.get("commit.gpgsign") === "true" ||
				effective.get("tag.gpgsign") === "true"
			) {
				const key = effective.get("user.signingkey");
				if (!key)
					throw new Error(
						"Shared signing needs an explicit selected key. Configure a signing-key binding before admission",
					);
				try {
					if (effective.get("gpg.format") === "ssh")
						execFileSync(
							"ssh-keygen",
							["-Y", "sign", "-f", resolvePath(key), "-n", "git"],
							{
								input: "Factory signing preflight",
								env,
								timeout: 15000,
								stdio: ["pipe", "pipe", "pipe"],
							},
						);
					else
						execFileSync(
							"gpg",
							[
								"--batch",
								"--yes",
								"--local-user",
								key,
								"--detach-sign",
								"--output",
								"/dev/null",
							],
							{
								input: "Factory signing preflight",
								env,
								timeout: 15000,
								stdio: ["pipe", "pipe", "pipe"],
							},
						);
				} catch {
					throw new Error(
						"Required signing key is unavailable or locked. Prepare headless key/agent access; signing cannot be silently disabled",
					);
				}
			}
			env.GIT_CONFIG_COUNT = String(overrides.length);
			overrides.forEach(([key, value], n) => {
				env[`GIT_CONFIG_KEY_${n}`] = key;
				env[`GIT_CONFIG_VALUE_${n}`] = value;
			});
			if (!auth)
				throw new Error(
					`Identity profile has no ${runner} authentication binding. Add one before selecting this runner.`,
				);
			if (native) {
				const directory = resolvePath(auth.configDirectory!);
				if (!existsSync(directory) || !statSync(directory).isDirectory())
					throw new Error(
						"Native Share configuration directory is missing; restore the accepted login root",
					);
				// Native OS credential stores use the logged-in user's namespace.
				for (const key of ["USER", "LOGNAME", "SHELL"])
					if (this.host[key]) env[key] = this.host[key]!;
				let account: string;
				if (runner === "claude") {
					// Default Claude login metadata lives beside ~/.claude in ~/.claude.json.
					// Share must retain that native namespace as well as its keychain/store.
					env.HOME = this.hostHome;
					if (directory !== join(this.hostHome, ".claude"))
						env.CLAUDE_CONFIG_DIR = directory;
					try {
						const status = JSON.parse(
							run(
								executionCapabilities("claude").binary,
								["auth", "status"],
								cwd,
								env,
							),
						);
						if (
							!status.loggedIn ||
							status.authMethod !== "claude.ai" ||
							!status.email
						)
							throw new Error("Missing native login");
						account = status.email;
					} catch {
						throw new Error(
							"Native Claude Share needs an existing claude.ai login in the selected root; unlock its keychain or use an API binding",
						);
					}
				} else {
					env.CODEX_HOME = directory;
					const status = await inspectCodexNativeLogin(env);
					account = status.account;
					disabledMcp.push(
						...status.mcp.filter((name) => !disabledMcp.includes(name)),
					);
				}
				if (account !== auth.account)
					throw new Error(
						"Native login account differs from the accepted account. Restore it or launch with a revised profile",
					);
			} else {
				const key = credential(auth.credential!);
				const variables = {
					claude: "ANTHROPIC_API_KEY",
					codex: "OPENAI_API_KEY",
					gemini: "GEMINI_API_KEY",
					cursor: "CURSOR_API_KEY",
					opencode:
						auth.provider === "anthropic"
							? "ANTHROPIC_API_KEY"
							: auth.provider === "google"
								? "GOOGLE_GENERATIVE_AI_API_KEY"
								: "OPENAI_API_KEY",
				};
				env[
					runner === "claude" && auth.kind === "setup-token"
						? "CLAUDE_CODE_OAUTH_TOKEN"
						: variables[runner]
				] = key;
				if (runner === "claude") {
					env.CLAUDE_CONFIG_DIR = join(home, ".claude");
					mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true, mode: 0o700 });
				}
				if (runner === "codex") {
					env.CODEX_HOME = join(home, ".codex");
					privateFile(
						join(env.CODEX_HOME, "auth.json"),
						JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: key }),
					);
					privateFile(
						join(env.CODEX_HOME, "config.toml"),
						'cli_auth_credentials_store = "file"\nmcp_oauth_credentials_store = "file"\nmodel_provider = "openai"\n',
					);
				}
			}
			if (runner === "opencode") env.OPENCODE_DISABLE_PROJECT_CONFIG = "true";
			const mcp = this.servers(tools, root, credential, secrets);
			validateServers(mcp, runner, tools?.denyTools ?? []);
			if (disabledMcp.some((name) => Object.hasOwn(mcp, name)))
				throw new Error(
					"Selected MCP name collides with a native Codex registration. Rename the materialized server to prevent native fields surviving a merge",
				);
			return {
				root,
				githubBindings,
				git: {
					author: `${env.GIT_AUTHOR_NAME} <${env.GIT_AUTHOR_EMAIL}>`,
					committer: `${env.GIT_COMMITTER_NAME} <${env.GIT_COMMITTER_EMAIL}>`,
					signing:
						policy.format === "disabled"
							? "disabled"
							: (effective.get("gpg.format") ?? "openpgp"),
					fingerprint,
					commits: effective.get("commit.gpgsign") === "true",
					tags: effective.get("tag.gpgsign") === "true",
				},
				runner,
				disabledMcp,
				repositoryInstructions:
					runner === "claude"
						? ["CLAUDE.md", ".claude/CLAUDE.md"]
								.filter((file) => existsSync(join(cwd, file)))
								.map(
									(file) =>
										`Repository instructions (${file}):\n${readFileSync(join(cwd, file), "utf8")}`,
								)
								.join("\n\n")
						: undefined,
				settings: {
					...executionSettings(tools!, runner, root),
					...(native && runner === "codex"
						? { model_provider: "openai", forced_login_method: "chatgpt" }
						: {}),
				},
				environment: env,
				mcp,
				accounts,
				redact: (value) => {
					return redactSecrets(value, secrets);
				},
			};
		}
		return {
			root,
			runner,
			disabledMcp,
			repositoryInstructions:
				runner === "claude"
					? ["CLAUDE.md", ".claude/CLAUDE.md"]
							.filter((file) => existsSync(join(cwd, file)))
							.map(
								(file) =>
									`Repository instructions (${file}):\n${readFileSync(join(cwd, file), "utf8")}`,
							)
							.join("\n\n")
					: undefined,
			settings: executionSettings(tools!, runner, root),
			environment: env,
			mcp: this.servers(tools, root, credential, secrets),
			accounts: [],
			redact: (value) => {
				return redactSecrets(value, secrets);
			},
		};
	}
	/** Remove transient native auth caches; retain nonsecret snapshots and authorized resume state. */
	cleanupCredentials(id: string): void {
		if (!/^[\w-]+$/.test(id)) throw new Error("Invalid execution root ID");
		const jobs = join(this.directory, "execution-private", id, "jobs");
		if (!existsSync(jobs)) return;
		for (const job of readdirSync(jobs, { withFileTypes: true })) {
			if (!job.isDirectory()) continue;
			for (const runner of readdirSync(join(jobs, job.name), {
				withFileTypes: true,
			})) {
				if (!runner.isDirectory()) continue;
				const home = join(jobs, job.name, runner.name, "home");
				for (const name of [
					".codex/auth.json",
					".claude/.credentials.json",
					".gemini/oauth_creds.json",
					".gemini/google_accounts.json",
					".local/share/opencode/auth.json",
				])
					rmSync(join(home, name), { force: true });
			}
		}
	}
	private servers(
		tools: ExecutionSnapshot["tools"],
		root: string,
		credential: (ref: CredentialReference) => string,
		secrets: Set<string>,
	): Record<string, McpServerConfig> {
		const servers: Record<string, McpServerConfig> = {};
		if (!tools) return servers;
		for (const source of tools.sources) {
			const file = resolvePath(source);
			const cached = join(
				root,
				"sources",
				`${createHash("sha256").update(file).digest("hex")}.json`,
			);
			if (tools.mode !== "share" && !existsSync(cached))
				privateFile(cached, readFileSync(file, "utf8"));
			let data: { mcpServers?: Record<string, unknown> };
			try {
				data = JSON.parse(
					readFileSync(tools.mode === "share" ? file : cached, "utf8"),
				);
			} catch {
				throw new Error("Declared MCP source is unreadable or invalid JSON");
			}
			if (!data.mcpServers || typeof data.mcpServers !== "object")
				throw new Error("Declared tool source must contain an MCP server map");
			for (const [name, config] of Object.entries(data.mcpServers)) {
				if (name === "factory-context")
					throw new Error(
						"Declared source collides with reserved factory-context server",
					);
				if (
					!config ||
					typeof config !== "object" ||
					(!Object.hasOwn(config, "command") && !Object.hasOwn(config, "url"))
				)
					throw new Error(
						"Declared MCP source has an unsupported server definition",
					);
				const definition = config as Record<string, unknown>;
				for (const field of ["env", "headers"]) {
					const values = definition[field];
					if (values && typeof values === "object")
						for (const value of Object.values(values))
							if (typeof value === "string" && value.length >= 4)
								secrets.add(value);
				}
				if (
					Object.keys(definition).some(
						(key) =>
							!["type", "command", "args", "env", "url", "headers"].includes(
								key,
							),
					)
				)
					throw new Error(
						"Declared MCP source contains unsupported automatic authentication or settings",
					);
				const def = definition;
				if (typeof def.url === "string") {
					let url: URL;
					try {
						url = new URL(def.url);
					} catch {
						throw new Error("Invalid declared MCP endpoint");
					}
					if (url.username || url.password || url.search || url.hash)
						throw new Error(
							"MCP endpoints cannot embed credentials; use references",
						);
				}
				servers[name] = config as McpServerConfig;
			}
		}
		for (const [name, config] of Object.entries(tools.mcp)) {
			if (config.type === "stdio")
				servers[name] = {
					type: "stdio",
					command: config.command,
					args: config.args,
					env: Object.fromEntries(
						Object.entries(config.env).map(([key, value]) => [
							key,
							"literal" in value ? value.literal : credential(value),
						]),
					),
				};
			else
				servers[name] = {
					type: config.type,
					url: config.url,
					headers: Object.fromEntries(
						Object.entries(config.headers).map(([key, value]) => [
							key,
							credential(value),
						]),
					),
				};
		}
		for (const name of tools.remove) delete servers[name];
		return servers;
	}
	apply(
		config: AgentRunnerConfig,
		snapshot: ExecutionSnapshot,
		resolved: ResolvedExecutionEnvironment,
	): void {
		if (!snapshot.tools)
			throw new Error(
				"Identity-only materialization requires declared tool sources; automatic host discovery has not been validated",
			);
		config.childEnvironment = { ...resolved.environment };
		// Retain only mandatory transport trust additions; never re-add an App token.
		for (const [key, value] of Object.entries(config.additionalEnv ?? {}))
			if (safeEnvironment.test(key)) config.childEnvironment[key] = value;
		config.additionalEnv = undefined;
		config.settingSources = [];
		if (resolved.repositoryInstructions)
			config.appendSystemPrompt = [
				config.appendSystemPrompt,
				resolved.repositoryInstructions,
			]
				.filter(Boolean)
				.join("\n\n");
		config.runnerSettings = resolved.settings;
		config.codexDisabledMcp = resolved.disabledMcp;
		config.plugins = [];
		config.autoMemoryDirectory = undefined;
		config.redact = resolved.redact;
		const errorHandler = config.onError;
		if (errorHandler)
			config.onError = (error) =>
				errorHandler(new Error(resolved.redact(error.message)));
		if (config.logger) {
			const logger = config.logger;
			config.logger = new Proxy(logger, {
				get(target, key) {
					const method = Reflect.get(target, key);
					if (typeof method !== "function") return method;
					return (...args: unknown[]) =>
						method.apply(
							target,
							args.map((value) => {
								if (typeof value === "string") return resolved.redact(value);
								if (value instanceof Error)
									return new Error(resolved.redact(value.message));
								if (value && typeof value === "object")
									return JSON.parse(resolved.redact(JSON.stringify(value)));
								return value;
							}),
						);
				},
			});
		}
		config.factoryHome = join(resolved.root, "runner-logs");
		config.runnerArtifactLeaseDirectory = ProjectArtifactLease.sharedDirectory;
		config.opencodeStateScope = "inherit";
		config.opencodeGlobalConfig = {
			...resolved.settings,
			enabled_providers: [
				snapshot.identity?.runners.opencode?.provider ?? "openai",
			],
		};
		config.opencodeRepositoryConfig = undefined;
		if (snapshot.tools) {
			config.mcpConfigPath = undefined;
			config.mcpConfig = resolved.mcp;
			config.strictMcpConfig = true;
			config.disallowedTools = [
				...(config.disallowedTools ?? []),
				...snapshot.tools.denyTools,
			];
		}
		if (this.host.BOBS_FACTORY_GITHUB_CREDENTIAL_COMMAND)
			allowGithubHelperExecutable(
				config,
				this.host.BOBS_FACTORY_INTERNAL_EXECUTABLE,
			);
	}
}

function redactSecrets(value: string, secrets: Set<string>): string {
	let result = value;
	for (const secret of [...secrets].sort((a, b) => b.length - a.length))
		for (const form of new Set([
			secret,
			JSON.stringify(secret).slice(1, -1),
			encodeURIComponent(secret),
		]))
			result = result.split(form).join("[REDACTED]");
	return result;
}

function validateServers(
	servers: Record<string, McpServerConfig>,
	runner: RunnerType,
	denied: string[],
): void {
	for (const server of Object.values(servers)) {
		if (runner === "gemini" && !("command" in server))
			throw new Error("Gemini execution profiles support only stdio MCP");
		if (runner === "opencode" && server.type === "sse")
			throw new Error("OpenCode does not support SSE MCP");
		if (server.type === "sdk")
			throw new Error(
				"Execution profiles require process or HTTP MCP transports",
			);
	}
	// A requested restriction must never be silently lost by a provider adapter.
	if (
		runner === "codex" &&
		denied.some((tool) => !/^mcp__[a-zA-Z0-9_-]+$/.test(tool))
	)
		throw new Error(
			"Codex profiles support MCP tool denials. Use native sandbox policy for shell and filesystem restrictions",
		);
	if (runner === "gemini" && denied.length)
		throw new Error(
			"Gemini profile tool denials are unsupported; use its supported server allowlist",
		);
}
