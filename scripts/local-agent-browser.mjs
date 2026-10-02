#!/usr/bin/env node
// macOS companion: bootstrap browser daemons outside the agent's Seatbelt sandbox.
// The helper accepts only a generated session id and a known browser executable;
// actual browser commands still run through the installed CLI in the agent.
import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	statSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createConnection, createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = join(homedir(), ".cyrus", "browser-host");
const state = join(homedir(), ".agent-browser");
const socket = join(state, "cyrus-host-bootstrap.sock");
const configPath = join(root, "config.json");
const browsers = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];
const label = "com.cyrusagents.browser-host";
const config = () => JSON.parse(readFileSync(configPath, "utf8"));

async function host() {
	const settings = config();
	const pending = new Map();
	const prepare = async ({
		session,
		executable,
		fallbackExecutable,
		debug,
		cwd,
	}) => {
		if (
			!/^cyrus-host-[a-f0-9]{24}$/.test(session) ||
			(executable !== undefined && !settings.browsers.includes(executable)) ||
			!settings.browsers.includes(fallbackExecutable) ||
			typeof debug !== "boolean" ||
			typeof cwd !== "string" ||
			!isAbsolute(cwd) ||
			!statSync(cwd).isDirectory()
		)
			throw new Error("Invalid browser bootstrap request");
		const selectionPath = join(root, `${session}.json`);
		const previous = existsSync(selectionPath)
			? JSON.parse(readFileSync(selectionPath, "utf8")).executable
			: undefined;
		// Retain Brave across subsequent commands even if the service defaults to Chrome.
		const selected = executable || previous || fallbackExecutable;
		if (!settings.browsers.includes(selected))
			throw new Error("Invalid saved browser selection");
		// Serialise concurrent first commands for a session, without blocking others.
		const key = session;
		if (!pending.has(key)) {
			const promise = run(
				settings.cli,
				[
					"--config",
					settings.emptyConfig,
					"--session",
					session,
					"--executable-path",
					selected,
					...(debug ? ["--debug"] : []),
					"get",
					"url",
				],
				{
					cwd,
					timeout: 30_000,
					maxBuffer: 64 * 1024,
					env: {
						HOME: homedir(),
						PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`,
						AGENT_BROWSER_SOCKET_DIR: state,
					},
				},
			)
				.then(() => {
					writeFileSync(
						selectionPath,
						JSON.stringify({ executable: selected }),
						{ mode: 0o600 },
					);
					return selected;
				})
				.finally(() => pending.delete(key));
			pending.set(key, promise);
		}
		return await pending.get(key);
	};
	if (existsSync(socket)) unlinkSync(socket);
	const server = createServer((connection) => {
		connection.setTimeout(35_000, () => connection.destroy());
		let input = "";
		connection.on("error", () => {});
		connection.on("data", (chunk) => {
			input += chunk;
			if (input.length > 2048) return connection.destroy();
			if (!input.includes("\n")) return;
			connection.removeAllListeners("data");
			Promise.resolve()
				.then(() => prepare(JSON.parse(input)))
				.then(
					(executable) =>
						connection.end(`${JSON.stringify({ ok: true, executable })}\n`),
					(error) =>
						connection.end(
							`${JSON.stringify({ error: error.stderr || error.message })}\n`,
						),
				);
		});
	});
	server.on("error", (error) => {
		console.error(error.message);
		process.exit(1);
	});
	server.listen(socket, () => chmodSync(socket, 0o600));
}

async function client(args) {
	const settings = config();
	// CLI-only commands do not need a browser. Leave their output untouched.
	if (
		args.length === 0 ||
		args.includes("--help") ||
		args.includes("--version") ||
		[
			"skills",
			"install",
			"session",
			"profiles",
			"plugin",
			"doctor",
			"dashboard",
		].includes(args[0])
	)
		return forward(settings.cli, args, process.env);
	let session = process.env.AGENT_BROWSER_SESSION || "default";
	let executable;
	const fallbackExecutable =
		process.env.AGENT_BROWSER_EXECUTABLE_PATH || settings.browsers[0];
	const forwarded = [];
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--session") {
			if (!args[index + 1]) throw new Error("--session requires a value");
			session = args[++index];
		} else if (argument.startsWith("--session=")) {
			session = argument.slice("--session=".length);
		} else if (argument === "--executable-path") {
			if (!args[index + 1])
				throw new Error("--executable-path requires a value");
			executable = args[++index];
		} else if (argument.startsWith("--executable-path=")) {
			executable = argument.slice("--executable-path=".length);
		} else {
			forwarded.push(argument);
		}
	}
	// Default sessions are isolated by worktree, even if agents omit --session.
	const physicalSession = `cyrus-host-${createHash("sha256").update(`${process.cwd()}\0${session}`).digest("hex").slice(0, 24)}`;
	const selected = await new Promise((resolve, reject) => {
		const connection = createConnection(socket);
		let output = "";
		connection.setTimeout(35_000, () =>
			connection.destroy(new Error("Browser host bootstrap timed out")),
		);
		connection.on("error", reject);
		connection.on("connect", () =>
			connection.write(
				`${JSON.stringify({
					session: physicalSession,
					executable,
					fallbackExecutable,
					cwd: process.cwd(),
					debug:
						args.includes("--debug") || process.env.AGENT_BROWSER_DEBUG === "1",
				})}\n`,
			),
		);
		connection.on("data", (chunk) => {
			output += chunk;
		});
		connection.on("end", () => {
			try {
				const response = JSON.parse(output);
				if (!response.ok)
					throw new Error(response.error || "Browser host bootstrap failed");
				if (!settings.browsers.includes(response.executable))
					throw new Error("Invalid browser host response");
				resolve(response.executable);
			} catch (error) {
				reject(error);
			}
		});
	});
	return forward(
		settings.cli,
		["--session", physicalSession, "--executable-path", selected, ...forwarded],
		{
			...process.env,
			AGENT_BROWSER_SOCKET_DIR: state,
		},
	);
}

function forward(cli, args, env) {
	return new Promise((resolve, reject) => {
		const child = spawn(cli, args, { stdio: "inherit", env });
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			process.exitCode = code ?? (signal ? 1 : 0);
			resolve();
		});
	});
}

function install(cli) {
	if (process.platform !== "darwin")
		throw new Error("This companion is for macOS");
	if (!cli || !isAbsolute(cli) || !existsSync(cli))
		throw new Error("Pass the absolute path of the real agent-browser CLI");
	const installed = join(root, "agent-browser.mjs");
	const wrapper = join(homedir(), ".cyrus", "bin", "agent-browser");
	const shellWrapper = join(homedir(), ".local", "bin", "agent-browser");
	const pathExists = (path) => {
		try {
			lstatSync(path);
			return true;
		} catch (error) {
			if (error.code === "ENOENT") return false;
			throw error;
		}
	};
	const plist = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
	if (pathExists(plist))
		throw new Error(
			`Preserve the existing LaunchAgent before installing: ${plist}`,
		);
	if (pathExists(shellWrapper))
		throw new Error(
			`Preserve the existing wrapper before installing: ${shellWrapper}`,
		);
	if (pathExists(wrapper))
		throw new Error(
			`Preserve the existing wrapper before installing: ${wrapper}`,
		);
	const available = browsers.filter(existsSync);
	if (!available.length) throw new Error("Install Chrome or Brave first");
	mkdirSync(root, { recursive: true, mode: 0o700 });
	mkdirSync(state, { recursive: true });
	mkdirSync(dirname(wrapper), { recursive: true });
	copyFileSync(fileURLToPath(import.meta.url), installed);
	const emptyConfig = join(root, "empty-config.json");
	writeFileSync(emptyConfig, "{}\n", { mode: 0o600 });
	writeFileSync(
		configPath,
		`${JSON.stringify({ cli: realpathSync(cli), browsers: available, emptyConfig }, null, 2)}\n`,
		{ mode: 0o600 },
	);
	const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
	writeFileSync(
		wrapper,
		`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(installed)} --client "$@"\n`,
		{ mode: 0o755 },
	);
	// Login shells may reset the service PATH; ~/.local/bin is usually kept first.
	mkdirSync(dirname(shellWrapper), { recursive: true });
	symlinkSync(wrapper, shellWrapper);
	const plistEscape = (value) =>
		value
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;");
	mkdirSync(dirname(plist), { recursive: true });
	writeFileSync(
		plist,
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${plistEscape(process.execPath)}</string><string>${plistEscape(installed)}</string><string>--host</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${plistEscape(join(root, "host.log"))}</string>
<key>StandardErrorPath</key><string>${plistEscape(join(root, "host.log"))}</string>
</dict></plist>\n`,
	);
	execFileSync(
		"/bin/launchctl",
		["bootstrap", `gui/${process.getuid()}`, plist],
		{ stdio: "inherit" },
	);
	console.log(
		`Installed ${wrapper}\nHost helper: ${plist}\nCyrus must have ~/.cyrus/bin first in PATH.`,
	);
}

try {
	const [mode, ...args] = process.argv.slice(2);
	if (mode === "--host") await host();
	else if (mode === "--client") await client(args);
	else if (mode === "install") install(args[0]);
	else
		throw new Error(
			"Usage: node scripts/local-agent-browser.mjs install /absolute/path/to/agent-browser",
		);
} catch (error) {
	console.error(`cyrus browser host: ${error.message}`);
	process.exitCode = 1;
}
