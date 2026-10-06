// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the scrollable log must receive keyboard focus
export { Bob } from "./bob";

import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { updateApp, usePwa } from "./pwa";
export type ToastData = {
	text: string;
	action?: string;
	onAction?: () => void;
};
export const ToastContext = createContext<(data: ToastData) => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
	const [toast, setToast] = useState<ToastData>();
	useEffect(() => {
		if (!toast) return;
		const timer = setTimeout(
			() => setToast(undefined),
			toast.action ? 6000 : 2600,
		);
		return () => clearTimeout(timer);
	}, [toast]);
	return (
		<ToastContext.Provider value={setToast}>
			{children}
			{toast && (
				<div className="toast" role="status">
					{toast.text}
					{toast.action && (
						<button
							type="button"
							onClick={() => {
								toast.onAction?.();
								setToast(undefined);
							}}
						>
							{toast.action}
						</button>
					)}
				</div>
			)}
		</ToastContext.Provider>
	);
}
export function Button({
	children,
	busy = false,
	variant = "primary",
	requiresConnection = false,
	...props
}: any) {
	const connection = usePwa();
	return (
		<button
			type="button"
			{...props}
			disabled={
				props.disabled ||
				busy ||
				(requiresConnection &&
					(connection.status !== "ready" || connection.updating))
			}
			className={`button ${variant} ${props.className ?? ""}`}
			aria-busy={busy || undefined}
		>
			{busy && <span className="spinner" />}
			{children}
		</button>
	);
}
export function External({ href, children, ...props }: any) {
	if (!/^https?:\/\//.test(href ?? "")) return <span>{children}</span>;
	return (
		<a {...props} href={href} target="_blank" rel="noopener noreferrer">
			{children}
			<span className="sr-only"> (opens in a new tab)</span>
		</a>
	);
}
export function Markdown({ children }: { children?: string }) {
	const [page, setPage] = useState(0);
	const text = String(children ?? "").replace(/<!--[\s\S]*?-->/g, "");
	const pages = Math.max(1, Math.ceil(text.length / 12000));
	const current = Math.min(page, pages - 1);
	return (
		<div className="markdown">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					a: ({ href, children }) => (
						<External href={href}>{children}</External>
					),
				}}
			>
				{text.slice(current * 12000, (current + 1) * 12000)}
			</ReactMarkdown>
			{pages > 1 && (
				<nav
					className="actions document-pages"
					aria-label="Long document pages"
				>
					<Button
						variant="ghost"
						disabled={current === 0}
						onClick={() => setPage(current - 1)}
					>
						← Previous
					</Button>
					<span>
						{current + 1} of {pages} pages
					</span>
					<Button
						variant="ghost"
						disabled={current === pages - 1}
						onClick={() => setPage(current + 1)}
					>
						Next →
					</Button>
				</nav>
			)}
		</div>
	);
}
export function Modal({
	open,
	onOpenChange,
	title,
	description,
	children,
	className = "",
	onKeyDown,
}: {
	open: boolean;
	onOpenChange: (value: boolean) => void;
	title: ReactNode;
	description?: string;
	children: ReactNode;
	className?: string;
	onKeyDown?: any;
}) {
	const returnFocus = useRef<HTMLElement | null>(null);
	const pwa = usePwa(),
		cache = useQueryClient();

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="modal-overlay" />
				<Dialog.Content
					className={`modal ${className}`}
					inert={pwa.updating}
					onKeyDown={onKeyDown}
					onOpenAutoFocus={() => {
						returnFocus.current = document.activeElement as HTMLElement;
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						returnFocus.current?.focus();
					}}
				>
					<header className="modal-header">
						<div>
							<Dialog.Title>{title}</Dialog.Title>
							<Dialog.Description className={description ? "muted" : "sr-only"}>
								{description ?? "Details"}
							</Dialog.Description>
						</div>
						{(pwa.waiting || pwa.status === "mismatch") && (
							<Button
								busy={pwa.updating}
								onClick={() => void updateApp(() => cache.isMutating())}
							>
								Update app
							</Button>
						)}
						<Dialog.Close asChild>
							<Button variant="icon" aria-label="Close dialog">
								×
							</Button>
						</Dialog.Close>
					</header>
					{children}
					{(pwa.updateError || pwa.error) && (
						<p role="alert" className="connection-error">
							{pwa.updateError ?? pwa.error}
						</p>
					)}
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
export function ConfirmStop({
	onStop,
	busy,
	requiresConnection,
}: {
	onStop: () => void;
	busy?: boolean;
	requiresConnection?: boolean;
}) {
	const [confirm, setConfirm] = useState(false);
	useEffect(() => {
		if (!confirm) return;
		const timer = setTimeout(() => setConfirm(false), 4000);
		return () => clearTimeout(timer);
	}, [confirm]);
	return (
		<Button
			requiresConnection={requiresConnection}
			variant={confirm ? "danger" : "ghost"}
			busy={busy}
			onClick={() => (confirm ? onStop() : setConfirm(true))}
		>
			{confirm ? "Really stop?" : "■ Stop"}
		</Button>
	);
}
export function FollowLatest({
	children,
	version,
}: {
	children: ReactNode;
	version: unknown;
}) {
	const box = useRef<HTMLDivElement>(null),
		following = useRef(true),
		position = useRef(0);
	const [behind, setBehind] = useState(false);
	useEffect(() => {
		void version; // Refresh follow position after streamed content changes.
		const element = box.current!;
		const update = () => {
			if (!element.getClientRects().length) return;
			if (!following.current) element.scrollTop = position.current;
			if (following.current) element.scrollTop = element.scrollHeight;
			setBehind(
				element.scrollHeight - element.clientHeight - element.scrollTop > 8,
			);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element.firstElementChild!);
		return () => observer.disconnect();
	}, [version]);
	return (
		<div className="conversation-wrap">
			<div
				className="conversation-scroll"
				role="log"
				tabIndex={0}
				ref={box}
				aria-label="Conversation activity"
				onWheel={(event) => {
					if (event.deltaY < 0) following.current = false;
				}}
				onScroll={() => {
					const element = box.current!;
					if (!element.getClientRects().length) return;
					position.current = element.scrollTop;
					following.current =
						element.scrollHeight - element.clientHeight - element.scrollTop <=
						8;
					setBehind(!following.current);
				}}
			>
				<div>{children}</div>
			</div>
			{behind && (
				<Button
					variant="secondary"
					className="latest-button"
					onClick={() => {
						following.current = true;
						box.current!.scrollTop = box.current!.scrollHeight;
						setBehind(false);
					}}
				>
					↓ Scroll to latest
				</Button>
			)}
		</div>
	);
}
