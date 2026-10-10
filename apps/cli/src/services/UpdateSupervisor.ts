import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { PublishedUpdateSource, UpdateManager } from "bobs-factory-edge-worker";
import {
	acquireRuntimeOperation,
	ownerAlive,
	workerOwner,
} from "./InstanceLock.js";
import { OwnedUpdateLifecycle } from "./OwnedUpdateLifecycle.js";
import { ServiceLifecycle } from "./ServiceLifecycle.js";
export async function runUpdateSupervisor(
	home: string,
	port: number,
	once = false,
) {
	const release = await acquireRuntimeOperation(home, "update-supervisor.lock");
	let stopping = false;
	process.once("SIGTERM", () => {
		stopping = true;
	});
	process.once("SIGINT", () => {
		stopping = true;
	});
	let lastStatus: ReturnType<UpdateManager["status"]> | undefined;
	let crashRestarts = 0;
	try {
		do {
			const lifecycle = new OwnedUpdateLifecycle(home, port);
			const executable = lifecycle.runtimeLink;
			const identity = JSON.parse(
				readFileSync(
					join(
						(await import("node:path")).dirname(realpathSync(executable)),
						"build.json",
					),
					"utf8",
				),
			);
			const source = new PublishedUpdateSource(
				join(home, "updates", "staged"),
				realpathSync(executable),
				identity.target,
			);
			const manager = new UpdateManager(home, source, lifecycle, identity);
			const service = new ServiceLifecycle(home).record();
			if (service && service.desired === "stopped") break;
			if (existsSync(join(home, "runtime", "desktop-stopped.json"))) break;
			const owner = workerOwner(home);
			if (owner && ownerAlive(owner)) {
				const transaction = manager.status().transaction;
				try {
					if (
						transaction &&
						((
							transaction as typeof transaction & {
								release?: { status: string };
							}
						).release?.status !== "acknowledged" ||
							!["succeeded", "rolled-back", "cancelled"].includes(
								transaction.phase,
							))
					)
						await manager.recover("operation owner stopped");
					else await manager.tick();
				} catch (error) {
					console.error(`Update supervisor: ${(error as Error).message}`);
				}
			} else if (existsSync(join(home, "runtime", "update-owner.json"))) {
				try {
					await manager.recover("operation owner stopped");
				} catch (error) {
					console.error(`Update recovery: ${(error as Error).message}`);
				}
			} else if (!service && crashRestarts < 3) {
				crashRestarts++;
				try {
					await lifecycle.restartCrashedDesktop();
				} catch (error) {
					console.error(`Desktop crash restart: ${(error as Error).message}`);
				}
			}
			lastStatus = manager.status();
			if (!once && !stopping)
				for (let n = 0; n < 100 && !stopping; n++)
					await new Promise((resolve) => setTimeout(resolve, 100));
		} while (!once && !stopping);
		return lastStatus;
	} finally {
		release();
	}
}
