import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeCommand } from "../../src/factory/FactoryTools.js";
import type { RunRepository } from "../../src/factory/RepositoryScope.js";
import type { ExecutionContext } from "../../src/factory/WorkflowRuntime.js";
import { providerReceipt } from "./merge-readiness.js";

export function deliveryFixture(directory: string) {
	const repositories: RunRepository[] = [];
	const requests = new Map<
		string,
		{
			url: string;
			headSha: string;
			state: string;
			isDraft: boolean;
			branchName?: string;
		}
	>();
	const publications: string[] = [],
		merges: string[] = [],
		commands: { repositoryId: string; executable: string; args: string[] }[] =
			[];
	let failPublication: string | undefined, failMerge: string | undefined;
	const git = (repository: RunRepository, ...args: string[]) =>
		execFileSync("git", args, {
			cwd: repository.workspace,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	for (const [index, name] of ["app", "api", "context"].entries()) {
		const workspace = join(directory, name),
			origin = join(directory, `${name}.git`),
			baseBranch = index === 1 ? "development" : "main";
		mkdirSync(workspace, { recursive: true });
		execFileSync("git", ["init", "--bare", "-q", origin]);
		const repository = {
			id: name,
			name,
			workspace,
			repositoryPath: workspace,
			baseBranch,
			githubUrl: `https://github.com/fixture/${name}`,
		};
		repositories.push(repository);
		git(repository, "init", "-q", "-b", baseBranch);
		git(repository, "config", "user.name", "Fixture");
		git(repository, "config", "user.email", "fixture@example.test");
		git(repository, "config", "commit.gpgsign", "false");
		writeFileSync(join(workspace, "shared.txt"), `${name} base\n`);
		git(repository, "add", ".");
		git(repository, "commit", "-qm", "chore: base");
		git(repository, "remote", "add", "origin", origin);
		git(repository, "push", "-qu", "origin", baseBranch);
		git(repository, "checkout", "-qb", "factory/group");
		if (name !== "context")
			writeFileSync(join(workspace, "shared.txt"), `${name} changed\n`);
	}
	const command = async (
		context: ExecutionContext,
		executable: string,
		args: string[],
		timeout?: number,
	) => {
		const repository = repositories.find(
			(repository) => repository.id === context.run.repositoryId,
		)!;
		const worktree = { ...repository, workspace: context.run.workspace };
		commands.push({ repositoryId: repository.id, executable, args });
		if (executable === "git") {
			const output = await executeCommand(context, executable, args, timeout);
			if (args[0] === "push" && requests.has(repository.id))
				requests.get(repository.id)!.headSha = git(
					worktree,
					"rev-parse",
					"HEAD",
				);
			return output;
		}
		if (executable !== "gh")
			throw new Error(`Unexpected command ${executable}`);
		if (args[0] === "pr" && args[1] === "list")
			return JSON.stringify(
				requests.has(repository.id) ? [requests.get(repository.id)] : [],
			);
		if (args[0] === "pr" && args[1] === "create") {
			if (failPublication === repository.id)
				throw new Error("Injected publication outage");
			const request = {
				url: `https://github.com/fixture/${repository.name}/pull/1`,
				headSha: git(worktree, "rev-parse", "HEAD"),
				state: "OPEN",
				isDraft: true,
				branchName: git(worktree, "branch", "--show-current"),
			};
			requests.set(repository.id, request);
			publications.push(repository.id);
			return request.url;
		}
		const request = requests.get(repository.id);
		if (!request) throw new Error(`Missing fixture PR ${repository.id}`);
		if (args[0] === "pr" && args[1] === "view")
			return JSON.stringify({
				...request,
				headRefOid: request.headSha,
				headRefName: request.branchName,
				baseRefName: repository.baseBranch,
			});
		if (args.includes("graphql"))
			return JSON.stringify(
				providerReceipt({
					url: request.url,
					headRefOid: request.headSha,
					baseRefOid: git(
						repository,
						"rev-parse",
						`origin/${repository.baseBranch}`,
					),
					state: request.state,
					isDraft: request.isDraft,
					mergeStateStatus: "CLEAN",
					reviewDecision: "APPROVED",
				}),
			);
		if (args[0] === "api") return "[[]]";
		if (args[1] === "ready") {
			request.isDraft = args.includes("--undo");
			return "";
		}
		if (args[1] === "edit") return "";
		if (args[1] === "merge") {
			if (failMerge === repository.id) throw new Error("Injected merge outage");
			request.state = "MERGED";
			merges.push(repository.id);
			return "";
		}
		throw new Error(`Unexpected fixture command ${args.join(" ")}`);
	};
	return {
		repositories,
		requests,
		publications,
		merges,
		commands,
		git,
		command,
		failPublication: (id?: string) => {
			failPublication = id;
		},
		failMerge: (id?: string) => {
			failMerge = id;
		},
	};
}
