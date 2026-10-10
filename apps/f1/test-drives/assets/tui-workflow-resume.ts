import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TodayApp } from "../../../../apps/cli/src/tui/app.js";
import { FactoryClient } from "../../../../apps/cli/src/tui/client.js";
import { Screen } from "../../../../apps/cli/src/tui/terminal.js";
import { sgrFor } from "../../../../apps/cli/src/tui/theme.js";
import { requestFactoryTerminalSession } from "../../../../packages/edge-worker/src/factory/FactoryAuthOperator.js";

// Run beside the isolated workflow-catalog-129 F1 fixture with F1_CAPTURE_WAIT=1.
const [receiptFile, evidenceDirectory] = process.argv.slice(2);
const receipt = JSON.parse(readFileSync(receiptFile!, "utf8"));
const client = new FactoryClient({
	port: 3649,
	home: receipt.home,
	requestSession: requestFactoryTerminalSession,
});
let frame = "",
	html = "",
	requests: string[] = [];
const originalPost = client.post.bind(client);
client.post = ((path: string, body?: unknown) => {
	requests.push(path);
	return originalPost(path, body);
}) as typeof client.post;
const escapeHtml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
const render = Screen.prototype.render;
Screen.prototype.render = function (sgr) {
	let content = "";
	for (let y = 0; y < this.h; y++) {
		for (let x = 0; x < this.w; x++) {
			const i = y * this.w + x,
				style = this.styles[i]!;
			content += `<span style="color:${style.fg ?? "inherit"};background:${style.bg ?? "transparent"};font-weight:${style.bold ? "bold" : "normal"}">${escapeHtml(this.cells[i]!)}</span>`;
		}
		content += "\n";
	}
	html = `<!doctype html><meta charset="utf-8"><title>Captured Bob's Factory terminal cell grid</title><style>body{margin:0;background:#14151a}pre{margin:0;padding:16px;font:14px/1.35 monospace;color:#eee}</style><pre>${content}</pre>`;
	return render.call(this, sgr);
};
const app = new TodayApp({
	client,
	theme: "dark",
	sgr: sgrFor(true),
	write: (value) => {
		frame = value;
	},
	size: () => ({ columns: 120, rows: 32 }),
	openUrl: async () => {},
	quit: () => {},
});
const until = async (check: () => boolean | Promise<boolean>) => {
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("Terminal assertion timed out");
};
const impact = await client.get<any>(
	"/api/workflows/catalog-wait/availability",
);
await client.put("/api/workflows/catalog-wait/availability", {
	enabled: false,
	confirm: true,
	token: impact.token,
});
app.start();
try {
	await until(() => frame.includes("NEEDS YOU"));
	app.key({ name: "ctrl-k" });
	app.key({ name: "text", text: receipt.runId });
	app.key({ name: "enter" });
	await until(() => frame.includes("Resume unavailable"));
	assert(frame.includes("Workflow disabled: catalog-wait"));
	app.key({ name: "text", text: "c" });
	assert.equal(requests.length, 0);
	writeFileSync(join(evidenceDirectory!, "terminal-disabled.html"), html);
	await client.put("/api/workflows/catalog-wait/availability", {
		enabled: true,
	});
	await until(
		() =>
			frame.includes("c resume") && !frame.includes("Resume is unavailable."),
	);
	assert.equal(
		(await client.get<any>(`/api/runs/${receipt.runId}`)).status,
		"blocked",
	);
	writeFileSync(join(evidenceDirectory!, "terminal-resume.html"), html);
	app.key({ name: "text", text: "c" });
	await until(
		async () =>
			(await client.get<any>(`/api/runs/${receipt.runId}`)).status ===
			"waiting",
	);
	await until(
		() =>
			frame.includes("? Bob asks") &&
			frame.includes("Choose the next implementation option"),
	);
	assert.deepEqual(requests, [`/api/runs/${receipt.runId}/resume`]);
	const detail = await client.get<any>(`/api/runs/${receipt.runId}`);
	assert(!detail.workflowBlock);
	assert.deepEqual(detail.questions, ["Choose the next implementation option"]);
	writeFileSync(join(evidenceDirectory!, "terminal-resumed.html"), html);
	writeFileSync(
		join(evidenceDirectory!, "terminal-resume-receipt.json"),
		JSON.stringify(
			{
				mode: "mock",
				result: "passed",
				runId: receipt.runId,
				requests,
				checks: [
					"disabled reason rendered",
					"disabled Resume sends no request",
					"enable leaves run blocked",
					"c posts Resume",
					"saved question restored",
				],
				capture:
					"Actual TodayApp Screen cells and styles rendered in a headless HTML viewer; no desktop terminal attached",
			},
			null,
			2,
		),
	);
	console.log(
		"PASS real terminal client authentication, eligibility, keyboard Resume endpoint and saved question",
	);
} finally {
	app.stop();
	Screen.prototype.render = render;
}
