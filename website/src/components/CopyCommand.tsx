import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

export function CopyCommand({
	command,
	label = command,
	dark = false,
	disabled = false,
}: {
	command: string;
	label?: string;
	dark?: boolean;
	disabled?: boolean;
}) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={async () => {
				await navigator.clipboard?.writeText(command).catch(() => {});
				setCopied(true);
				setTimeout(() => setCopied(false), 1600);
			}}
			className={`group flex max-w-full items-center gap-3 whitespace-nowrap rounded-2xl border px-4 py-4 font-mono text-xs sm:px-5 sm:text-sm transition enabled:hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 ${dark ? "border-white/15 bg-white/5 text-white/90" : "border-line bg-white/80 text-ink shadow-sm backdrop-blur"}`}
			aria-label={`Copy command: ${label}`}
		>
			<span className="text-r6">$</span>
			<span className="min-w-0 whitespace-normal text-left [overflow-wrap:anywhere]">
				{label}
			</span>
			<span className="relative ml-1 inline-flex w-14 shrink-0 justify-end text-xs font-bold text-muted">
				<AnimatePresence mode="wait" initial={false}>
					<motion.span
						key={copied ? "y" : "n"}
						initial={{ y: 8, opacity: 0 }}
						animate={{ y: 0, opacity: 1 }}
						exit={{ y: -8, opacity: 0 }}
						className={copied ? "text-r4" : ""}
					>
						{copied ? "copied!" : "copy"}
					</motion.span>
				</AnimatePresence>
			</span>
		</button>
	);
}
