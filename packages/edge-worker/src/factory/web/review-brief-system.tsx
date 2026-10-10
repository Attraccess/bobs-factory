import { type CSSProperties, useState } from "react";
import type { BriefFlow, ReviewBrief } from "../ReviewBrief";
import { Button } from "./ui";

export type FlowFocus = { flow: string; steps: number[] } | undefined;
type FlowStep = BriefFlow["steps"][number];

/** Architecture as concrete artefacts: one sequence diagram per trigger, plus fact tables. */
export function BriefSystem({
	system,
	focus,
	requirementNumber,
}: {
	system: NonNullable<ReviewBrief["system"]>;
	focus: FlowFocus;
	requirementNumber: (id: string) => number | undefined;
}) {
	return (
		<>
			<p className="brief-lead">{system.summary}</p>
			<p className="brief-legend">
				Time runs downward · <span className="brief-tag new">●</span> new ·{" "}
				<span className="brief-tag changed">◆</span> changed · dashed = outside
				the product’s control
			</p>
			<div className="brief-flows">
				{system.flows.map((flow) => (
					<FlowCard
						key={flow.id}
						flow={flow}
						highlight={focus?.flow === flow.id ? focus.steps : []}
						requirementNumber={requirementNumber}
					/>
				))}
			</div>
			{system.interfaces.map((table) => (
				<section key={table.title} className="brief-interface">
					<h4 className="brief-sub">{table.title}</h4>
					<p className="muted">{table.why}</p>
					<div className="brief-table-wrap">
						<table className="brief-table interface">
							<thead>
								<tr>
									<th>
										<span className="sr-only">Change</span>
									</th>
									{table.columns.map((column) => (
										<th key={column}>{column}</th>
									))}
								</tr>
							</thead>
							<tbody>
								{table.rows.map((row, i) => (
									<tr key={i} className={`mark-${row.mark ?? "same"}`}>
										<td>
											<span className={`brief-mark mark-${row.mark ?? "same"}`}>
												{row.mark ?? "same"}
											</span>
										</td>
										{row.cells.map((cell, j) => (
											<td key={j}>{j === 0 ? <code>{cell}</code> : cell}</td>
										))}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			))}
		</>
	);
}

function FlowCard({
	flow,
	highlight,
	requirementNumber,
}: {
	flow: BriefFlow;
	highlight: number[];
	requirementNumber: (id: string) => number | undefined;
}) {
	const [mode, setMode] = useState<"after" | "before">("after");
	const steps = mode === "before" && flow.before ? flow.before : flow.steps;
	return (
		<section
			id={`brief-flow-${flow.id}`}
			className={`brief-flow ${highlight.length ? "focused" : ""}`}
			aria-labelledby={`brief-flow-${flow.id}-title`}
		>
			<header>
				<div>
					<h4 id={`brief-flow-${flow.id}-title`}>{flow.title}</h4>
					<p className="muted">
						Trigger: {flow.trigger} · implements{" "}
						{flow.implements
							.map((id) => `#${requirementNumber(id) ?? "?"}`)
							.join(", ")}
					</p>
				</div>
				{flow.before ? (
					<fieldset className="brief-toggle" aria-label="Show this flow">
						<Button
							variant="secondary"
							aria-pressed={mode === "before"}
							onClick={() => setMode("before")}
						>
							Before
						</Button>
						<Button
							variant="secondary"
							aria-pressed={mode === "after"}
							onClick={() => setMode("after")}
						>
							After this PR
						</Button>
					</fieldset>
				) : (
					<span className="brief-mark mark-new">new flow</span>
				)}
			</header>
			<Sequence
				participants={flow.participants}
				steps={steps}
				highlight={mode === "after" ? highlight : []}
				label={`${flow.title}, ${mode === "before" ? "before this PR" : "after this PR"}`}
			/>
			{flow.note && mode === "after" && (
				<p className="brief-note-text">{flow.note}</p>
			)}
		</section>
	);
}

function Sequence({
	participants,
	steps,
	highlight,
	label,
}: {
	participants: BriefFlow["participants"];
	steps: FlowStep[];
	highlight: number[];
	label: string;
}) {
	const index = (id: string) => participants.findIndex((p) => p.id === id);
	const name = (id: string) =>
		participants.find((p) => p.id === id)?.label ?? id;
	const columns = {
		gridTemplateColumns: `2rem repeat(${participants.length}, minmax(0, 1fr))`,
		"--actors": participants.length,
	} as CSSProperties;
	return (
		<div className="brief-sequence">
			<div className="brief-seq-row actors" style={columns} aria-hidden="true">
				<span />
				{participants.map((p) => (
					<span
						key={p.id}
						className={`brief-actor ${p.external ? "external" : ""}`}
					>
						<strong>{p.label}</strong>
						{p.detail && <small>{p.detail}</small>}
					</span>
				))}
			</div>
			<ol aria-label={label}>
				{steps.map((step, i) => {
					const from = index(step.from),
						to = index(step.to),
						low = Math.min(from, to),
						span = Math.abs(to - from) + 1,
						direction = from === to ? "self" : to < from ? "left" : "right";
					return (
						<li
							key={i}
							className={[
								"brief-seq-row",
								step.change ? `change-${step.change}` : "",
								step.dashed ? "outside" : "",
								step.outcome ? `outcome-${step.outcome}` : "",
								highlight.includes(i + 1) ? "highlight" : "",
							].join(" ")}
							style={columns}
						>
							<span className="brief-seq-number" aria-hidden="true">
								{i + 1}
							</span>
							{participants.map((p, j) => (
								<span
									key={p.id}
									className="brief-lifeline"
									style={{ gridColumn: j + 2, gridRow: 1 }}
									aria-hidden="true"
								/>
							))}
							<div
								className={`brief-message ${direction}`}
								style={
									{
										gridColumn: `${low + 2} / span ${span}`,
										gridRow: 1,
										"--inset": `${50 / span}%`,
									} as CSSProperties
								}
							>
								<span className="sr-only">
									{name(step.from)} to {name(step.to)}:{" "}
								</span>
								<span className="brief-message-label">
									{step.change === "new" && (
										<span className="brief-tag new">
											<span aria-hidden="true">● </span>
											<span className="sr-only">New: </span>
										</span>
									)}
									{step.change === "changed" && (
										<span className="brief-tag changed">
											<span aria-hidden="true">◆ </span>
											<span className="sr-only">Changed: </span>
										</span>
									)}
									{step.outcome === "bad" && "✕ "}
									{step.outcome === "good" && "✓ "}
									{step.label}
								</span>
								{direction !== "self" && (
									<span className="brief-arrow" aria-hidden="true" />
								)}
								{step.detail && (
									<span className="brief-message-detail">{step.detail}</span>
								)}
							</div>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
