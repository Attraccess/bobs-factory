import {
	AnimatePresence,
	motion,
	useMotionValueEvent,
	useScroll,
	useSpring,
	useTransform,
} from "motion/react";
import { type ReactNode, useRef, useState } from "react";
import { Bob, type Mood } from "./Bob";
import { BrowserFrame, ease, SectionTitle, Shot } from "./ui";

type Station = {
	icon: string;
	name: string;
	kind: "agent" | "tool" | "you";
	title: string;
	body: string;
	loop?: string;
	mood: Mood;
	visual: { shot: string; alt: string } | { code: string; file: string };
};

const stations: Station[] = [
	{
		icon: "💬",
		name: "Clarify",
		kind: "agent",
		mood: "alert",
		title: "Asks before he guesses.",
		body: "Bob reads the ticket, every comment and the repo. If a decision would change the build, he asks — with context, options and consequences — and pauses until you answer from the dashboard or the ticket thread.",
		visual: {
			shot: "question",
			alt: "A clarification question card in Bob's Factory",
		},
	},
	{
		icon: "🗺️",
		name: "Plan",
		kind: "agent",
		mood: "busy",
		loop: "plan ↺ plan review",
		title: "Plans get reviewed. Bad ones bounce.",
		body: "A planner writes a lean plan from the clarified requirements and decision records. A second role reviews it against the ticket and sends it back until nothing is missing. The implementer only ever sees the accepted plan.",
		visual: {
			file: "outputs/plan-review.json",
			code: `{
  "approved": false,
  "feedback": [
    "Respect prefers-reduced-motion for theme transitions.",
    "State a measurable contrast target (≥ 4.5:1)."
  ]
}`,
		},
	},
	{
		icon: "🔨",
		name: "Implement",
		kind: "agent",
		mood: "busy",
		title: "Real work, in a real worktree.",
		body: "Each run gets its own Git worktree. Claude Code, Codex, Cursor, Gemini or OpenCode does the coding — and every thought and tool call streams into the run timeline. Message Bob mid-run to steer.",
		visual: {
			shot: "run-live",
			alt: "Live agent conversation with grouped tool calls",
		},
	},
	{
		icon: "🚀",
		name: "Draft PR",
		kind: "tool",
		mood: "happy",
		title: "Pushed as a draft. Never sneaky.",
		body: "Conventional commit, push, draft PR. Takeover runs publish onto the original PR branch and keep it draft. Nothing is marked ready for review until a human says so.",
		visual: {
			file: "outputs/draft-pr.json",
			code: `{
  "url": "https://github.com/syrup-co/pancake-palace/pull/128",
  "branch": "bob/dark-mode-menu",
  "headSha": "b2b88aff0c3e…"
}`,
		},
	},
	{
		icon: "👀",
		name: "Code review",
		kind: "agent",
		mood: "alert",
		loop: "review ↺ fix",
		title: "He reviews his own homework.",
		body: "A reviewer rates findings with stable IDs. Nitpicks (severity 1) are discarded. The fixer can fix — or reject with evidence, which gets reviewed too. No ping-pong, no reopened arguments.",
		visual: {
			file: "outputs/code-review.json",
			code: `{
  "findings": [{
    "id": "toggle-label",
    "rating": 2,
    "summary": "aria-label doesn't update after switching themes",
    "evidence": "src/theme.js:9",
    "status": "open"
  }]
}`,
		},
	},
	{
		icon: "🚦",
		name: "CI & readiness",
		kind: "tool",
		mood: "busy",
		loop: "CI ↺ fix → review",
		title: "Babysits CI so you don't.",
		body: "Bob watches checks, review threads, required reviewers, conflicts and merge rules. Failures and new provider comments go to a fixer — and the fix goes back through code review.",
		visual: {
			file: "activity",
			code: `Merge readiness: 3/3 checks passed
  ✓ lint      ✓ unit      ✓ e2e
  · Approve the review guide to mark the PR ready
  · Required reviewer approval is missing`,
		},
	},
	{
		icon: "📸",
		name: "QA & screenshots",
		kind: "agent",
		mood: "party",
		loop: "QA ↺ fix → review → CI",
		title: "Proof, not promises.",
		body: "Bob turns requirements into user stories, executes them, and captures every changed UI state on desktop and mobile. Images are hash-verified; unchanged, approved evidence is reused instead of recaptured.",
		visual: {
			shot: "review-chapter",
			alt: "Screenshot evidence inside a review guide chapter",
		},
	},
	{
		icon: "📖",
		name: "Review guide",
		kind: "agent",
		mood: "happy",
		title: "A guided tour of the whole PR.",
		body: "Chapters per feature with before/after, system diagrams, screenshots, risks and exactly what to check — plus every changed file grouped by chapter. It's also posted to the PR description.",
		visual: {
			shot: "review-overview",
			alt: "Review guide overview with a before/after system diagram",
		},
	},
	{
		icon: "✅",
		name: "You decide",
		kind: "you",
		mood: "party",
		title: "Your click. Then GitHub's word.",
		body: "Approve to mark the PR ready and merge — honoring required reviews, checks and merge queues, never an admin bypass. Request changes and Bob fixes, re-reviews, re-tests and asks again.",
		visual: {
			shot: "review-decision",
			alt: "The final decide step of a review guide",
		},
	},
];

const kindLabel = {
	agent: "Agent role",
	tool: "Factory tool",
	you: "Human gate",
} as const;
const kindColor = {
	agent: "#7b61ff",
	tool: "#075e7c",
	you: "#08683f",
} as const;

function Visual({ station }: { station: Station }) {
	if ("shot" in station.visual)
		return (
			<BrowserFrame className="w-full">
				<div className="aspect-[1440/1000] overflow-hidden">
					<Shot
						name={station.visual.shot}
						alt={station.visual.alt}
						className="h-full object-cover object-top"
					/>
				</div>
			</BrowserFrame>
		);
	return (
		<div className="overflow-hidden rounded-[22px] border border-white/10 bg-night shadow-[0_40px_100px_-30px_#39245a77]">
			<div className="flex items-center justify-between border-b border-white/10 px-5 py-3 font-mono text-xs text-white/50">
				<span>{station.visual.file}</span>
				<span className="rounded-full bg-white/10 px-2 py-0.5">
					{station.name.toLowerCase()}
				</span>
			</div>
			<pre className="overflow-x-auto p-6 font-mono text-[13px] leading-relaxed text-[#e8e2ff] sm:text-sm">
				<Highlight code={station.visual.code} />
			</pre>
		</div>
	);
}

/** Tiny JSON-ish highlighter; enough for marketing snippets. */
export function Highlight({ code }: { code: string }) {
	const parts: ReactNode[] = [];
	const pattern =
		/("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)|(✓|·)/g;
	let last = 0;
	for (const match of code.matchAll(pattern)) {
		parts.push(code.slice(last, match.index));
		const [text, string, colon, keyword, number, mark] = match;
		const color = string
			? colon
				? "#c77dff"
				: "#7ee0b4"
			: keyword
				? "#ff9f43"
				: number
					? "#ffd23f"
					: mark === "✓"
						? "#3ddc97"
						: "#8f84c4";
		parts.push(
			<span key={match.index} style={{ color }}>
				{string ?? text}
			</span>,
		);
		if (colon) parts.push(colon);
		last = match.index! + text.length;
	}
	parts.push(code.slice(last));
	return <>{parts}</>;
}

export function AssemblyLine() {
	const ref = useRef<HTMLDivElement>(null);
	const { scrollYProgress } = useScroll({
		target: ref,
		offset: ["start start", "end end"],
	});
	const smooth = useSpring(scrollYProgress, { stiffness: 140, damping: 28 });
	const [active, setActive] = useState(0);
	useMotionValueEvent(scrollYProgress, "change", (value) =>
		setActive(
			Math.min(
				stations.length - 1,
				Math.max(0, Math.floor(value * stations.length)),
			),
		),
	);
	const bobX = useTransform(smooth, [0, 1], ["0%", "100%"]);
	const station = stations[active]!;

	const jump = (index: number) => {
		const box = ref.current!;
		const top =
			box.offsetTop +
			((box.offsetHeight - window.innerHeight) * (index + 0.5)) /
				stations.length;
		window.scrollTo({ top, behavior: "smooth" });
	};

	return (
		<section id="line" className="relative">
			<div className="mx-auto max-w-6xl px-6 pb-10 pt-28">
				<SectionTitle
					eyebrow="The assembly line"
					color="#ff5d73"
					title={
						<>
							Nine stations.{" "}
							<span className="rainbow-text">Three feedback loops.</span> One
							cheerful PR.
						</>
					}
				>
					The stock Software factory recipe is a real workflow graph. Every step
					is checkpointed, so Bob picks up exactly where he left off after a
					restart.
				</SectionTitle>
			</div>

			{/* Desktop: sticky, scroll-driven */}
			<div
				ref={ref}
				className="relative hidden lg:block"
				style={{ height: `${stations.length * 75}vh` }}
			>
				<div className="sticky top-0 flex h-screen flex-col justify-center overflow-hidden">
					<div className="mx-auto w-full max-w-6xl px-6">
						<div className="relative mb-12 mt-8 h-24">
							<div className="absolute inset-x-0 top-[62px] h-3 rounded-full bg-[repeating-linear-gradient(90deg,#efe6f7_0_14px,#e3dcf0_14px_28px)]">
								<motion.div
									className="h-full rounded-full"
									style={{ width: bobX, background: "var(--rainbow)" }}
								/>
							</div>
							<div className="absolute inset-x-0 top-[50px] flex justify-between">
								{stations.map((item, index) => (
									<button
										type="button"
										key={item.name}
										onClick={() => jump(index)}
										aria-label={`Go to ${item.name}`}
										className={`relative grid size-9 place-items-center rounded-full border-2 text-base transition-all duration-300 ${index <= active ? "scale-110 border-white bg-white shadow-[0_6px_16px_-4px_#7b61ff66]" : "border-white bg-[#f2eff7] grayscale"}`}
									>
										{item.icon}
										<span
											className={`absolute top-11 whitespace-nowrap text-[11px] font-bold transition ${index === active ? "text-ink" : "text-muted/70"}`}
										>
											{item.name}
										</span>
									</button>
								))}
							</div>
							<motion.div
								className="absolute top-0 -ml-[22px]"
								style={{ left: bobX }}
							>
								<Bob mood={station.mood} size={44} track={false} />
							</motion.div>
						</div>

						<div className="grid grid-cols-[0.85fr_1.15fr] items-center gap-14">
							<AnimatePresence mode="wait">
								<motion.div
									key={station.name}
									initial={{ opacity: 0, y: 24 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: -16 }}
									transition={{ duration: 0.45, ease }}
								>
									<div className="flex flex-wrap items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest">
										<span style={{ color: kindColor[station.kind] }}>
											{String(active + 1).padStart(2, "0")} ·{" "}
											{kindLabel[station.kind]}
										</span>
										{station.loop && (
											<span className="rounded-full bg-[#fff1e2] px-2.5 py-1 normal-case tracking-normal text-[#9a4a00]">
												↺ {station.loop}
											</span>
										)}
									</div>
									<h3 className="mt-4 font-display text-5xl font-bold leading-[1] tracking-[-0.035em]">
										{station.title}
									</h3>
									<p className="mt-5 text-lg leading-relaxed text-ink-2">
										{station.body}
									</p>
								</motion.div>
							</AnimatePresence>
							<AnimatePresence mode="wait">
								<motion.div
									key={station.name}
									initial={{ opacity: 0, x: 40, rotate: 1.5, scale: 0.97 }}
									animate={{ opacity: 1, x: 0, rotate: 0, scale: 1 }}
									exit={{ opacity: 0, x: -30, rotate: -1, scale: 0.97 }}
									transition={{ duration: 0.5, ease }}
								>
									<Visual station={station} />
								</motion.div>
							</AnimatePresence>
						</div>
					</div>
				</div>
			</div>

			{/* Mobile: stacked */}
			<div className="mx-auto flex max-w-xl flex-col gap-14 px-6 pb-24 lg:hidden">
				{stations.map((item, index) => (
					<motion.div
						key={item.name}
						initial={{ opacity: 0, y: 30 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true, margin: "-60px" }}
						transition={{ duration: 0.6, ease }}
					>
						<div
							className="font-mono text-xs font-bold uppercase tracking-widest"
							style={{ color: kindColor[item.kind] }}
						>
							{item.icon} {String(index + 1).padStart(2, "0")} · {item.name}
							{item.loop && (
								<span className="ml-2 normal-case text-[#9a4a00]">
									↺ {item.loop}
								</span>
							)}
						</div>
						<h3 className="mt-3 font-display text-3xl font-bold tracking-[-0.03em]">
							{item.title}
						</h3>
						<p className="mb-6 mt-3 text-ink-2">{item.body}</p>
						<Visual station={item} />
					</motion.div>
				))}
			</div>
		</section>
	);
}
