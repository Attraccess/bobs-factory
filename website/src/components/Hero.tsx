import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { useRef, useState } from "react";
import { INSTALL_COMMAND, releaseAvailable } from "../install";
import { Bob, type Mood } from "./Bob";
import { CopyCommand } from "./CopyCommand";
import { BrowserFrame, ease, Video } from "./ui";

const chips = [
	{
		text: "💬 1 question for you",
		className: "left-[-4%] top-[18%]",
		color: "#9a4a00",
		bg: "#fff1e2",
		delay: 0.9,
	},
	{
		text: "👀 Dark mode · ready for review",
		className: "right-[-5%] top-[9%]",
		color: "#08683f",
		bg: "#e3faf0",
		delay: 1.1,
	},
	{
		text: "🔁 Fixing review finding toggle-label",
		className: "left-[-7%] bottom-[22%]",
		color: "#075e7c",
		bg: "#e4f7fd",
		delay: 1.3,
	},
	{
		text: "✅ PR #119 merged",
		className: "right-[-3%] bottom-[30%]",
		color: "#2b2346",
		bg: "#eeeaff",
		delay: 1.5,
	},
];

export function Hero() {
	const ref = useRef<HTMLDivElement>(null);
	const [mood, setMood] = useState<Mood>("happy");
	const { scrollYProgress } = useScroll({
		target: ref,
		offset: ["start start", "end start"],
	});
	const spring = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
	const tilt = useTransform(spring, [0, 0.45], [16, 0]);
	const scale = useTransform(spring, [0, 0.45], [0.92, 1]);
	const glow = useTransform(spring, [0, 0.5], [0.9, 0.3]);

	return (
		<section
			ref={ref}
			className="grain relative overflow-hidden pb-24 pt-36 sm:pt-44"
		>
			<motion.div
				aria-hidden
				className="pointer-events-none absolute inset-0"
				style={{ opacity: glow }}
			>
				<div className="absolute -left-40 top-10 size-[38rem] rounded-full bg-[#ff7a9a]/25 blur-[120px]" />
				<div className="absolute -right-32 top-40 size-[34rem] rounded-full bg-[#4cc9f0]/25 blur-[120px]" />
				<div className="absolute left-1/3 top-[46rem] size-[40rem] rounded-full bg-[#c77dff]/25 blur-[140px]" />
			</motion.div>

			<div className="relative mx-auto max-w-6xl px-6 text-center">
				<motion.div
					initial={{ opacity: 0, y: 12 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.7, ease }}
					className="inline-flex items-center gap-2 rounded-full border border-line bg-white/70 py-1.5 pl-1.5 pr-4 text-sm font-semibold text-ink-2 shadow-sm backdrop-blur"
				>
					<span className="rounded-full bg-ink px-2.5 py-0.5 font-mono text-[11px] text-white">
						NEW
					</span>
					Review briefs: proof for every requirement
				</motion.div>

				<h1 className="mx-auto mt-8 max-w-5xl font-display text-[clamp(2.9rem,8.4vw,7.2rem)] font-extrabold leading-[0.92] tracking-[-0.05em]">
					{["Hand", "Bob", "a", "ticket."].map((word, index) => (
						<motion.span
							key={word}
							className="inline-block pr-[0.22em]"
							initial={{ opacity: 0, y: 40, rotate: 4 }}
							animate={{ opacity: 1, y: 0, rotate: 0 }}
							transition={{ duration: 0.8, ease, delay: 0.08 * index }}
						>
							{word}
						</motion.span>
					))}
					<br />
					<motion.span
						className="rainbow-text inline-block pb-2"
						initial={{ opacity: 0, y: 40, filter: "blur(12px)" }}
						animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
						transition={{ duration: 1, ease, delay: 0.45 }}
					>
						Get a PR you'd merge.
					</motion.span>
				</h1>

				<motion.p
					initial={{ opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.8, ease, delay: 0.7 }}
					className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-ink-2 sm:text-xl"
				>
					Bob is a cheerful little software factory that runs on your machine.
					He clarifies, plans, codes, reviews his own work, babysits CI,
					screenshots the UI and writes you a review brief —{" "}
					<strong className="text-ink">then waits for your click.</strong>
				</motion.p>

				<motion.div
					initial={{ opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.8, ease, delay: 0.85 }}
					className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
				>
					<a
						href="#start"
						onMouseEnter={() => setMood("party")}
						onMouseLeave={() => setMood("happy")}
						className="group relative rounded-2xl bg-ink px-7 py-4 font-bold text-white shadow-[0_6px_0_#120c25] transition active:translate-y-1 active:shadow-[0_2px_0_#120c25]"
					>
						Get Bob running{" "}
						<span className="inline-block transition group-hover:translate-x-1">
							→
						</span>
					</a>
					<CopyCommand
						command={INSTALL_COMMAND}
						label="Copy install command"
						disabled={!releaseAvailable}
					/>
				</motion.div>
			</div>

			<div className="relative mx-auto mt-36 max-w-6xl px-4 sm:mt-44 [perspective:1600px] sm:px-6">
				<motion.div
					className="absolute -top-[92px] left-1/2 z-20 -translate-x-1/2 sm:-top-[118px]"
					initial={{ y: 90, opacity: 0 }}
					animate={{ y: 0, opacity: 1 }}
					transition={{ type: "spring", stiffness: 140, damping: 13, delay: 1 }}
				>
					<button
						type="button"
						aria-label="Boop Bob"
						className="cursor-pointer rounded-full"
						onMouseEnter={() => setMood("party")}
						onMouseLeave={() => setMood("happy")}
						onFocus={() => setMood("party")}
						onBlur={() => setMood("happy")}
					>
						<Bob
							mood={mood}
							size={128}
							className="drop-shadow-[0_12px_18px_#7b61ff40]"
						/>
					</button>
				</motion.div>
				<motion.div
					style={{ rotateX: tilt, scale }}
					className="relative origin-top"
				>
					<BrowserFrame url="127.0.0.1:3457/#/">
						<Video
							name="today"
							label="Launching a run in Bob's Factory and watching it join the queue"
						/>
					</BrowserFrame>
					{chips.map((chip) => (
						<motion.div
							key={chip.text}
							initial={{ opacity: 0, scale: 0.6 }}
							animate={{ opacity: 1, scale: 1, y: [0, -8, 0] }}
							transition={{
								opacity: { delay: chip.delay, duration: 0.4 },
								scale: {
									delay: chip.delay,
									type: "spring",
									stiffness: 260,
									damping: 14,
								},
								y: {
									delay: chip.delay,
									duration: 4 + chip.delay,
									repeat: Infinity,
									ease: "easeInOut",
								},
							}}
							className={`absolute z-10 hidden rounded-2xl border border-white px-4 py-2.5 text-sm font-bold shadow-[0_14px_30px_-10px_#39245a40] lg:block ${chip.className}`}
							style={{ color: chip.color, background: chip.bg }}
						>
							{chip.text}
						</motion.div>
					))}
				</motion.div>
			</div>
		</section>
	);
}
