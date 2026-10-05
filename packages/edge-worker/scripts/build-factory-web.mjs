import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = `${root}/src/factory/web`,
	target = `${root}/dist/factory/web`;
mkdirSync(target, { recursive: true });
await build({
	entryPoints: [`${source}/app.tsx`],
	outfile: `${target}/app.js`,
	bundle: true,
	nodePaths: [`${root}/node_modules`],
	format: "esm",
	platform: "browser",
	target: "es2022",
	jsx: "automatic",
	minify: true,
	sourcemap: true,
});
execFileSync(
	"pnpm",
	[
		"exec",
		"tailwindcss",
		"-i",
		`${source}/styles.css`,
		"-o",
		`${target}/styles.css`,
		"--minify",
	],
	{ cwd: root, stdio: "inherit" },
);
copyFileSync(`${source}/index.html`, `${target}/index.html`);
