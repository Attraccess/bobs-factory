import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { getAllTools } from "../packages/claude-runner/dist/index.js";
import { type RunnerType, resolvePath } from "../packages/core/dist/index.js";
import { EdgeWorker } from "../packages/edge-worker/dist/index.js";

const { values } = parseArgs({
	options: {
		repo: { type: "string", default: process.cwd() },
		port: { type: "string", default: "3457" },
		origin: { type: "string" },
		"session-hours": { type: "string", default: "12" },
		agent: { type: "string", default: "claude" },
		model: { type: "string" },
		home: { type: "string", default: join(homedir(), ".bobs-factory") },
	},
});
const repo = resolve(resolvePath(values.repo!));
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port >= 65535)
	throw new Error("Choose a UI port between 1 and 65534");
if (
	!["claude", "codex", "gemini", "cursor", "opencode"].includes(values.agent!)
)
	throw new Error("Unknown agent");
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
process.env.CYRUS_FACTORY_PORT = String(port);
if (values.origin) process.env.CYRUS_FACTORY_ORIGIN = values.origin;
process.env.CYRUS_FACTORY_SESSION_HOURS = values["session-hours"];
const worker = new EdgeWorker({
	platform: "cli",
	cyrusHome: home,
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
