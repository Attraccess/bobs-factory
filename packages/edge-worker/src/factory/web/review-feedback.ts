import {
	draftRevision,
	forgetDraft,
	recoverDraft,
	rememberDraft,
} from "./restoration";
import { readStored, writeStored } from "./review-state";

export type FeedbackTarget = {
	path: string;
	page: number;
	pageTitle: string;
	kind: string;
	label: string;
	context: string;
	order: number[];
};
export type ItemComment = { target: FeedbackTarget; text: string };
export type FeedbackDraft = {
	feedback: string;
	open: boolean;
	collectedOpen?: boolean;
	items: ItemComment[];
	editing?: string;
};
export const emptyFeedback = (): FeedbackDraft => ({
	feedback: "",
	open: false,
	items: [],
});
export const feedbackKey = (identity: string, gateId?: string) =>
	`${identity}/feedback/${gateId ?? "finished"}`;

/** Also accepts the original single-text draft without losing its contents. */
export function normalizeFeedback(value: unknown): FeedbackDraft {
	const saved = value as Partial<FeedbackDraft> | null;
	if (!saved || typeof saved !== "object") return emptyFeedback();
	const items: ItemComment[] = [];
	if (Array.isArray(saved.items))
		for (const item of saved.items) {
			const t = item?.target;
			if (
				t &&
				typeof item.text === "string" &&
				["path", "pageTitle", "kind", "label", "context"].every(
					(k) => typeof t[k as keyof FeedbackTarget] === "string",
				) &&
				t.path.startsWith("/") &&
				Number.isInteger(t.page) &&
				t.page >= 0 &&
				Array.isArray(t.order) &&
				t.order.length > 0 &&
				t.order.every((n) => Number.isInteger(n) && n >= 0) &&
				!items.some((i) => i.target.path === t.path)
			)
				items.push({ target: t, text: item.text });
		}
	return {
		feedback: typeof saved.feedback === "string" ? saved.feedback : "",
		open: saved.open === true,
		collectedOpen: saved.collectedOpen === true,
		items,
		editing: typeof saved.editing === "string" ? saved.editing : undefined,
	};
}
export function loadFeedback(key: string) {
	// Revision-scoped shared storage must never supply another tab's old edits.
	// Only this tab's mounted drafts or explicit update snapshot can cross revisions.
	const runPrefix = key.match(/^factory-review\/[^/]+\//)?.[0];
	const recover = <T>(kind: string) =>
		recoverDraft<T>(
			`feedback/${kind}/${key}`,
			runPrefix ? `feedback/${kind}/${runPrefix}` : undefined,
		);
	const snapshot = recover<FeedbackDraft>("draft");
	if (snapshot !== undefined) return normalizeFeedback(snapshot);
	// Updates from the original single-text shell carry the tab's draft under
	// these keys. Shared storage may belong to another tab, including comments
	// the original shell could never have collected.
	const text = recover<string>("text");
	const open = recover<boolean>("open");
	if (text === undefined && open === undefined)
		return normalizeFeedback(readStored(key, null));
	const migrated = normalizeFeedback({
		...emptyFeedback(),
		feedback: text ?? "",
		open: open ?? false,
	});
	rememberDraft(
		`feedback/draft/${key}`,
		migrated,
		draftRevision(`feedback/text/${key}`) ??
			draftRevision(`feedback/open/${key}`),
	);
	forgetDraft(`feedback/text/${key}`);
	forgetDraft(`feedback/open/${key}`);
	return migrated;
}
export function saveFeedback(key: string, draft: FeedbackDraft) {
	writeStored(key, draft);
	const snapshotKey = `feedback/draft/${key}`;
	rememberDraft(snapshotKey, draft, draftRevision(snapshotKey));
	forgetDraft(`feedback/text/${key}`);
	forgetDraft(`feedback/open/${key}`);
}
export function orderedComments(draft: FeedbackDraft, includeEmpty = false) {
	return draft.items
		.filter((i) => includeEmpty || i.text.trim())
		.sort((a, b) => {
			for (
				let i = 0;
				i < Math.max(a.target.order.length, b.target.order.length);
				i++
			) {
				const diff = (a.target.order[i] ?? -1) - (b.target.order[i] ?? -1);
				if (diff) return diff;
			}
			return a.target.path.localeCompare(b.target.path);
		});
}
export function hasFeedback(draft: FeedbackDraft) {
	return Boolean(
		draft.feedback.trim() || draft.items.some((i) => i.text.trim()),
	);
}
export const MAX_FEEDBACK_LENGTH = 100_000;
export function serializeFeedback(
	draft: FeedbackDraft,
	context?: { revision: string; goal: string; identity: string },
) {
	if (!hasFeedback(draft)) return "";
	// Guide-less follow-ups retain their original message format.
	if (!context) {
		if (draft.feedback.length > MAX_FEEDBACK_LENGTH)
			throw new Error(
				"Feedback exceeds 100,000 characters. Shorten your feedback before submitting; your draft is saved.",
			);
		return draft.feedback;
	}
	const sections = [
		`Review feedback\nRevision: ${context.revision}\nGuide: ${context.goal}\nReview: ${context.identity}`,
	];
	const items = orderedComments(draft);
	if (items.length)
		sections.push(
			`Item comments\n\n${items.map(({ target: t, text }, i) => `${i + 1}. ${t.pageTitle} — ${t.kind}: ${t.label}\nTarget: ${t.path}\nSource: ${t.context}\nComment:\n${text}`).join("\n\n")}`,
		);
	if (draft.feedback.trim())
		sections.push(`Additional feedback\n\n${draft.feedback}`);
	const result = sections.join("\n\n");
	if (result.length > MAX_FEEDBACK_LENGTH)
		throw new Error(
			"Collected feedback exceeds 100,000 characters. Shorten or remove comments before submitting; your drafts are saved.",
		);
	return result;
}
