import {
	createContext,
	type PointerEvent,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { type FeedbackTarget, orderedComments } from "./review-feedback";
import { feedbackSession } from "./review-feedback-session";
import { Button } from "./ui";

export function useFeedbackController(key: string) {
	const session = useMemo(() => feedbackSession(key), [key]);
	const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
	return {
		...state,
		update: session.update,
		lock: session.lock,
		unlock: session.unlock,
		clear: session.clear,
	};
}
export type FeedbackController = ReturnType<typeof useFeedbackController>;
export const FeedbackContext = createContext<FeedbackController | null>(null);
export const useReviewFeedback = () => useContext(FeedbackContext);

// A hold must not fire after a scroll/drag or on a nested annotation target.
export function Commentable({
	target,
	children,
}: {
	target: FeedbackTarget;
	children: ReactNode;
}) {
	const controller = useReviewFeedback(),
		id = useId();
	const box = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const editor = useRef<HTMLTextAreaElement>(null);
	const popover = useRef<HTMLDivElement>(null);
	const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const origin = useRef<{ x: number; y: number } | undefined>(undefined);
	const held = useRef(false);
	const editing = controller?.draft.editing === target.path;
	const busy = controller?.busy;
	const cancelHold = useCallback(() => {
		clearTimeout(hold.current);
		hold.current = undefined;
	}, []);
	useEffect(() => {
		if (busy) cancelHold();
		window.addEventListener("scroll", cancelHold, true);
		return () => {
			cancelHold();
			window.removeEventListener("scroll", cancelHold, true);
		};
	}, [busy, cancelHold]);
	useLayoutEffect(() => {
		if (!editing || !popover.current || !box.current) return;
		const panel = popover.current;
		// Manual dismissal keeps releasing the original hold from closing the panel.
		panel.showPopover();
		const place = () => {
			const rect = box.current!.getBoundingClientRect();
			const viewport = window.visualViewport;
			const left = viewport?.offsetLeft ?? 0,
				top = viewport?.offsetTop ?? 0;
			const width = viewport?.width ?? window.innerWidth;
			const height = viewport?.height ?? window.innerHeight;
			panel.style.maxHeight = `${height - 24}px`;
			panel.style.maxWidth = `${width - 24}px`;
			panel.style.left = `${Math.max(left + 12, Math.min(rect.right - panel.offsetWidth, left + width - panel.offsetWidth - 12))}px`;
			panel.style.top = `${Math.max(top + 12, Math.min(rect.bottom + 8, top + height - panel.offsetHeight - 12))}px`;
		};
		place();
		const observer = new ResizeObserver(place);
		observer.observe(panel);
		editor.current?.focus({ preventScroll: true });
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		window.visualViewport?.addEventListener("resize", place);
		window.visualViewport?.addEventListener("scroll", place);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
			window.visualViewport?.removeEventListener("resize", place);
			window.visualViewport?.removeEventListener("scroll", place);
		};
	}, [editing]);
	const updateDraft = controller?.update;
	useEffect(() => {
		if (!editing || !updateDraft) return;
		const dismiss = () =>
			updateDraft((d) => ({
				...d,
				editing: d.editing === target.path ? undefined : d.editing,
			}));
		const outside = (event: globalThis.PointerEvent) => {
			if (
				!popover.current?.contains(event.target as Node) &&
				!trigger.current?.contains(event.target as Node)
			)
				dismiss();
		};
		const onEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || busy) return;
			event.preventDefault();
			dismiss();
			trigger.current?.focus({ preventScroll: true });
		};
		document.addEventListener("pointerdown", outside, true);
		document.addEventListener("keydown", onEscape);
		return () => {
			document.removeEventListener("pointerdown", outside, true);
			document.removeEventListener("keydown", onEscape);
		};
	}, [editing, busy, updateDraft, target.path]);

	if (!controller) return <>{children}</>;
	const { draft, update } = controller;
	const item = draft.items.find((i) => i.target.path === target.path);
	const open = () => update((d) => ({ ...d, editing: target.path }));
	const close = () => {
		update((d) => ({
			...d,
			editing: d.editing === target.path ? undefined : d.editing,
		}));
		trigger.current?.focus({ preventScroll: true });
	};
	const startHold = (event: PointerEvent<HTMLDivElement>) => {
		cancelHold();
		held.current = false;
		if (busy || !event.isPrimary || event.button !== 0) return;
		const node = event.target as HTMLElement;
		if (
			node.closest("[data-comment-path]") !== event.currentTarget ||
			node.closest("input, textarea, select, [data-comment-trigger]")
		)
			return;
		origin.current = { x: event.clientX, y: event.clientY };
		hold.current = setTimeout(() => {
			held.current = true;
			window.getSelection()?.removeAllRanges();
			open();
		}, 550);
	};
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: hold is an alternative gesture; the adjacent button supplies keyboard and screen-reader access.
		<div
			ref={box}
			className={`commentable ${editing ? "comment-selected" : ""} ${item?.text.trim() ? "commented" : ""}`}
			data-comment-path={target.path}
			onPointerDown={startHold}
			onPointerMove={(event) => {
				if (
					origin.current &&
					Math.hypot(
						event.clientX - origin.current.x,
						event.clientY - origin.current.y,
					) > 8
				)
					cancelHold();
			}}
			onPointerUp={() => {
				cancelHold();
				if (held.current)
					requestAnimationFrame(() =>
						editor.current?.focus({ preventScroll: true }),
					);
			}}
			onPointerCancel={cancelHold}
			onPointerLeave={cancelHold}
			onContextMenu={(event) => {
				if (hold.current || held.current) event.preventDefault();
			}}
			onClickCapture={(event) => {
				if (
					event.detail === 0 ||
					!held.current ||
					!box.current?.contains(event.target as Node)
				)
					return;
				held.current = false;
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			{children}
			<button
				type="button"
				ref={trigger}
				data-comment-trigger
				className={`comment-trigger ${item?.text.trim() ? "has-comment" : ""}`}
				disabled={busy}
				aria-label={`${item?.text.trim() ? "Edit" : "Add"} comment: ${target.label}`}
				aria-haspopup="dialog"
				aria-expanded={editing}
				aria-controls={editing ? `${id}-popover` : undefined}
				onClick={open}
			>
				<span className="comment-marker">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.8"
						aria-hidden="true"
					>
						<path d="M20 11.5a8 8 0 0 1-8 8H4l-1 2v-10a8 8 0 0 1 17 0Z" />
					</svg>
					{item?.text.trim() && <span>1</span>}
				</span>
			</button>
			{editing &&
				createPortal(
					<div
						id={`${id}-popover`}
						ref={popover}
						popover="manual"
						role="dialog"
						aria-labelledby={`${id}-title`}
						className="comment-popover"
					>
						<header>
							<div>
								<strong id={`${id}-title`}>Comment</strong>
								<small>{target.label}</small>
							</div>
							<Button
								variant="ghost"
								disabled={busy}
								aria-label="Close comment"
								onClick={close}
							>
								×
							</Button>
						</header>
						<label className="sr-only" htmlFor={id}>
							Comment on {target.label}
						</label>
						<textarea
							id={id}
							ref={editor}
							rows={4}
							disabled={busy}
							placeholder="What should change?"
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
						<footer>
							{item && (
								<Button
									variant="ghost"
									disabled={busy}
									onClick={() => {
										update((d) => ({
											...d,
											items: d.items.filter(
												(i) => i.target.path !== target.path,
											),
											editing: undefined,
										}));
										trigger.current?.focus({ preventScroll: true });
									}}
								>
									Remove
								</Button>
							)}
							<span className="muted">Saved as draft</span>
							<Button variant="secondary" disabled={busy} onClick={close}>
								Done
							</Button>
						</footer>
					</div>,
					document.body,
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
				<p>No comments yet. Hold an item or use its comment button.</p>
			)}
			{items.map(({ target, text }) => (
				<section className="collected-comment" key={target.path}>
					<strong>
						{target.pageTitle} · {target.label}
					</strong>
					<p className="collected-comment-text">{text || "Empty draft"}</p>
					<div className="actions">
						<Button
							variant="secondary"
							disabled={busy}
							onClick={() => go(target)}
						>
							Edit comment
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
