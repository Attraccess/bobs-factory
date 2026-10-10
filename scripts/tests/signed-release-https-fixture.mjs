// TEST ONLY: ephemeral RSA publisher pin and TLS endpoint. No production pin edits.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:https";
import { join } from "node:path";
import {
	jsonBytes,
	REPOSITORY,
	sha256,
	TARGETS,
} from "../lib/binary-release.mjs";
import { githubClient } from "../lib/github-release.mjs";
import { installerWithKeys } from "../lib/installer-pins.mjs";
import { validateCandidate } from "../lib/release-candidate.mjs";
import { signManifest } from "../lib/release-signature.mjs";

export async function signedHttpsFixture(root, work, builds) {
	const pair = generateKeyPairSync("rsa", {
		modulusLength: 3072,
		publicKeyEncoding: { type: "spki", format: "pem" },
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
	});
	const keyId = "integration-test-only";
	const keys = {
		[keyId]: { algorithm: "rsa-sha256", status: "active", pem: pair.publicKey },
	};
	const keyFingerprint = sha256(pair.publicKey);
	const bootstrap = installerWithKeys(
		readFileSync(join(root, "scripts/install.sh"), "utf8"),
		keys,
	);
	const verifier = readFileSync(join(root, "scripts/install-binary.sh"));
	const tls = join(work, "tls");
	mkdirSync(tls, { recursive: true });
	writeFileSync(
		join(tls, "config.cnf"),
		"[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n",
	);
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:3072",
			"-nodes",
			"-days",
			"1",
			"-config",
			join(tls, "config.cnf"),
			"-keyout",
			join(tls, "key.pem"),
			"-out",
			join(tls, "cert.pem"),
		],
		{ stdio: "ignore" },
	);
	const ca = readFileSync(join(tls, "cert.pem"));
	const releases = [];
	const requests = [];
	let visible = [];
	let pointer;
	let offline = false;
	function add(selection) {
		const frozen = validateCandidate(
			JSON.parse(readFileSync(join(builds, `candidate-${selection}.json`))),
		);
		const c = frozen.candidate;
		const files = new Map();
		const put = (name, bytes) => {
			files.set(name, Buffer.from(bytes));
			return { file: name, size: bytes.length, sha256: sha256(bytes) };
		};
		put("install.sh", Buffer.from(bootstrap));
		put("install-binary.sh", verifier);
		put("candidate.json", jsonBytes(frozen));
		// These records deliberately say NOT release evidence. Other native targets
		// are inventory-only fixtures; only the caller's actual native archive runs.
		for (const name of [
			"release-evidence.json",
			"build-provenance.json",
			...TARGETS.flatMap((t) => [
				`runtime-smoke-${t}.txt`,
				`native-helpers-${t}.json`,
				`prepared-agent-boundaries-${t}.json`,
			]),
		])
			put(
				name,
				jsonBytes({
					fixture: true,
					status: "not-run",
					purpose: "signed inventory boundary ONLY; no publication receipt",
					file: name,
				}),
			);
		put(
			"validation-receipts.tar.gz",
			Buffer.from("TEST ONLY: no passed release receipts"),
		);
		// Carry the exact Factory source without asserting complete Bun/LGPL rebuild material.
		put(
			"source-rebuild.tar.gz",
			execFileSync("git", ["archive", "--format=tar.gz", c.commit], {
				cwd: root,
				maxBuffer: 30 * 1024 * 1024,
			}),
		);
		const target = `${process.platform}-${process.arch}`;
		const targets = {};
		for (const t of TARGETS) {
			const name = `bobs-factory-${c.version}-${t}`;
			let archive, sidecar;
			if (t === target) {
				archive = put(
					`${name}.tar.gz`,
					readFileSync(join(builds, `build-${selection}`, `${name}.tar.gz`)),
				);
				sidecar = put(
					`${name}.manifest.json`,
					readFileSync(
						join(builds, `build-${selection}`, `${name}.manifest.json`),
					),
				);
				const b = JSON.parse(
					readFileSync(join(builds, `build-${selection}`, name, "build.json")),
				);
				assert.equal(b.commit, c.commit);
				assert.equal(b.candidateDigest, frozen.digest);
				assert.equal(b.dirty, false);
				assert.equal(b.tooling.bun, "1.4.2");
			} else {
				archive = put(
					`${name}.tar.gz`,
					Buffer.from(`TEST ONLY unbuilt target ${t}`),
				);
				sidecar = put(
					`${name}.manifest.json`,
					jsonBytes({ fixture: true, status: "not-run", target: t }),
				);
			}
			targets[t] = {
				archive: archive.file,
				archiveSha256: archive.sha256,
				archiveSize: archive.size,
				manifest: sidecar.file,
				manifestSha256: sidecar.sha256,
				manifestSize: sidecar.size,
			};
		}
		const record = (name) => {
			const bytes = files.get(name);
			return { file: name, size: bytes.length, sha256: sha256(bytes) };
		};
		const manifest = {
			schemaVersion: 2,
			product: "bobs-factory",
			repository: REPOSITORY,
			status: "available",
			channel: c.channel,
			version: c.version,
			tag: c.tag,
			commit: c.commit,
			workflowSha: c.workflowSha,
			candidateDigest: frozen.digest,
			buildRunId: Number(selection) || 1200,
			installer: record("install.sh"),
			verifier: record("install-binary.sh"),
			source: record("source-rebuild.tar.gz"),
			targets,
			assets: [...files.keys()].map(record),
		};
		const release = {
			id: releases.length + 1,
			draft: false,
			prerelease: c.channel !== "stable",
			published_at: "2026-10-10T18:00:00.000Z",
			tag_name: c.tag,
			files,
			manifest,
			frozen,
			selection,
		};
		release.resign = () => {
			files.set("release.json", jsonBytes(manifest));
			files.set(
				"release.json.sig",
				signManifest(files.get("release.json"), pair.privateKey, keyId, keys),
			);
			files.set("release.json.key-id", Buffer.from(`${keyId}\n`));
		};
		release.resign();
		releases.push(release);
		return release;
	}
	const assets = (r) =>
		[...r.files].map(([name, bytes]) => ({
			name,
			size: bytes.length,
			digest: `sha256:${sha256(bytes)}`,
			state: "uploaded",
			browser_download_url:
				"https://github.com/" +
				REPOSITORY +
				"/releases/download/" +
				r.tag_name +
				"/" +
				name,
		}));
	const publicRelease = (r) => ({
		id: r.id,
		draft: r.draft,
		prerelease: r.prerelease,
		published_at: r.published_at,
		tag_name: r.tag_name,
		assets: assets(r),
	});
	const server = createServer(
		{ key: readFileSync(join(tls, "key.pem")), cert: ca },
		(req, res) => {
			const canonical = new URL(req.url, "https://localhost").searchParams.get(
				"url",
			);
			requests.push({
				url: canonical,
				authorization: Boolean(req.headers.authorization),
			});
			if (offline) {
				res.writeHead(503);
				res.end("controlled offline");
				return;
			}
			const url = new URL(canonical);
			let body;
			const api = `/repos/${REPOSITORY}`;
			if (url.hostname === "api.github.com") {
				if (url.pathname === api)
					body = jsonBytes({
						full_name: REPOSITORY,
						private: false,
						visibility: "public",
					});
				else if (url.pathname === `${api}/releases`)
					body = jsonBytes(visible.map(publicRelease));
				else if (url.pathname.startsWith(`${api}/releases/tags/`)) {
					const r = releases.find(
						(r) =>
							r.tag_name === url.pathname.slice(`${api}/releases/tags/`.length),
					);
					if (r) body = jsonBytes(publicRelease(r));
				} else if (url.pathname.endsWith("/assets")) {
					const id = Number(url.pathname.split("/").at(-2));
					const r = releases.find((r) => r.id === id);
					if (r) body = jsonBytes(assets(r));
				} else if (url.pathname.startsWith(`${api}/git/ref/tags/`)) {
					const r = releases.find(
						(r) =>
							r.tag_name === url.pathname.slice(`${api}/git/ref/tags/`.length),
					);
					if (r)
						body = jsonBytes({
							object: { type: "commit", sha: r.manifest.commit },
						});
				}
			} else if (url.hostname === "github.com") {
				const [tag, name] = url.pathname
					.slice(`/${REPOSITORY}/releases/download/`.length)
					.split("/");
				body = releases.find((r) => r.tag_name === tag)?.files.get(name);
			} else if (url.hostname === "jappyjan.github.io") {
				if (url.pathname.endsWith("/install.sh")) body = Buffer.from(bootstrap);
				else if (pointer) {
					const suffix = url.pathname.endsWith(".sig")
						? ".sig"
						: url.pathname.endsWith(".key-id")
							? ".key-id"
							: "";
					body = pointer.files.get(`release.json${suffix}`);
				}
			}
			if (!body) {
				res.writeHead(404);
				res.end("missing controlled fixture");
				return;
			}
			res.writeHead(200, {
				"Content-Length": body.length,
				"Content-Type": "application/octet-stream",
			});
			res.end(body);
		},
	);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const endpoint = `https://localhost:${server.address().port}`;
	const transport = (url, options = {}) =>
		new Promise((resolve, reject) => {
			const req = request(
				`${endpoint}/?url=${encodeURIComponent(url)}`,
				{ ...options, ca, family: 4 },
				(res) => {
					const chunks = [];
					res.on("data", (b) => chunks.push(b));
					res.on("error", reject);
					res.on("end", () =>
						resolve(
							new Response(Buffer.concat(chunks), { status: res.statusCode }),
						),
					);
				},
			);
			req.on("error", reject);
			req.end(options.body);
		});
	const bin = join(work, "transport-bin");
	mkdirSync(bin);
	const realCurl = execFileSync("which", ["curl"], { encoding: "utf8" }).trim();
	const wrapper =
		'#!/usr/bin/env node\nimport {spawnSync} from "node:child_process";const args=process.argv.slice(2).map(a=>a.startsWith("https://")?' +
		JSON.stringify(`${endpoint}/?url=`) +
		"+encodeURIComponent(a):a);const r=spawnSync(" +
		JSON.stringify(realCurl) +
		',["--cacert",' +
		JSON.stringify(join(tls, "cert.pem")) +
		',...args],{stdio:"inherit"});process.exit(r.status??1);\n';
	writeFileSync(join(bin, "curl"), wrapper, { mode: 0o700 });
	const installer = join(work, "test-install.sh");
	writeFileSync(installer, bootstrap, { mode: 0o700 });
	const preload = join(work, "fixture-fetch.mjs");
	writeFileSync(
		preload,
		'import {request} from "node:https";import {readFileSync} from "node:fs";globalThis.fetch=(url,options={})=>new Promise((resolve,reject)=>{const req=request(' +
			JSON.stringify(`${endpoint}/?url=`) +
			"+encodeURIComponent(url),{ca:readFileSync(" +
			JSON.stringify(join(tls, "cert.pem")) +
			'),family:4,signal:options.signal},res=>{const chunks=[];res.on("data",b=>chunks.push(b));res.on("end",()=>{const r=new Response(Buffer.concat(chunks),{status:res.statusCode});Object.defineProperty(r,"url",{value:String(url)});resolve(r);});});req.on("error",reject);req.end();});\n',
	);
	return {
		add,
		keys,
		keyFingerprint,
		requests,
		transport,
		client: githubClient("", transport),
		installer,
		preload,
		bin,
		show: (values) => {
			visible = values;
		},
		pointer: (r) => {
			pointer = r;
		},
		offline: (value) => {
			offline = value;
		},
		env: { PATH: `${bin}:${process.env.PATH}` },
		close: async () => {
			server.closeAllConnections();
			await new Promise((r) => server.close(r));
			rmSync(tls, { recursive: true, force: true });
		},
	};
}

export async function command(command, args, options = {}) {
	const {
		timeout = 60000,
		termGraceMs = 1000,
		killWaitMs = 2000,
		...spawnOptions
	} = options;
	// Own the deadline: spawn timeout would TERM the leader before ownership is captured.
	const child = spawn(command, args, {
		...spawnOptions,
		detached: process.platform !== "win32",
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "",
		stderr = "";
	child.stdout.on("data", (b) => (stdout += b));
	child.stderr.on("data", (b) => (stderr += b));
	const close = once(child, "close");
	let timedOut = false;
	let timer;
	try {
		const exited = close.then(([code, signal]) => ({
			code,
			signal,
			forcedKill: false,
			closeTimedOut: false,
		}));
		const deadline = new Promise((resolve) => {
			timer = setTimeout(() => resolve(null), timeout);
		});
		let result = await Promise.race([exited, deadline]);
		if (!result) {
			timedOut = true;
			result = await terminateOwnedProcess(child, close, {
				detached: process.platform !== "win32",
				termGraceMs,
				killWaitMs,
			});
		}
		return {
			...result,
			code: timedOut && result.code === 0 ? 124 : result.code,
			timedOut,
			pid: child.pid,
			stdout,
			stderr,
		};
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export async function terminateOwnedProcess(
	child,
	close = once(child, "close"),
	{
		detached = process.platform !== "win32",
		termGraceMs = 1000,
		killWaitMs = 2000,
	} = {},
) {
	let result;
	let closeError;
	// A close event only describes the leader and its stdio, not the group.
	close.then(
		([code, signal]) => {
			result = { code, signal };
		},
		(error) => {
			closeError = error;
		},
	);
	const group = detached && process.platform !== "win32" && child.pid;
	const members = () =>
		execFileSync("ps", ["-axo", "pid=,pgid=,stat=,lstart="], {
			encoding: "utf8",
			timeout: 1000,
		})
			.split("\n")
			.map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/))
			.filter(
				(row) => row && Number(row[2]) === child.pid && !row[3].startsWith("Z"),
			);
	// Capture identities while the direct child still anchors this detached group.
	// Never signal a stale numeric PGID after observing the group disappear.
	const identities = new Map();
	let groupGone = false;
	if (group) {
		const initial = members();
		if (
			initial.length &&
			(child.exitCode !== null || child.signalCode !== null)
		)
			throw new Error(
				"Cannot establish process-group ownership after leader exit",
			);
		if (initial.length && !initial.some((row) => Number(row[1]) === child.pid))
			throw new Error(
				"Detached child does not own the requested process group",
			);
		for (const row of initial) identities.set(Number(row[1]), row[4]);
		groupGone = initial.length === 0;
	}
	const alive = () => {
		if (!group) return child.exitCode === null && child.signalCode === null;
		if (groupGone) return false;
		const current = members();
		if (!current.length) {
			groupGone = true;
			return false;
		}
		// At least one continuously owned member must survive. A replacement group
		// (or reused leader PID) is not ours; fail closed instead of signaling it.
		if (
			!current.some((row) => identities.get(Number(row[1])) === row[4]) ||
			current.some(
				(row) =>
					identities.has(Number(row[1])) &&
					identities.get(Number(row[1])) !== row[4],
			)
		)
			throw new Error("Process-group identity changed during cleanup");
		for (const row of current) identities.set(Number(row[1]), row[4]);
		return true;
	};
	const waitForStop = async (timeoutMs) => {
		const deadline = Date.now() + timeoutMs;
		do {
			if (closeError) throw closeError;
			const running = alive();
			if (!running && result) return true;
			await new Promise((resolve) => setTimeout(resolve, 25));
		} while (Date.now() < deadline);
		return !alive() && Boolean(result);
	};
	const signalOwned = (signal) => {
		if (!alive()) return false;
		try {
			if (group) process.kill(-child.pid, signal);
			else child.kill(signal);
			return true;
		} catch (error) {
			if (error.code === "ESRCH") {
				groupGone = true;
				return false;
			}
			throw error;
		}
	};

	signalOwned("SIGTERM");
	if (await waitForStop(termGraceMs))
		return { ...result, forcedKill: false, closeTimedOut: false };
	const forcedKill = signalOwned("SIGKILL");
	const stopped = await waitForStop(killWaitMs);
	return {
		code: result?.code ?? null,
		signal: result?.signal ?? null,
		forcedKill,
		closeTimedOut: !stopped,
	};
}
