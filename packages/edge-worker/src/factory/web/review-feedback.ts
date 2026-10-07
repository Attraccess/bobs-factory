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
				"Feedback exceeds 100,000 characters. Shorten your feedback before submitting.",
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
			"Collected feedback exceeds 100,000 characters. Shorten or remove comments before submitting.",
		);
	return result;
}
