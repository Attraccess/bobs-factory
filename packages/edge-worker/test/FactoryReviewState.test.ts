import { afterEach, expect, it, vi } from "vitest";
import {
	guideMatchesGate,
	readProgress,
	readStored,
	readTextStored,
	reviewKey,
	todayContext,
	writeStored,
} from "../src/factory/web/review-state.js";

afterEach(() => vi.unstubAllGlobals());

it("restores progress written by the original reader and isolates changed reviews", () => {
	const run = { id: "saved-run", reviewGate: { headSha: "abc123" } };
	const guide = { summary: "Saved guide" };
	const key = reviewKey(run, guide);
	expect(key).toBe("factory-review/saved-run/abc123/8jd7j8");
	const saved = { page: 2, reviewed: { feature: true } };
	expect(readProgress(saved, 4)).toEqual({ ...saved, disclosures: {} });
	expect(reviewKey(structuredClone(run), structuredClone(guide))).toBe(key);
	expect(reviewKey({ ...run, updatedAt: "later" }, guide)).toBe(key);
	expect(
		reviewKey({ ...run, reviewGate: { headSha: "replacement" } }, guide),
	).not.toBe(key);
	expect(reviewKey(run, { summary: "Replacement guide" })).not.toBe(key);
});

it("rejects corrupt progress without blocking reading", () => {
	for (const saved of [
		null,
		{},
		{ page: -1, reviewed: {} },
		{ page: 4, reviewed: {} },
		{ page: 1, reviewed: [] },
	])
		expect(readProgress(saved, 4)).toEqual({ page: 0, reviewed: {} });
	expect(
		readProgress(
			{
				page: 1,
				reviewed: { a: true, b: "false" },
				disclosures: { "1/code": true },
			},
			4,
		),
	).toEqual({
		page: 1,
		reviewed: { a: true },
		disclosures: { "1/code": true },
	});
});

it("keeps legacy selections readable and tolerates unavailable or malformed storage", () => {
	vi.stubGlobal("sessionStorage", { getItem: () => "saved-run" });
	expect(readTextStored("bob-selected", "", true)).toBe("saved-run");
	vi.stubGlobal("localStorage", {
		getItem: () => "malformed",
		setItem: () => {
			throw new Error("Denied");
		},
	});
	expect(readStored("draft", { open: false })).toEqual({ open: false });
	expect(() =>
		writeStored("draft", { feedback: "Keep this draft" }),
	).not.toThrow();
	vi.stubGlobal("localStorage", {
		getItem: () => {
			throw new Error("Denied");
		},
	});
	expect(readStored("progress", null)).toBeNull();
});

it("blocks decisions on a guide from a different revision, including custom nested workflows", () => {
	const run = {
		reviewGate: { headSha: "new" },
		roleRevisions: { "pipeline/guide": { headSha: "old" } },
	};
	expect(guideMatchesGate(run)).toBe(false);
	expect(
		guideMatchesGate({
			...run,
			roleRevisions: { "custom/guide": { headSha: "old" } },
		}),
	).toBe(false);
	expect(
		guideMatchesGate({
			...run,
			roleRevisions: { "pipeline/guide": { headSha: "new" } },
		}),
	).toBe(true);
	// Historical guides predate role-revision receipts; their pending gate is still server-validated.
	expect(guideMatchesGate({ reviewGate: { headSha: "legacy" } })).toBe(true);
});

it("carries the reviewed run into Today through direct links and run-story navigation", () => {
	expect(todayContext("/runs/a%20b/review", null)).toEqual({
		focusRunId: "a b",
	});
	expect(todayContext("/runs/a", { focusRunId: "a" })).toEqual({
		focusRunId: "a",
	});
	expect(() => todayContext("/runs/%/review", null)).not.toThrow();
});
