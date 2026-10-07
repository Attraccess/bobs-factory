import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useMemo, useState } from "react";
import { Highlight } from "./AssemblyLine";
import { Bob } from "./Bob";
import { Reveal, SectionTitle } from "./ui";

const runners = {
	claude: { label: "Claude Code", model: "claude-opus-5-5", color: "#ff9f43" },
	codex: { label: "Codex", model: "gpt-6.1-sol", color: "#3ddc97" },
	cursor: { label: "Cursor", model: undefined, color: "#4cc9f0" },
	gemini: { label: "Gemini", model: undefined, color: "#7b61ff" },
	opencode: { label: "OpenCode", model: undefined, color: "#c77dff" },
} as const;
type Runner = keyof typeof runners;

const toggles = [
	{ id: "clarify", label: "Ask clarifying questions", icon: "💬" },
	{ id: "planReview", label: "Review the plan", icon: "🧐" },
	{ id: "codeReview", label: "Code review ↺ fix", icon: "👀" },
	{ id: "qa", label: "QA & screenshots", icon: "📸" },
	{ id: "human", label: "Human review gate", icon: "🙋" },
] as const;
type Toggle = (typeof toggles)[number]["id"];

const roles = [
	{ id: "plan", label: "Planner" },
	{ id: "implement", label: "Implementer" },
	{ id: "review", label: "Reviewer" },
] as const;
type Role = (typeof roles)[number]["id"];

function agent(
	id: string,
	name: string,
	runner?: Runner,
	extra: Record<string, unknown> = {},
) {
	return {
		id,
		name,
		type: "agent",
		prompt: "…",
		...(runner
			? {
					runner,
					...(runners[runner].model ? { model: runners[runner].model } : {}),
				}
			: {}),
		...extra,
	};
}
const back = (path: string, next: string) => ({
	branches: [{ when: { path, equals: false }, next }],
});

export function Recipes() {
	const [on, setOn] = useState<Record<Toggle, boolean>>({
		clarify: true,
		planReview: true,
		codeReview: true,
		qa: true,
		human: true,
	});
	const [who, setWho] = useState<Record<Role, Runner>>({
		plan: "claude",
		implement: "codex",
		review: "claude",
	});

	const steps = useMemo(() => {
		const list: Record<string, unknown>[] = [];
		if (on.clarify)
			list.push(
				agent("clarify", "Clarify requirements", undefined, {
					askQuestions: true,
				}),
			);
		list.push(agent("plan", "Write implementation plan", who.plan));
		if (on.planReview)
			list.push(
				agent(
					"plan-review",
					"Review implementation plan",
					who.review,
					back("approved", "plan"),
				),
			);
		list.push(
			agent("implement", "Implement accepted plan", who.implement, {
				inputs: ["plan"],
			}),
		);
		list.push({
			id: "draft-pr",
			name: "Push and create draft PR",
			type: "tool",
			tool: "draft-pr",
		});
		if (on.codeReview) {
			list.push(agent("code-review", "Review code", who.review));
			list.push({
				id: "review-gate",
				name: "Review gate",
				type: "tool",
				tool: "review-gate",
				next: "ci",
				...back("approved", "code-fix"),
			});
			list.push(
				agent("code-fix", "Fix review findings", who.implement, {
					next: "code-review",
				}),
			);
		}
		list.push({
			id: "ci",
			name: "Watch merge readiness",
			type: "tool",
			tool: "ci",
		});
		if (on.qa)
			list.push(
				agent("capture", "Run QA stories and capture screenshots", who.review, {
					qaContract: "qa-v1",
				}),
			);
		if (on.human) {
			list.push(agent("guide", "Prepare human review guide", who.review));
			list.push({
				id: "human-review",
				name: "Human review",
				type: "tool",
				tool: "human-review",
			});
		}
		list.push({
			id: "merge",
			name: "Merge approved revision",
			type: "tool",
			tool: "merge",
		});
		return list;
	}, [on, who]);

	const json = JSON.stringify(
		{
			id: "my-factory",
			name: "My factory",
			icon: "🥞",
			allowedTriggers: ["manual", "ticket-assignment"],
			labels: ["workflow:my-factory"],
			steps,
		},
		null,
		2,
	);
	const mood = !on.human
		? "oops"
		: Object.values(on).every(Boolean)
			? "happy"
			: "alert";

	return (
		<section
			id="recipes"
			className="relative overflow-hidden bg-[linear-gradient(180deg,#fffaf3,#f7f1ff)] py-28 sm:py-36"
		>
			<div className="mx-auto max-w-6xl px-6">
				<SectionTitle
					eyebrow="Recipes"
					color="#7b61ff"
					title={
						<>
							Your process,{" "}
							<span className="rainbow-text">as a JSON graph.</span>
						</>
					}
				>
					Workflows are plain JSON: agent steps, tools, scripts, fan-out, nested
					workflows and loop-back branches. Pick a different agent and model for
					every role. Edit in the Recipes tab — running work keeps its original
					definition.
				</SectionTitle>

				<div className="mt-14 grid gap-8 lg:grid-cols-[380px_1fr]">
					<Reveal className="flex flex-col gap-6">
						<div className="rounded-3xl border border-line bg-white p-6 shadow-sm">
							<div className="mb-4 flex items-center justify-between">
								<div className="font-display text-lg font-bold">Stations</div>
								<Bob mood={mood} size={40} track={false} />
							</div>
							<div className="flex flex-col gap-2">
								{toggles.map((toggle) => (
									<label
										key={toggle.id}
										className="flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-[#f7f3ff]"
									>
										<span className="text-lg">{toggle.icon}</span>
										<span className="flex-1 font-semibold">{toggle.label}</span>
										<input
											type="checkbox"
											className="peer sr-only"
											checked={on[toggle.id]}
											onChange={() =>
												setOn((value) => ({
													...value,
													[toggle.id]: !value[toggle.id],
												}))
											}
										/>
										<span className="relative h-6 w-11 rounded-full bg-[#e3dcf0] transition peer-checked:bg-r6 peer-focus-visible:ring-2 peer-focus-visible:ring-r6 after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5" />
									</label>
								))}
							</div>
							<AnimatePresence>
								{!on.human && (
									<motion.p
										initial={{ opacity: 0, height: 0 }}
										animate={{ opacity: 1, height: "auto" }}
										exit={{ opacity: 0, height: 0 }}
										className="mt-3 overflow-hidden rounded-2xl bg-[#ffe9ec] px-4 py-3 text-sm font-semibold text-[#b0183a]"
									>
										Bob gets nervous merging without you. (It's your recipe,
										though.)
									</motion.p>
								)}
							</AnimatePresence>
						</div>

						<div className="rounded-3xl border border-line bg-white p-6 shadow-sm">
							<div className="mb-4 font-display text-lg font-bold">
								Who does what
							</div>
							<div className="flex flex-col gap-4">
								{roles.map((role) => (
									<div key={role.id}>
										<div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted">
											{role.label}
										</div>
										<LayoutGroup id={role.id}>
											<div className="flex flex-wrap gap-1.5">
												{(Object.keys(runners) as Runner[]).map((runner) => (
													<button
														key={runner}
														type="button"
														onClick={() =>
															setWho((value) => ({
																...value,
																[role.id]: runner,
															}))
														}
														className="relative rounded-full px-3 py-1.5 text-xs font-bold"
													>
														{who[role.id] === runner && (
															<motion.span
																layoutId="pill"
																className="absolute inset-0 rounded-full"
																style={{
																	background: `${runners[runner].color}33`,
																	boxShadow: `inset 0 0 0 1.5px ${runners[runner].color}`,
																}}
																transition={{
																	type: "spring",
																	stiffness: 400,
																	damping: 30,
																}}
															/>
														)}
														<span className="relative">
															{runners[runner].label}
														</span>
													</button>
												))}
											</div>
										</LayoutGroup>
									</div>
								))}
							</div>
						</div>
					</Reveal>

					<Reveal delay={0.1} className="flex min-w-0 flex-col gap-6">
						<div className="rounded-3xl border border-line bg-white/80 p-5 shadow-sm">
							<motion.div layout className="flex flex-wrap items-center gap-2">
								<AnimatePresence initial={false}>
									{steps.map((step, position) => (
										<motion.div
											layout
											key={String(step.id)}
											initial={{ opacity: 0, scale: 0.6 }}
											animate={{ opacity: 1, scale: 1 }}
											exit={{ opacity: 0, scale: 0.6 }}
											transition={{
												type: "spring",
												stiffness: 380,
												damping: 26,
											}}
											className="flex items-center gap-2"
										>
											<span
												className="rounded-xl border px-2.5 py-1.5 font-mono text-[11px] font-bold"
												style={
													step.type === "agent"
														? {
																borderColor: `${runners[(step.runner as Runner) ?? "claude"].color}66`,
																background: `${runners[(step.runner as Runner) ?? "claude"].color}14`,
															}
														: { borderColor: "#efe6f7", background: "#fbf9fe" }
												}
											>
												{"branches" in step ? "↺ " : ""}
												{String(step.id)}
											</span>
											{position < steps.length - 1 && (
												<span className="text-muted/60">→</span>
											)}
										</motion.div>
									))}
								</AnimatePresence>
							</motion.div>
						</div>
						<div className="min-w-0 overflow-hidden rounded-3xl border border-white/10 bg-night shadow-[0_30px_80px_-30px_#2b234688]">
							<div className="flex items-center justify-between border-b border-white/10 px-5 py-3 font-mono text-xs text-white/50">
								<span>~/.bobs-factory/factory/workflows.json</span>
								<span>{steps.length} steps</span>
							</div>
							<pre className="max-h-[520px] overflow-auto p-5 font-mono text-[12.5px] leading-relaxed text-[#e8e2ff]">
								<Highlight code={json} />
							</pre>
						</div>
					</Reveal>
				</div>
			</div>
		</section>
	);
}
