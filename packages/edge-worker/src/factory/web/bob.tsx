import { useId } from "react";
export function Bob({
	mood = "happy",
	size = 36,
}: {
	mood?: string;
	size?: number;
}) {
	const id = useId().replace(/:/g, "");
	const sleepy = mood === "sleepy",
		worried = mood === "oops",
		alert = mood === "alert";
	return (
		<svg
			role="img"
			aria-label={`Bob, ${mood}`}
			className={`bob bob-${mood}`}
			width={size}
			height={size}
			viewBox="0 0 100 108"
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
					cx="9"
					cy={alert ? 43 : 68}
					rx="7"
					ry="12"
					transform={alert ? "rotate(-25 9 43)" : ""}
				/>
				<ellipse cx="91" cy="67" rx="7" ry="12" />
			</g>
			<g className="bob-eyes">
				{sleepy ? (
					<path
						d="M22 48q10 12 23 0M54 48q11 12 23 0"
						fill="none"
						stroke="#2b2346"
						strokeWidth="4"
					/>
				) : (
					<>
						<ellipse cx="33" cy="47" rx="19" ry="22" fill="white" />
						<ellipse cx="67" cy="47" rx="19" ry="22" fill="white" />
						{[33, 67].map((x) => (
							<g key={x}>
								<ellipse
									cx={x + (mood === "busy" ? 5 : 0)}
									cy={alert ? 41 : 47}
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
			{sleepy && (
				<text x="78" y="16" fill="#7b61ff" fontSize="13">
					z z
				</text>
			)}
			{mood === "party" && (
				<g fill="#ff9f43">
					<text x="2" y="20">
						✦
					</text>
					<text x="84" y="23">
						✧
					</text>
				</g>
			)}
		</svg>
	);
}
