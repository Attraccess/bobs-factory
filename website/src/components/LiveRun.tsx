import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Bob } from "./Bob";
import { BrowserFrame, Reveal, SectionTitle, Video } from "./ui";

// The same beats the demo agent streamed into the recorded run.
const beats = [
	{
		kind: "think",
		text: "Start with a baseline so the improvement is measurable.",
	},
	{
		kind: "tool",
		tool: "Bash",
		text: "pnpm autocannon -c 50 -d 20 /checkout",
		out: "p50 182 ms · p95 612 ms · p99 940 ms",
	},
	{
		kind: "tool",
		tool: "Read",
		text: "src/api/checkout.ts",
		out: "for (const item of cart.items) { … findMany(…) }",
	},
	{
		kind: "say",
		text: "Found it: one topping query per cart item (N+1). Batching into a single IN query.",
	},
	{
		kind: "tool",
		tool: "Edit",
		text: "src/api/checkout.ts",
		out: "+ findMany({ where: { stackId: { in: ids } } })",
	},
	{
		kind: "tool",
		tool: "Edit",
		text: "src/api/tax.ts",
		out: "+ memoize(loadTaxTable, { ttl: 300_000 })",
	},
	{
		kind: "tool",
		tool: "Bash",
		text: "pnpm test src/api",
		out: "Tests  38 passed (38)",
	},
	{
		kind: "tool",
		tool: "Bash",
		text: "pnpm autocannon -c 50 -d 20 /checkout",
		out: "p50 41 ms · p95 118 ms · p99 203 ms",
	},
	{
		kind: "say",
		text: "p95 dropped from 612 ms to 118 ms. Adding a CI perf budget so it stays there.",
	},
] as const;

const toolColor: Record<string, string> = {
	Bash: "#ffd23f",
	Read: "#4cc9f0",
	Edit: "#3ddc97",
};

function Stream() {
	const ref = useRef<HTMLDivElement>(null);
	const inView = useInView(ref, { margin: "-120px" });
	const [count, setCount] = useState(0);
	useEffect(() => {
		if (!inView) return;
		const timer = setInterval(
			() => setCount((value) => (value >= beats.length + 3 ? 0 : value + 1)),
			1300,
		);
		return () => clearInterval(timer);
	}, [inView]);
	const shown = beats.slice(0, Math.min(count, beats.length));
	return (
		<div
			ref={ref}
			className="relative h-[460px] overflow-hidden rounded-[22px] border border-white/10 bg-[#0f0b1f] p-5 font-mono text-[13px] shadow-[0_30px_80px_-30px_#000]"
		>
			<div className="mb-4 flex items-center justify-between text-xs text-white/40">
				<span>run · Speed up checkout API p95 · implement</span>
				<span className="flex items-center gap-2 text-[#86dcf7]">
					<span className="size-2 animate-pulse rounded-full bg-[#4cc9f0]" />
					streaming
				</span>
			</div>
			<div
				className="flex flex-col justify-end gap-3"
				style={{ minHeight: 380 }}
			>
				<AnimatePresence initial={false}>
					{shown.map((beat, index) => (
						<motion.div
							key={index}
							layout
							initial={{ opacity: 0, y: 16, filter: "blur(4px)" }}
							animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.4 }}
						>
							{beat.kind === "tool" ? (
								<div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
									<div className="flex items-center gap-2">
										<span
											className="rounded px-1.5 py-0.5 text-[11px] font-bold text-night"
											style={{ background: toolColor[beat.tool] }}
										>
											{beat.tool}
										</span>
										<span className="truncate text-white/80">{beat.text}</span>
										<span className="ml-auto text-[#3ddc97]">✓</span>
									</div>
									<div className="mt-1 truncate pl-1 text-white/40">
										↳ {beat.out}
									</div>
								</div>
							) : (
								<div
									className={
										beat.kind === "think"
											? "italic text-white/50"
											: "text-white"
									}
								>
									{beat.kind === "think" ? "✻ " : "● "}
									{beat.text}
								</div>
							)}
						</motion.div>
					))}
				</AnimatePresence>
				{count < beats.length && <div className="blink-caret text-white/30" />}
			</div>
			<div className="pointer-events-none absolute inset-x-0 top-10 h-24 bg-gradient-to-b from-[#0f0b1f] to-transparent" />
		</div>
	);
}

export function LiveRun() {
	return (
		<section className="relative overflow-hidden bg-night py-28 text-white sm:py-36">
			<div aria-hidden className="pointer-events-none absolute inset-0">
				<div className="absolute -right-40 top-0 size-[40rem] rounded-full bg-[#7b61ff]/20 blur-[140px]" />
				<div className="absolute -left-40 bottom-0 size-[36rem] rounded-full bg-[#4cc9f0]/15 blur-[140px]" />
			</div>
			<div className="relative mx-auto max-w-6xl px-6">
				<div className="flex flex-col items-start justify-between gap-10 lg:flex-row lg:items-end">
					<SectionTitle
						dark
						eyebrow="Glass-box agents"
						color="#86dcf7"
						title={
							<>
								Watch him work.
								<br />
								<span className="rainbow-text">Nudge him mid-flight.</span>
							</>
						}
					>
						Every thought and tool call streams into the run timeline. Tool
						calls collapse into tidy summaries, CI polling becomes one status,
						and <strong className="text-white">Message Bob</strong> lets you
						steer the agent while it works — or resume the same conversation
						after it's done.
					</SectionTitle>
					<Reveal className="hidden shrink-0 lg:block">
						<Bob mood="busy" size={110} />
					</Reveal>
				</div>
				<div className="mt-16 grid items-start gap-8 lg:grid-cols-[1.35fr_1fr]">
					<Reveal>
						<BrowserFrame dark url="127.0.0.1:3457/#/runs/manual-…">
							<Video
								name="live-run"
								label="A run streaming agent activity in real time"
							/>
						</BrowserFrame>
					</Reveal>
					<Reveal delay={0.15}>
						<Stream />
						<p className="mt-4 text-sm text-white/50">
							Restart-safe: native agent sessions and checkpoints survive
							restarts. Waiting gates resume exactly where they were.
						</p>
					</Reveal>
				</div>
			</div>
		</section>
	);
}
