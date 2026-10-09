import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeCommand } from "../../src/factory/FactoryTools.js";
import type { RunRepository } from "../../src/factory/RepositoryScope.js";
import type { ExecutionContext } from "../../src/factory/WorkflowRuntime.js";
import { githubApiReceipt, githubRequest } from "./github-api.js";

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
		if (executable !== "bobs-factory:github-api")
			throw new Error(`Unexpected command ${executable}`);
		const api = githubRequest(args);
		const pulls = `repos/fixture/${repository.id}/pulls`;
		if (api.method === "GET" && api.path.startsWith(`${pulls}?`))
			return JSON.stringify(
				requests.has(repository.id)
					? [
							{
								html_url: requests.get(repository.id)!.url,
								draft: requests.get(repository.id)!.isDraft,
							},
						]
					: [],
			);
		if (api.method === "POST" && api.path === pulls) {
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
			const pr = githubApiReceipt(
				[JSON.stringify({ ...api, method: "GET", path: `${pulls}/1` })],
				{ url: request.url, headRefOid: request.headSha },
			);
			pr.head.ref = request.branchName;
			pr.base.ref = repository.baseBranch;
			return JSON.stringify(pr);
		}
		const request = requests.get(repository.id);
		if (!request) throw new Error(`Missing fixture PR ${repository.id}`);
		if (api.path === "graphql") {
			const query = (api.body as { query: string }).query;
			if (query.includes("markPullRequestReadyForReview"))
				request.isDraft = false;
			if (query.includes("convertPullRequestToDraft")) request.isDraft = true;
		}
		if (api.method === "PUT" && api.path.endsWith("/merge")) {
			if (failMerge === repository.id) throw new Error("Injected merge outage");
			if ((api.body as { sha: string }).sha !== request.headSha)
				throw new Error("Unapproved revision");
			request.state = "MERGED";
			merges.push(repository.id);
		}
		const receipt = githubApiReceipt(args, {
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
		});
		if (api.method === "GET" && api.path === `${pulls}/1`) {
			receipt.head.ref = request.branchName;
			receipt.base.ref = repository.baseBranch;
		}
		return JSON.stringify(receipt);
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
