import {
	emptyFeedback,
	type FeedbackDraft,
	loadFeedback,
	normalizeFeedback,
	saveFeedback,
} from "./review-feedback";
import { readStored } from "./review-state";

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

// A request can outlive its route. Remounts must share the same lock and state
// until it settles; do not persist locks across reloads, which cancel requests.
const pending = new Map<string, FeedbackSession>();
class FeedbackSession {
	private state: { draft: FeedbackDraft; busy: boolean };
	private listeners = new Set<() => void>();
	constructor(private key: string) {
		this.state = { draft: loadFeedback(key), busy: false };
	}
	getSnapshot = () => this.state;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
	private publish(draft: FeedbackDraft, busy = this.state.busy) {
		this.state = { draft, busy };
		for (const listener of this.listeners) listener();
	}
	update = (change: (draft: FeedbackDraft) => FeedbackDraft) => {
		if (this.state.busy || pending.has(this.key)) return;
		const next = change(this.state.draft);
		saveFeedback(this.key, next);
		this.publish(next);
	};
	lock = () => {
		if (this.state.busy || pending.has(this.key)) return false;
		pending.set(this.key, this);
		this.publish(this.state.draft, true);
		return true;
	};
	unlock = () => {
		if (pending.get(this.key) !== this) return;
		pending.delete(this.key);
		this.publish(this.state.draft, false);
	};
	clear = (submitted: FeedbackDraft) => {
		// Another tab can change storage while this request is in flight. Preserve
		// those edits too, falling back to memory when storage is unavailable.
		const stored = readStored<unknown>(this.key, null);
		const current =
			stored === null ? this.state.draft : normalizeFeedback(stored);
		const next = withoutSubmitted(current, submitted);
		saveFeedback(this.key, next);
		this.publish(next);
	};
}

export function feedbackSession(key: string) {
	return pending.get(key) ?? new FeedbackSession(key);
}
