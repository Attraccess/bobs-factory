import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Bob } from "./Bob";
import { CopyCommand } from "./CopyCommand";
import { Reveal, SectionTitle } from "./ui";

export const REPO = "https://github.com/Attraccess/bobs-factory";

const lines = [
	{ cmd: "# Download a verified macOS or Linux binary release" },
	{ cmd: "./install-binary.sh ARCHIVE.tar.gz ARCHIVE.manifest.json ~/.local" },
	{
		cmd: "bobs-factory --repo ~/code/pancake-palace --agent claude",
		out: "Bob's Factory: http://127.0.0.1:3457\nRepository: ~/code/pancake-palace\nState: ~/.bobs-factory",
	},
];

function Terminal() {
	const ref = useRef<HTMLDivElement>(null);
	const inView = useInView(ref, { once: true, margin: "-120px" });
	const [typed, setTyped] = useState(0);
	const total = lines.reduce((sum, line) => sum + line.cmd.length, 0);
	useEffect(() => {
		if (!inView || typed >= total) return;
		const timer = setTimeout(() => setTyped((value) => value + 2), 22);
		return () => clearTimeout(timer);
	}, [inView, typed, total]);
	let budget = typed;
	return (
		<div
			ref={ref}
			className="rounded-[26px] border border-white/10 bg-night p-6 font-mono text-[13px] leading-relaxed shadow-[0_40px_90px_-30px_#2b2346aa] sm:text-sm"
		>
			<div className="mb-5 flex gap-1.5">
				<span className="size-3 rounded-full bg-[#ff5d73]" />
				<span className="size-3 rounded-full bg-[#ffd23f]" />
				<span className="size-3 rounded-full bg-[#3ddc97]" />
			</div>
			{lines.map((line, index) => {
				const shown = line.cmd.slice(0, Math.max(0, budget));
				const done = budget >= line.cmd.length;
				budget -= line.cmd.length;
				if (!shown) return null;
				return (
					<div key={index} className="mb-3">
						<div className="break-all text-white">
							<span className="text-r4">❯ </span>
							{shown}
							{!done && <span className="blink-caret" />}
						</div>
						{done && line.out && (
							<motion.pre
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								className="whitespace-pre-wrap text-white/50"
							>
								{line.out}
							</motion.pre>
						)}
					</div>
				);
			})}
		</div>
	);
}

export function GetStarted() {
	return (
		<section id="start" className="relative overflow-hidden py-28 sm:py-36">
			<div aria-hidden className="pointer-events-none absolute inset-0">
				<div className="absolute left-1/2 top-20 size-[44rem] -translate-x-1/2 rounded-full bg-[#ffd23f]/20 blur-[140px]" />
			</div>
			<div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-6 lg:grid-cols-2">
				<div className="min-w-0">
					<SectionTitle
						eyebrow="Get started"
						color="#08683f"
						title={
							<>
								From your laptop to{" "}
								<span className="rainbow-text">your first PR.</span>
							</>
						}
					>
						Install a verified binary for macOS or Linux. You'll need Git, the
						GitHub CLI and an authenticated agent CLI. Your repository needs an{" "}
						<code className="font-mono text-base">origin</code> you can push to.
						The factory bundles its runtime. Then open the dashboard and tell
						Bob what to build. Binary releases are being validated; use the docs
						for current availability.
					</SectionTitle>
					<Reveal delay={0.1} className="mt-8 flex flex-wrap gap-3">
						<a
							href={REPO}
							className="rounded-2xl bg-ink px-6 py-4 font-bold text-white shadow-[0_6px_0_#120c25] transition active:translate-y-1 active:shadow-[0_2px_0_#120c25]"
						>
							★ View on GitHub
						</a>
						<a
							href={`${REPO}/blob/main/docs/FACTORY.md`}
							className="rounded-2xl border border-line bg-white px-6 py-4 font-bold text-ink transition hover:-translate-y-0.5"
						>
							Read the factory docs
						</a>
					</Reveal>
				</div>
				<Reveal delay={0.15} className="relative min-w-0">
					<div className="absolute -right-2 -top-[92px] z-10">
						<Bob mood="happy" size={96} />
					</div>
					<Terminal />
					<div className="mt-4 flex justify-center">
						<CopyCommand command="bobs-factory --repo . --agent codex" />
					</div>
				</Reveal>
			</div>
		</section>
	);
}

export function Footer() {
	return (
		<footer className="relative border-t border-line bg-white/50 py-16">
			<div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 text-center">
				<Bob mood="sleepy" size={72} track={false} />
				<p className="font-display text-2xl font-bold tracking-tight">
					Bob's off duty. Your PRs aren't.
				</p>
				<div className="flex flex-wrap justify-center gap-5 text-sm font-bold text-ink-2">
					<a href={REPO} className="hover:text-ink">
						GitHub
					</a>
					<a
						href={`${REPO}/blob/main/docs/FACTORY.md`}
						className="hover:text-ink"
					>
						Docs
					</a>
					<a
						href="https://github.com/ceedaragents/cyrus"
						className="hover:text-ink"
					>
						Built on Cyrus
					</a>
				</div>
				<p className="max-w-lg text-xs text-muted">
					Apache-2.0. Screens on this page are real Bob's Factory UI, running
					the actual factory runtime against a demo repository with scripted
					agents. No pancakes were harmed.
				</p>
			</div>
		</footer>
	);
}
