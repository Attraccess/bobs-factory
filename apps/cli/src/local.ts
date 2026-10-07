import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { getAllTools } from "bobs-factory-claude-runner";
import { type RunnerType, resolvePath } from "bobs-factory-core";
import { EdgeWorker } from "bobs-factory-edge-worker";

export async function launchLocal(values: {
	repo: string;
	port: string;
	agent: string;
	model?: string;
	home: string;
}) {
	const repo = resolve(resolvePath(values.repo!));
	const port = Number(values.port);
	if (!Number.isInteger(port) || port < 1 || port >= 65535)
		throw new Error("Choose a UI port between 1 and 65534");
	if (
		!["claude", "codex", "gemini", "cursor", "opencode"].includes(values.agent!)
	)
		throw new Error("Unknown agent");
	let isDirectory = false;
	try {
		isDirectory = statSync(repo).isDirectory();
	} catch {
		throw new Error(
			`Cannot access repository directory: ${repo}. Choose an existing Git repository with --repo <path>, or create the directory and run git init there.`,
		);
	}
	if (!isDirectory)
		throw new Error(
			`Repository path is not a directory: ${repo}. Use --repo <path> to select a Git repository directory.`,
		);
	const home = resolvePath(values.home!);
	let baseBranch: string;
	try {
		baseBranch = execFileSync(
			"git",
			["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
			{ cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		)
			.trim()
			.replace(/^origin\//, "");
	} catch {
		baseBranch = execFileSync("git", ["branch", "--show-current"], {
			cwd: repo,
			encoding: "utf8",
		}).trim();
	}
	if (!baseBranch)
		throw new Error("Check out a branch before starting the factory");
	process.env.BOBS_FACTORY_FACTORY_PORT = String(port);
	const worker = new EdgeWorker({
		platform: "cli",
		factoryHome: home,
		serverPort: port + 1,
		serverHost: "127.0.0.1",
		defaultRunner: values.agent as RunnerType,
		linearAllowedTools: getAllTools(),
		...(values.model
			? {
					claudeDefaultModel: values.model,
					codexDefaultModel: values.model,
					geminiDefaultModel: values.model,
					cursorDefaultModel: values.model,
					opencodeDefaultModel: values.model,
				}
			: {}),
		repositories: [
			{
				id: "local",
				name: basename(repo),
				repositoryPath: repo,
				workspaceBaseDir: join(home, "worktrees"),
				baseBranch,
				linearWorkspaceId: "cli-workspace",
				isActive: true,
			},
		],
	});
	await worker.start();
	console.log(
		`Bob's Factory: http://127.0.0.1:${port}\nRepository: ${repo}\nState: ${home}`,
	);
	let stopping = false;
	const stop = async () => {
		if (stopping) return;
		stopping = true;
		await worker.stop();
		process.exit(0);
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
}
