// Screenshots the marketing site at several scroll positions for visual QA.
import { chromium } from "playwright";

const [, , url = "http://localhost:5180", width = "1440", height = "900"] =
	process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +width, height: +height } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await p.goto(url);
await p.waitForTimeout(2500);
const total = await p.evaluate(() => document.documentElement.scrollHeight);
let i = 0;
for (let y = 0; y < total; y += +height * 0.9) {
	await p.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
	await p.waitForTimeout(1300);
	await p.screenshot({
		path: `/tmp/bobshots/site-${width}-${String(i++).padStart(2, "0")}.png`,
	});
}
console.log("height", total, "shots", i, "errors", errors);
await b.close();
