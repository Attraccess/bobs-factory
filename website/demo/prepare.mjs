// Captures the mock "Pancake Palace" product so Bob's QA step has real evidence images.
import { createReadStream, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("./pancake/", import.meta.url));
const out = fileURLToPath(new URL("./assets/pancake/", import.meta.url));
mkdirSync(out, { recursive: true });
const types = {
	".html": "text/html",
	".css": "text/css",
	".js": "text/javascript",
};
const server = createServer((request, response) => {
	const path = new URL(request.url, "http://x").pathname;
	const file = join(root, path.endsWith("/") ? `${path}index.html` : path);
	response.setHeader("content-type", types[extname(file)] ?? "text/plain");
	createReadStream(file)
		.on("error", () => response.writeHead(404).end())
		.pipe(response);
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const shots = [
	["before-desktop", "base", { width: 1280, height: 800 }, "light"],
	["after-light-desktop", "head", { width: 1280, height: 800 }, "light"],
	["after-dark-desktop", "head", { width: 1280, height: 800 }, "dark"],
	["after-dark-mobile", "head", { width: 390, height: 844 }, "dark"],
	["after-light-mobile", "head", { width: 390, height: 844 }, "light"],
];
for (const [name, revision, viewport, scheme] of shots) {
	const page = await browser.newPage({
		viewport,
		deviceScaleFactor: 2,
		colorScheme: scheme,
	});
	await page.goto(`${base}/${revision}/`);
	await page.waitForSelector(".card");
	await page.screenshot({ path: join(out, `${name}.png`) });
	await page.close();
}
await browser.close();
server.close();
console.log(`Saved ${shots.length} product screenshots to ${out}`);
