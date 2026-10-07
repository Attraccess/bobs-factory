import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	appendBrowserUseAddendum,
	BROWSER_USE_PROMPT_ADDENDUM,
	HEADLESS_BROWSER_PROMPT_ADDENDUM,
} from "../src/prompts/browserUsePromptAddendum.js";

describe("browser-use prompt addendum", () => {
	const original = process.env.BOBS_FACTORY_BROWSER_USE_ENABLED;

	beforeEach(() => {
		delete process.env.BOBS_FACTORY_BROWSER_USE_ENABLED;
	});

	afterEach(() => {
		if (original === undefined)
			delete process.env.BOBS_FACTORY_BROWSER_USE_ENABLED;
		else process.env.BOBS_FACTORY_BROWSER_USE_ENABLED = original;
	});

	it("includes the agent-browser CLI name and a screenshot hint", () => {
		expect(BROWSER_USE_PROMPT_ADDENDUM).toContain("agent-browser");
		expect(BROWSER_USE_PROMPT_ADDENDUM).toMatch(/screenshot/i);
	});

	it("adds headless guidance without claiming tooling is installed when the env var is unset", () => {
		expect(appendBrowserUseAddendum("You are Bob’s Factory.")).toBe(
			`You are Bob’s Factory.\n\n${HEADLESS_BROWSER_PROMPT_ADDENDUM}`,
		);
		for (const base of [undefined, null, "", " \n"]) {
			expect(appendBrowserUseAddendum(base)).toBe(
				HEADLESS_BROWSER_PROMPT_ADDENDUM,
			);
		}
	});

	it("retains headless guidance when the browser availability flag is falsy", () => {
		for (const value of ["false", "0", "", "no"]) {
			process.env.BOBS_FACTORY_BROWSER_USE_ENABLED = value;
			expect(appendBrowserUseAddendum("You are Bob’s Factory.")).toBe(
				`You are Bob’s Factory.\n\n${HEADLESS_BROWSER_PROMPT_ADDENDUM}`,
			);
		}
	});

	it("appends the addendum with a blank-line separator when enabled", () => {
		process.env.BOBS_FACTORY_BROWSER_USE_ENABLED = "true";
		expect(appendBrowserUseAddendum("You are Bob’s Factory.\n ")).toBe(
			`You are Bob’s Factory.\n\n${HEADLESS_BROWSER_PROMPT_ADDENDUM}\n\n${BROWSER_USE_PROMPT_ADDENDUM}`,
		);
	});

	it("returns both addenda when enabled with no base prompt", () => {
		process.env.BOBS_FACTORY_BROWSER_USE_ENABLED = "1";
		for (const base of [undefined, null, ""]) {
			expect(appendBrowserUseAddendum(base)).toBe(
				`${HEADLESS_BROWSER_PROMPT_ADDENDUM}\n\n${BROWSER_USE_PROMPT_ADDENDUM}`,
			);
		}
	});

	it("accepts common truthy spellings", () => {
		for (const value of ["true", "1", "yes", "TRUE", " Yes "]) {
			process.env.BOBS_FACTORY_BROWSER_USE_ENABLED = value;
			expect(appendBrowserUseAddendum("base")).toBe(
				`base\n\n${HEADLESS_BROWSER_PROMPT_ADDENDUM}\n\n${BROWSER_USE_PROMPT_ADDENDUM}`,
			);
		}
	});
});
