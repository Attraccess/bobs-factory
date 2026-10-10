#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const installerUrl =
	"https://jappyjan.github.io/bobs-factory/install.sh";
const versionPattern =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*)?$/;

function usage() {
	console.log(`Usage: npx --yes bobs-factory-trial [options] [-- FACTORY_ARGS...]

Options:
  --channel stable|nightly   Select the signed release channel (default: stable)
  --version VERSION          Run one exact signed release version
  --no-open                  Start the dashboard without opening a browser
  --help                     Show this help

The temporary executable is removed when the process exits. Factory state remains
in the normal ~/.bobs-factory home and can be reused by a regular installation.`);
}

function parseArgs(args) {
	let channel = "stable";
	let version;
	let noOpen = false;
	const factoryArgs = [];
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
		if (arg === "--channel" || arg === "--version") {
			const value = args[i + 1];
			if (!value || value.startsWith("--")) {
				throw new Error(`${arg} requires a value.`);
			}
			if (arg === "--channel") channel = value;
			else version = value;
			i += 1;
			continue;
		}
		throw new Error(`Unknown launcher option: ${arg}. Use -- before Factory arguments.`);
	}
	if (!new Set(["stable", "nightly"]).has(channel)) {
		throw new Error("Channel must be stable or nightly.");
	}
	if (version && !versionPattern.test(version)) {
		throw new Error("Version must be an exact semantic version.");
	}
	return { channel, factoryArgs, help: false, noOpen, version };
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

	const tempRoot = await mkdtemp(join(tmpdir(), "bobs-factory-trial-"));
	const prefix = resolve(tempRoot, "prefix");
	const installer = join(tempRoot, "install.sh");
	try {
		const response = await fetch(installerUrl, { redirect: "error" });
		if (!response.ok || !response.url.startsWith("https://")) {
			throw new Error(`Could not fetch the official installer (${response.status}).`);
		}
		const bytes = Buffer.from(await response.arrayBuffer());
		if (bytes.length === 0 || bytes.length > 1024 * 1024) {
			throw new Error("The official installer response has an invalid size.");
		}
		await writeFile(installer, bytes, { mode: 0o700, flag: "wx" });
		console.log(`Installing a temporary ${selection.channel} runtime. Factory state remains in your normal home.`);
		const installArgs = [installer, "--prefix", prefix, "--no-modify-path"];
		if (selection.version) {
			installArgs.push("--version", selection.version);
			if (selection.channel !== "stable") {
				installArgs.push("--channel", selection.channel);
			}
		} else if (selection.channel !== "stable") {
			installArgs.push("--channel", selection.channel);
		}
		const installCode = await run("sh", installArgs);
		if (installCode !== 0) return installCode;
		const factoryArgs = [...selection.factoryArgs];
		if (selection.noOpen) factoryArgs.unshift("--no-open");
		return await run(join(prefix, "bin", "bobs-factory"), factoryArgs);
	} finally {
		await rm(tempRoot, { force: true, recursive: true });
		console.log("Removed the temporary runtime. Your Factory state was retained.");
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
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
