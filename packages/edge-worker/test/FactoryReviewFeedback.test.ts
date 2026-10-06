import { afterEach, expect, it, vi } from "vitest";
import { forgetDraft } from "../src/factory/web/restoration.js";
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

it("isolates shared storage by run, revision, guide and gate while retaining legacy keys", () => {
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
	// Another tab's shared storage is not a draft mounted in this tab or saved by its update.
	forgetDraft(`feedback/draft/${key}`);
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

function memoryStorage() {
	const data = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => data.set(key, value),
	});
}

it("retains the pending lock across route remounts and clears the submitted view", () => {
	memoryStorage();
	const key = "remount-success";
	const original = feedbackSession(key);
	original.update((d) => ({ ...d, feedback: "Submitted feedback" }));
	const submitted = original.getSnapshot().draft;
	expect(original.lock()).toBe(true);
	const returning = feedbackSession(key);
	const changed = vi.fn();
	const unsubscribe = returning.subscribe(changed);
	expect(returning.getSnapshot().busy).toBe(true);
	expect(returning.lock()).toBe(false);
	returning.update((d) => ({ ...d, feedback: "New edit while locked" }));
	expect(returning.getSnapshot().draft).toEqual(submitted);
	original.clear(submitted);
	original.unlock();
	expect(returning.getSnapshot()).toEqual({
		draft: emptyFeedback(),
		busy: false,
	});
	expect(changed).toHaveBeenCalledTimes(2);
	unsubscribe();
	expect(loadFeedback(key).feedback).toBe("");
	expect(feedbackSession(key).getSnapshot().busy).toBe(false);
});

it("unlocks a remounted review after failure without clearing its drafts", () => {
	memoryStorage();
	const key = "remount-failure";
	const original = feedbackSession(key);
	original.update((d) => ({
		...d,
		feedback: "General draft",
		items: [{ target: target("/summary", [0, 1]), text: "Item draft" }],
	}));
	const submitted = original.getSnapshot().draft;
	original.lock();
	const returning = feedbackSession(key);
	original.unlock();
	expect(returning.getSnapshot()).toEqual({ draft: submitted, busy: false });
	returning.update((d) => ({ ...d, feedback: "Editable after failure" }));
	expect(loadFeedback(key)).toEqual(
		normalizeFeedback({ ...submitted, feedback: "Editable after failure" }),
	);
	expect(returning.lock()).toBe(true);
	returning.unlock();
});

it("clears only the submitted contents and identity when stored drafts change", () => {
	memoryStorage();
	const key = "changed-in-other-tab";
	const original = feedbackSession(key);
	const first = { target: target("/summary", [0, 1]), text: "Original" };
	const second = { target: target("/goal", [0, 0]), text: "Unchanged" };
	original.update((d) => ({
		...d,
		feedback: "Original general feedback",
		items: [first, second],
	}));
	const submitted = original.getSnapshot().draft;
	original.lock();
	const returning = feedbackSession(key);
	const newItem = { target: target("/checks/0", [2, 0]), text: "New item" };
	const edited = {
		...submitted,
		feedback: "New unsent general edit",
		items: [{ ...first, text: "New unsent item edit" }, second, newItem],
	};
	saveFeedback(key, edited);
	const other = feedbackSession("replacement-gate");
	other.update((d) => ({ ...d, feedback: "Different review" }));
	expect(other.getSnapshot().busy).toBe(false);
	original.clear(submitted);
	original.unlock();
	const expected = normalizeFeedback({
		...edited,
		items: [edited.items[0], newItem],
	});
	expect(returning.getSnapshot()).toEqual({ draft: expected, busy: false });
	expect(loadFeedback(key)).toEqual(expected);
	expect(feedbackSession(key).getSnapshot().draft).toEqual(expected);
	expect(loadFeedback("replacement-gate").feedback).toBe("Different review");
});

it("keeps pending state and submitted drafts in memory when storage is denied", () => {
	vi.stubGlobal("localStorage", {
		getItem: () => {
			throw new Error("Denied");
		},
		setItem: () => {
			throw new Error("Denied");
		},
	});
	const original = feedbackSession("pending-denied");
	original.update((d) => ({ ...d, feedback: "In-memory draft" }));
	const submitted = original.getSnapshot().draft;
	original.lock();
	const returning = feedbackSession("pending-denied");
	expect(returning.getSnapshot()).toEqual({ draft: submitted, busy: true });
	original.clear(submitted);
	original.unlock();
	expect(returning.getSnapshot()).toEqual({
		draft: emptyFeedback(),
		busy: false,
	});
});
