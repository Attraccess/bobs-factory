import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	accessSync,
	chmodSync,
	constants,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
	type EdgeConfig,
	EdgeConfigSchema,
	type RepositoryConfig,
	type RunnerType,
	resolvePath,
} from "bobs-factory-core";
import { resolveCursorInstallation } from "bobs-factory-cursor-runner";
import type { FactoryOnboarding } from "bobs-factory-edge-worker";

const agents = [
	{
		id: "codex",
		label: "Codex",
		command: "codex",
		login: "codex login",
		install: "https://developers.openai.com/codex/cli/",
	},
	{
		id: "claude",
		label: "Claude Code",
		command: "claude",
		login: "claude auth login",
		install: "https://code.claude.com/docs/en/setup",
	},
	{
		id: "gemini",
		label: "Gemini CLI",
		command: "gemini",
		login: "gemini",
		install: "https://geminicli.com/docs/get-started/installation/",
	},
	{
		id: "cursor",
		label: "Cursor",
		command: "agent",
		login: "agent login",
		install: "https://cursor.com/docs/cli/overview",
	},
	{
		id: "opencode",
		label: "OpenCode",
		command: "opencode",
		login: "opencode auth login",
		install: "https://opencode.ai/docs/",
	},
] as const;

export function installedCommand(
	command: string,
	path = process.env.PATH ?? "",
) {
	return path.split(":").some((directory) => {
		if (!directory) return false;
		try {
			const file = join(directory, command);
			accessSync(file, constants.X_OK);
			return statSync(file).isFile();
		} catch {
			return false;
		}
	});
}

function agentAvailability(agent: (typeof agents)[number]) {
	if (!installedCommand(agent.command)) return { installed: false };
	if (agent.id !== "cursor") return { installed: true };
	try {
		const installation = resolveCursorInstallation();
		if (installation.node) {
			const version = execFileSync(installation.node, ["--version"], {
				encoding: "utf8",
				timeout: 5000,
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
			const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
			if (!major || major < 22 || (major === 22 && (!minor || minor < 13)))
				throw new Error("Cursor needs a prepared Node runtime >=22.13.");
		}
		return { installed: true };
	} catch {
		return {
			installed: false,
			note: "Cursor needs separately prepared @cursor/sdk 1.0.19 and Node >=22.13. Complete the Cursor setup in the distribution guide, then refresh.",
		};
	}
}

function privateText(path: string) {
	const stat = lstatSync(path);
	if (
		!stat.isFile() ||
		stat.isSymbolicLink() ||
		(process.getuid && stat.uid !== process.getuid())
	)
		throw new Error(
			"Factory setup files must belong to this operator and cannot be links",
		);
	chmodSync(path, 0o600);
	return readFileSync(path, "utf8");
}
export function savePrivateJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	if (existsSync(path)) privateText(path);
	const temporary = `${path}.${randomBytes(12).toString("hex")}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
			mode: 0o600,
			flag: "wx",
		});
		renameSync(temporary, path);
	} finally {
		if (existsSync(temporary)) unlinkSync(temporary);
	}
}

export function loadLocalConfig(home: string): EdgeConfig {
	const path = join(home, "config.json");
	if (!existsSync(path)) return { repositories: [] };
	try {
		return EdgeConfigSchema.parse(JSON.parse(privateText(path)));
	} catch {
		throw new Error(
			`Cannot read Factory configuration at ${path}. Restore or repair it before starting; existing setup was preserved.`,
		);
	}
}

export function localRepository(
	path: string,
	home: string,
	id = "local",
): RepositoryConfig {
	let repo = resolve(resolvePath(path));
	try {
		if (!statSync(repo).isDirectory())
			throw new Error(
				`Repository path is not a directory: ${repo}. Use --repo <path> to select a Git repository directory.`,
			);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Repository path"))
			throw error;
		throw new Error(
			`Cannot access repository directory: ${repo}. Choose an existing Git repository with --repo <path>, or create the directory and run git init there.`,
		);
	}
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd: repo,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 10000,
		}).trim();
	try {
		repo = git("rev-parse", "--show-toplevel");
	} catch {
		throw new Error(
			"Choose an existing Git checkout. Install Git if it is missing, then select your project folder.",
		);
	}
	let baseBranch: string;
	try {
		baseBranch = git(
			"symbolic-ref",
			"--short",
			"refs/remotes/origin/HEAD",
		).replace(/^origin\//, "");
	} catch {
		baseBranch = git("branch", "--show-current");
	}
	if (!git("branch", "--show-current"))
		throw new Error("Check out a branch before adding this project.");
	try {
		git("rev-parse", "--verify", "HEAD");
	} catch {
		throw new Error("Create the first Git commit before adding this project.");
	}
	let origin: string;
	try {
		origin = git("remote", "get-url", "origin");
	} catch {
		throw new Error(
			"Add an origin remote for this project so Bob can deliver pull requests.",
		);
	}
	const github =
		/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(
			origin,
		);
	const gitlab = /^https:\/\/gitlab\.com\/([^\s]+?)(?:\.git)?\/?$/.exec(origin);
	return {
		id,
		name: basename(repo),
		repositoryPath: repo,
		workspaceBaseDir: join(home, "worktrees"),
		baseBranch,
		linearWorkspaceId: "cli-workspace",
		isActive: true,
		...(github
			? { githubUrl: `https://github.com/${github[1]}/${github[2]}` }
			: {}),
		...(gitlab ? { gitlabUrl: `https://gitlab.com/${gitlab[1]}` } : {}),
	};
}

type GithubAuth = {
	version: 1;
	hosts: Record<string, { token: string; account: string; apiUrl?: string }>;
};

// Exercise the same protected evidence used for readiness without changing a PR
// or starting a coding-agent turn. Fine-grained PATs cannot always read checks.
const githubSetupQuery = `query FactoryGithubSetup($owner:String!,$name:String!) {
  repository(owner:$owner,name:$name) {
    nameWithOwner viewerPermission
    defaultBranchRef {
      target { ... on Commit { oid statusCheckRollup { ...FactorySetupChecks } } }
    }
    pullRequests(first:1,states:OPEN) {
      nodes {
        headRefOid baseRefOid reviewDecision mergeQueueEntry { id }
        autoMergeRequest { enabledAt }
        statusCheckRollup { ...FactorySetupChecks }
        reviewThreads(first:1) {
          nodes { id isResolved comments(first:1) { nodes { id } } }
        }
      }
    }
  }
}
fragment FactorySetupChecks on StatusCheckRollup {
  contexts(first:100) {
    nodes {
      __typename
      ... on CheckRun { name status conclusion }
      ... on StatusContext { context state }
    }
  }
}`;

export class LocalOnboarding implements FactoryOnboarding {
	private config: EdgeConfig;
	private saving = false;
	constructor(
		readonly home: string,
		private readonly apply: (
			repository: RepositoryConfig,
			runner: RunnerType,
		) => Promise<void>,
	) {
		this.config = loadLocalConfig(home);
	}
	status() {
		const authPath = join(this.home, "github-auth.json");
		let account: string | undefined;
		if (existsSync(authPath)) {
			try {
				account = (JSON.parse(privateText(authPath)) as GithubAuth).hosts?.[
					"github.com"
				]?.account;
			} catch {
				/* Invalid credentials must be reconnected, never returned to the browser. */
			}
		}
		return {
			available: true,
			required: !this.config.repositories.length || !this.config.defaultRunner,
			project: this.config.repositories[0]
				? {
						path: this.config.repositories[0].repositoryPath,
						name: this.config.repositories[0].name,
						githubUrl: this.config.repositories[0].githubUrl,
					}
				: undefined,
			runner: this.config.defaultRunner,
			gitInstalled: installedCommand("git"),
			agents: agents.map((agent) => ({
				...agent,
				...agentAvailability(agent),
			})),
			github: {
				connected: Boolean(
					account || process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
				),
				account,
			},
		};
	}
	async configure(input: { repositoryPath: string; runner: RunnerType }) {
		if (this.saving)
			throw new Error("Setup is already being saved. Try again shortly.");
		const agent = agents.find((agent) => agent.id === input.runner);
		if (!agent || !agentAvailability(agent).installed)
			throw new Error(
				"Install the selected coding agent, then refresh to continue.",
			);
		this.saving = true;
		try {
			const current = loadLocalConfig(this.home);
			const validated = localRepository(input.repositoryPath, this.home);
			const existing = current.repositories.find(
				(repository) =>
					resolve(resolvePath(repository.repositoryPath)) ===
					validated.repositoryPath,
			);
			const repository = existing
				? { ...existing, repositoryPath: validated.repositoryPath }
				: {
						...validated,
						id: current.repositories.length
							? `local-${randomBytes(8).toString("hex")}`
							: "local",
					};
			const next = {
				...current,
				defaultRunner: input.runner,
				repositories: [
					repository,
					...current.repositories.filter((repo) => repo.id !== repository.id),
				],
			};
			// The writer keeps unknown operator-owned config fields, and changes only setup fields.
			const path = join(this.home, "config.json");
			const raw = existsSync(path) ? JSON.parse(privateText(path)) : {};
			savePrivateJson(path, {
				...raw,
				defaultRunner: next.defaultRunner,
				repositories: next.repositories.map((repo) => ({
					...raw.repositories?.find(
						(saved: { id?: string }) => saved.id === repo.id,
					),
					...repo,
				})),
			});
			await this.apply(repository, input.runner);
			this.config = next;
			return this.status();
		} finally {
			this.saving = false;
		}
	}
	async connectGithub({ token }: { token: string }) {
		if (!token || /[\r\n\0]/.test(token))
			throw new Error("Enter a valid GitHub token.");
		const selected = this.config.repositories[0];
		const url = selected?.githubUrl ? new URL(selected.githubUrl) : undefined;
		const coordinates = url?.pathname.match(/^\/([\w.-]+)\/([\w.-]+)$/);
		if (url?.hostname !== "github.com" || !coordinates)
			throw new Error("Choose a GitHub project before connecting GitHub.");
		const [, owner, name] = coordinates;
		const request = async (endpoint: string, body?: unknown) => {
			try {
				return await fetch(`https://api.github.com/${endpoint}`, {
					method: body === undefined ? "GET" : "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						Accept: "application/vnd.github+json",
						"X-GitHub-Api-Version": "2022-11-28",
						...(body === undefined
							? {}
							: { "Content-Type": "application/json" }),
					},
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
					redirect: "error",
					signal: AbortSignal.timeout(15000),
				});
			} catch {
				throw new Error(
					"Cannot reach GitHub. Your token was not saved; try again when connected.",
				);
			}
		};
		const response = await request("user");
		if (!response.ok)
			throw new Error(
				"GitHub did not accept that token. Check its expiry and permissions.",
			);
		const user = (await response.json()) as { login?: string };
		if (!user.login)
			throw new Error("A personal GitHub token is required for this setup.");
		const check = await request(`repos/${owner}/${name}`);
		if (!check.ok)
			throw new Error(
				"That token cannot access your project. Use a classic token with repo scope; authorize it for your organization's SSO if required.",
			);
		const details = (await check.json()) as {
			permissions?: { push?: boolean };
		};
		if (!details.permissions?.push)
			throw new Error(
				"Your GitHub account needs write access to this project so Bob can deliver changes.",
			);
		const evidence = await request("graphql", {
			query: githubSetupQuery,
			variables: { owner, name },
		});
		const payload = (await evidence.json().catch(() => undefined)) as
			| {
					errors?: unknown[];
					data?: {
						repository?: {
							nameWithOwner?: string;
							viewerPermission?: string;
							defaultBranchRef?: { target?: { oid?: string } };
							pullRequests?: { nodes?: { headRefOid?: string }[] };
						};
					};
			  }
			| undefined;
		const repository = payload?.data?.repository;
		if (
			!evidence.ok ||
			payload?.errors?.length ||
			repository?.nameWithOwner?.toLowerCase() !==
				`${owner}/${name}`.toLowerCase() ||
			!["WRITE", "MAINTAIN", "ADMIN"].includes(
				repository?.viewerPermission ?? "",
			)
		)
			throw new Error(
				"This token cannot read the project's PR and CI readiness evidence. Use a classic personal access token with repo scope; fine-grained tokens can lack check access. Your token was not saved.",
			);
		if (
			!repository?.defaultBranchRef?.target?.oid &&
			!repository?.pullRequests?.nodes?.some((pr) => pr.headRefOid)
		)
			throw new Error(
				"Push your project's first commit to GitHub, then reconnect so Bob can validate its CI access. Your token was not saved.",
			);
		const path = join(this.home, "github-auth.json");
		const current: GithubAuth = existsSync(path)
			? JSON.parse(privateText(path))
			: { version: 1, hosts: {} };
		if (
			current.version !== 1 ||
			typeof current.hosts !== "object" ||
			current.hosts === null
		)
			throw new Error(
				"The GitHub credentials file needs repair before reconnecting.",
			);
		savePrivateJson(path, {
			...current,
			hosts: { ...current.hosts, "github.com": { token, account: user.login } },
		});
		return this.status();
	}
}
