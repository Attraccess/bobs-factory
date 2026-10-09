import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

import { getAllTools } from "bobs-factory-claude-runner";
import {
	EdgeConfigSchema,
	type EdgeWorkerConfig,
	type RunnerType,
	resolvePath,
} from "bobs-factory-core";
import { EdgeWorker } from "bobs-factory-edge-worker";

export async function launchLocal(values: {
	repo: string;
	port: string;
	agent: string;
	model?: string;
	home: string;
	origin?: string;
	sessionHours?: string;
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
	if (values.origin) process.env.BOBS_FACTORY_FACTORY_ORIGIN = values.origin;
	if (values.sessionHours !== undefined)
		process.env.BOBS_FACTORY_FACTORY_SESSION_HOURS = values.sessionHours;
	let config: EdgeWorkerConfig = {
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
	};
	// Local launches retain an owned source for operator connection repairs across restarts.
	const configPath = join(home, "local-config.json");
	mkdirSync(home, { recursive: true, mode: 0o700 });
	if (existsSync(configPath)) {
		const saved = EdgeConfigSchema.parse(
			JSON.parse(readFileSync(configPath, "utf8")),
		);
		const repository = saved.repositories.find(
			(repository) =>
				repository.id === "local" && repository.repositoryPath === repo,
		);
		if (!repository)
			throw new Error(
				"This Factory home retains a different local repository. Select its repository or use a separate --home so saved operator repairs and runs keep their repository identity.",
			);
		config = {
			...saved,
			...config,
			// An omitted --model restores provider defaults, rather than an old override.
			claudeDefaultModel: values.model,
			codexDefaultModel: values.model,
			geminiDefaultModel: values.model,
			cursorDefaultModel: values.model,
			opencodeDefaultModel: values.model,
			linearAllowedTools: saved.linearAllowedTools ?? config.linearAllowedTools,
			repositories: saved.repositories.map((entry) =>
				entry.id === "local" ? { ...entry, ...config.repositories[0]! } : entry,
			),
		};
	}
	// Reload and startup must consume the same effective launch configuration.
	const temporaryPath = `${configPath}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporaryPath, JSON.stringify(config, null, 2), {
			mode: 0o600,
			flag: "wx",
		});
		renameSync(temporaryPath, configPath);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
	const worker = new EdgeWorker(config);
	worker.setConfigPath(configPath);
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
