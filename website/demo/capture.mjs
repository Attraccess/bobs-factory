// Captures marketing screenshots and recordings from a running demo server.
//   bun demo/server.ts &   then   node demo/capture.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const origin = process.env.DEMO_URL ?? "http://127.0.0.1:3700";
const out = fileURLToPath(new URL("./shots-png/", import.meta.url));
const web = fileURLToPath(new URL("../public/shots/", import.meta.url));
const videos = fileURLToPath(new URL("../public/video/", import.meta.url));
mkdirSync(out, { recursive: true });
mkdirSync(web, { recursive: true });
mkdirSync(videos, { recursive: true });
const only = process.argv.slice(2);
const want = (name) => !only.length || only.includes(name);

const runs = await (await fetch(`${origin}/api/runs`)).json();
const id = (title) => runs.find((run) => run.title === title).id;
const dark = id("Dark mode for the menu page");
const live = id("Speed up checkout API p95");
const waffle = id("Why does the waffle test flake on CI?");

const browser = await chromium.launch();
async function page({
	width = 1440,
	height = 900,
	scheme = "light",
	scale = 2,
	video,
} = {}) {
	const context = await browser.newContext({
		viewport: { width, height },
		deviceScaleFactor: scale,
		colorScheme: scheme,
		...(video ? { recordVideo: { dir: video, size: { width, height } } } : {}),
	});
	const p = await context.newPage();
	p.setDefaultTimeout(8000);
	p.settle = async (ms = 900) => {
		await p.waitForTimeout(ms);
		await p.evaluate(() => document.activeElement?.blur());
	};
	return p;
}
const go = async (p, hash, ms = 1800) => {
	await p.goto(`${origin}/#${hash}`);
	await p.settle(ms);
};
const save = (p, name, options = {}) =>
	p.screenshot({ path: join(out, `${name}.png`), ...options });
const scrollTo = (p, text) =>
	p
		.getByText(text, { exact: false })
		.first()
		.evaluate((el) => el.scrollIntoView({ block: "start" }));
const next = async (p) => {
	await p
		.locator("button.primary")
		.filter({ hasText: /^(Start|Next|Files|Decide) →/ })
		.last()
		.click();
	await p.settle(1100);
};

for (const scheme of ["light", "dark"]) {
	if (!want(`today-${scheme}`)) continue;
	const p = await page({ scheme });
	await go(p, "/");
	await save(p, `today-${scheme}`);
	await p.context().close();
}

if (want("review")) {
	const p = await page({ height: 1000 });
	await go(p, `/runs/${dark}/review`);
	await p.mouse.wheel(0, 340);
	await p.settle();
	await save(p, "review-overview");
	await next(p);
	await save(p, "review-chapter");
	await next(p);
	await p.getByRole("button", { name: "How it works" }).click();
	await p.settle();
	await save(p, "review-how");
	await next(p);
	await p.settle(1500);
	await save(p, "review-files");
	await p
		.getByText("A toggle that remembers the guest's choice")
		.last()
		.click();
	await p.settle(1500);
	await p.getByText("theme.js", { exact: true }).first().click();
	await p.settle(1500);
	await p
		.getByRole("button", { name: "Unified" })
		.click()
		.catch(() => {});
	await p.settle(800);
	await save(p, "review-diff");
	await p.keyboard.press("Escape");
	await p.settle(600);
	await next(p).catch(() => {});
	await p.settle(1000);
	await p.mouse.wheel(0, 2000);
	await p.settle(800);
	await save(p, "review-decision");
	await p.context().close();
}

if (want("question")) {
	const p = await page({ height: 1000 });
	await go(p, "/");
	await scrollTo(p, "For you");
	await p.mouse.wheel(0, -24);
	await p.settle();
	await save(p, "question");
	await p.context().close();
}

if (want("run")) {
	const p = await page({ height: 1000 });
	await go(p, `/runs/${live}`, 2500);
	await scrollTo(p, "Load older messages");
	await p.mouse.wheel(0, -60);
	await p.settle(1500);
	await save(p, "run-live");
	await go(p, `/runs/${waffle}`, 2500);
	await save(p, "run-simple");
	await p.context().close();
}

if (want("recipes")) {
	const p = await page({ height: 1000 });
	await go(p, "/recipes");
	await scrollTo(p, "Software factory");
	await p.mouse.wheel(0, -30);
	await p.settle();
	await save(p, "recipes");
	await p.context().close();
}

if (want("mobile")) {
	for (const [name, hash] of [
		["mobile-today", "/"],
		["mobile-review", `/runs/${dark}/review`],
	]) {
		const p = await page({
			width: 390,
			height: 844,
			scale: 3,
			scheme: name === "mobile-review" ? "dark" : "light",
		});
		await go(p, hash);
		if (name === "mobile-review") await next(p);
		await save(p, name);
		await p.context().close();
	}
}

// Screen recordings, encoded to H.264 + WebM for every browser.
async function record(name, script, size = { width: 1440, height: 900 }) {
	if (!want(name)) return;
	const dir = join(videos, `.${name}`);
	rmSync(dir, { recursive: true, force: true });
	const p = await page({ ...size, scale: 1, video: dir });
	await script(p);
	await p.context().close();
	const raw = join(dir, readdirSync(dir)[0]);
	renameSync(raw, join(dir, "raw.webm"));
	const input = join(dir, "raw.webm");
	// Drop the blank first frames while the app shell loads.
	execFileSync("ffmpeg", [
		"-y",
		"-loglevel",
		"error",
		"-ss",
		"2.1",
		"-i",
		input,
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-crf",
		"24",
		"-preset",
		"slow",
		"-movflags",
		"+faststart",
		"-an",
		join(videos, `${name}.mp4`),
	]);
	execFileSync("ffmpeg", [
		"-y",
		"-loglevel",
		"error",
		"-ss",
		"2.1",
		"-i",
		input,
		"-c:v",
		"libvpx-vp9",
		"-crf",
		"36",
		"-b:v",
		"0",
		"-an",
		join(videos, `${name}.webm`),
	]);
	execFileSync("ffmpeg", [
		"-y",
		"-loglevel",
		"error",
		"-ss",
		"2.3",
		"-i",
		input,
		"-frames:v",
		"1",
		join(videos, `${name}.jpg`),
	]);
	rmSync(dir, { recursive: true, force: true });
}

const smooth = async (p, dy, steps = 30) => {
	for (let i = 0; i < steps; i++) {
		await p.mouse.wheel(0, dy / steps);
		await p.waitForTimeout(28);
	}
};

await record("live-run", async (p) => {
	await go(p, `/runs/${live}`, 2000);
	await p.waitForTimeout(800);
	await smooth(p, 760, 60);
	await p.waitForTimeout(16000);
});

await record("today", async (p) => {
	await go(p, "/", 1500);
	await p
		.locator("button:visible, [role=radio]:visible", {
			hasText: "Software factory",
		})
		.first()
		.click();
	await p.waitForTimeout(700);
	await p.locator("textarea").first().click();
	await p.keyboard.type("Add a seasonal pumpkin spice stack to the menu", {
		delay: 45,
	});
	await p.waitForTimeout(700);
	await p.keyboard.press("Enter");
	await p.waitForTimeout(5000);
	await smooth(p, 600, 50);
	await p.waitForTimeout(4000);
});

await browser.close();
// Web-friendly copies for the site.
for (const file of readdirSync(out).filter((name) => name.endsWith(".png")))
	execFileSync("cwebp", [
		"-quiet",
		"-q",
		"82",
		join(out, file),
		"-o",
		join(web, file.replace(/\.png$/, ".webp")),
	]);
console.log("Captured to public/shots and public/video");
