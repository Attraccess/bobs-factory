import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Bob } from "./Bob";
import { BrowserFrame, ease, Reveal, SectionTitle, Shot } from "./ui";

const tabs = [
	{
		id: "ask",
		label: "The ask",
		shot: "review-verdict",
		note: "Your request, word for word — and every place Bob had to decide what it meant.",
	},
	{
		id: "proof",
		label: "Proof",
		shot: "review-proof",
		note: "One line per requirement, each with the proof that it works: cropped screenshots, observed values, tests.",
	},
	{
		id: "call",
		label: "Your call",
		shot: "review-call",
		note: "Only what needs a human: taste, trade-offs and consequences. Mark each line met or not.",
	},
	{
		id: "files",
		label: "Files",
		shot: "review-files",
		note: "Every changed file, grouped by the requirement it serves. Files nothing asked for stand out.",
	},
	{
		id: "diff",
		label: "Diff",
		shot: "review-diff",
		note: "The exact reviewed revision, unified or split. Hold any line to comment.",
	},
	{
		id: "decide",
		label: "Decide",
		shot: "review-decision",
		note: "Objections become precise feedback for Bob. Or approve the exact revision you read.",
	},
];
const DURATION = 5200;

const confettiColors = [
	"#ff5d73",
	"#ff9f43",
	"#ffd23f",
	"#3ddc97",
	"#4cc9f0",
	"#7b61ff",
	"#c77dff",
];

function Confetti({ burst }: { burst: number }) {
	if (!burst) return null;
	return (
		<div
			className="pointer-events-none absolute inset-0 z-30 overflow-visible"
			key={burst}
		>
			{Array.from({ length: 70 }, (_, index) => {
				const angle = (Math.PI * 2 * index) / 70 + Math.random() * 0.4;
				const distance = 160 + Math.random() * 260;
				return (
					<motion.span
						key={index}
						className="absolute left-1/2 top-1/2 block h-3 w-2 rounded-[2px]"
						style={{
							background: confettiColors[index % confettiColors.length],
						}}
						initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
						animate={{
							x: Math.cos(angle) * distance,
							y: [
								0,
								Math.sin(angle) * distance - 80,
								Math.sin(angle) * distance + 220,
							],
							opacity: [1, 1, 0],
							rotate: Math.random() * 720 - 360,
						}}
						transition={{
							duration: 1.6 + Math.random() * 0.6,
							ease: "easeOut",
						}}
					/>
				);
			})}
		</div>
	);
}

export function Review() {
	const [index, setIndex] = useState(0);
	const [paused, setPaused] = useState(false);
	const [burst, setBurst] = useState(0);
	const [state, setState] = useState<"idle" | "merging" | "merged">("idle");
	const ref = useRef<HTMLDivElement>(null);
	const inView = useInView(ref, { margin: "-200px" });

	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const pause = () => setPaused(true);
		const resume = () => setPaused(false);
		element.addEventListener("pointerenter", pause);
		element.addEventListener("pointerleave", resume);
		return () => {
			element.removeEventListener("pointerenter", pause);
			element.removeEventListener("pointerleave", resume);
		};
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: restart the timer whenever the tab changes.
	useEffect(() => {
		if (paused || !inView) return;
		const timer = setTimeout(
			() => setIndex((value) => (value + 1) % tabs.length),
			DURATION,
		);
		return () => clearTimeout(timer);
	}, [index, paused, inView]);

	const approve = () => {
		if (state !== "idle") return;
		setState("merging");
		setTimeout(() => {
			setState("merged");
			setBurst((value) => value + 1);
		}, 1100);
		setTimeout(() => setState("idle"), 6000);
	};
	const tab = tabs[index]!;

	return (
		<section id="review" className="relative py-28 sm:py-36">
			<div className="mx-auto max-w-6xl px-6">
				<SectionTitle
					eyebrow="Human review, redesigned"
					color="#08683f"
					title={
						<>
							A review you'll actually{" "}
							<span className="rainbow-text">look forward to.</span>
						</>
					}
				>
					Bob doesn't drop a 600-line diff on you. He writes a review brief that
					answers one question — does this deliver what you asked? — with your
					request, proof for every requirement, and only the decisions that need
					you. Then he waits.
				</SectionTitle>

				<div ref={ref} className="mt-14">
					<div
						className="mb-6 flex flex-wrap gap-2"
						role="tablist"
						aria-label="Review brief sections"
					>
						{tabs.map((item, position) => (
							<button
								key={item.id}
								type="button"
								role="tab"
								aria-selected={position === index}
								onClick={() => setIndex(position)}
								className={`relative overflow-hidden rounded-full border px-5 py-2.5 text-sm font-bold transition ${position === index ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2 hover:border-[#d9cff0]"}`}
							>
								{position === index && !paused && inView && (
									<motion.span
										key={`${index}-progress`}
										className="absolute inset-y-0 left-0 bg-white/15"
										initial={{ width: "0%" }}
										animate={{ width: "100%" }}
										transition={{ duration: DURATION / 1000, ease: "linear" }}
									/>
								)}
								<span className="relative">
									{position + 1}. {item.label}
								</span>
							</button>
						))}
					</div>

					<div className="grid items-start gap-8 lg:grid-cols-[1fr_300px]">
						<BrowserFrame url="127.0.0.1:3457/#/runs/…/review">
							<div className="relative aspect-[1440/1000] overflow-hidden bg-cream">
								<AnimatePresence initial={false}>
									<motion.div
										key={tab.id}
										className="absolute inset-0"
										initial={{ opacity: 0, scale: 1.02 }}
										animate={{ opacity: 1, scale: 1 }}
										exit={{ opacity: 0 }}
										transition={{ duration: 0.6, ease }}
									>
										<Shot
											name={tab.shot}
											alt={`Review brief: ${tab.label}`}
											className="h-full object-cover object-top"
										/>
									</motion.div>
								</AnimatePresence>
							</div>
						</BrowserFrame>

						<div className="flex flex-col gap-5 lg:sticky lg:top-28">
							<AnimatePresence mode="wait">
								<motion.p
									key={tab.id}
									initial={{ opacity: 0, y: 10 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: -10 }}
									className="min-h-[96px] text-lg font-semibold leading-snug text-ink"
								>
									{tab.note}
								</motion.p>
							</AnimatePresence>
							<div className="relative rounded-3xl border border-line bg-white p-5 shadow-sm">
								<Confetti burst={burst} />
								<div className="flex items-center gap-3">
									<Bob
										mood={
											state === "merged"
												? "party"
												: state === "merging"
													? "busy"
													: "happy"
										}
										size={52}
									/>
									<div className="text-sm">
										<div className="font-bold">Dark mode for the menu page</div>
										<div className="text-muted">
											PR #128 · revision b2b88aff
										</div>
									</div>
								</div>
								<button
									type="button"
									onClick={approve}
									className="mt-5 w-full rounded-2xl bg-[#08683f] px-5 py-3.5 font-bold text-white shadow-[0_5px_0_#04412a] transition active:translate-y-1 active:shadow-[0_1px_0_#04412a]"
								>
									<AnimatePresence mode="wait" initial={false}>
										<motion.span
											key={state}
											initial={{ y: 10, opacity: 0 }}
											animate={{ y: 0, opacity: 1 }}
											exit={{ y: -10, opacity: 0 }}
											className="block"
										>
											{state === "idle"
												? "Approve & merge"
												: state === "merging"
													? "Waiting for GitHub…"
													: "Merged! 🥞"}
										</motion.span>
									</AnimatePresence>
								</button>
								<p className="mt-3 text-xs leading-relaxed text-muted">
									Try it. (In the real thing, approval applies to the exact
									reviewed revision and settles only after GitHub confirms the
									merge.)
								</p>
							</div>
						</div>
					</div>
				</div>

				<Reveal className="mt-16 grid gap-4 sm:grid-cols-3">
					{[
						[
							"Request changes",
							"Your feedback goes to the fixer, then back through code review, CI and QA — and you get a fresh brief that says what changed.",
						],
						[
							"Comment on anything",
							"Mark a requirement not met, or hold any line or diff row, to attach a comment to your feedback.",
						],
						[
							"Drafts survive",
							"Unsent review comments survive reloads, app updates and new revisions — clearly marked.",
						],
					].map(([title, body]) => (
						<div
							key={title}
							className="rounded-3xl border border-line bg-white/70 p-6"
						>
							<div className="font-display text-xl font-bold">{title}</div>
							<p className="mt-2 text-ink-2">{body}</p>
						</div>
					))}
				</Reveal>
			</div>
		</section>
	);
}
