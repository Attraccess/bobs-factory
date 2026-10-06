import { motion, useMotionValue, useTransform } from "motion/react";
import { useRef } from "react";
import { BrowserFrame, Reveal, SectionTitle, Shot } from "./ui";

export function Today() {
	const ref = useRef<HTMLDivElement>(null);
	const split = useMotionValue(50);
	const clip = useTransform(split, (value) => `inset(0 0 0 ${value}%)`);
	const left = useTransform(split, (value) => `${value}%`);
	const move = (clientX: number) => {
		const box = ref.current?.getBoundingClientRect();
		if (!box) return;
		split.set(
			Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100)),
		);
	};
	return (
		<section className="relative py-28 sm:py-32">
			<div className="mx-auto max-w-6xl px-6">
				<SectionTitle
					center
					eyebrow="Today"
					color="#075e7c"
					title={
						<>
							One page for everything{" "}
							<span className="rainbow-text">Bob needs from you.</span>
						</>
					}
				>
					Questions, stuck runs and reviews come first. Busy work hums along
					below. Day shift or night shift — drag to compare.
				</SectionTitle>
				<Reveal className="mt-14">
					<BrowserFrame>
						<div
							ref={ref}
							className="relative aspect-[1440/900] cursor-ew-resize touch-none select-none overflow-hidden"
							onPointerMove={(event) =>
								event.buttons === 1 || event.pointerType === "mouse"
									? move(event.clientX)
									: undefined
							}
							onPointerDown={(event) => move(event.clientX)}
							role="slider"
							aria-label="Compare light and dark theme"
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={Math.round(split.get())}
							tabIndex={0}
							onKeyDown={(event) => {
								if (event.key === "ArrowLeft")
									split.set(Math.max(0, split.get() - 5));
								if (event.key === "ArrowRight")
									split.set(Math.min(100, split.get() + 5));
							}}
						>
							<Shot
								name="today-light"
								alt="Today view, light theme"
								className="h-full object-cover object-top"
							/>
							<motion.div
								className="absolute inset-0"
								style={{ clipPath: clip }}
							>
								<Shot
									name="today-dark"
									alt="Today view, dark theme"
									className="h-full object-cover object-top"
								/>
							</motion.div>
							<motion.div
								className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_#0002]"
								style={{ left }}
							>
								<div className="absolute top-1/2 left-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line bg-white text-lg shadow-lg">
									☀︎☾
								</div>
							</motion.div>
						</div>
					</BrowserFrame>
				</Reveal>
			</div>
		</section>
	);
}
