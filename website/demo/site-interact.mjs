// Exercises the site's interactive elements and screenshots the results.
import { chromium } from "playwright";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.goto("http://localhost:5180");
await p.waitForTimeout(2600);
await p.screenshot({ path: "/tmp/bobshots/i-hero.png" });
await p.locator("#review").scrollIntoViewIfNeeded();
await p.getByRole("tab", { name: /Diff/ }).click();
await p.getByRole("button", { name: "Approve & merge" }).click();
await p.waitForTimeout(1500);
await p
	.getByRole("button", { name: /Merged/ })
	.evaluate((el) => el.scrollIntoView({ block: "center" }));
await p.waitForTimeout(150);
await p.screenshot({ path: "/tmp/bobshots/i-approve.png" });
await p.locator("#recipes").scrollIntoViewIfNeeded();
await p.locator("#recipes").getByText("Human review gate").click();
await p.locator("#recipes").getByText("QA & screenshots").click();
await p.getByRole("button", { name: "Gemini" }).first().click();
await p.waitForTimeout(900);
await p
	.getByText("Who does what")
	.evaluate((el) => el.scrollIntoView({ block: "center" }));
await p.waitForTimeout(500);
await p.screenshot({ path: "/tmp/bobshots/i-recipes.png" });
const slider = p.getByRole("slider", { name: "Compare light and dark theme" });
await slider.scrollIntoViewIfNeeded();
const box = await slider.boundingBox();
await p.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
await p.waitForTimeout(400);
await p.screenshot({ path: "/tmp/bobshots/i-slider.png" });
console.log("errors", errors);
await b.close();
