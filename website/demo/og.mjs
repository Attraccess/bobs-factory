// Renders public/og.png from demo/og.html.
import { chromium } from "playwright";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto(new URL("./og.html", import.meta.url).href);
await p.waitForTimeout(500);
await p.screenshot({
	path: new URL("../public/og.png", import.meta.url).pathname,
});
await b.close();
