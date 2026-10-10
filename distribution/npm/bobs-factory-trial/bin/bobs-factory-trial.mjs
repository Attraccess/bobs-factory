#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const packageInfo = JSON.parse(
	await (await import("node:fs/promises")).readFile(
		new URL("../package.json", import.meta.url),
		"utf8",
	),
);
const releaseSelection = packageInfo.factoryRelease;
const installerUrl = "https://jappyjan.github.io/bobs-factory/install.sh";
const versionPattern =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*)?$/;

function usage() {
	console.log(`Usage: npx --yes bobs-factory-trial [options] [-- FACTORY_ARGS...]

Options:
  --channel stable|nightly   Select the signed release channel (default: stable)
  --version VERSION          Run one exact signed release version
  --no-open                  Start the dashboard without opening a browser
  --port PORT                Dashboard port (default: 4560; also reserves PORT+1)
  --help                     Show this help

The temporary executable is removed when the process exits. Factory state remains
in ~/.bobs-factory-trial and can be reused by another trial. Stale launcher locks
require inspection before retrying. No service or global CLI is installed.`);
}

function parseArgs(args) {
	let channel = releaseSelection?.channel ?? "stable";
	let version = releaseSelection?.version;
	let versionExplicit = false;
	let noOpen = false;
	const factoryArgs = [];
	let port = "4560";
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--") {
			factoryArgs.push(...args.slice(i + 1));
			break;
		}
		if (arg === "--help" || arg === "-h") return { help: true };
		if (arg === "--no-open" || arg === "--headless") {
			noOpen = true;
			continue;
		}
		if (arg === "--channel" || arg === "--version" || arg === "--port") {
			const value = args[i + 1];
			if (!value || value.startsWith("--")) {
				throw new Error(`${arg} requires a value.`);
			}
			if (arg === "--channel") {
				channel = value;
				if (!versionExplicit) version = undefined;
			} else if (arg === "--port") port = value;
			else {
				version = value;
				versionExplicit = true;
			}
			i += 1;
			continue;
		}
		throw new Error(
			`Unknown launcher option: ${arg}. Use -- before Factory arguments.`,
		);
	}
	if (!new Set(["stable", "nightly"]).has(channel)) {
		throw new Error("Channel must be stable or nightly.");
	}
	if (version && !versionPattern.test(version)) {
		throw new Error("Version must be an exact semantic version.");
	}
	if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65533)
		throw new Error("Choose a trial port between 1024 and 65533.");
	if (factoryArgs.some((arg) => /^(--home|--port)(=|$)/.test(arg)))
		throw new Error(
			"The trial owns its separate home and port. Use launcher --port.",
		);
	return { channel, factoryArgs, help: false, noOpen, version, port };
}

function run(command, args, options = {}) {
	return new Promise((resolveRun, rejectRun) => {
		const child = spawn(command, args, { stdio: "inherit", ...options });
		const forward = (signal) => {
			if (child.exitCode === null) child.kill(signal);
		};
		const onInterrupt = () => forward("SIGINT");
		const onTerminate = () => forward("SIGTERM");
		process.on("SIGINT", onInterrupt);
		process.on("SIGTERM", onTerminate);
		child.once("error", rejectRun);
		child.once("close", (code, signal) => {
			process.off("SIGINT", onInterrupt);
			process.off("SIGTERM", onTerminate);
			resolveRun(signal ? 128 : (code ?? 1));
		});
	});
}

async function checkPort(port) {
	await new Promise((resolvePort, rejectPort) => {
		const server = createServer();
		server.once("error", () =>
			rejectPort(
				new Error(
					`Trial port ${port} is occupied; choose --port and avoid existing workers.`,
				),
			),
		);
		server.listen(port, "127.0.0.1", () => server.close(resolvePort));
	});
}

export async function main(args = process.argv.slice(2)) {
	const selection = parseArgs(args);
	if (selection.help) {
		usage();
		return 0;
	}
	if (process.platform !== "darwin" && process.platform !== "linux") {
		throw new Error("The trial currently supports macOS and Linux only.");
	}
	if (process.versions.node.split(".")[0] < 20) {
		throw new Error("Node.js 20 or newer is required for this npx launcher.");
	}

	const home = join(homedir(), ".bobs-factory-trial");
	await mkdir(home, { recursive: true, mode: 0o700 });
	if ((await lstat(home)).isSymbolicLink())
		throw new Error("Trial home must not be a symlink.");
	const lock = join(home, ".launcher-lock");
	await mkdir(lock, { mode: 0o700 }).catch(() => {
		throw new Error(
			`Another trial or interrupted launcher owns ${lock}; inspect it before retrying.`,
		);
	});
	await writeFile(
		join(lock, "owner.json"),
		JSON.stringify({ pid: process.pid, home, port: selection.port }),
		{ flag: "wx", mode: 0o600 },
	);
	let interrupted = false;
	const cancel = () => {
		interrupted = true;
	};
	process.on("SIGINT", cancel);
	process.on("SIGTERM", cancel);
	let tempRoot;
	try {
		await checkPort(Number(selection.port));
		await checkPort(Number(selection.port) + 1);
		if (interrupted) return 130;
		tempRoot = await mkdtemp(join(tmpdir(), "bobs-factory-trial-"));
		const prefix = resolve(tempRoot, "prefix");
		const installer = join(tempRoot, "install.sh");
		try {
			const response = await fetch(installerUrl, {
				redirect: "error",
				signal: AbortSignal.timeout(30000),
			});
			if (!response.ok || !response.url.startsWith("https://")) {
				throw new Error(
					`Could not fetch the official installer (${response.status}).`,
				);
			}
			const bytes = Buffer.from(await response.arrayBuffer());
			if (bytes.length === 0 || bytes.length > 1024 * 1024) {
				throw new Error("The official installer response has an invalid size.");
			}
			await writeFile(installer, bytes, { mode: 0o700, flag: "wx" });
			console.log(
				`Installing a temporary ${selection.channel} runtime. Factory state remains in ${home}.`,
			);
			const installArgs = [installer, "--prefix", prefix, "--no-modify-path"];
			if (selection.version) {
				installArgs.push("--version", selection.version);
				if (selection.channel !== "stable") {
					installArgs.push("--channel", selection.channel);
				}
			} else if (selection.channel !== "stable") {
				installArgs.push("--channel", selection.channel);
			}
			if (interrupted) return 130;
			const installCode = await run("sh", installArgs);
			if (installCode !== 0) return installCode;
			if (interrupted) return 130;
			const factoryArgs = [
				"--home",
				home,
				"--port",
				selection.port,
				...selection.factoryArgs,
			];
			if (selection.noOpen) factoryArgs.unshift("--no-open");
			return await run(join(prefix, "bin", "bobs-factory"), factoryArgs, {
				env: { ...process.env, BOBS_FACTORY_HOME: home },
			});
		} finally {
			await rm(tempRoot, { force: true, recursive: true });
			console.log(
				"Removed the temporary runtime. Your Factory state was retained.",
			);
		}
	} finally {
		process.off("SIGINT", cancel);
		process.off("SIGTERM", cancel);
		await rm(lock, { recursive: true });
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
	main().then(
		(code) => {
			process.exitCode = code;
		},
		(error) => {
			console.error(`Bob’s Factory trial: ${error.message}`);
			process.exitCode = 1;
		},
	);
}
