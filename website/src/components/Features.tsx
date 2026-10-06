import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Bob } from "./Bob";
import { Phone, Reveal, SectionTitle, Shot } from "./ui";

function Card({
	children,
	className = "",
	delay = 0,
	tint = "#ffffff",
}: {
	children: ReactNode;
	className?: string;
	delay?: number;
	tint?: string;
}) {
	return (
		<Reveal
			delay={delay}
			className={`group relative overflow-hidden rounded-[28px] border border-line p-7 shadow-[0_6px_20px_#39245a0a] transition-shadow duration-500 hover:shadow-[0_24px_60px_-20px_#7b61ff40] ${className}`}
			style={{ background: tint }}
		>
			{children}
		</Reveal>
	);
}
const Title = ({ children }: { children: ReactNode }) => (
	<h3 className="font-display text-2xl font-bold tracking-[-0.02em]">
		{children}
	</h3>
);
const Body = ({ children }: { children: ReactNode }) => (
	<p className="mt-2 leading-relaxed text-ink-2">{children}</p>
);

export function Features() {
	return (
		<section id="features" className="relative py-28 sm:py-36">
			<div className="mx-auto max-w-6xl px-6">
				<SectionTitle
					eyebrow="Small factory, big manners"
					color="#ff9f43"
					title={
						<>
							Everything a careful teammate would do.{" "}
							<span className="rainbow-text">Nothing they wouldn't.</span>
						</>
					}
				/>
				<div className="mt-14 grid gap-5 md:grid-cols-6">
					<Card
						className="md:col-span-4 md:row-span-2"
						tint="linear-gradient(160deg,#fff,#f7f1ff)"
					>
						<Title>Runs on your machine</Title>
						<Body>
							No database, no hosted login, no queue service. One command starts
							the dashboard on loopback; runs, recipes and evidence live as JSON
							under{" "}
							<code className="rounded bg-[#f2eff7] px-1.5 font-mono text-sm">
								~/.bobs-factory
							</code>
							. Install it as an app on desktop or phone — with dark mode.
						</Body>
						<div className="mt-8 flex items-end justify-center gap-6">
							<motion.div
								whileHover={{ y: -10, rotate: -2 }}
								className="w-[46%] max-w-[230px]"
							>
								<Phone>
									<Shot
										name="mobile-today"
										alt="Bob's Factory on a phone, Today view"
									/>
								</Phone>
							</motion.div>
							<motion.div
								whileHover={{ y: -10, rotate: 2 }}
								className="w-[46%] max-w-[230px] translate-y-6"
							>
								<Phone>
									<Shot
										name="mobile-review"
										alt="Review guide on a phone in dark mode"
									/>
								</Phone>
							</motion.div>
						</div>
					</Card>
					<Card className="md:col-span-2" delay={0.05} tint="#e3faf0">
						<div className="text-3xl">🙋</div>
						<Title>Nothing merges without you</Title>
						<Body>
							Approval is explicit and bound to the exact revision. No admin
							bypass, ever.
						</Body>
					</Card>
					<Card className="md:col-span-2" delay={0.1} tint="#e4f7fd">
						<div className="text-3xl">💾</div>
						<Title>Restart-safe</Title>
						<Body>
							Checkpoints, native agent sessions and pending questions survive
							restarts and resume in place.
						</Body>
					</Card>
					<Card className="md:col-span-3" delay={0.05} tint="#fff1e2">
						<div className="text-3xl">🎫</div>
						<Title>Tickets in, PRs out</Title>
						<Body>
							Assign a Linear issue with{" "}
							<code className="font-mono text-sm">workflow:factory</code>, or
							mention Bob with{" "}
							<code className="font-mono text-sm">[workflow=takeover]</code>.
							Questions, progress and the guide flow back to the ticket. Slack
							and Zulip chats work too.
						</Body>
					</Card>
					<Card className="md:col-span-3" delay={0.1} tint="#eeeaff">
						<div className="text-3xl">🤝</div>
						<Title>Takes over existing work</Title>
						<Body>
							Point Bob at a half-finished PR or ticket. He inspects what's
							done, clarifies what's left, keeps the PR draft, and runs it
							through the same pipeline.
						</Body>
					</Card>
					<Card className="md:col-span-2" delay={0.05} tint="#fff8d9">
						<div className="text-3xl">🔐</div>
						<Title>Evidence, hashed</Title>
						<Body>
							Screenshots are verified PNG/JPEG files with SHA-256 provenance.
							Missing evidence can't be waived.
						</Body>
					</Card>
					<Card className="md:col-span-2" delay={0.1} tint="#ffe9ec">
						<div className="text-3xl">🧵</div>
						<Title>Today, not a backlog</Title>
						<Body>
							Questions, stuck runs and reviews come first. Running work stays
							compact; done work settles away.
						</Body>
					</Card>
					<Card className="md:col-span-2" delay={0.15} tint="#f7ecff">
						<div className="flex items-start justify-between">
							<div className="text-3xl">⚡</div>
							<Bob mood="busy" size={40} track={false} />
						</div>
						<Title>Or just… ask</Title>
						<Body>
							The Simple recipe is a single agent session for quick questions
							and fixes — still with chat and history.
						</Body>
					</Card>
				</div>
			</div>
		</section>
	);
}

const agents = ["Claude Code", "Codex", "Cursor", "Gemini CLI", "OpenCode"];
const places = ["Linear", "GitHub", "GitLab", "Slack", "Zulip"];

export function Marquee() {
	const items = [
		...agents.map((name) => ["🤖", name]),
		...places.map((name) => ["🔌", name]),
	];
	return (
		<div className="relative overflow-hidden border-y border-line bg-white/50 py-6">
			<div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-32 bg-gradient-to-r from-cream to-transparent" />
			<div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-32 bg-gradient-to-l from-cream to-transparent" />
			<div className="marquee flex w-max gap-4">
				{[...items, ...items].map(([icon, name], index) => (
					<span
						key={index}
						className="flex items-center gap-2 whitespace-nowrap rounded-full border border-line bg-white px-5 py-2 font-display text-lg font-semibold text-ink-2"
					>
						<span className="text-base">{icon}</span>
						{name}
					</span>
				))}
			</div>
			<p className="mt-4 text-center font-mono text-xs font-semibold uppercase tracking-[0.18em] text-muted">
				Bring your own agent · bring your own tracker · bring your own keys
			</p>
		</div>
	);
}
