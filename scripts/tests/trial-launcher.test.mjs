import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const launcher = join(
	root,
	"distribution/npm/bobs-factory-trial/bin/bobs-factory-trial.mjs",
);
const trialPort = 46000 + (process.pid % 9000);
const binary = process.env.BOBS_FACTORY_TRIAL_SMOKE_BINARY;
function fixture() {
	const work = mkdtempSync(join(tmpdir(), "factory-trial-test-"));
	const home = join(work, "home");
	mkdirSync(home);
	const normal = join(home, ".bobs-factory");
	mkdirSync(normal);
	writeFileSync(join(normal, "config.json"), "existing normal instance");
	const temp = join(work, "temporary");
	mkdirSync(temp);
	const bin = join(work, "bin");
	mkdirSync(bin);
	const browser = join(work, "browser");
	for (const cmd of ["open", "xdg-open"])
		writeFileSync(
			join(bin, cmd),
			`#!/bin/sh\nprintf '%s\\n' "$@" >> '${browser}'\n`,
			{ mode: 0o755 },
		);
	const runtime = join(work, "runtime.mjs");
	writeFileSync(
		runtime,
		`#!${process.execPath}\nimport {createServer} from 'node:http';import {writeFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';import {join} from 'node:path';
 const args=process.argv.slice(2);const home=args[args.indexOf('--home')+1];const port=Number(args[args.indexOf('--port')+1]);writeFileSync(join(home,'fixture-state'),'retained');
 const server=createServer((req,res)=>res.end('<!doctype html><title>Controlled Factory dashboard</title>'));
 server.listen(port,'127.0.0.1',()=>{if(!args.includes('--no-open'))spawnSync('open',['http://localhost:'+port]);console.log('fixture ready')});
 process.on('SIGTERM',()=>server.close(()=>process.exit(0)));process.on('SIGINT',()=>server.close(()=>process.exit(0)));`,
		{ mode: 0o755 },
	);
	const installer = `#!/bin/sh\nset -eu\nprefix=\nwhile [ "$#" -gt 0 ]; do case "$1" in --prefix) prefix=$2;shift 2;; *) shift;; esac; done\nmkdir -p "$prefix/bin"\ncp '${binary ?? runtime}' "$prefix/bin/bobs-factory"\nchmod 755 "$prefix/bin/bobs-factory"\n`;
	const preload = join(work, "transport.mjs");
	writeFileSync(
		preload,
		`globalThis.fetch=async url=>{if(String(url)!=='https://jappyjan.github.io/bobs-factory/install.sh')throw Error('unexpected transport');const response=new Response(${JSON.stringify(installer)});Object.defineProperty(response,'url',{value:String(url)});return response;};`,
	);
	const env = {
		...process.env,
		HOME: home,
		BROWSER: join(bin, "xdg-open"),
		TMPDIR: temp,
		PATH: `${bin}:${process.env.PATH}`,
		NODE_OPTIONS: `--import=${preload}`,
		BOBS_FACTORY_SENTRY_DISABLED: "1",
		BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY: join(work, "empty"),
	};
	mkdirSync(env.BOBS_FACTORY_MIGRATION_SOURCE_CAPACITY_DIRECTORY);
	const trialHome = join(home, ".bobs-factory-trial");
	const lock = join(trialHome, ".launcher-lock");
	return {
		work,
		home,
		temp,
		browser,
		env,
		trialHome,
		lock,
		cleanup: () => rmSync(work, { recursive: true, force: true }),
	};
}
async function waitFor(check, description) {
	for (let i = 0; i < 100; i++) {
		if (await check()) return;
		await delay(100);
	}
	throw new Error(`Timed out: ${description}`);
}
function child(command, args, env) {
	const process = spawn(command, args, {
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	process.stdout.on("data", (data) => (output += data));
	process.stderr.on("data", (data) => (output += data));
	const exited = new Promise((resolve) =>
		process.once("close", (code) => resolve(code)),
	);
	return { process, exited, output: () => output };
}

for (const noOpen of [false, true])
	test(`packed npm trial usable dashboard, ${noOpen ? "no-browser" : "browser"}, exclusivity and retained state${binary ? " (native)" : " (controlled protocol)"}`, {
		timeout: 30000,
	}, async () => {
		const f = fixture();
		let current;
		try {
			const pack = JSON.parse(
				execFileSync("npm", ["pack", "--json", "--pack-destination", f.work], {
					cwd: join(root, "distribution/npm/bobs-factory-trial"),
					encoding: "utf8",
				}),
			)[0];
			// npm executes the actual packed entry point. Registry auth is never needed.
			current = child(
				"npm",
				[
					"exec",
					"--offline",
					"--yes",
					"--cache",
					join(f.work, "npm-cache"),
					"--package",
					join(f.work, pack.filename),
					"--",
					"bobs-factory-trial",
					"--port",
					String(trialPort),
					...(noOpen ? ["--no-open"] : []),
				],
				f.env,
			);
			await waitFor(() => {
				if (current.process.exitCode !== null)
					throw new Error(current.output());
				return existsSync(join(f.lock, "owner.json"));
			}, "launcher lock");
			await waitFor(async () => {
				try {
					return (await fetch(`http://127.0.0.1:${trialPort}/`)).ok;
				} catch {
					return false;
				}
			}, "usable dashboard");
			const response = await fetch(`http://127.0.0.1:${trialPort}/`);
			assert.match(await response.text(), /doctype html/i);
			if (!noOpen)
				await waitFor(() => existsSync(f.browser), "browser handoff");
			else assert.equal(existsSync(f.browser), false);
			const competing = child(
				process.execPath,
				[launcher, "--port", String(trialPort + 2)],
				f.env,
			);
			assert.notEqual(await competing.exited, 0);
			assert.match(competing.output(), /Another trial/);
			const owner = JSON.parse(readFileSync(join(f.lock, "owner.json")));
			process.kill(owner.pid, "SIGTERM");
			assert.equal(await current.exited, 0, current.output());
			assert.equal(existsSync(f.lock), false);
			assert.deepEqual(
				readdirSync(f.temp).filter((name) =>
					name.startsWith("bobs-factory-trial-"),
				),
				[],
			);
			await assert.rejects(fetch(`http://127.0.0.1:${trialPort}/`));
			assert.equal(
				readFileSync(join(f.home, ".bobs-factory/config.json"), "utf8"),
				"existing normal instance",
			);
			assert.deepEqual(
				readdirSync(join(f.home, ".bobs-factory")).filter(
					(name) => name !== "resources",
				),
				["config.json"],
			);
			assert.equal(existsSync(f.trialHome), true);
			assert.match(current.output(), /temporary runtime/);
			if (binary)
				assert.equal(existsSync(join(f.trialHome, "config.json")), true);
			else
				assert.equal(
					readFileSync(join(f.trialHome, "fixture-state"), "utf8"),
					"retained",
				);
		} finally {
			if (existsSync(join(f.lock, "owner.json"))) {
				const owner = JSON.parse(readFileSync(join(f.lock, "owner.json")));
				try {
					process.kill(owner.pid, "SIGTERM");
				} catch {}
			}
			if (current) {
				await Promise.race([current.exited, delay(3000)]);
				current.process.kill("SIGKILL");
			}
			f.cleanup();
		}
	});

test("occupied port rejects launch and leaves no stale lock", async () => {
	const f = fixture();
	const server = createServer();
	await new Promise((resolve) =>
		server.listen(trialPort + 4, "127.0.0.1", resolve),
	);
	try {
		const current = child(
			process.execPath,
			[launcher, "--port", String(trialPort + 4)],
			f.env,
		);
		assert.notEqual(await current.exited, 0);
		assert.match(current.output(), /occupied/);
		assert.equal(existsSync(f.lock), false);
	} finally {
		server.close();
		f.cleanup();
	}
});

test("invalid options cannot override trial home", async () => {
	const f = fixture();
	try {
		const current = child(
			process.execPath,
			[launcher, "--", "--home", f.home],
			f.env,
		);
		assert.notEqual(await current.exited, 0);
		assert.equal(existsSync(f.lock), false);
	} finally {
		f.cleanup();
	}
});
