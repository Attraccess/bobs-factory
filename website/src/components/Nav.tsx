import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { Bob } from "./Bob";

const links = [
	["The line", "#line"],
	["Reviews", "#review"],
	["Recipes", "#recipes"],
	["Features", "#features"],
	["Downloads", `${import.meta.env.BASE_URL}downloads/`],
] as const;

export function Nav() {
	const { scrollY } = useScroll();
	const [scrolled, setScrolled] = useState(false);
	useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 40));
	return (
		<motion.header
			initial={{ y: -40, opacity: 0 }}
			animate={{ y: 0, opacity: 1 }}
			transition={{ duration: 0.6 }}
			className="fixed inset-x-0 top-4 z-50 flex justify-center px-4"
		>
			<nav
				className={`flex w-full max-w-5xl items-center gap-2 rounded-full border px-3 py-2 transition-all duration-500 ${scrolled ? "border-line bg-white/80 shadow-[0_10px_40px_-12px_#39245a33] backdrop-blur-xl" : "border-transparent bg-transparent"}`}
			>
				<a
					href="#top"
					className="flex items-center gap-2 pr-3 font-display text-lg font-bold tracking-tight"
				>
					<Bob size={34} track={false} />
					Bob's Factory
				</a>
				<div className="ml-auto hidden items-center gap-1 md:flex">
					{links.map(([label, href]) => (
						<a
							key={href}
							href={href}
							className="rounded-full px-4 py-2 text-sm font-bold text-ink-2 transition hover:bg-[#f2eff7] hover:text-ink"
						>
							{label}
						</a>
					))}
				</div>
				<a
					href="#start"
					className="ml-auto rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white transition hover:scale-[1.03] md:ml-2"
				>
					Get started
				</a>
			</nav>
		</motion.header>
	);
}
