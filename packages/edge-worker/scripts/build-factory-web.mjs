import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "src/factory/web"),
	target = join(root, "dist/factory/web");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
mkdirSync(target, { recursive: true });
const stage = mkdtempSync(join(target, ".stage-"));
const placeholder = "FACTORY_BUILD_REPLACED_AT_BUILD_TIME";
try {
	await build({
		entryPoints: [join(source, "app.tsx")],
		outfile: join(stage, "app.js"),
		bundle: true,
		nodePaths: [join(root, "node_modules")],
		format: "esm",
		platform: "browser",
		target: "es2022",
		jsx: "automatic",
		minify: true,
		define: { __FACTORY_BUILD__: JSON.stringify(placeholder) },
	});
	await build({
		entryPoints: [join(source, "sw.js")],
		outfile: join(stage, "sw.js"),
		bundle: true,
		format: "iife",
		platform: "browser",
		target: "es2022",
		minify: true,
		define: {
			"process.env.NODE_ENV": '"production"',
			__SHELL__: "FACTORY_SHELL_REPLACED_AT_BUILD_TIME",
		},
	});
	execFileSync(
		"pnpm",
		[
			"exec",
			"tailwindcss",
			"-i",
			join(source, "styles.css"),
			"-o",
			join(stage, "styles.css"),
			"--minify",
		],
		{ cwd: root, stdio: "inherit" },
	);
	const inputs = new Map([
		["app.js", readFileSync(join(stage, "app.js"))],
		["styles.css", readFileSync(join(stage, "styles.css"))],
		["index.html", readFileSync(join(source, "index.html"))],
		[
			"manifest.webmanifest",
			readFileSync(join(source, "manifest.webmanifest")),
		],
		["sw.js", readFileSync(join(stage, "sw.js"))],
		...[
			"icon-192.png",
			"icon-512.png",
			"maskable-512.png",
			"apple-touch-icon.png",
		].map((name) => [
			`icons/${name}`,
			readFileSync(join(source, "icons", name)),
		]),
	]);
	// Include build tooling too: changing generation rules creates a distinct completed build.
	const buildId = hash(
		Buffer.concat(
			[...inputs]
				.flatMap(([name, bytes]) => [Buffer.from(name), bytes])
				.concat(readFileSync(fileURLToPath(import.meta.url))),
		),
	).slice(0, 24);
	const app = Buffer.from(
		inputs.get("app.js").toString().replaceAll(placeholder, buildId),
	);
	const appName = `app.${hash(app).slice(0, 24)}.js`,
		cssName = `styles.${hash(inputs.get("styles.css")).slice(0, 24)}.css`;
	const output = new Map([
		[appName, app],
		[cssName, inputs.get("styles.css")],
		[
			"index.html",
			Buffer.from(
				inputs
					.get("index.html")
					.toString()
					.replace("__APP__", `/${appName}`)
					.replace("__STYLES__", `/${cssName}`),
			),
		],
		...[...inputs].filter(
			([name]) => name.startsWith("icons/") || name === "manifest.webmanifest",
		),
	]);
	const type = (name) =>
		name.endsWith(".png")
			? "image/png"
			: name.endsWith(".js")
				? "application/javascript"
				: name.endsWith(".css")
					? "text/css"
					: name.endsWith(".html")
						? "text/html"
						: "application/manifest+json";
	const resources = [...output].map(([name, bytes]) => ({
		path: name === "index.html" ? "/" : `/${name}`,
		file: name,
		sha256: hash(bytes),
		type: type(name),
		immutable: name === appName || name === cssName,
	}));
	output.set(
		"sw.js",
		Buffer.from(
			inputs
				.get("sw.js")
				.toString()
				.replace(
					"FACTORY_SHELL_REPLACED_AT_BUILD_TIME",
					JSON.stringify({
						build: buildId,
						resources: resources.map((resource) => ({
							...resource,
							integrity: `sha256-${Buffer.from(resource.sha256, "hex").toString("base64")}`,
						})),
					}),
				),
		),
	);
	resources.push({
		path: "/sw.js",
		file: "sw.js",
		sha256: hash(output.get("sw.js")),
		type: "application/javascript",
		immutable: false,
	});
	// Publish a complete immutable directory first, then atomically replace the pointer.
	for (const [name, bytes] of output) {
		mkdirSync(join(stage, name, ".."), { recursive: true });
		writeFileSync(join(stage, name), bytes);
	}
	rmSync(join(stage, "app.js"));
	rmSync(join(stage, "styles.css"));
	writeFileSync(
		join(stage, "shell.json"),
		JSON.stringify({ build: buildId, protocol: 1, resources }),
	);
	const completed = join(target, `build-${buildId}`);
	if (existsSync(completed)) rmSync(stage, { recursive: true, force: true });
	else renameSync(stage, completed);
	const pointer = join(target, `.current-${process.pid}.json`);
	writeFileSync(pointer, JSON.stringify({ directory: `build-${buildId}` }));
	renameSync(pointer, join(target, "current.json"));
	console.log(`Factory web build: ${buildId}`);
} finally {
	rmSync(stage, { recursive: true, force: true });
}
