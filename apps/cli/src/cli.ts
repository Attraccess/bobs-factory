import { factoryVersion, setGlobalErrorReporter } from "bobs-factory-core";
import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import { Application } from "./Application.js";
import { bootstrap } from "./bootstrap.js";
import { CheckTokensCommand } from "./commands/CheckTokensCommand.js";
import { RefreshTokenCommand } from "./commands/RefreshTokenCommand.js";
import { SelfAddRepoCommand } from "./commands/SelfAddRepoCommand.js";
import { SelfAuthCommand } from "./commands/SelfAuthCommand.js";
import { StartCommand } from "./commands/StartCommand.js";
import { launchLocal } from "./local.js";
import { addMigrationCommands } from "./migration/command.js";
import { createErrorReporter } from "./services/createErrorReporter.js";

const { home, envFile } = bootstrap();
// Initialise the error reporter as early as possible so that exceptions
// thrown by subsequent imports/bootstrap are captured. Install it as the
// process-wide reporter so that every Logger.error(...) call across the
// codebase forwards to Sentry automatically.
const errorReporter = createErrorReporter({
	release:
		factoryVersion === "development" ? packageJson.version : factoryVersion,
});
setGlobalErrorReporter(errorReporter);

// Setup Commander program
const program = new Command();

program
	.name("bobs-factory")
	.description("Self-hosted software factory")
	.version(
		factoryVersion === "development" ? packageJson.version : factoryVersion,
	)
	.option("--home <path>", "State and configuration directory", home)
	.option(
		"--env-file <path>",
		"Environment file (process environment takes precedence)",
		envFile,
	)
	.option("--repo <path>", "Repository for local launch", process.cwd())
	.option("--port <port>", "Loopback dashboard port for local launch", "3457")
	.option("--agent <agent>", "Prepared agent CLI", "claude")
	.option("--model <model>", "Agent model");

program
	.command("local", { isDefault: true })
	.description("Start the dashboard for a local Git repository")
	.action(async () => {
		await launchLocal(program.opts());
	});

// Start command (default)
program
	.command("start")
	.description("Start the edge worker")
	.action(async () => {
		const opts = program.opts();
		const app = new Application(
			opts.home,
			opts.envFile,
			factoryVersion === "development" ? packageJson.version : factoryVersion,
			errorReporter,
		);
		await new StartCommand(app).execute([]);
	});

// Check tokens command
program
	.command("check-tokens")
	.description("Check the status of all Linear tokens")
	.action(async () => {
		const opts = program.opts();
		const app = new Application(
			opts.home,
			opts.envFile,
			factoryVersion === "development" ? packageJson.version : factoryVersion,
			errorReporter,
		);
		await new CheckTokensCommand(app).execute([]);
	});

// Refresh token command
program
	.command("refresh-token")
	.description("Refresh a specific Linear token")
	.action(async () => {
		const opts = program.opts();
		const app = new Application(
			opts.home,
			opts.envFile,
			factoryVersion === "development" ? packageJson.version : factoryVersion,
			errorReporter,
		);
		await new RefreshTokenCommand(app).execute([]);
	});

// Self-auth-linear command - Linear OAuth directly from CLI
program
	.command("self-auth-linear")
	.description("Authenticate with Linear OAuth directly")
	.action(async () => {
		const opts = program.opts();
		const app = new Application(
			opts.home,
			opts.envFile,
			factoryVersion === "development" ? packageJson.version : factoryVersion,
			errorReporter,
		);
		await new SelfAuthCommand(app).execute([]);
	});

// Self-add-repo command - Clone and add repository
program
	.command("self-add-repo [url] [workspace]")
	.description(
		'Clone a repo and add it to config. URL accepts any valid git clone address (e.g., "https://github.com/org/repo.git"). Workspace is the display name of the Linear workspace (e.g., "My Workspace"). If URL is omitted, prompts interactively.',
	)
	.option(
		"-l, --label <labels>",
		"Comma-separated routing labels (defaults to repo name)",
	)
	.option(
		"-b, --base-branch <branch>",
		"Base branch name (auto-detected from remote if not specified)",
	)
	.action(
		async (
			url: string | undefined,
			workspace: string | undefined,
			cmdOpts: { label?: string; baseBranch?: string },
		) => {
			const opts = program.opts();
			const app = new Application(
				opts.home,
				opts.envFile,
				factoryVersion === "development" ? packageJson.version : factoryVersion,
			);
			const args = [url, workspace].filter(Boolean) as string[];
			if (cmdOpts.label) {
				args.push("-l", cmdOpts.label);
			}
			if (cmdOpts.baseBranch) {
				args.push("-b", cmdOpts.baseBranch);
			}
			await new SelfAddRepoCommand(app).execute(args);
		},
	);

addMigrationCommands(program);

// Parse and execute
(async () => {
	try {
		await program.parseAsync(process.argv);
	} catch (error) {
		errorReporter.captureException(error, { tags: { phase: "bootstrap" } });
		await errorReporter.flush(2000).catch(() => false);
		console.error("Fatal error:", error);
		process.exit(1);
	}
})();
