import { spawnExecution } from "bobs-factory-core";
import { MachineCapacity } from "../../src/MachineCapacity.js";

const [directory, home, ledger, mode] = process.argv.slice(2);
const capacity = new MachineCapacity(undefined, directory!);
await capacity.ready();
const work = async (kind: string, duration: number) => {
	const lease = await capacity.acquireLease(undefined, {
		identity: `${home}:${kind}`,
		recoverable: true,
		workflowRun: mode?.startsWith("workflow-")
			? {
					identity: home!,
					createdAt:
						mode === "workflow-old"
							? "2026-10-08T00:00:00Z"
							: "2026-10-09T00:00:00Z",
				}
			: undefined,
		onChange: (request) =>
			process.send?.({
				phase: request?.phase,
				kind,
				sequence: request?.sequence,
			}),
	});
	await lease.run(async () => {
		const program = `const fs = require('node:fs'); const record = phase => fs.appendFileSync(process.argv[1], JSON.stringify({phase, kind: process.argv[2], home: process.argv[3], at: Date.now(), pid: process.pid}) + '\\n'); record('start'); setTimeout(() => { record('end'); }, Number(process.argv[4]));`;
		const child = spawnExecution(
			process.execPath,
			["-e", program, ledger!, kind, home!, String(duration)],
			{ detached: true, stdio: "ignore" },
		);
		process.send?.({ child: child.pid });
		await new Promise<void>((resolve, reject) => {
			child.on("error", reject);
			child.on("close", () => resolve());
		});
	});
	await lease.release();
};
if (mode === "orphan") await work("orphan", 60000);
else if (mode === "queued" || mode?.startsWith("workflow-"))
	await work(mode!, 180);
else
	await Promise.all([
		work("agent", 180),
		work("script", 180),
		work("tool", 180),
	]);
process.disconnect?.();
