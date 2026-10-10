import { resolve } from "node:path";
import {
	factoryVersion,
	isPackagedExecutable,
	resolvePath,
} from "bobs-factory-core";
import { preflightFactoryState } from "bobs-factory-edge-worker";
import type { Command } from "commander";
import { Application } from "../Application.js";
import { launchLocal } from "../local.js";
import {
	type ServiceAction,
	ServiceLifecycle,
} from "../services/ServiceLifecycle.js";
import { runUpdateSupervisor } from "../services/UpdateSupervisor.js";
import { StartCommand } from "./StartCommand.js";
export function addServiceCommands(program: Command) {
	const service = program
		.command("service")
		.description(
			"Explicit user-service ownership and login startup (no root/system daemon)",
		);
	const lifecycle = () =>
		new ServiceLifecycle(resolve(resolvePath(program.opts().home)));
	service
		.command("install")
		.option("--executable <path>", "Absolute packaged Factory executable")
		.option(
			"--mode <mode>",
			"start (configured headless) or local (guided setup)",
			"start",
		)
		.action((opts: { executable?: string; mode: string }) => {
			if (!["start", "local"].includes(opts.mode))
				throw new Error("Choose start or local mode");
			if (!opts.executable && !isPackagedExecutable)
				throw new Error(
					"Checkout services require --executable pointing to a packaged binary",
				);
			console.log(
				JSON.stringify(
					lifecycle().install(
						opts.executable ?? process.execPath,
						opts.mode as "start" | "local",
						undefined,
						Number(program.opts().port ?? 3457),
					),
					null,
					2,
				),
			);
		});
	for (const action of [
		"status",
		"logs",
		"start",
		"stop",
		"restart",
		"enable",
		"disable",
		"remove",
		"maintenance",
	] as ServiceAction[]) {
		if (action === "install") continue;
		service
			.command(action)
			.action(async () =>
				console.log(JSON.stringify(await lifecycle().action(action), null, 2)),
			);
	}
	service
		.command("updates-run", { hidden: true })
		.option("--once", "One supervisor tick")
		.action(async (opts: { once?: boolean }) =>
			console.log(
				JSON.stringify(
					await runUpdateSupervisor(
						lifecycle().home,
						Number(program.opts().port ?? 3457),
						opts.once,
					),
				),
			),
		);
	service
		.command("validate-state", { hidden: true })
		.action(() =>
			console.log(JSON.stringify(preflightFactoryState(lifecycle().home))),
		);
	service.command("run", { hidden: true }).action(async () => {
		const r = lifecycle().record();
		if (!r || r.desired !== "running") return;
		process.env.BOBS_FACTORY_FACTORY_PORT = String(r.dashboardPort ?? 3457);
		if (process.env.BOBS_FACTORY_SERVICE_ID !== r.id)
			throw new Error("service run is manager-only");
		if (r.mode === "local")
			await launchLocal({ ...program.opts(), open: false });
		else
			await new StartCommand(
				new Application(r.home, undefined, factoryVersion),
			).execute([]);
	});
	service
		.command("resume")
		.description("Leave update maintenance after verified replacement/recovery")
		.action(async () =>
			console.log(JSON.stringify(await lifecycle().resume(), null, 2)),
		);
}
