import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import {
	emptyFeedback,
	type FeedbackDraft,
	type FeedbackTarget,
	loadFeedback,
	orderedComments,
	saveFeedback,
} from "./review-feedback";
import { Button } from "./ui";

export function useFeedbackController(key: string) {
	const [draft, setDraft] = useState(() => loadFeedback(key));
	const [busy, setBusy] = useState(false);
	const locked = useRef(false);
	const update = (change: (d: FeedbackDraft) => FeedbackDraft) => {
		if (locked.current) return;
		setDraft((d) => {
			const next = change(d);
			saveFeedback(key, next);
			return next;
		});
	};
	return {
		draft,
		busy,
		update,
		lock: () => {
			if (locked.current) return false;
			locked.current = true;
			setBusy(true);
			return true;
		},
		unlock: () => {
			locked.current = false;
			setBusy(false);
		},
		clear: () => {
			const next = emptyFeedback();
			saveFeedback(key, next);
			setDraft(next);
		},
	};
}
export type FeedbackController = ReturnType<typeof useFeedbackController>;
export const FeedbackContext = createContext<FeedbackController | null>(null);
export const useReviewFeedback = () => useContext(FeedbackContext);

export function Commentable({
	target,
	children,
}: {
	target: FeedbackTarget;
	children: ReactNode;
}) {
	const controller = useReviewFeedback(),
		id = useId();
	const editor = useRef<HTMLTextAreaElement>(null);
	const isEditing = controller?.draft.editing === target.path;
	useEffect(() => {
		if (isEditing) editor.current?.focus();
	}, [isEditing]);
	if (!controller) return <>{children}</>;
	const { draft, update, busy } = controller;
	const item = draft.items.find((i) => i.target.path === target.path);
	const editing = draft.editing === target.path;
	return (
		<div
			className={`commentable ${editing ? "comment-selected" : ""}`}
			data-comment-path={target.path}
		>
			{children}
			<div className="item-comment-actions">
				<Button
					variant="ghost"
					disabled={busy}
					aria-label={`${item?.text.trim() ? "Edit" : "Add"} comment: ${target.label}`}
					aria-expanded={editing}
					onClick={() =>
						update((d) => ({
							...d,
							editing: editing ? undefined : target.path,
						}))
					}
				>
					{editing
						? "Close editor"
						: item?.text.trim()
							? "Edit comment · draft"
							: "Add comment"}
				</Button>
				{item && (
					<Button
						variant="ghost"
						disabled={busy}
						aria-label={`Remove comment: ${target.label}`}
						onClick={() =>
							update((d) => ({
								...d,
								items: d.items.filter((i) => i.target.path !== target.path),
								editing: undefined,
							}))
						}
					>
						Remove
					</Button>
				)}
			</div>
			{editing && (
				<label className="item-comment-editor" htmlFor={id}>
					Comment on {target.label}{" "}
					<span className="muted">· draft, sent only when you submit</span>
					<textarea
						id={id}
						ref={editor}
						rows={3}
						disabled={busy}
						value={item?.text ?? ""}
						onChange={(e) => {
							const text = e.target.value;
							update((d) => ({
								...d,
								items: [
									...d.items.filter((i) => i.target.path !== target.path),
									{ target, text },
								],
							}));
						}}
					/>
				</label>
			)}
			{!editing && item?.text.trim() && (
				<p className="item-comment-preview">{item.text}</p>
			)}
		</div>
	);
}

export function CollectedFeedback({
	go,
}: {
	go: (target: FeedbackTarget) => void;
}) {
	const controller = useReviewFeedback();
	if (!controller) return null;
	const { draft, update, busy } = controller,
		items = orderedComments(draft, true);
	return (
		<details
			className="collected-feedback"
			open={draft.collectedOpen ?? false}
			onToggle={(e) => {
				const open = e.currentTarget.open;
				if (draft.collectedOpen !== open)
					update((d) => ({ ...d, collectedOpen: open }));
			}}
		>
			<summary>
				Collected feedback · {items.filter((i) => i.text.trim()).length} item{" "}
				{items.length === 1 ? "comment" : "comments"}
				{draft.feedback.trim() ? " + additional feedback" : ""}
			</summary>
			<p className="muted">
				Drafts stay here as you read. Submit them together when you’re ready.
			</p>
			{!items.length && (
				<p>No item comments yet. Use Add comment beside any guide item.</p>
			)}
			{items.map(({ target, text }) => (
				<section className="collected-comment" key={target.path}>
					<strong>
						{target.pageTitle} · {target.label}
					</strong>
					<small>{target.path}</small>
					<label>
						Comment on {target.label}
						<textarea
							rows={3}
							disabled={busy}
							value={text}
							onChange={(e) => {
								const text = e.target.value;
								update((d) => ({
									...d,
									items: d.items.map((i) =>
										i.target.path === target.path ? { ...i, text } : i,
									),
								}));
							}}
						/>
					</label>
					<div className="actions">
						<Button variant="secondary" onClick={() => go(target)}>
							Go to item
						</Button>
						<Button
							variant="ghost"
							disabled={busy}
							onClick={() =>
								update((d) => ({
									...d,
									items: d.items.filter((i) => i.target.path !== target.path),
								}))
							}
						>
							Remove comment
						</Button>
					</div>
				</section>
			))}
		</details>
	);
}
