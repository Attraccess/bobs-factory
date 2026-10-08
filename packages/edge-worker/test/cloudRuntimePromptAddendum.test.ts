import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	appendCloudRuntimeAddendum,
	CLOUD_RUNTIME_PROMPT_ADDENDUM,
} from "../src/prompts/cloudRuntimePromptAddendum.js";

describe("cloud-runtime prompt addendum", () => {
	const original = process.env.BOBS_FACTORY_CLOUD_RUNTIME;

	beforeEach(() => {
		delete process.env.BOBS_FACTORY_CLOUD_RUNTIME;
	});

	afterEach(() => {
		if (original === undefined) delete process.env.BOBS_FACTORY_CLOUD_RUNTIME;
		else process.env.BOBS_FACTORY_CLOUD_RUNTIME = original;
	});

	it("includes the packages settings link and apt/npm guidance", () => {
		expect(CLOUD_RUNTIME_PROMPT_ADDENDUM).toContain(
			"https://app.atcyrus.com/settings/packages",
		);
		expect(CLOUD_RUNTIME_PROMPT_ADDENDUM).toMatch(/apt/);
		expect(CLOUD_RUNTIME_PROMPT_ADDENDUM).toMatch(/npm/);
	});

	it("returns the existing prompt unchanged when the env var is unset", () => {
		expect(appendCloudRuntimeAddendum("You are Bob’s Factory.")).toBe(
			"You are Bob’s Factory.",
		);
		expect(appendCloudRuntimeAddendum(undefined)).toBe("");
		expect(appendCloudRuntimeAddendum(null)).toBe("");
	});

	it("returns the existing prompt unchanged when the env var is falsy", () => {
		process.env.BOBS_FACTORY_CLOUD_RUNTIME = "false";
		expect(appendCloudRuntimeAddendum("You are Bob’s Factory.")).toBe(
			"You are Bob’s Factory.",
		);
		process.env.BOBS_FACTORY_CLOUD_RUNTIME = "0";
		expect(appendCloudRuntimeAddendum("You are Bob’s Factory.")).toBe(
			"You are Bob’s Factory.",
		);
	});

	it("appends the addendum with a blank-line separator when enabled", () => {
		process.env.BOBS_FACTORY_CLOUD_RUNTIME = "true";
		const result = appendCloudRuntimeAddendum("You are Bob’s Factory.");
		expect(result.startsWith("You are Bob’s Factory.\n\n")).toBe(true);
		expect(result.endsWith(CLOUD_RUNTIME_PROMPT_ADDENDUM)).toBe(true);
	});

	it("returns the addendum verbatim when enabled with no base prompt", () => {
		process.env.BOBS_FACTORY_CLOUD_RUNTIME = "1";
		expect(appendCloudRuntimeAddendum(undefined)).toBe(
			CLOUD_RUNTIME_PROMPT_ADDENDUM,
		);
		expect(appendCloudRuntimeAddendum("")).toBe(CLOUD_RUNTIME_PROMPT_ADDENDUM);
	});

	it("accepts common truthy spellings", () => {
		for (const value of ["true", "1", "yes", "TRUE", " Yes "]) {
			process.env.BOBS_FACTORY_CLOUD_RUNTIME = value;
			expect(appendCloudRuntimeAddendum("base")).toContain(
				CLOUD_RUNTIME_PROMPT_ADDENDUM,
			);
		}
	});
});
