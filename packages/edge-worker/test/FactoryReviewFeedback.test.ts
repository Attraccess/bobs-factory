import { afterEach, expect, it, vi } from "vitest";
import {
	emptyFeedback,
	type FeedbackDraft,
	type FeedbackTarget,
	feedbackKey,
	hasFeedback,
	loadFeedback,
	normalizeFeedback,
	orderedComments,
	saveFeedback,
	serializeFeedback,
} from "../src/factory/web/review-feedback.js";
import { reviewKey } from "../src/factory/web/review-state.js";

afterEach(() => vi.unstubAllGlobals());
const target = (
	path: string,
	order: number[],
	kind = "Text block",
	label = "Before",
	context = "Old behavior",
): FeedbackTarget => ({
	path,
	page: order[0]!,
	pageTitle: "Meter names (meters)",
	kind,
	label,
	context,
	order,
});
const context = {
	revision: "abc123",
	goal: "Review meter names",
	identity: "review/abc123/guide1",
};

it("migrates single-text drafts and discards invalid stored comments", () => {
	expect(
		normalizeFeedback({
			feedback: "Keep my old draft\nSecond line",
			open: true,
		}),
	).toEqual({
		feedback: "Keep my old draft\nSecond line",
		open: true,
		collectedOpen: false,
		items: [],
		editing: undefined,
	});
	const item = {
		target: target("/chapters/0/before", [1, 2]),
		text: "Comment",
	};
	expect(
		normalizeFeedback({
			items: [
				null,
				{},
				item,
				item,
				{ ...item, target: { ...item.target, path: "bad" } },
				{ ...item, target: { ...item.target, order: [NaN] } },
			],
			feedback: 7,
			editing: false,
		}).items,
	).toEqual([item]);
	for (const value of [null, "broken", [], false])
		expect(normalizeFeedback(value).items).toEqual([]);
});

it("isolates run, revision, guide and gate identities while retaining legacy keys", () => {
	const data = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => data.set(key, value),
	});
	const run = { id: "a", reviewGate: { headSha: "sha1" } },
		guide = { summary: "Guide" };
	const key = feedbackKey(reviewKey(run, guide), "gate1");
	expect(key).toBe(`${reviewKey(run, guide)}/feedback/gate1`);
	const draft = { ...emptyFeedback(), feedback: "Old draft" };
	saveFeedback(key, draft);
	expect(loadFeedback(key).feedback).toBe("Old draft");
	for (const other of [
		feedbackKey(reviewKey({ ...run, id: "b" }, guide), "gate1"),
		feedbackKey(
			reviewKey({ ...run, reviewGate: { headSha: "sha2" } }, guide),
			"gate1",
		),
		feedbackKey(reviewKey(run, { summary: "New guide" }), "gate1"),
		feedbackKey(reviewKey(run, guide), "gate2"),
	])
		expect(loadFeedback(other).feedback).toBe("");
	saveFeedback(feedbackKey(reviewKey(run, guide), "gate2"), emptyFeedback());
	expect(loadFeedback(key).feedback).toBe("Old draft");
});

it("orders distinct repeated targets numerically and serializes the entire combined review", () => {
	const draft: FeedbackDraft = {
		feedback: "Also retain the caption.\nThanks.",
		open: true,
		items: [
			{
				target: target(
					"/chapters/0/files/10",
					[1, 8, 10],
					"File",
					"src/meter.ts",
					"src/meter.ts",
				),
				text: "Check this file.",
			},
			{
				target: target(
					"/chapters/0/screenshots/0",
					[1, 5, 0],
					"Screenshot",
					"Meter picker",
					"Area: Dashboard; state: open; caption: Meter picker",
				),
				text: "Use a clearer label.\nKeep the icon.",
			},
			{
				target: target("/chapters/0/before", [1, 2]),
				text: "Explain the previous default.",
			},
			{
				target: target(
					"/chapters/0/files/2",
					[1, 8, 2],
					"File",
					"src/meter.ts",
					"src/meter.ts",
				),
				text: "Same file, separate item.",
			},
			{ target: target("/chapters/0/risks/0", [1, 6, 0]), text: " \n " },
		],
	};
	expect(serializeFeedback(draft, context)).toBe(`Review feedback
Revision: abc123
Guide: Review meter names
Review: review/abc123/guide1

Item comments

1. Meter names (meters) — Text block: Before
Target: /chapters/0/before
Source: Old behavior
Comment:
Explain the previous default.

2. Meter names (meters) — Screenshot: Meter picker
Target: /chapters/0/screenshots/0
Source: Area: Dashboard; state: open; caption: Meter picker
Comment:
Use a clearer label.
Keep the icon.

3. Meter names (meters) — File: src/meter.ts
Target: /chapters/0/files/2
Source: src/meter.ts
Comment:
Same file, separate item.

4. Meter names (meters) — File: src/meter.ts
Target: /chapters/0/files/10
Source: src/meter.ts
Comment:
Check this file.

Additional feedback

Also retain the caption.
Thanks.`);
	expect(orderedComments(draft).length).toBe(4);
	expect(draft.items[0]?.target.path).toBe("/chapters/0/files/10");
});

it("supports item-only, general-only and guide-less feedback and filters blanks", () => {
	const item = {
		target: target("/behavior/0/before", [1, 2]),
		text: "Fix the default.",
	};
	expect(
		serializeFeedback({ ...emptyFeedback(), items: [item] }, context),
	).toBe(
		"Review feedback\nRevision: abc123\nGuide: Review meter names\nReview: review/abc123/guide1\n\nItem comments\n\n1. Meter names (meters) — Text block: Before\nTarget: /behavior/0/before\nSource: Old behavior\nComment:\nFix the default.",
	);
	expect(
		serializeFeedback(
			{ ...emptyFeedback(), feedback: "General feedback" },
			context,
		),
	).toBe(
		"Review feedback\nRevision: abc123\nGuide: Review meter names\nReview: review/abc123/guide1\n\nAdditional feedback\n\nGeneral feedback",
	);
	expect(
		serializeFeedback({ ...emptyFeedback(), feedback: "Follow-up\nunchanged" }),
	).toBe("Follow-up\nunchanged");
	const blank = {
		...emptyFeedback(),
		feedback: " \n ",
		items: [{ ...item, text: "\t" }],
	};
	expect(hasFeedback(blank)).toBe(false);
	expect(serializeFeedback(blank, context)).toBe("");
});

it("checks the final message limit without truncating or altering drafts", () => {
	const prefix =
		serializeFeedback({ ...emptyFeedback(), feedback: "x" }, context).length -
		1;
	const draft = { ...emptyFeedback(), feedback: "x".repeat(100_000 - prefix) };
	expect(serializeFeedback(draft, context).length).toBe(100_000);
	draft.feedback += "x";
	expect(() => serializeFeedback(draft, context)).toThrow(
		"Shorten or remove comments",
	);
	expect(draft.feedback.length).toBe(100_001 - prefix);
	expect(() =>
		serializeFeedback({ ...draft, feedback: "x".repeat(100_001) }),
	).toThrow("Shorten your feedback");
});

it("keeps unavailable storage from blocking draft use", () => {
	vi.stubGlobal("localStorage", {
		getItem: () => {
			throw new Error("Denied");
		},
		setItem: () => {
			throw new Error("Denied");
		},
	});
	const draft = { ...loadFeedback("denied"), feedback: "In-memory feedback" };
	expect(() => saveFeedback("denied", draft)).not.toThrow();
	expect(serializeFeedback(draft)).toBe("In-memory feedback");
});
