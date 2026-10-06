// Run after changing Bob: node scripts/generate-factory-icons.mjs (requires agent-browser with Chromium)
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "factory-icons-"));
const target = join(root, "src/factory/web/icons");
const session = `factory-icons-${process.pid}`;
mkdirSync(target, { recursive: true });
try {
	await build({
		stdin: {
			contents:
				'import { createElement } from "react"; import { renderToStaticMarkup } from "react-dom/server"; import { Bob } from "./src/factory/web/bob.tsx"; export default renderToStaticMarkup(createElement(Bob, {size: 100}));',
			resolveDir: root,
		},
		outfile: join(temp, "bob.mjs"),
		bundle: true,
		format: "esm",
		banner: {
			js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
		},
		platform: "node",
		jsx: "automatic",
	});
	const { default: svg } = await import(join(temp, "bob.mjs"));
	const page = join(temp, "icon.html");
	writeFileSync(page, `<html>${svg}</html>`);
	execFileSync(
		"agent-browser",
		["--session", session, "open", `file://${page}`],
		{ stdio: "ignore" },
	);
	const result = JSON.parse(
		execFileSync(
			"agent-browser",
			["--session", session, "--json", "eval", "--stdin"],
			{
				encoding: "utf8",
				input: `(async()=>{
		const node = document.querySelector("svg"); node.setAttribute("xmlns", "http://www.w3.org/2000/svg"); const svg = new XMLSerializer().serializeToString(node);
		const img = new Image(); img.src = "data:image/svg+xml," + encodeURIComponent(svg);
		await img.decode(); const icons = {};
		for(const [name,size,scale] of [["icon-192",192,.82],["icon-512",512,.82],["maskable-512",512,.64],["apple-touch-icon",180,.82]]) {
			const canvas = document.createElement("canvas"); canvas.width=size;canvas.height=size;
			const ctx = canvas.getContext("2d");ctx.fillStyle="#fff4f6";ctx.fillRect(0,0,size,size);
			const height=size*scale, width=height*100/108;ctx.drawImage(img,(size-width)/2,(size-height)/2,width,height);
			icons[name]=canvas.toDataURL("image/png").split(",")[1];
		}return icons;
	})()`,
			},
		),
	);
	if (!result.success) throw new Error("Icon rendering failed");
	for (const [name, base64] of Object.entries(result.data.result))
		writeFileSync(join(target, `${name}.png`), Buffer.from(base64, "base64"));
} finally {
	execFileSync("agent-browser", ["--session", session, "close"], {
		stdio: "ignore",
	});
	rmSync(temp, { recursive: true, force: true });
}
