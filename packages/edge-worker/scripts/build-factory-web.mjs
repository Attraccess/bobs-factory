import { readFileSync, writeFileSync } from "node:fs";

// Embed the existing, browser-safe runner formatters as ES modules. Keeping the
// dashboard in one asset also lets an already-running Cyrus serve UI updates.
const moduleUrl = (source) =>
	`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
let activity = readFileSync(
	new URL("../src/factory/web/activity.js", import.meta.url),
	"utf8",
);
for (const runner of ["claude", "codex", "gemini", "cursor", "opencode"]) {
	const formatter = readFileSync(
		new URL(`../../${runner}-runner/dist/formatter.js`, import.meta.url),
		"utf8",
	);
	activity = activity.replace(
		`../../../../${runner}-runner/dist/formatter.js`,
		moduleUrl(formatter),
	);
}
const app = readFileSync(
	new URL("../src/factory/web/app.js", import.meta.url),
	"utf8",
).replace("./activity.js", moduleUrl(activity));
writeFileSync(new URL("../dist/factory/web/app.js", import.meta.url), app);
