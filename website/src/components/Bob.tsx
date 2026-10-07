import { useEffect, useId, useRef, useState } from "react";

export type Mood = "happy" | "busy" | "alert" | "oops" | "party" | "sleepy";

/**
 * Bob, ported from the factory's own mascot (packages/edge-worker/src/factory/web/bob.tsx),
 * with eyes that follow the cursor and an occasional blink.
 */
export function Bob({
	mood = "happy",
	size = 120,
	track = true,
	className = "",
}: {
	mood?: Mood;
	size?: number;
	track?: boolean;
	className?: string;
}) {
	const id = useId().replace(/:/g, "");
	const ref = useRef<SVGSVGElement>(null);
	const [look, setLook] = useState({ x: 0, y: 0 });
	const [blink, setBlink] = useState(false);

	useEffect(() => {
		if (!track) return;
		const move = (event: PointerEvent) => {
			const box = ref.current?.getBoundingClientRect();
			if (!box) return;
			const dx = event.clientX - (box.left + box.width / 2);
			const dy = event.clientY - (box.top + box.height * 0.45);
			const distance = Math.hypot(dx, dy) || 1;
			const reach = Math.min(1, distance / 260);
			setLook({
				x: (dx / distance) * 5 * reach,
				y: (dy / distance) * 5 * reach,
			});
		};
		window.addEventListener("pointermove", move, { passive: true });
		return () => window.removeEventListener("pointermove", move);
	}, [track]);

	useEffect(() => {
		let timer: ReturnType<typeof setTimeout>;
		const schedule = () => {
			timer = setTimeout(
				() => {
					setBlink(true);
					setTimeout(() => setBlink(false), 140);
					schedule();
				},
				2400 + Math.random() * 3200,
			);
		};
		schedule();
		return () => clearTimeout(timer);
	}, []);

	const sleepy = mood === "sleepy" || blink,
		worried = mood === "oops",
		alert = mood === "alert";
	const lx = mood === "busy" ? 5 : look.x,
		ly = alert ? -6 : look.y;
	return (
		<svg
			ref={ref}
			role="img"
			aria-label={`Bob, ${mood}`}
			className={`bob-svg bob-${mood} ${className}`}
			width={size}
			height={size * 1.08}
			viewBox="0 0 100 108"
			overflow="visible"
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
					className="bob-arm-left"
					cx="9"
					cy={alert || mood === "party" ? 43 : 68}
					rx="7"
					ry="12"
					transform={alert || mood === "party" ? "rotate(-25 9 43)" : ""}
				/>
				<ellipse
					className="bob-arm-right"
					cx="91"
					cy={mood === "party" ? 43 : 67}
					rx="7"
					ry="12"
					transform={mood === "party" ? "rotate(25 91 43)" : ""}
				/>
			</g>
			<g>
				{sleepy ? (
					<path
						d="M22 48q10 12 23 0M54 48q11 12 23 0"
						fill="none"
						stroke="#2b2346"
						strokeWidth="4"
						strokeLinecap="round"
					/>
				) : (
					<>
						<ellipse cx="33" cy="47" rx="19" ry="22" fill="white" />
						<ellipse cx="67" cy="47" rx="19" ry="22" fill="white" />
						{[33, 67].map((x) => (
							<g
								key={x}
								style={{
									transform: `translate(${lx}px, ${ly}px)`,
									transition: "transform 120ms ease-out",
								}}
							>
								<ellipse
									cx={x}
									cy={47}
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
			{mood === "sleepy" && (
				<text x="80" y="14" fill="#7b61ff" fontSize="13" className="bob-zz">
					z z
				</text>
			)}
			{mood === "party" && (
				<g fill="#ff9f43" fontSize="14">
					<text x="-6" y="20">
						✦
					</text>
					<text x="92" y="22">
						✧
					</text>
				</g>
			)}
		</svg>
	);
}
