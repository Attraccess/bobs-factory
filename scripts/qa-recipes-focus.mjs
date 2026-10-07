// Run against an isolated Factory server: node scripts/qa-recipes-focus.mjs URL EVIDENCE_DIR AUTH_STATE
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [url, directory, authState] = process.argv.slice(2);
assert(
	url && directory && authState,
	"Provide an isolated Factory URL, evidence directory and authenticated test browser state",
);
const origin = new URL(url).origin;
const evidence = resolve(directory);
mkdirSync(evidence, { recursive: true });
const session = `recipes-focus-${Date.now()}`;
const receipt = {
	url: origin,
	session,
	rationale:
		"Programmatic element.click() does not establish normal trigger focus; text containment can match the entire page. Open with trusted pointer/keyboard events and compare activeElement with the exact retained opening button.",
	cases: [],
	commands: [],
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 500));
async function browser(...args) {
	const command = ["--headed", "false", "--session", session, ...args];
	if (args[0] === "open") command.splice(4, 0, "--state", resolve(authState));
	const result = spawnSync("agent-browser", command, { encoding: "utf8" });
	receipt.commands.push({
		args: command,
		exitCode: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	await pause();
	return result.stdout.trim();
}
const evaluate = async (script) => JSON.parse(await browser("eval", script));
const config = async () =>
	evaluate(`(async () => {
		const response = await fetch('/api/config', {cache: 'no-store'});
		if (!response.ok) throw new Error('Authenticated fixture config read failed: ' + response.status);
		return response.json();
	})()`);
const saveReceipt = () =>
	writeFileSync(
		join(evidence, "focus-receipts.json"),
		`${JSON.stringify(receipt, null, 2)}\n`,
	);

try {
	await browser("open", `${origin}/#/recipes`);
	receipt.before = await config();
	for (const width of [1280, 430]) {
		for (const method of ["pointer", "keyboard"]) {
			await browser("set", "viewport", String(width), "900");
			const snapshot = await browser("snapshot", "-i");
			const match = snapshot.match(
				/button "Security and data protection: [^"\n]*" \[ref=(\w+)\]/,
			);
			assert(match, "Find the Security reviewer button in the fresh snapshot");
			const ref = `@${match[1]}`;
			await evaluate(`(() => {
				const matches = [...document.querySelectorAll('button')].filter(e => e.textContent.startsWith('Security and data protection:'));
				if (matches.length !== 1) throw new Error('Expected one opening button');
				window.qaRecipesTrigger = matches[0];
				window.qaRecipesOpen = [];
				for (const type of ['click', 'keydown']) matches[0].addEventListener(type, e => window.qaRecipesOpen.push({type, key:e.key, trusted:e.isTrusted, focused:document.activeElement === window.qaRecipesTrigger}), {once:true});
				return true;
			})()`);
			if (method === "pointer") await browser("click", ref);
			else {
				await browser("focus", ref);
				assert(
					await evaluate("document.activeElement === window.qaRecipesTrigger"),
				);
				await browser("press", "Enter");
			}
			const opened = await evaluate(`({
				dialog: !!document.querySelector('[role=dialog]'),
				focusInside: !!document.querySelector('[role=dialog]')?.contains(document.activeElement),
				events: window.qaRecipesOpen
			})`);
			assert(opened.dialog && opened.focusInside);
			assert(
				opened.events.some((e) => e.type === "click" && e.trusted && e.focused),
			);
			const tabOrder = [];
			for (let i = 0; i < 15; i++) {
				await browser("press", "Tab");
				const focused = await evaluate(`(() => {
					const e = document.activeElement;
					const label = e.labels?.[0];
					return {tag:e.tagName, type:e.type, label:label && [...label.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim(), inside:document.querySelector('[role=dialog]').contains(e)};
				})()`);
				assert(focused.inside, "Tab stays within the dialog");
				tabOrder.push(focused);
				if (focused.type === "checkbox") break;
			}
			assert(
				tabOrder.some((e) => e.tag === "TEXTAREA" && e.label === "Role prompt"),
			);
			assert(
				tabOrder.some(
					(e) => e.tag === "SELECT" && e.label === "Output contract",
				),
			);
			assert.equal(tabOrder.at(-1).label, "Structured JSON output");
			const scrolling = await evaluate(`(() => {
				const body = document.querySelector('[role=dialog] .modal-body');
				return {scrollHeight:body.scrollHeight, clientHeight:body.clientHeight, overflowY:getComputedStyle(body).overflowY, scrollTop:body.scrollTop};
			})()`);
			if (width === 430) {
				assert(scrolling.scrollHeight > scrolling.clientHeight);
				assert(["auto", "scroll"].includes(scrolling.overflowY));
				assert(
					scrolling.scrollTop > 0,
					"Keyboard navigation scrolls the dialog",
				);
			}
			// Reproduce the rejected-save state without changing the saved fixture.
			await browser("press", "Space");
			assert.equal(
				await evaluate(
					"document.querySelector('[role=dialog] input[type=checkbox]').checked",
				),
				false,
			);
			await browser("press", "Tab");
			assert.equal(
				await evaluate("document.activeElement.textContent.trim()"),
				"Save step settings",
			);
			await browser("press", "Enter");
			const error = await browser("get", "text", "[role=dialog] [role=alert]");
			assert.match(error, /structured JSON/i);
			assert.equal(
				await evaluate(
					"document.querySelector('[role=dialog] input[type=checkbox]').checked",
				),
				false,
			);
			await browser("press", "Escape");
			const restored = await evaluate(`({
				exactOpeningButton: document.activeElement === window.qaRecipesTrigger,
				triggerConnected: window.qaRecipesTrigger.isConnected,
				tag:document.activeElement.tagName,
				text:document.activeElement.textContent.trim(),
				dialogClosed:!document.querySelector('[role=dialog]')
			})`);
			assert(
				restored.exactOpeningButton &&
					restored.triggerConnected &&
					restored.dialogClosed,
			);
			assert.equal(restored.tag, "BUTTON");
			assert.deepEqual(
				await config(),
				receipt.before,
				"Rejected saves leave the fixture unchanged",
			);
			const screenshot = join(evidence, `focus-${method}-${width}.png`);
			await browser("screenshot", screenshot);
			receipt.cases.push({
				width,
				method,
				opened,
				tabOrder,
				scrolling,
				error,
				restored,
				screenshot,
				outcome: "passed",
			});
			saveReceipt();
			console.log(
				`PASS ${method} ${width}px: Escape focuses the exact opening button`,
			);
		}
	}
	receipt.after = await config();
	receipt.outcome = "passed";
} catch (error) {
	receipt.outcome = "failed";
	receipt.error = String(error);
	throw error;
} finally {
	await browser("close");
	saveReceipt();
}
