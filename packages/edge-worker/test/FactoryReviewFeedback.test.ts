import { afterEach, expect, it, vi } from "vitest";
import {
	emptyFeedback,
	type FeedbackDraft,
	type FeedbackTarget,
	feedbackKey,
	hasFeedback,
	orderedComments,
	serializeFeedback,
} from "../src/factory/web/review-feedback.js";
import { feedbackSession } from "../src/factory/web/review-feedback-session.js";
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

it("starts fresh even with legacy feedback saved in browser storage", () => {
	const key = feedbackKey(
		reviewKey(
			{ id: "a", reviewGate: { headSha: "sha1" } },
			{ summary: "Guide" },
		),
		"gate1",
	);
	const getItem = vi.fn(() =>
		JSON.stringify({ feedback: "Old draft", open: true }),
	);
	const setItem = vi.fn();
	vi.stubGlobal("localStorage", { getItem, setItem });
	const first = feedbackSession(key);
	first.update((d) => ({ ...d, feedback: "New edit" }));
	expect(feedbackSession(key).getSnapshot().draft).toEqual(emptyFeedback());
	expect(first.getSnapshot().draft.feedback).toBe("New edit");
	expect(getItem).not.toHaveBeenCalled();
	expect(setItem).not.toHaveBeenCalled();
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

it.each([
	"success",
	"failure",
])("keeps only the pending lock across remounts on %s", (result) => {
	const key = `remount-${result}`;
	const original = feedbackSession(key);
	original.update((d) => ({ ...d, feedback: "Submitted feedback" }));
	const submitted = original.getSnapshot().draft;
	expect(original.lock()).toBe(true);
	const returning = feedbackSession(key);
	expect(returning.getSnapshot()).toEqual({
		draft: emptyFeedback(),
		busy: true,
	});
	expect(returning.lock()).toBe(false);
	returning.update((d) => ({ ...d, feedback: "Duplicate edit" }));
	expect(returning.getSnapshot().draft).toEqual(emptyFeedback());
	if (result === "success") original.clear(submitted);
	original.unlock();
	expect(returning.getSnapshot()).toEqual({
		draft: emptyFeedback(),
		busy: false,
	});
	expect(original.getSnapshot().draft.feedback).toBe(
		result === "failure" ? "Submitted feedback" : "",
	);
	returning.update((d) => ({ ...d, feedback: "Replacement edit" }));
	expect(returning.lock()).toBe(true);
	original.clear(submitted);
	original.unlock();
	expect(returning.getSnapshot()).toEqual({
		draft: { ...emptyFeedback(), feedback: "Replacement edit" },
		busy: true,
	});
	returning.unlock();
});

it("keeps a replacement review independent of an older request", () => {
	const old = feedbackSession("old-gate");
	old.update((d) => ({ ...d, feedback: "Old feedback" }));
	const submitted = old.getSnapshot().draft;
	old.lock();
	const replacement = feedbackSession("new-gate");
	replacement.update((d) => ({ ...d, feedback: "New feedback" }));
	old.clear(submitted);
	old.unlock();
	expect(replacement.getSnapshot()).toEqual({
		draft: { ...emptyFeedback(), feedback: "New feedback" },
		busy: false,
	});
});

it("edits and submits without access to browser storage", () => {
	vi.stubGlobal("localStorage", {
		getItem: () => {
			throw new Error("Denied");
		},
		setItem: () => {
			throw new Error("Denied");
		},
	});
	const session = feedbackSession("denied");
	session.update((d) => ({ ...d, feedback: "In-memory feedback" }));
	const submitted = session.getSnapshot().draft;
	expect(serializeFeedback(submitted)).toBe("In-memory feedback");
	expect(session.lock()).toBe(true);
	session.clear(submitted);
	session.unlock();
	expect(session.getSnapshot()).toEqual({
		draft: emptyFeedback(),
		busy: false,
	});
});
