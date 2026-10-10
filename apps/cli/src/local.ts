import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getAllTools } from "bobs-factory-claude-runner";
import {
	type EdgeWorkerConfig,
	type RunnerType,
	resolvePath,
} from "bobs-factory-core";
import { EdgeWorker } from "bobs-factory-edge-worker";
import open from "open";
import {
	installedCommand,
	LocalOnboarding,
	loadLocalConfig,
	localRepository,
	savePrivateJson,
} from "./onboarding.js";
import { acquireInstanceLock } from "./services/InstanceLock.js";
import { assertServiceLaunch } from "./services/ServiceLifecycle.js";

export async function launchLocal(values: {
	repo?: string;
	port: string;
	agent?: string;
	model?: string;
	home: string;
	origin?: string;
	sessionHours?: string;
	open?: boolean;
}) {
	const home = resolve(resolvePath(values.home));
	const port = Number(values.port);
	if (!Number.isInteger(port) || port < 1 || port >= 65535)
		throw new Error("Choose a UI port between 1 and 65534");
	if (
		values.agent &&
		!["claude", "codex", "gemini", "cursor", "opencode"].includes(values.agent)
	)
		throw new Error("Unknown agent");
	process.env.BOBS_FACTORY_FACTORY_PORT = String(port);
	assertServiceLaunch(home);
	const releaseOwnership = await acquireInstanceLock(home);
	const config = loadLocalConfig(home);
	const repository = values.repo
		? localRepository(values.repo, home)
		: undefined;
	const selected = values.agent ?? config.defaultRunner;
	// The dashboard itself needs neither Git nor an agent. Select an installed agent in setup.
	const command = selected === "cursor" ? "agent" : selected;
	if (values.repo && selected && command && !installedCommand(command))
		throw new Error(
			`Install the selected ${selected} coding agent before launching this project, or run bobs-factory without --repo to use guided setup.`,
		);
	const configPath = join(home, "config.json");

	process.env.BOBS_FACTORY_FACTORY_PORT = String(port);
	process.env.BOBS_FACTORY_HOME = home;
	if (values.origin) process.env.BOBS_FACTORY_FACTORY_ORIGIN = values.origin;
	if (values.sessionHours !== undefined)
		process.env.BOBS_FACTORY_FACTORY_SESSION_HOURS = values.sessionHours;
	// Persist the effective launch settings so operator repair reloads use the same runner and model.
	const effective: EdgeWorkerConfig = {
		...config,
		platform: "cli",
		factoryHome: home,
		serverPort: port + 1,
		serverHost: "127.0.0.1",
		...(selected ? { defaultRunner: selected as RunnerType } : {}),
		linearAllowedTools: config.linearAllowedTools ?? getAllTools(),
		...(values.agent || values.repo || values.model
			? {
					claudeDefaultModel: values.model,
					codexDefaultModel: values.model,
					geminiDefaultModel: values.model,
					cursorDefaultModel: values.model,
					opencodeDefaultModel: values.model,
				}
			: {}),
		repositories: config.repositories,
	};
	savePrivateJson(configPath, effective);
	let worker: EdgeWorker;
	const onboarding = new LocalOnboarding(home, (repository, runner) =>
		worker.configureLocalRepository(repository, runner),
	);
	worker = new EdgeWorker(effective, onboarding);
	const originalStop = worker.stop?.bind(worker);
	worker.stop = async () => {
		if (originalStop) await originalStop();
		releaseOwnership();
	};
	worker.setConfigPath(configPath);
	await worker.start();
	if (repository && selected)
		await onboarding.configure({
			repositoryPath: repository.repositoryPath,
			runner: selected as RunnerType,
		});
	const address = `http://localhost:${port}`;
	let setupCode: string | undefined;
	// Only the local launcher reads machine authority. Never expose enrollment grants via HTTP.
	const statePath = join(home, "factory", "auth", "state.json");
	const grantPath = join(home, "factory", "auth", "enroll.json");
	if (existsSync(statePath) && existsSync(grantPath)) {
		const state = JSON.parse(readFileSync(statePath, "utf8"));
		if (state.credentials.length === 0) {
			const grant = JSON.parse(readFileSync(grantPath, "utf8"));
			if (grant.expires > Date.now()) setupCode = grant.token;
		}
	}
	console.log(`Bob's Factory: ${address}\nState: ${home}`);
	if (setupCode)
		console.log(
			`First passkey setup code (private, expires in ten minutes): ${setupCode}`,
		);
	if (values.open !== false) {
		try {
			// Fragments stay on the local machine, outside HTTP requests and server logs.
			await open(`${address}/${setupCode ? `#setup=${setupCode}` : ""}`, {
				wait: false,
			});
		} catch {
			console.log(`Open ${address} in your browser to continue setup.`);
		}
	}
	let stopping = false;
	const stop = async () => {
		if (stopping) return;
		stopping = true;
		await worker.stop();
		process.exit(0);
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	return worker;
}
