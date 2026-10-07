import { emptyFeedback, type FeedbackDraft } from "./review-feedback";

/** Remove only comments whose submitted contents are still unchanged. */
function withoutSubmitted(draft: FeedbackDraft, submitted: FeedbackDraft) {
	const next = {
		...draft,
		feedback: draft.feedback === submitted.feedback ? "" : draft.feedback,
		items: draft.items.filter(
			(item) =>
				!submitted.items.some(
					(sent) =>
						sent.text === item.text &&
						JSON.stringify(sent.target) === JSON.stringify(item.target),
				),
		),
	};
	return next.feedback || next.items.length ? next : emptyFeedback();
}

// Only pending request identities cross route remounts; no editable content does.
const pending = new Map<string, symbol>();
const listeners = new Set<() => void>();
const changed = () => {
	for (const listener of listeners) listener();
};
class FeedbackSession {
	private state: { draft: FeedbackDraft; busy: boolean };
	private token?: symbol;
	constructor(private key: string) {
		this.state = { draft: emptyFeedback(), busy: pending.has(key) };
	}
	getSnapshot = () => {
		const busy = pending.has(this.key);
		if (busy !== this.state.busy) this.state = { ...this.state, busy };
		return this.state;
	};
	subscribe = (listener: () => void) => {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	};
	private publish(draft: FeedbackDraft) {
		this.state = { draft, busy: pending.has(this.key) };
		changed();
	}
	update = (change: (draft: FeedbackDraft) => FeedbackDraft) => {
		if (!pending.has(this.key)) this.publish(change(this.state.draft));
	};
	lock = () => {
		if (pending.has(this.key)) return false;
		this.token = Symbol(this.key);
		pending.set(this.key, this.token);
		changed();
		return true;
	};
	unlock = () => {
		if (!this.token || pending.get(this.key) !== this.token) return;
		pending.delete(this.key);
		this.token = undefined;
		changed();
	};
	clear = (submitted: FeedbackDraft) => {
		this.publish(withoutSubmitted(this.state.draft, submitted));
	};
}
export function feedbackSession(key: string) {
	return new FeedbackSession(key);
}
