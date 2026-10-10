import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// A managed Factory turn supplies credentials and retained repository scope.
// The fixture owns an isolated temporary home and must not inherit either.
const environment = { ...process.env };
for (const name of Object.keys(environment)) {
	if (name.startsWith("BOBS_FACTORY_") || name.startsWith("CYRUS_"))
		delete environment[name];
}
const child = spawn(
	"bun",
	["run", fileURLToPath(new URL("./workflow-catalog-129.ts", import.meta.url))],
	{ env: environment, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
	process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
