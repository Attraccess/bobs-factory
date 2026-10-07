import { type HTMLMotionProps, motion } from "motion/react";
import type { ReactNode } from "react";

/** Public asset URL that respects the deploy base path (GitHub Pages serves under /bobs-factory/). */
export const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

export const ease = [0.22, 1, 0.36, 1] as const;

export function Reveal({
	children,
	delay = 0,
	y = 28,
	...rest
}: {
	children: ReactNode;
	delay?: number;
	y?: number;
} & HTMLMotionProps<"div">) {
	return (
		<motion.div
			initial={{ opacity: 0, y }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, margin: "-80px" }}
			transition={{ duration: 0.8, ease, delay }}
			{...rest}
		>
			{children}
		</motion.div>
	);
}

export function Eyebrow({
	children,
	color = "#7b61ff",
	dark = false,
}: {
	children: ReactNode;
	color?: string;
	dark?: boolean;
}) {
	return (
		<span
			className={`inline-flex items-center gap-2 rounded-full border border-current/20 ${dark ? "bg-white/5" : "bg-white/60"} px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] backdrop-blur`}
			style={{ color }}
		>
			<span className="size-1.5 rounded-full bg-current" />
			{children}
		</span>
	);
}

export function SectionTitle({
	eyebrow,
	title,
	children,
	color,
	center = false,
	dark = false,
}: {
	eyebrow: string;
	title: ReactNode;
	children?: ReactNode;
	color?: string;
	center?: boolean;
	dark?: boolean;
}) {
	return (
		<Reveal className={`max-w-3xl ${center ? "mx-auto text-center" : ""}`}>
			<Eyebrow color={color} dark={dark}>
				{eyebrow}
			</Eyebrow>
			<h2
				className={`mt-5 font-display text-4xl font-bold leading-[1.02] tracking-[-0.035em] sm:text-6xl ${dark ? "text-white" : "text-ink"}`}
			>
				{title}
			</h2>
			{children && (
				<p
					className={`mt-5 text-lg leading-relaxed sm:text-xl ${dark ? "text-white/70" : "text-ink-2"}`}
				>
					{children}
				</p>
			)}
		</Reveal>
	);
}

/** Real product screenshot, served as WebP. */
export function Shot({
	name,
	alt,
	className = "",
	eager = false,
}: {
	name: string;
	alt: string;
	className?: string;
	eager?: boolean;
}) {
	return (
		<img
			src={asset(`shots/${name}.webp`)}
			alt={alt}
			loading={eager ? "eager" : "lazy"}
			decoding="async"
			className={`block w-full ${className}`}
		/>
	);
}

export function BrowserFrame({
	children,
	url = "127.0.0.1:3457",
	className = "",
	dark = false,
}: {
	children: ReactNode;
	url?: string;
	className?: string;
	dark?: boolean;
}) {
	return (
		<div
			className={`overflow-hidden rounded-[22px] border shadow-[0_40px_100px_-30px_#39245a55,0_8px_24px_-8px_#39245a22] ${dark ? "border-white/10 bg-night-2" : "border-line bg-white"} ${className}`}
		>
			<div
				className={`flex items-center gap-3 border-b px-4 py-3 ${dark ? "border-white/10 bg-night" : "border-line bg-[#fbf7ff]"}`}
			>
				<div className="flex gap-1.5">
					<span className="size-3 rounded-full bg-[#ff5d73]" />
					<span className="size-3 rounded-full bg-[#ffd23f]" />
					<span className="size-3 rounded-full bg-[#3ddc97]" />
				</div>
				<div
					className={`mx-auto flex min-w-0 max-w-sm flex-1 items-center justify-center gap-2 rounded-full px-4 py-1 font-mono text-[11px] ${dark ? "bg-white/5 text-white/50" : "bg-white text-muted"}`}
				>
					<svg
						width="10"
						height="10"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="3"
						aria-hidden="true"
					>
						<rect x="4" y="11" width="16" height="10" rx="2" />
						<path d="M8 11V7a4 4 0 0 1 8 0v4" />
					</svg>
					<span className="truncate">{url}</span>
				</div>
				<div className="w-[52px]" />
			</div>
			{children}
		</div>
	);
}

export function Phone({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={`relative rounded-[46px] border-[10px] border-[#1b1530] bg-[#1b1530] shadow-[0_40px_80px_-24px_#2b234677] ${className}`}
		>
			<div className="absolute left-1/2 top-2 z-10 h-6 w-24 -translate-x-1/2 rounded-full bg-[#1b1530]" />
			<div className="overflow-hidden rounded-[36px]">{children}</div>
		</div>
	);
}

export function Video({
	name,
	className = "",
	label,
}: {
	name: string;
	className?: string;
	label: string;
}) {
	return (
		<video
			className={`block w-full ${className}`}
			autoPlay
			muted
			loop
			playsInline
			preload="metadata"
			poster={asset(`video/${name}.jpg`)}
			aria-label={label}
		>
			<source src={asset(`video/${name}.webm`)} type="video/webm" />
			<source src={asset(`video/${name}.mp4`)} type="video/mp4" />
		</video>
	);
}
