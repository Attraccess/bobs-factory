import { DesktopAppLifecycle, read } from "./app-lifecycle.mjs";
import { DesktopAppSource } from "./app-source.mjs";
import * as services from "./update-services.mjs";

const options = read(process.argv[2]),
	source = new DesktopAppSource(
		options.directory,
		options.install,
		options.target,
		services,
	),
	lifecycle = new DesktopAppLifecycle(options, services);
const manager = new services.UpdateManager(
	`${options.home}/desktop`,
	source,
	lifecycle,
	options.identity,
);
try {
	if (process.argv[3] === "recover")
		await manager.recover("operation owner stopped");
	else await manager.reconcile();
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
