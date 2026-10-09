import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:https";
import { arch, cpus, platform, release, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

// Node controls the fixture; each factory helper runs as the native executable
// with an OS-only PATH. No real credential, account or inference is used.
const { values } = parseArgs({
	options: {
		binary: { type: "string" },
		output: { type: "string" },
		"allow-dirty-development": { type: "boolean", default: false },
	},
});
assert(values.binary && values.output, "Provide --binary and --output");
const binary = realpathSync(values.binary);
const build = JSON.parse(readFileSync(join(dirname(binary), "build.json")));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(build.product, "bobs-factory");
assert.equal(
	build.target,
	`${platform()}-${arch()}`,
	"Execute on the native target",
);
assert.equal(build.executable.sha256, digest(readFileSync(binary)));
assert(/^[a-f0-9]{40}$/.test(build.commit));
assert(
	!build.dirty || values["allow-dirty-development"],
	"Release smoke requires a clean build",
);
const work = mkdtempSync(join(tmpdir(), "factory-native-helpers-"));
const home = join(work, "home");
const state = join(home, "state");
const bin = join(work, "path");
for (const directory of [home, state, bin])
	mkdirSync(directory, { mode: 0o700 });
symlinkSync("/bin/sh", join(bin, "sh"));
const token = `synthetic-${randomBytes(24).toString("hex")}`;
const savedToken = `synthetic-saved-${randomBytes(24).toString("hex")}`;
const cert = join(work, "cert.pem");
const key = join(work, "key.pem");
const opensslConfig = join(work, "openssl.cnf");
writeFileSync(
	opensslConfig,
	`[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=127.0.0.1\n[ext]\nbasicConstraints=critical,CA:true\nsubjectAltName=IP:127.0.0.1\n`,
	{ mode: 0o600 },
);
execFileSync(
	"openssl",
	[
		"req",
		"-x509",
		"-nodes",
		"-newkey",
		"rsa:2048",
		"-days",
		"1",
		"-config",
		opensslConfig,
		"-keyout",
		key,
		"-out",
		cert,
	],
	{ stdio: "ignore" },
);
const checks = {};
const requests = [];
const server = createServer(
	{ key: readFileSync(key), cert: readFileSync(cert) },
	async (request, response) => {
		try {
			assert.equal(request.headers.authorization, `Bearer ${token}`);
			let body = "";
			for await (const chunk of request) body += chunk;
			requests.push({ method: request.method, path: request.url });
			if (
				request.url ===
				"/api/v3/repos/test/repo/actions/runs/42/rerun-failed-jobs"
			) {
				assert.equal(request.method, "POST");
				response.writeHead(201).end();
				return;
			}
			response.setHeader("Content-Type", "application/json");
			if (request.url === "/api/graphql") {
				assert.equal(request.method, "POST");
				assert.equal(JSON.parse(body).variables.owner, "test");
				response.end(
					JSON.stringify({
						data: { repository: { nameWithOwner: "test/repo" } },
					}),
				);
				return;
			}
			assert.equal(request.url, "/api/v3/repos/test/repo/pulls/1");
			assert.equal(request.method, "GET");
			response.end(
				JSON.stringify({ number: 1, head: { sha: "approved-head" } }),
			);
		} catch {
			response.writeHead(500).end("fixture rejected request");
		}
	},
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `https://127.0.0.1:${server.address().port}/api/v3`;
const environment = {
	HOME: home,
	TMPDIR: work,
	PATH: bin,
	BOBS_FACTORY_HOME: state,
	BOBS_FACTORY_SENTRY_DISABLED: "1",
	BOBS_FACTORY_GITHUB_EXPLICIT_CREDENTIALS: "1",
	BOBS_FACTORY_GITHUB_REPOSITORIES: JSON.stringify([
		{ host: "github.com", project: "test/repo" },
	]),
	BOBS_FACTORY_GITHUB_API_URLS: JSON.stringify({ "github.com": base }),
	GH_TOKEN: token,
	NODE_EXTRA_CA_CERTS: cert,
};
writeFileSync(
	join(state, "github-auth.json"),
	JSON.stringify({
		version: 1,
		hosts: { "github.com": { token: savedToken, account: "fixture" } },
	}),
	{ mode: 0o600 },
);
const authBefore = digest(readFileSync(join(state, "github-auth.json")));
const systemVersion =
	platform() === "darwin"
		? execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim()
		: readFileSync("/etc/os-release", "utf8").match(
				/^PRETTY_NAME="?([^"\n]+)"?$/m,
			)?.[1];
const libc =
	platform() === "linux"
		? execFileSync("getconf", ["GNU_LIBC_VERSION"], { encoding: "utf8" }).trim()
		: "not-applicable";
assert(systemVersion && cpus()[0]?.model, "Record actual OS and CPU");
assert(
	platform() !== "linux" || /^glibc \d+\.\d+$/.test(libc),
	"Linux smoke requires observed glibc",
);
const run = (
	args,
	{ input = "", env = environment, command = binary, succeeds = true } = {},
) =>
	new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			env,
			cwd: work,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "",
			stderr = "";
		const timeout = setTimeout(() => child.kill("SIGKILL"), 30000);
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => {
			clearTimeout(timeout);
			try {
				assert.equal(
					code === 0,
					succeeds,
					`Unexpected helper exit (${code}): ${stderr.replaceAll(token, "[synthetic]").replaceAll(savedToken, "[synthetic]")}`,
				);
				resolve({ stdout, stderr });
			} catch (error) {
				reject(error);
			}
		});
		child.stdin.end(input);
	});
const requestFile = join(work, "request.json");
const api = async (request, options = {}) => {
	writeFileSync(requestFile, JSON.stringify(request));
	return run(
		[
			"--home",
			state,
			"github-api",
			"--repo",
			options.repo ?? "https://github.com/test/repo",
			"--request",
			requestFile,
		],
		options,
	);
};
try {
	const credential = await run(["git-credential", "get"], {
		input: "protocol=https\nhost=github.com\npath=test/repo.git\n\n",
	});
	assert.equal(
		credential.stdout,
		`username=x-access-token\npassword=${token}\n\n`,
	);
	assert.equal(credential.stderr, "");
	checks.gitCredentialScoped = "passed";
	assert.equal(
		(
			await run(["git-credential", "get"], {
				input: "protocol=https\nhost=github.com\npath=other/repo.git\n\n",
			})
		).stdout,
		"",
	);
	checks.gitCredentialForeignRejected = "passed";
	const rest = { method: "GET", path: "repos/test/repo/pulls/1" };
	assert.equal(JSON.parse((await api(rest)).stdout).head.sha, "approved-head");
	checks.restApiScoped = "passed";
	assert.equal(
		JSON.parse(
			(
				await api({
					method: "POST",
					path: "graphql",
					body: {
						query:
							"query($owner:String!,$name:String!){repository(owner:$owner,name:$name){nameWithOwner}}",
						variables: { owner: "test", name: "repo" },
					},
				})
			).stdout,
		).data.repository.nameWithOwner,
		"test/repo",
	);
	checks.graphqlApiScoped = "passed";
	const beforeRejected = requests.length;
	await api(
		{ method: "GET", path: "repos/other/repo/pulls/1" },
		{ repo: "https://github.com/other/repo", succeeds: false },
	);
	checks.apiForeignRejected = "passed";
	const missing = { ...environment };
	delete missing.GH_TOKEN;
	await api(rest, { env: missing, succeeds: false });
	assert.equal(requests.length, beforeRejected);
	checks.missingCredentialNoFallback = "passed";
	assert.deepEqual(
		JSON.parse(
			(
				await api({
					method: "POST",
					path: "repos/test/repo/actions/runs/42/rerun-failed-jobs",
				})
			).stdout,
		),
		{},
	);
	checks.http201CiRetry = "passed";
	writeFileSync(requestFile, JSON.stringify(rest));
	const quoted = `'${binary.replaceAll("'", "'\\''")}'`;
	const helper = await run(
		[
			"-c",
			`${quoted} --home '${state}' github-api "$@"`,
			"bobs-factory",
			"--repo",
			"https://github.com/test/repo",
			"--request",
			requestFile,
		],
		{ command: "/bin/sh" },
	);
	assert.equal(JSON.parse(helper.stdout).head.sha, "approved-head");
	checks.helperWithoutPath = "passed";
	const permissions = join(work, "permissions.json");
	writeFileSync(permissions, '{"allow":["Shell(*)"],"deny":["Shell(rm)"]}');
	assert.equal(
		JSON.parse(
			(
				await run(["internal", "cursor-permission", permissions], {
					input:
						'{"hook_event_name":"beforeShellExecution","command":"rm -rf /tmp/example"}',
				})
			).stdout,
		).permission,
		"deny",
	);
	checks.cursorPermission = "passed";
	assert.equal(
		digest(readFileSync(join(state, "github-auth.json"))),
		authBefore,
	);
	const receipt = {
		schemaVersion: 1,
		product: "bobs-factory",
		validation: "native-helpers",
		status: "passed",
		version: build.version,
		commit: build.commit,
		target: build.target,
		dirty: build.dirty,
		resourceDigest: build.resourceDigest,
		executableSha256: build.executable.sha256,
		platform: {
			os: platform(),
			arch: arch(),
			release: release(),
			systemVersion,
			cpuModel: cpus()[0].model,
			libc,
		},
		scope: {
			transport: "controlled-local-https",
			credentials: "synthetic-scoped",
			agentInference: "none",
		},
		checks,
		requestCount: requests.length,
	};
	mkdirSync(resolve(values.output), { recursive: true });
	writeFileSync(
		join(resolve(values.output), "native-helpers.json"),
		`${JSON.stringify(receipt, null, 2)}\n`,
		{ flag: "wx" },
	);
	console.log(
		`Native helpers passed on ${build.target}; scoped synthetic HTTPS, no gh/Node/Bun on helper PATH, no inference`,
	);
} finally {
	await new Promise((resolve) => server.close(resolve));
	rmSync(work, { recursive: true, force: true });
}
