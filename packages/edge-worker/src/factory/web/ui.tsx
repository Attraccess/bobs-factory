// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the scrollable log must receive keyboard focus
import * as Dialog from "@radix-ui/react-dialog";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
	...props
}: any) {
	return (
		<button
			type="button"
			{...props}
			disabled={props.disabled || busy}
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

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="modal-overlay" />
				<Dialog.Content
					className={`modal ${className}`}
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
						<Dialog.Close asChild>
							<Button variant="icon" aria-label="Close dialog">
								×
							</Button>
						</Dialog.Close>
					</header>
					{children}
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
export function Bob({
	mood = "happy",
	size = 36,
}: {
	mood?: string;
	size?: number;
}) {
	const id = useId().replace(/:/g, "");
	const sleepy = mood === "sleepy",
		worried = mood === "oops",
		alert = mood === "alert";
	return (
		<svg
			role="img"
			aria-label={`Bob, ${mood}`}
			className={`bob bob-${mood}`}
			width={size}
			height={size}
			viewBox="0 0 100 108"
		>
			<defs>
				<linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
					<stop stopColor="#ff5d73" />
					<stop offset=".2" stopColor="#ff9f43" />
					<stop offset=".4" stopColor="#ffd23f" />
					<stop offset=".55" stopColor="#3ddc97" />
					<stop offset=".7" stopColor="#4cc9f0" />
					<stop offset=".85" stopColor="#7b61ff" />
					<stop offset="1" stopColor="#c77dff" />
				</linearGradient>
			</defs>
			<g fill={`url(#${id})`} stroke="#ffedfa" strokeWidth="1.3">
				<path d="M25 23Q12 5 23 3Q34 8 36 23M67 23Q66 6 79 3Q88 12 78 29" />
				<path d="M17 37l-7 6 3 7-7 6 6 7-2 9 8 6 1 9 9 2 5 9 10-2 9 6 8-7 10 2 4-9 10-3-1-10 8-5-4-9 6-7-6-6 2-8-8-4-4-9-10 1-6-8-9 4-9-4-6 7-10-1z" />
				<ellipse cx="28" cy="99" rx="11" ry="6" />
				<ellipse cx="70" cy="99" rx="11" ry="6" />
				<ellipse
					cx="9"
					cy={alert ? 43 : 68}
					rx="7"
					ry="12"
					transform={alert ? "rotate(-25 9 43)" : ""}
				/>
				<ellipse cx="91" cy="67" rx="7" ry="12" />
			</g>
			<g className="bob-eyes">
				{sleepy ? (
					<path
						d="M22 48q10 12 23 0M54 48q11 12 23 0"
						fill="none"
						stroke="#2b2346"
						strokeWidth="4"
					/>
				) : (
					<>
						<ellipse cx="33" cy="47" rx="19" ry="22" fill="white" />
						<ellipse cx="67" cy="47" rx="19" ry="22" fill="white" />
						{[33, 67].map((x) => (
							<g key={x}>
								<ellipse
									cx={x + (mood === "busy" ? 5 : 0)}
									cy={alert ? 41 : 47}
									rx={worried ? 8 : 12}
									ry={worried ? 10 : 15}
									fill="#2b2346"
								/>
								<circle cx={x - 4} cy="40" r="5" fill="white" />
								<circle cx={x + 5} cy="51" r="2.5" fill="white" />
							</g>
						))}
					</>
				)}
			</g>
			<ellipse cx="21" cy="72" rx="7" ry="4" fill="#ff7a9a" />
			<ellipse cx="79" cy="72" rx="7" ry="4" fill="#ff7a9a" />
			{alert ? (
				<ellipse cx="50" cy="76" rx="5" ry="7" fill="#2b2346" />
			) : (
				<path
					d={
						worried
							? "M40 81q5-9 10-2t10 0"
							: mood === "party"
								? "M38 72q12 24 24 0z"
								: "M40 75q10 12 20 0"
					}
					fill={mood === "party" ? "#2b2346" : "none"}
					stroke="#2b2346"
					strokeWidth="3"
					strokeLinecap="round"
				/>
			)}
			{sleepy && (
				<text x="78" y="16" fill="#7b61ff" fontSize="13">
					z z
				</text>
			)}
			{mood === "party" && (
				<g fill="#ff9f43">
					<text x="2" y="20">
						✦
					</text>
					<text x="84" y="23">
						✧
					</text>
				</g>
			)}
		</svg>
	);
}
export function ConfirmStop({
	onStop,
	busy,
}: {
	onStop: () => void;
	busy?: boolean;
}) {
	const [confirm, setConfirm] = useState(false);
	useEffect(() => {
		if (!confirm) return;
		const timer = setTimeout(() => setConfirm(false), 4000);
		return () => clearTimeout(timer);
	}, [confirm]);
	return (
		<Button
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
