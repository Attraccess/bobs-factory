// biome-ignore-all lint/a11y/useKeyWithClickEvents: throwaway prototype (lightbox handles keys globally)
// biome-ignore-all lint/complexity/noCommaOperator: throwaway prototype
// biome-ignore-all lint/suspicious/useIterableCallbackReturn: throwaway prototype
// biome-ignore-all lint/a11y/noStaticElementInteractions: throwaway prototype
// biome-ignore-all lint/a11y/useSemanticElements: throwaway prototype
// biome-ignore-all lint/a11y/noSvgWithoutTitle: throwaway prototype
// PROTOTYPE (throwaway) — taskbot bobs-factory#71: "How should the review guide look so a
// highly technical, non-UI PR can be consumed chunk by chunk?"
// Five variants on the existing `#/runs/:id/review` route, switchable via `?variant=A…E`
// (A = current guide). Read-only: no decision actions outside variant A.
// Variants prefer the proposed enriched fields (see review-prototype-enriched.ts) and
// fall back to what today's GuideSchema provides; `&enriched=0` shows the fallback.
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "./client";
import { DecisionActions } from "./focus";
import { LazyImage } from "./media";
import { type Enriched, enrichedFor } from "./review-prototype-enriched";
import { Markdown } from "./ui";

declare const process: { env: { NODE_ENV?: string } };
export const prototypesEnabled = process.env.NODE_ENV !== "production";

export const VARIANTS: [string, string][] = [
	["A", "Current guide"],
	["F", "Unified Atlas (all ideas)"],
	["B", "Atlas: system map"],
	["C", "Deck: one idea per card"],
	["D", "Triage matrix"],
	["E", "Life of an update"],
];

/* ---------------------------------------------------------------- model */

const HUES = [262, 200, 160, 32, 330, 280, 140, 12, 215];
const color = (i: number, l = 60) => `hsl(${HUES[i % HUES.length]} 70% ${l}%)`;

function shorten(text = "", max = 70) {
	const first = text.split(/(?<=[.;])\s/)[0]!.replace(/[.;]$/, "");
	return first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}…`;
}
function areaOf(file: string) {
	const p = file.split("/"),
		test = /\.(spec|test)\.|\/tests?\//.test(file);
	let area = p.slice(0, 2).join("/");
	if (file.startsWith("apps/api/")) area = "API";
	else if (file.startsWith("apps/frontend/")) area = "Web app";
	else if (file.startsWith("apps/plugins/")) area = `Plugin · ${p[2]}`;
	else if (file.startsWith("libs/plugins-"))
		area = `SDK · ${p[1]!.replace("plugins-", "").replace("-sdk", "")}`;
	else if (file.startsWith("libs/shared")) area = "Shared lib";
	else if (file.startsWith("docs/")) area = "Docs";
	return { area, test, name: p.at(-1)! };
}
const EVIDENCE: [string, string, RegExp][] = [
	[
		"unit",
		"Unit tests",
		/spec\.ts|test\.tsx?|tests? (passed|cover)|regression/i,
	],
	["browser", "Browser run", /browser|capture|screenshot|network\.json/i],
	["ci", "CI", /\bCI\b|actions\/runs/],
	["review", "Code review", /review|discussion_r|issuecomment/i],
];
const GAP =
	/not (verified|exercised|reconstructed)|simulator|fixture|predates|earlier/i;

export type Chapter = ReturnType<typeof buildModel>["chapters"][number];
function buildModel(
	guide: any,
	enriched?: Enriched,
	evidence: any[] = [],
	runId = "",
) {
	const shotOwner = new Map<number, number>();
	const raw: any[] = guide.chapters?.length
		? guide.chapters
		: (guide.behavior ?? []).map((b: any, i: number) => ({
				id: `legacy-${i}`,
				title: b.scenario,
				summary: b.after,
				before: b.before,
				after: b.after,
				requirementIndexes: [],
				files: [],
				screenshots: [],
				diagrams: [],
				reviewChecks: [],
				risks: [],
				evidence: [],
			}));
	const owner = new Map<string, number>();
	const chapters = raw.map((c, i) => {
		const e = enriched?.chapters[c.id];
		for (const f of c.files) if (!owner.has(f)) owner.set(f, i);
		const text = [...c.evidence, ...c.risks].join("\n");
		const shots = c.screenshots
			.map((ref: any) => ({
				...ref,
				shot: evidence.find(
					(s: any) => s.area === ref.area && s.state === ref.state,
				),
			}))
			.filter((x: any) => x.shot);
		for (const x of shots)
			if (!shotOwner.has(x.shot.index)) shotOwner.set(x.shot.index, i);
		return {
			...c,
			index: i,
			color: color(i),
			soft: `color-mix(in srgb, ${color(i)} 22%, transparent)`,
			tldr: e?.tldr ?? shorten(c.summary, 80),
			beforeShort: e?.beforeShort ?? shorten(c.before, 60),
			afterShort: e?.afterShort ?? shorten(c.after, 60),
			nodes: e?.nodes ?? [],
			risk:
				e?.risk ??
				(c.risks.length
					? {
							level: c.risks.length >= 3 ? "high" : "medium",
							text: shorten(c.risks[0], 70),
						}
					: { level: "low", text: "No risks listed" }),
			keyChecks:
				e?.keyChecks ??
				c.reviewChecks
					.slice(0, 3)
					.map((r: string) => ({ do: shorten(r, 90), expect: "" })),
			shots,
			evidenceKinds: EVIDENCE.filter(
				([k, , re]) => re.test(text) || (k === "browser" && shots.length > 0),
			).map(([k, l]) => ({ k, l })),
			gaps: [...c.evidence, ...c.risks].filter((t: string) => GAP.test(t))
				.length,
			files: c.files.map((f: string) => ({ path: f, ...areaOf(f) })),
		};
	});
	const all = [...owner.entries()].map(([path, i]) => ({
		path,
		owner: i,
		...areaOf(path),
	}));
	const supported = guide.requirements.filter(
		(r: any) => r.status === "supported",
	).length;
	return {
		guide,
		enriched,
		chapters,
		files: all,
		tldr: enriched?.tldr ?? shorten(guide.summary, 110),
		supported,
		runId,
		shots: evidence.map((s: any) => ({ ...s, owner: shotOwner.get(s.index) })),
	};
}
type Model = ReturnType<typeof buildModel>;

function useFullGuide(run: any) {
	const value = run.outputs?.guide;
	const q = useQuery({
		queryKey: ["prototype-guide", run.id, value?.__artifactHash],
		enabled: Boolean(value?.__artifactPreview),
		queryFn: ({ signal }) =>
			api(`/api/runs/${run.id}/artifacts/guide`, { signal }),
		staleTime: Infinity,
	});
	return value?.__artifactPreview ? q.data : value;
}

/* ------------------------------------------------------- shared widgets */

function SystemDiagram({
	system,
	mode,
	highlight = [],
	tint,
	onNode,
}: {
	system: Enriched["system"];
	mode: "before" | "after";
	highlight?: string[];
	tint?: string;
	onNode?: (id: string) => void;
}) {
	const W = 124,
		H = 40,
		COL = 186,
		ROW = 62,
		TOP = 34;
	const byLane = system.lanes.map((_, l) =>
		system.nodes.filter((n) => n.lane === l),
	);
	const rows = Math.max(...byLane.map((l) => l.length));
	const pos = new Map<string, { x: number; y: number }>();
	byLane.forEach((nodes, l) =>
		nodes.forEach((n, i) =>
			pos.set(n.id, {
				x: 10 + l * COL,
				y: TOP + ((rows - nodes.length) * ROW) / 2 + i * ROW,
			}),
		),
	);
	const edges = mode === "before" ? system.before : system.after;
	const width = 10 + (system.lanes.length - 1) * COL + W + 10,
		height = TOP + rows * ROW;
	const absent = (s: string) => (mode === "before" ? s === "new" : false);
	return (
		<svg
			className="rp-system"
			viewBox={`0 0 ${width} ${height}`}
			role="img"
			aria-label={`System ${mode} this PR`}
		>
			<defs>
				<marker
					id="rp-arrow"
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="7"
					markerHeight="7"
					orient="auto-start-reverse"
				>
					<path d="M0,0 L10,5 L0,10 z" fill="var(--secondary)" />
				</marker>
			</defs>
			{system.lanes.map((lane, l) => (
				<text key={lane} x={10 + l * COL + W / 2} y={16} className="rp-lane">
					{lane.toUpperCase()}
				</text>
			))}
			{edges.map((e, i) => {
				const a = pos.get(e.from)!,
					b = pos.get(e.to)!;
				const x1 = a.x + W,
					y1 = a.y + H / 2,
					x2 = b.x - 4,
					y2 = b.y + H / 2,
					mx = (x1 + x2) / 2;
				const hot = highlight.includes(e.from) && highlight.includes(e.to);
				return (
					<g
						key={i}
						className={`rp-edge ${e.weak ? "weak" : ""} ${hot ? "hot" : ""}`}
						style={hot && tint ? { stroke: tint } : undefined}
					>
						<path
							d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
							markerEnd="url(#rp-arrow)"
						/>
						{e.label && (hot || mode === "before" || !highlight.length) && (
							<text x={mx} y={(y1 + y2) / 2 - 7} className="rp-edge-label">
								{e.label}
							</text>
						)}
					</g>
				);
			})}
			{system.nodes.map((n) => {
				const p = pos.get(n.id)!,
					on = highlight.includes(n.id),
					gone = absent(n.status),
					dim = mode === "after" && n.status === "legacy";
				return (
					<g
						key={n.id}
						className={`rp-node ${n.status} ${on ? "on" : ""} ${gone ? "gone" : ""} ${dim ? "dim" : ""}`}
						transform={`translate(${p.x},${p.y})`}
						onClick={() => onNode?.(n.id)}
						style={on && tint ? ({ "--tint": tint } as any) : undefined}
					>
						<rect width={W} height={H} rx={12} />
						<text x={W / 2} y={H / 2 + 5}>
							{n.label}
						</text>
						{mode === "after" && n.status === "new" && (
							<text x={W - 8} y={12} className="rp-badge">
								NEW
							</text>
						)}
					</g>
				);
			})}
		</svg>
	);
}

/** Every changed file as a tile, grouped by area, coloured by owning chapter. */
function Footprint({
	model,
	selected,
	onPick,
	only,
}: {
	model: Model;
	selected?: number;
	onPick?: (i: number) => void;
	only?: number;
}) {
	const files =
		only === undefined
			? model.files
			: model.chapters[only]!.files.map((f: any) => ({ ...f, owner: only }));
	const groups = new Map<string, any[]>();
	for (const f of files) groups.set(f.area, [...(groups.get(f.area) ?? []), f]);
	return (
		<div className="rp-footprint">
			{[...groups.entries()]
				.sort((a, b) => b[1].length - a[1].length)
				.map(([area, fs]) => (
					<div className="rp-area" key={area}>
						<small>
							{area} <span className="muted">· {fs.length}</span>
						</small>
						<div className="rp-tiles">
							{fs.map((f) => (
								<button
									type="button"
									key={f.path}
									title={`${f.path}\n→ ${model.chapters[f.owner]!.title}`}
									className={`rp-tile ${f.test ? "test" : ""} ${selected !== undefined && selected !== f.owner ? "faded" : ""}`}
									style={{ "--c": model.chapters[f.owner]!.color } as any}
									onClick={() => onPick?.(f.owner)}
								/>
							))}
						</div>
					</div>
				))}
			<p className="rp-legend muted">
				<span className="rp-tile" /> source <span className="rp-tile test" />{" "}
				test · colour = chapter
			</p>
		</div>
	);
}

function FlowStrip({ diagram, color }: { diagram: any; color: string }) {
	return (
		<ol className="rp-strip" style={{ "--c": color } as any}>
			{diagram.steps.map((s: any, i: number) => (
				<li key={i} title={s.detail}>
					<span>{i + 1}</span>
					{s.label}
				</li>
			))}
		</ol>
	);
}

function BeforeAfter({ c, big }: { c: Chapter; big?: boolean }) {
	return (
		<div className={`rp-ba ${big ? "big" : ""}`}>
			<div className="before">
				<small>BEFORE</small>
				{c.beforeShort}
			</div>
			<span className="arrow" aria-hidden>
				→
			</span>
			<div className="after" style={{ borderColor: c.color }}>
				<small>AFTER</small>
				{c.afterShort}
			</div>
		</div>
	);
}

function RiskDot({ level }: { level: string }) {
	return <span className={`rp-risk ${level}`} title={`${level} risk`} />;
}

function Checks({
	c,
	done,
	toggle,
}: {
	c: Chapter;
	done: Record<string, boolean>;
	toggle: (k: string) => void;
}) {
	return (
		<ul className="rp-checks">
			{c.keyChecks.map((k: any, i: number) => {
				const key = `${c.id}/${i}`;
				return (
					<li key={key}>
						<label>
							<input
								type="checkbox"
								checked={!!done[key]}
								onChange={() => toggle(key)}
							/>
							<span>
								<b>{k.do}</b>
								{k.expect && <em> → {k.expect}</em>}
							</span>
						</label>
					</li>
				);
			})}
		</ul>
	);
}

function FullText({ c }: { c: Chapter }) {
	return (
		<details className="rp-more">
			<summary>Full text, evidence & {c.files.length} files</summary>
			<Markdown>{c.summary}</Markdown>
			<p>
				<b>Before:</b> {c.before}
			</p>
			<p>
				<b>After:</b> {c.after}
			</p>
			{c.reviewChecks.length > 0 && <h4>All checks</h4>}
			<ul>
				{c.reviewChecks.map((x: string, i: number) => (
					<li key={i}>{x}</li>
				))}
			</ul>
			{c.risks.length > 0 && <h4>Risks</h4>}
			<ul>
				{c.risks.map((x: string, i: number) => (
					<li key={i}>{x}</li>
				))}
			</ul>
			<h4>Evidence</h4>
			<ul>
				{c.evidence.map((x: string, i: number) => (
					<li key={i}>
						<Markdown>{x}</Markdown>
					</li>
				))}
			</ul>
			<h4>Files</h4>
			<ul className="rp-filelist">
				{c.files.map((f: any) => (
					<li key={f.path} className={f.test ? "test" : ""}>
						<code>{f.path}</code>
					</li>
				))}
			</ul>
		</details>
	);
}

function useChecks() {
	const [done, setDone] = useState<Record<string, boolean>>({});
	return [done, (k: string) => setDone((d) => ({ ...d, [k]: !d[k] }))] as const;
}

const NeedsField = ({ field }: { field: string }) => (
	<p className="rp-needs">
		Needs the proposed <code>{field}</code> guide field — not in today's schema
		(try without <code>enriched=0</code>).
	</p>
);

/* ------------------------------------------------------- B · Atlas */

function VariantB({ model }: { model: Model }) {
	const [sel, setSel] = useState(0),
		[mode, setMode] = useState<"before" | "after">("after"),
		[done, toggle] = useChecks(),
		c = model.chapters[sel]!,
		sys = model.enriched?.system;
	return (
		<div className="rp-atlas">
			<div className="rp-atlas-main">
				<p className="rp-tldr">{model.tldr}</p>
				<section className="rp-panel">
					<header className="rp-row">
						<h3>The system</h3>
						<div className="rp-seg" role="group">
							{(["before", "after"] as const).map((m) => (
								<button
									type="button"
									key={m}
									className={mode === m ? "on" : ""}
									onClick={() => setMode(m)}
								>
									{m === "before" ? "Before" : "After"}
								</button>
							))}
						</div>
					</header>
					{sys ? (
						<SystemDiagram
							system={sys}
							mode={mode}
							highlight={c.nodes}
							tint={c.color}
							onNode={(id) => {
								const i = model.chapters.findIndex((x: Chapter) =>
									x.nodes.includes(id),
								);
								if (i >= 0) setSel(i);
							}}
						/>
					) : (
						<NeedsField field="system" />
					)}
				</section>
				<div className="rp-pins">
					{model.chapters.map((x: Chapter) => (
						<button
							type="button"
							key={x.id}
							className={x.index === sel ? "on" : ""}
							style={{ "--c": x.color } as any}
							onClick={() => setSel(x.index)}
						>
							<span>{x.index + 1}</span>
							{x.title}
							{x.keyChecks.every((_: any, i: number) => done[`${x.id}/${i}`]) &&
								" ✓"}
						</button>
					))}
				</div>
				<section className="rp-panel">
					<h3>Where the code changed</h3>
					<Footprint model={model} selected={sel} onPick={setSel} />
				</section>
			</div>
			<aside className="rp-drawer" style={{ "--c": c.color } as any}>
				<small>
					CHAPTER {sel + 1} / {model.chapters.length}
				</small>
				<h2>{c.title}</h2>
				<p className="rp-tldr small">{c.tldr}</p>
				<BeforeAfter c={c} />
				{c.diagrams.map((d: any, i: number) => (
					<FlowStrip key={i} diagram={d} color={c.color} />
				))}
				<div className="rp-riskline">
					<RiskDot level={c.risk.level} /> {c.risk.text}
				</div>
				<h4>Check</h4>
				<Checks c={c} done={done} toggle={toggle} />
				<FullText c={c} />
				<div className="rp-row">
					<button
						type="button"
						disabled={sel === 0}
						onClick={() => setSel(sel - 1)}
					>
						↑ Prev
					</button>
					<button
						type="button"
						disabled={sel === model.chapters.length - 1}
						onClick={() => setSel(sel + 1)}
					>
						Next ↓
					</button>
				</div>
			</aside>
		</div>
	);
}

/* ------------------------------------------------------- C · Deck */

type Card = { chapter?: number; kind: string };
function VariantC({ model }: { model: Model }) {
	const cards = useMemo(() => {
		const out: Card[] = [{ kind: "intro" }];
		model.chapters.forEach((c: Chapter, i: number) => {
			out.push({ chapter: i, kind: "idea" });
			if (c.diagrams.length) out.push({ chapter: i, kind: "flow" });
			if (c.nodes.length && model.enriched)
				out.push({ chapter: i, kind: "map" });
			out.push({ chapter: i, kind: "where" });
			out.push({ chapter: i, kind: "check" });
		});
		out.push({ kind: "end" });
		return out;
	}, [model]);
	const [at, setAt] = useState(0),
		[step, setStep] = useState(0),
		[done, toggle] = useChecks(),
		card = cards[at]!,
		c = card.chapter !== undefined ? model.chapters[card.chapter]! : undefined;
	const flowLen = card.kind === "flow" ? c!.diagrams[0].steps.length : 0;
	const next = () =>
		card.kind === "flow" && step < flowLen - 1
			? setStep(step + 1)
			: (setAt(Math.min(at + 1, cards.length - 1)), setStep(0));
	const prev = () =>
		card.kind === "flow" && step > 0
			? setStep(step - 1)
			: (setAt(Math.max(at - 1, 0)), setStep(0));
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (
				(e.target as HTMLElement)?.closest?.(
					"input,textarea,select,[contenteditable]",
				)
			)
				return;
			if (e.key === "ArrowDown" || e.key === " " || e.key === "j")
				e.preventDefault(), next();
			if (e.key === "ArrowUp" || e.key === "k") e.preventDefault(), prev();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});
	return (
		<div className="rp-deck">
			<div className="rp-deck-progress">
				{model.chapters.map((x: Chapter) => {
					const own = cards
						.map((k, i) => [k, i] as const)
						.filter(([k]) => k.chapter === x.index);
					return (
						<button
							type="button"
							key={x.id}
							title={x.title}
							style={{ "--c": x.color } as any}
							className={
								c?.index === x.index
									? "on"
									: own.every(([, i]) => i < at)
										? "seen"
										: ""
							}
							onClick={() => (setAt(own[0]![1]), setStep(0))}
						/>
					);
				})}
			</div>
			<section
				className={`rp-card ${card.kind}`}
				style={c ? ({ "--c": c.color, "--soft": c.soft } as any) : undefined}
				key={`${at}`}
			>
				{c && (
					<small className="rp-kicker">
						{c.index + 1}. {c.title}
					</small>
				)}
				{card.kind === "intro" && (
					<>
						<small className="rp-kicker">THIS PR IN ONE LINE</small>
						<p className="rp-huge">{model.tldr}</p>
						<p className="muted">
							{model.chapters.length} changes · {model.files.length} files ·{" "}
							{model.supported}/{model.guide.requirements.length} criteria
							supported
						</p>
						<ol className="rp-mini-toc">
							{model.chapters.map((x: Chapter) => (
								<li key={x.id} style={{ "--c": x.color } as any}>
									{x.tldr}
								</li>
							))}
						</ol>
					</>
				)}
				{card.kind === "idea" && (
					<>
						<p className="rp-huge">{c!.tldr}</p>
						<BeforeAfter c={c!} big />
					</>
				)}
				{card.kind === "flow" && (
					<>
						<h3>{c!.diagrams[0].title}</h3>
						<ol className="rp-reveal">
							{c!.diagrams[0].steps.map((s: any, i: number) => (
								<li
									key={i}
									className={i < step ? "past" : i === step ? "now" : "future"}
								>
									<span>{i + 1}</span>
									<div>
										<b>{s.label}</b>
										{i === step && <p>{s.detail}</p>}
									</div>
								</li>
							))}
						</ol>
					</>
				)}
				{card.kind === "map" && model.enriched && (
					<>
						<h3>Where this sits in the system</h3>
						<SystemDiagram
							system={model.enriched.system}
							mode="after"
							highlight={c!.nodes}
							tint={c!.color}
						/>
					</>
				)}
				{card.kind === "where" && (
					<>
						<h3>
							Code touched · {c!.files.length} files (
							{c!.files.filter((f: any) => f.test).length} tests)
						</h3>
						<Footprint model={model} only={c!.index} />
					</>
				)}
				{card.kind === "check" && (
					<>
						<div className="rp-riskline big">
							<RiskDot level={c!.risk.level} /> {c!.risk.text}
						</div>
						<h3>Try these</h3>
						<Checks c={c!} done={done} toggle={toggle} />
						<FullText c={c!} />
					</>
				)}
				{card.kind === "end" && (
					<>
						<small className="rp-kicker">READY TO DECIDE?</small>
						<p className="rp-huge">
							{shorten(model.guide.decision.summary, 90)}
						</p>
						<div className="rp-endgrid">
							{model.chapters.map((x: Chapter) => (
								<div key={x.id} style={{ "--c": x.color } as any}>
									<RiskDot level={x.risk.level} /> {x.title}
									<span className="muted">
										{" "}
										{
											x.keyChecks.filter(
												(_: any, i: number) => done[`${x.id}/${i}`],
											).length
										}
										/{x.keyChecks.length}
									</span>
								</div>
							))}
						</div>
						<p className="muted">
							Approve / request changes live on variant A in this prototype.
						</p>
					</>
				)}
			</section>
			<footer className="rp-row rp-deck-nav">
				<button type="button" onClick={prev} disabled={at === 0 && step === 0}>
					↑ Back
				</button>
				<span className="muted">
					card {at + 1}/{cards.length} · ↑ ↓ / space
				</span>
				<button
					type="button"
					className="primary"
					onClick={next}
					disabled={at === cards.length - 1}
				>
					{card.kind === "flow" && step < flowLen - 1
						? "Next step ↓"
						: "Next ↓"}
				</button>
			</footer>
		</div>
	);
}

/* ------------------------------------------------------- D · Triage matrix */

function VariantD({ model }: { model: Model }) {
	const [open, setOpen] = useState<number>(),
		[done, toggle] = useChecks();
	const areas = [...new Set(model.files.map((f) => f.area))];
	const risks = model.chapters.filter(
		(c: Chapter) => c.risk.level !== "low",
	).length;
	return (
		<div className="rp-matrix">
			<p className="rp-tldr">{model.tldr}</p>
			<div className="rp-kpis">
				<div>
					<b>{model.chapters.length}</b>changes
				</div>
				<div>
					<b>{model.files.length}</b>files ·{" "}
					{model.files.filter((f) => f.test).length} tests
				</div>
				<div
					className={
						model.supported === model.guide.requirements.length
							? "good"
							: "warn"
					}
				>
					<b>
						{model.supported}/{model.guide.requirements.length}
					</b>
					criteria supported
				</div>
				<div className={risks ? "warn" : "good"}>
					<b>{risks}</b>changes need care
				</div>
				<div
					className={model.guide.decision.status === "ready" ? "good" : "warn"}
				>
					<b>
						{model.guide.decision.status === "ready" ? "Ready" : "Attention"}
					</b>
					bot verdict
				</div>
			</div>
			<table>
				<thead>
					<tr>
						<th>#</th>
						<th>Change</th>
						<th>Before → after</th>
						<th>Footprint</th>
						<th>Proof</th>
						<th>Risk</th>
						<th>Checked</th>
					</tr>
				</thead>
				<tbody>
					{model.chapters.map((c: Chapter) => {
						const by = areas.map(
							(a) => c.files.filter((f: any) => f.area === a).length,
						);
						const n = c.keyChecks.filter(
							(_: any, i: number) => done[`${c.id}/${i}`],
						).length;
						return [
							<tr
								key={c.id}
								className={open === c.index ? "open" : ""}
								onClick={() => setOpen(open === c.index ? undefined : c.index)}
								style={{ "--c": c.color } as any}
							>
								<td>
									<span className="rp-num">{c.index + 1}</span>
								</td>
								<td>
									<b>{c.title}</b>
									<div className="muted">{c.tldr}</div>
								</td>
								<td className="rp-ba-cell">
									<s>{c.beforeShort}</s>
									<span>{c.afterShort}</span>
								</td>
								<td>
									<div
										className="rp-bars"
										title={areas.map((a, i) => `${a}: ${by[i]}`).join("\n")}
									>
										{by.map(
											(v, i) =>
												v > 0 && (
													<i
														key={i}
														style={{
															flexGrow: v,
															background: `hsl(${(i * 47) % 360} 55% 62%)`,
														}}
													/>
												),
										)}
									</div>
									<small className="muted">{c.files.length} files</small>
								</td>
								<td>
									<div className="rp-proof">
										{EVIDENCE.map(([k, l]) => (
											<span
												key={k}
												className={
													c.evidenceKinds.some((e: any) => e.k === k)
														? "yes"
														: "no"
												}
												title={l}
											>
												{k === "unit"
													? "T"
													: k === "browser"
														? "B"
														: k === "ci"
															? "CI"
															: "R"}
											</span>
										))}
										{c.gaps > 0 && (
											<span
												className="gap"
												title="Evidence with limits (fixtures, simulators, earlier runs)"
											>
												⚠{c.gaps}
											</span>
										)}
									</div>
								</td>
								<td>
									<RiskDot level={c.risk.level} />
								</td>
								<td>
									{n}/{c.keyChecks.length}
								</td>
							</tr>,
							open === c.index && (
								<tr
									key={`${c.id}-x`}
									className="rp-expanded"
									style={{ "--c": c.color } as any}
								>
									<td />
									<td colSpan={6}>
										<div className="rp-exp-grid">
											<div>
												{c.diagrams.map((d: any, i: number) => (
													<FlowStrip key={i} diagram={d} color={c.color} />
												))}
												<div className="rp-riskline">
													<RiskDot level={c.risk.level} /> {c.risk.text}
												</div>
												<Checks c={c} done={done} toggle={toggle} />
											</div>
											<div>
												<FullText c={c} />
											</div>
										</div>
									</td>
								</tr>
							),
						];
					})}
				</tbody>
			</table>
			<p className="rp-legend muted">
				Proof: T unit tests · B browser run · CI · R code review · ⚠ evidence
				with limits (fixtures, simulators, earlier runs)
			</p>
			<details className="rp-more">
				<summary>Overall risks ({model.guide.risks.length})</summary>
				<ul>
					{model.guide.risks.map((r: string, i: number) => (
						<li key={i}>{r}</li>
					))}
				</ul>
			</details>
		</div>
	);
}

/* ------------------------------------------------------- E · Life of an update */

function VariantE({ model }: { model: Model }) {
	const seq = model.enriched?.sequence,
		[sel, setSel] = useState<number>(),
		[upTo, setUpTo] = useState(seq ? seq.steps.length : 0),
		[done, toggle] = useChecks();
	if (!seq)
		return (
			<div className="rp-life">
				<NeedsField field="sequence" />
				{model.chapters.map((c: Chapter) => (
					<section className="rp-panel" key={c.id}>
						<h3 style={{ color: c.color }}>{c.title}</h3>
						{c.diagrams.map((d: any, i: number) => (
							<FlowStrip key={i} diagram={d} color={c.color} />
						))}
					</section>
				))}
			</div>
		);
	const chapterIdx = (id: string) =>
		model.chapters.findIndex((c: Chapter) => c.id === id);
	const COL = 112,
		ROW = 40,
		TOP = 52,
		cx = (id: string) => 60 + seq.actors.findIndex((a) => a.id === id) * COL;
	const width = 60 + (seq.actors.length - 1) * COL + 60,
		height = TOP + seq.steps.length * ROW + 20;
	const c = sel !== undefined ? model.chapters[sel] : undefined;
	return (
		<div className="rp-life">
			<p className="rp-tldr">
				Follow one live update from a tab to a device and back. Each arrow
				belongs to a chapter — click it.
			</p>
			<div className="rp-life-grid">
				<div className="rp-panel">
					<svg className="rp-seq" viewBox={`0 0 ${width} ${height}`}>
						<defs>
							<marker
								id="rp-seq-arrow"
								viewBox="0 0 10 10"
								refX="9"
								refY="5"
								markerWidth="6"
								markerHeight="6"
								orient="auto-start-reverse"
							>
								<path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
							</marker>
						</defs>
						{seq.actors.map((a) => (
							<g key={a.id}>
								<line
									x1={cx(a.id)}
									x2={cx(a.id)}
									y1={TOP - 8}
									y2={height - 10}
									className="rp-lifeline"
								/>
								<rect
									x={cx(a.id) - 50}
									y={6}
									width={100}
									height={30}
									rx={10}
									className="rp-actor"
								/>
								<text x={cx(a.id)} y={26} className="rp-actor-label">
									{a.label}
								</text>
							</g>
						))}
						{seq.steps.map((s, i) => {
							const ci = chapterIdx(s.chapter),
								col = model.chapters[ci]?.color ?? "gray",
								y = TOP + i * ROW + 22,
								x1 = cx(s.from),
								x2 = cx(s.to),
								self = x1 === x2,
								faded = (sel !== undefined && sel !== ci) || i >= upTo;
							return (
								<g
									key={i}
									className={`rp-msg ${faded ? "faded" : ""}`}
									onClick={() => setSel(ci)}
									style={{ stroke: col }}
								>
									<rect
										x={0}
										y={y - 26}
										width={width}
										height={ROW}
										className="rp-hit"
									/>
									{self ? (
										<path
											d={`M${x1},${y - 8} h34 v14 h-30`}
											markerEnd="url(#rp-seq-arrow)"
											fill="none"
										/>
									) : (
										<line
											x1={x1}
											x2={x2 + (x2 > x1 ? -4 : 4)}
											y1={y}
											y2={y}
											markerEnd="url(#rp-seq-arrow)"
										/>
									)}
									<text
										x={self ? x1 + 40 : (x1 + x2) / 2}
										y={self ? y : y - 6}
										className={`rp-msg-label ${self ? "left" : ""}`}
										style={{ fill: col }}
									>
										{s.label}
									</text>
									{s.note && (
										<text
											x={Math.max(x1, x2) + (self ? 40 : 8)}
											y={self ? y + 14 : y + 4}
											className="rp-msg-note"
										>
											{s.note}
										</text>
									)}
									<circle
										cx={14}
										cy={y}
										r={9}
										style={{ fill: col, stroke: "none" }}
									/>
									<text x={14} y={y + 4} className="rp-step-num">
										{ci + 1}
									</text>
								</g>
							);
						})}
					</svg>
					<div className="rp-row">
						<button
							type="button"
							onClick={() => setUpTo(Math.max(1, upTo - 1))}
						>
							◀ step
						</button>
						<span className="muted">
							{upTo}/{seq.steps.length} messages
						</span>
						<button
							type="button"
							onClick={() => setUpTo(Math.min(seq.steps.length, upTo + 1))}
						>
							step ▶
						</button>
						<button type="button" onClick={() => setUpTo(1)}>
							replay from start
						</button>
					</div>
				</div>
				<aside
					className="rp-drawer"
					style={c ? ({ "--c": c.color } as any) : undefined}
				>
					{c ? (
						<>
							<small>
								CHAPTER {c.index + 1} ·{" "}
								<button
									type="button"
									className="rp-link"
									onClick={() => setSel(undefined)}
								>
									show all
								</button>
							</small>
							<h2>{c.title}</h2>
							<p className="rp-tldr small">{c.tldr}</p>
							<BeforeAfter c={c} />
							<div className="rp-riskline">
								<RiskDot level={c.risk.level} /> {c.risk.text}
							</div>
							<Checks c={c} done={done} toggle={toggle} />
							<FullText c={c} />
						</>
					) : (
						<>
							<small>CHAPTERS</small>
							<ol className="rp-legend-list">
								{model.chapters.map((x: Chapter) => (
									<li key={x.id}>
										<button
											type="button"
											onClick={() => setSel(x.index)}
											style={{ "--c": x.color } as any}
										>
											<span>{x.index + 1}</span>
											{x.title}
										</button>
									</li>
								))}
							</ol>
						</>
					)}
				</aside>
			</div>
		</div>
	);
}

/* ------------------------------------------------------- F · Unified Atlas */
// Atlas layout (B) + lens tabs for the system map, the sequence story (E), the
// screenshot sheet and the code footprint; chapter rows carry the triage signals (D); the
// drawer adapts to the chapter (screens for visual changes, step-reveal flow for technical
// ones, both for mixed); focus mode (`f`) turns the drawer into a deck-like card (C).

type Lens = "system" | "story" | "screens" | "code";
const LENS_LABEL: Record<Lens, string> = {
	system: "System",
	story: "Story",
	screens: "Screens",
	code: "Code",
};
const shotUrl = (model: Model, shot: any) =>
	`/api/runs/${model.runId}/screenshots/${shot.index}?v=${shot.imageSha256 ?? ""}`;
const device = (state: string) =>
	/mobile|390|DE mobile/i.test(state)
		? "Mobile"
		: /480×480|reader/i.test(state)
			? "Reader"
			: /email|receipt/i.test(state)
				? "Email"
				: "Desktop";
function kindOf(c: Chapter) {
	const visual = c.shots.length > 0,
		technical = c.nodes.length > 0 || c.diagrams.length > 0;
	return visual && technical
		? "Visual + logic"
		: visual
			? "Visual"
			: technical
				? "Logic"
				: "Supporting";
}

function SequenceDiagram({
	model,
	selected,
	onPick,
}: {
	model: Model;
	selected?: string;
	onPick: (i: number) => void;
}) {
	const seq = model.enriched!.sequence,
		COL = Math.max(112, Math.min(170, 640 / seq.actors.length)),
		ROW = 38,
		TOP = 50,
		cx = (id: string) => 70 + seq.actors.findIndex((a) => a.id === id) * COL,
		width = 70 + (seq.actors.length - 1) * COL + 90,
		height = TOP + seq.steps.length * ROW + 14;
	return (
		<svg className="rp-seq" viewBox={`0 0 ${width} ${height}`}>
			<defs>
				<marker
					id="rp-useq-arrow"
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="6"
					markerHeight="6"
					orient="auto-start-reverse"
				>
					<path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
				</marker>
			</defs>
			{seq.actors.map((a) => (
				<g key={a.id}>
					<line
						x1={cx(a.id)}
						x2={cx(a.id)}
						y1={TOP - 8}
						y2={height - 6}
						className="rp-lifeline"
					/>
					<rect
						x={cx(a.id) - 54}
						y={6}
						width={108}
						height={30}
						rx={10}
						className="rp-actor"
					/>
					<text x={cx(a.id)} y={26} className="rp-actor-label">
						{a.label}
					</text>
				</g>
			))}
			{seq.steps.map((s, i) => {
				const ci = model.chapters.findIndex((c: Chapter) => c.id === s.chapter),
					col = model.chapters[ci]?.color ?? "gray",
					y = TOP + i * ROW + 20,
					x1 = cx(s.from),
					x2 = cx(s.to),
					self = x1 === x2,
					faded = selected !== undefined && selected !== s.chapter;
				return (
					<g
						key={i}
						className={`rp-msg ${faded ? "faded" : ""}`}
						onClick={() => onPick(ci)}
						style={{ stroke: col }}
					>
						<rect
							x={0}
							y={y - 24}
							width={width}
							height={ROW}
							className="rp-hit"
						/>
						{self ? (
							<path
								d={`M${x1},${y - 8} h34 v14 h-30`}
								markerEnd="url(#rp-useq-arrow)"
								fill="none"
							/>
						) : (
							<line
								x1={x1}
								x2={x2 + (x2 > x1 ? -4 : 4)}
								y1={y}
								y2={y}
								markerEnd="url(#rp-useq-arrow)"
							/>
						)}
						<text
							x={self ? x1 + 40 : (x1 + x2) / 2}
							y={self ? y : y - 6}
							className={`rp-msg-label ${self ? "left" : ""}`}
							style={{ fill: col }}
						>
							{s.label}
						</text>
						{s.note && (
							<text
								x={Math.max(x1, x2) + (self ? 40 : 8)}
								y={self ? y + 14 : y + 4}
								className="rp-msg-note"
							>
								{s.note}
							</text>
						)}
						<circle
							cx={16}
							cy={y}
							r={9}
							style={{ fill: col, stroke: "none" }}
						/>
						<text x={16} y={y + 4} className="rp-step-num">
							{ci + 1}
						</text>
					</g>
				);
			})}
		</svg>
	);
}

/** All accepted screenshots as a contact sheet, grouped by UI area, coloured by chapter. */
function ScreenSheet({
	model,
	selected,
	onOpen,
}: {
	model: Model;
	selected?: number;
	onOpen: (list: any[], i: number) => void;
}) {
	const groups = new Map<string, any[]>();
	for (const s of model.shots)
		groups.set(s.area, [...(groups.get(s.area) ?? []), s]);
	return (
		<div className="rp-sheet">
			{[...groups.entries()].map(([area, shots]) => {
				const owner = shots.find((s) => s.owner !== undefined)?.owner,
					c = owner !== undefined ? model.chapters[owner] : undefined;
				return (
					<div
						className={`rp-sheet-group ${selected !== undefined && owner !== selected ? "faded" : ""}`}
						key={area}
						style={{ "--c": c?.color ?? "var(--line)" } as any}
					>
						<small>
							{c && <span className="rp-dotnum">{c.index + 1}</span>}
							{area}
						</small>
						<div>
							{shots.map((s, i) => (
								<button
									type="button"
									key={s.index}
									className={`rp-thumb ${device(s.state).toLowerCase()}`}
									onClick={() =>
										onOpen(
											shots.map((x) => ({ shot: x, caption: x.caption })),
											i,
										)
									}
									title={s.state}
								>
									<LazyImage src={shotUrl(model, s)} alt={s.caption} />
									<span>{device(s.state)}</span>
								</button>
							))}
						</div>
					</div>
				);
			})}
		</div>
	);
}

function Lightbox({
	model,
	box,
	onClose,
}: {
	model: Model;
	box: { list: any[]; i: number };
	onClose: (next?: { list: any[]; i: number }) => void;
}) {
	const item = box.list[box.i],
		go = (d: number) =>
			onClose({
				...box,
				i: (box.i + d + box.list.length) % box.list.length,
			});
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!["Escape", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
			e.stopImmediatePropagation();
			if (e.key === "Escape") onClose();
			else go(e.key === "ArrowLeft" ? -1 : 1);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	});
	return (
		<div className="rp-lightbox" onClick={() => onClose()}>
			<figure onClick={(e) => e.stopPropagation()}>
				<img src={shotUrl(model, item.shot)} alt={item.caption} />
				<figcaption>
					<b>{item.caption}</b>
					<span className="muted">{item.shot.state}</span>
				</figcaption>
				<div className="rp-row">
					<button type="button" onClick={() => go(-1)}>
						← prev
					</button>
					<span className="muted">
						{box.i + 1}/{box.list.length} · Esc to close
					</span>
					<button type="button" onClick={() => go(1)}>
						next →
					</button>
				</div>
			</figure>
		</div>
	);
}

function VariantF({
	model,
	run,
	onSettled,
	settling,
}: {
	model: Model;
	run: any;
	onSettled?: () => void;
	settling?: boolean;
}) {
	const n = model.chapters.length,
		seq = model.enriched?.sequence;
	const has = (lens: Lens, c?: Chapter) =>
		lens === "system"
			? Boolean(model.enriched?.system) && (!c || c.nodes.length > 0)
			: lens === "story"
				? Boolean(seq) && (!c || seq!.steps.some((s) => s.chapter === c.id))
				: lens === "screens"
					? model.shots.length > 0 && (!c || c.shots.length > 0)
					: !c || c.files.length > 0;
	const lenses = (["system", "story", "screens", "code"] as Lens[]).filter(
		(l) => has(l),
	);
	const [sel, setSel] = useState(0), // n = decide page
		[chosenLens, setLens] = useState<Lens>(lenses[0]!),
		[mode, setMode] = useState<"before" | "after">("after"),
		[focus, setFocus] = useState(false),
		[step, setStep] = useState<number>(),
		[box, setBox] = useState<{ list: any[]; i: number }>(),
		[reviewed, setReviewed] = useState<Record<string, boolean>>({}),
		[done, toggle] = useChecks();
	const lens = lenses.includes(chosenLens) ? chosenLens : lenses[0]!;
	const c = sel < n ? model.chapters[sel] : undefined;
	const pick = (i: number) => {
		const next = Math.max(0, Math.min(n, i));
		setSel(next);
		setStep(undefined);
		const ch = model.chapters[next];
		if (ch && !has(lens, ch)) {
			const l = lenses.find((x) => has(x, ch));
			if (l) setLens(l);
		}
	};
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (
				box ||
				(e.target as HTMLElement)?.closest?.(
					"input,textarea,select,[contenteditable]",
				)
			)
				return;
			if (e.key === "ArrowDown" || e.key === "j") {
				e.preventDefault();
				pick(sel + 1);
			}
			if (e.key === "ArrowUp" || e.key === "k") {
				e.preventDefault();
				pick(sel - 1);
			}
			if (e.key === "f") setFocus((f) => !f);
			if (e.key === "Escape") setFocus(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});
	const reviewedCount = model.chapters.filter(
		(x: Chapter) => reviewed[x.id],
	).length;
	const care = model.chapters.filter(
		(x: Chapter) => x.risk.level !== "low",
	).length;
	return (
		<div className={`rp-unified ${focus ? "focus" : ""}`}>
			<div className="rp-u-top">
				<p className="rp-tldr">{model.tldr}</p>
				<div className="rp-u-kpis">
					<span>
						<b>{n}</b> changes
					</span>
					<span>
						<b>{model.files.length}</b> files ·{" "}
						{model.files.filter((f) => f.test).length} tests
					</span>
					{model.shots.length > 0 && (
						<span>
							<b>{model.shots.length}</b> screens
						</span>
					)}
					<span
						className={
							model.supported === model.guide.requirements.length
								? "good"
								: "warn"
						}
					>
						<b>
							{model.supported}/{model.guide.requirements.length}
						</b>{" "}
						criteria
					</span>
					<span className={care ? "warn" : "good"}>
						<b>{care}</b> need care
					</span>
					<span>
						<b>
							{reviewedCount}/{n}
						</b>{" "}
						reviewed
					</span>
				</div>
			</div>
			<div className="rp-u-grid">
				<div className="rp-u-main">
					<section className="rp-panel rp-u-lens">
						<header className="rp-row">
							<div className="rp-seg" role="tablist">
								{lenses.map((l) => (
									<button
										type="button"
										role="tab"
										aria-selected={lens === l}
										key={l}
										className={lens === l ? "on" : ""}
										onClick={() => setLens(l)}
									>
										{LENS_LABEL[l]}
										{c && has(l, c) && (
											<i
												className="rp-lens-dot"
												style={{ background: c.color }}
											/>
										)}
									</button>
								))}
							</div>
							{lens === "system" && (
								<div className="rp-seg">
									{(["before", "after"] as const).map((m) => (
										<button
											type="button"
											key={m}
											className={mode === m ? "on" : ""}
											onClick={() => setMode(m)}
										>
											{m === "before" ? "Before" : "After"}
										</button>
									))}
								</div>
							)}
						</header>
						{lens === "system" && model.enriched && (
							<SystemDiagram
								system={model.enriched.system}
								mode={mode}
								highlight={c?.nodes ?? []}
								tint={c?.color}
								onNode={(id) => {
									const i = model.chapters.findIndex((x: Chapter) =>
										x.nodes.includes(id),
									);
									if (i >= 0) pick(i);
								}}
							/>
						)}
						{lens === "story" && seq && (
							<SequenceDiagram model={model} selected={c?.id} onPick={pick} />
						)}
						{lens === "screens" && (
							<ScreenSheet
								model={model}
								selected={c?.index}
								onOpen={(list, i) => setBox({ list, i })}
							/>
						)}
						{lens === "code" && (
							<Footprint model={model} selected={c?.index} onPick={pick} />
						)}
					</section>
					<ol className="rp-rail">
						{model.chapters.map((x: Chapter) => {
							const checked = x.keyChecks.filter(
								(_: any, i: number) => done[`${x.id}/${i}`],
							).length;
							return (
								<li key={x.id}>
									<button
										type="button"
										className={x.index === sel ? "on" : ""}
										style={{ "--c": x.color } as any}
										onClick={() => pick(x.index)}
									>
										<span className="rp-num">
											{reviewed[x.id] ? "✓" : x.index + 1}
										</span>
										<span className="rp-rail-text">
											<b>{x.title}</b>
											<small>{x.tldr}</small>
										</span>
										<span className="rp-kind">{kindOf(x)}</span>
										<span className="rp-proof">
											{EVIDENCE.map(([k, l]) => (
												<span
													key={k}
													className={
														x.evidenceKinds.some((e: any) => e.k === k)
															? "yes"
															: "no"
													}
													title={l}
												>
													{k === "unit"
														? "T"
														: k === "browser"
															? "B"
															: k === "ci"
																? "CI"
																: "R"}
												</span>
											))}
											{x.gaps > 0 && (
												<span
													className="gap"
													title="Evidence with limits (fixtures, simulators, earlier runs)"
												>
													⚠{x.gaps}
												</span>
											)}
										</span>
										<RiskDot level={x.risk.level} />
										<span className="rp-count">
											{checked}/{x.keyChecks.length}
										</span>
									</button>
								</li>
							);
						})}
						<li>
							<button
								type="button"
								className={`rp-decide ${sel === n ? "on" : ""}`}
								onClick={() => pick(n)}
							>
								<span className="rp-num">✓</span>
								<span className="rp-rail-text">
									<b>Decide</b>
									<small>
										{reviewedCount}/{n} chapters reviewed · bot says{" "}
										{model.guide.decision.status}
									</small>
								</span>
							</button>
						</li>
					</ol>
					<p className="rp-legend muted">
						Proof: T tests · B browser/screens · CI · R code review · ⚠ evidence
						with limits · ↑↓ chapters · f focus
					</p>
				</div>
				<aside
					className="rp-drawer rp-u-drawer"
					style={c ? ({ "--c": c.color } as any) : undefined}
				>
					{c ? (
						<>
							<small>
								{c.index + 1} / {n} · {kindOf(c).toUpperCase()}
							</small>
							<h2>{c.title}</h2>
							<p className="rp-tldr small">{c.tldr}</p>
							<BeforeAfter c={c} big={focus} />
							{c.shots.length > 0 && (
								<>
									<h4>See it · {c.shots.length}</h4>
									<div className="rp-gallery">
										{c.shots.map((x: any, i: number) => (
											<button
												type="button"
												key={i}
												className={`rp-thumb ${device(x.shot.state).toLowerCase()}`}
												onClick={() => setBox({ list: c.shots, i })}
												title={x.caption}
											>
												<LazyImage
													src={shotUrl(model, x.shot)}
													alt={x.caption}
												/>
												<span>{device(x.shot.state)}</span>
											</button>
										))}
									</div>
								</>
							)}
							{c.diagrams.map((d: any, di: number) => (
								<div key={di}>
									<h4>{d.title}</h4>
									<ol className="rp-steps">
										{d.steps.map((s: any, i: number) => {
											const k = di * 100 + i;
											return (
												<li key={i} className={step === k ? "now" : ""}>
													<button
														type="button"
														onClick={() => setStep(step === k ? undefined : k)}
													>
														<span>{i + 1}</span>
														<b>{s.label}</b>
													</button>
													{step === k && <p>{s.detail}</p>}
												</li>
											);
										})}
									</ol>
								</div>
							))}
							<div className="rp-riskline">
								<RiskDot level={c.risk.level} /> {c.risk.text}
							</div>
							<h4>Check</h4>
							<Checks c={c} done={done} toggle={toggle} />
							<label className="rp-reviewed">
								<input
									type="checkbox"
									checked={!!reviewed[c.id]}
									onChange={(e) =>
										setReviewed((r) => ({ ...r, [c.id]: e.target.checked }))
									}
								/>{" "}
								I’ve reviewed this change
							</label>
							<FullText c={c} />
						</>
					) : (
						<>
							<small>DECIDE</small>
							<h2>Ready to decide?</h2>
							<p className="rp-tldr small">
								{shorten(model.guide.decision.summary, 120)}
							</p>
							<ul className="rp-decide-list">
								{model.chapters.map((x: Chapter) => (
									<li key={x.id} style={{ "--c": x.color } as any}>
										<RiskDot level={x.risk.level} />
										<button
											type="button"
											className="rp-link"
											onClick={() => pick(x.index)}
										>
											{x.title}
										</button>
										<span>{reviewed[x.id] ? "✓ reviewed" : "—"}</span>
									</li>
								))}
							</ul>
							<details className="rp-more">
								<summary>Overall risks ({model.guide.risks.length})</summary>
								<ul>
									{model.guide.risks.map((r: string, i: number) => (
										<li key={i}>{r}</li>
									))}
								</ul>
							</details>
							<details className="rp-more">
								<summary>
									Acceptance criteria ({model.supported}/
									{model.guide.requirements.length} supported)
								</summary>
								<ul>
									{model.guide.requirements.map((r: any, i: number) => (
										<li key={i}>
											{r.status === "supported" ? "✓" : "⚠"} {r.criterion}
										</li>
									))}
								</ul>
							</details>
							<div className="rp-u-actions">
								<DecisionActions
									identity={`prototype-review/${run.id}`}
									decisionPage
									run={run}
									onSettled={onSettled ?? (() => {})}
									settling={settling}
								/>
							</div>
						</>
					)}
					<div className="rp-row rp-u-nav">
						<button
							type="button"
							disabled={sel === 0}
							onClick={() => pick(sel - 1)}
						>
							↑ Prev
						</button>
						<button type="button" onClick={() => setFocus(!focus)}>
							{focus ? "Show map" : "Focus"}
						</button>
						<button
							type="button"
							disabled={sel === n}
							onClick={() => pick(sel + 1)}
						>
							{sel === n - 1 ? "Decide ↓" : "Next ↓"}
						</button>
					</div>
				</aside>
			</div>
			{box && (
				<Lightbox model={model} box={box} onClose={(next) => setBox(next)} />
			)}
		</div>
	);
}

const UNIFIED_CSS = `
.rp-u-top{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;margin-bottom:14px}
.rp-u-top .rp-tldr{margin:0}
.rp-u-kpis{display:flex;flex-wrap:wrap;gap:6px}
.rp-u-kpis span{background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:13px;color:var(--secondary)}
.rp-u-kpis b{color:var(--text)}
.rp-u-kpis .good{background:var(--green)}.rp-u-kpis .warn{background:var(--orange)}
.rp-u-grid{display:grid;grid-template-columns:minmax(0,1fr) 440px;gap:20px;align-items:start}
.rp-u-main{min-width:0}
.rp-u-lens{min-height:300px}
.rp-u-lens .rp-seq{max-height:62vh}
.rp-seg button{position:relative}
.rp-lens-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-left:6px;vertical-align:middle}
.rp-rail{list-style:none;padding:0;margin:0;display:grid;gap:5px}
.rp-rail button{width:100%;display:grid;grid-template-columns:28px minmax(0,1fr) auto auto 14px 34px;gap:10px;align-items:center;text-align:left;background:var(--surface);color:var(--text);border:1px solid var(--line);border-left:5px solid var(--c,var(--primary));border-radius:12px;padding:8px 10px}
.rp-rail button:hover,.rp-rail button.on{background:color-mix(in srgb,var(--c,#7b61ff) 10%,var(--surface))}
.rp-rail button.on{box-shadow:0 0 0 2px var(--c,#7b61ff)}
.rp-rail .rp-num{background:var(--c,var(--primary));color:#fff}
.rp-rail .rp-decide{grid-template-columns:28px 1fr;--c:var(--primary)}
.rp-rail .rp-decide .rp-num{color:var(--primary-text)}
.rp-rail-text b{display:block;font-size:14px}
.rp-rail-text small{display:block;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rp-kind{font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--secondary);background:var(--quiet);border-radius:6px;padding:2px 6px}
.rp-count{font-size:12px;color:var(--muted);text-align:right}
.rp-u-drawer h4{margin:14px 0 6px}
.rp-u-nav{margin-top:14px;position:sticky;bottom:-16px;background:var(--surface);padding:8px 0}
.rp-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
.rp-thumb{position:relative;display:block;border:2px solid var(--line);border-radius:10px;padding:0;overflow:hidden;background:var(--quiet);height:110px;cursor:zoom-in}
.rp-thumb img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
.rp-thumb.mobile img,.rp-thumb.reader img{object-fit:contain}
.rp-thumb span{position:absolute;left:4px;bottom:4px;font-size:10px;font-weight:800;background:#000a;color:#fff;border-radius:6px;padding:1px 6px}
.rp-thumb:hover{border-color:var(--c,#7b61ff)}
.rp-sheet{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.rp-sheet-group{border-left:4px solid var(--c);padding-left:10px;transition:opacity .2s}
.rp-sheet-group.faded{opacity:.25}
.rp-sheet-group small{display:flex;gap:6px;align-items:center;font-weight:700;font-size:12px;margin-bottom:6px}
.rp-sheet-group > div{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
.rp-sheet-group .rp-thumb{height:78px}
.rp-dotnum{display:inline-grid;place-items:center;min-width:18px;height:18px;border-radius:50%;background:var(--c);color:#fff;font-size:10px;font-weight:800}
.rp-steps{list-style:none;padding:0;margin:0;display:grid;gap:4px}
.rp-steps button{display:flex;gap:8px;align-items:center;width:100%;text-align:left;background:color-mix(in srgb,var(--c) 9%,var(--surface));border:1px solid transparent;border-radius:10px;padding:6px 8px;color:var(--text)}
.rp-steps button span{display:inline-grid;place-items:center;flex:none;width:20px;height:20px;border-radius:50%;background:var(--c);color:#fff;font-size:11px;font-weight:800}
.rp-steps li.now button{border-color:var(--c)}
.rp-steps p{margin:4px 0 4px 36px;font-size:13.5px;color:var(--secondary)}
.rp-reviewed{display:flex;gap:8px;align-items:center;margin-top:12px;font-weight:700;cursor:pointer}
.rp-decide-list{list-style:none;padding:0;display:grid;gap:4px}
.rp-decide-list li{display:grid;grid-template-columns:14px 1fr auto;gap:8px;align-items:center;border-left:4px solid var(--c);padding:2px 8px;font-size:13.5px}
.rp-decide-list .rp-link{text-align:left}
.rp-decide-list li span:last-child{color:var(--muted);font-size:12px}
.rp-u-actions{margin-top:14px}
.rp-lightbox{position:fixed;inset:0;z-index:900;background:#000c;display:grid;place-items:center;padding:24px}
.rp-lightbox figure{margin:0;max-width:min(1200px,94vw);background:var(--surface);border-radius:16px;padding:12px}
.rp-lightbox img{display:block;max-width:100%;max-height:74vh;margin:auto;border-radius:8px}
.rp-lightbox figcaption{display:grid;gap:2px;margin:10px 4px;font-size:14px}
/* focus mode: deck-like single card */
.rp-unified.focus .rp-u-main{display:none}
.rp-unified.focus .rp-u-grid{grid-template-columns:minmax(0,820px);justify-content:center}
.rp-unified.focus .rp-u-drawer{position:static;max-height:none;padding:28px 34px;border-radius:26px}
.rp-unified.focus .rp-u-drawer h2{font-size:30px}
.rp-unified.focus .rp-u-drawer .rp-tldr.small{font-size:24px;font-weight:800}
.rp-unified.focus .rp-gallery{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.rp-unified.focus .rp-gallery .rp-thumb{height:180px}
@media (max-width:1100px){.rp-u-grid{grid-template-columns:1fr}.rp-u-drawer{position:static;max-height:none}}
`;

/* ------------------------------------------------------- mount + switcher */

export function ReviewPrototype({
	run,
	variant,
	onSettled,
	settling,
}: {
	run: any;
	variant: string;
	onSettled?: () => void;
	settling?: boolean;
}) {
	const [params] = useSearchParams(),
		guide = useFullGuide(run),
		evidence = useQuery({
			queryKey: ["prototype-evidence", run.id],
			queryFn: ({ signal }) => api(`/api/runs/${run.id}/evidence`, { signal }),
			staleTime: Infinity,
		});
	const model = useMemo(
		() =>
			guide && !evidence.isPending
				? buildModel(
						guide,
						params.get("enriched") === "0" ? undefined : enrichedFor(guide),
						evidence.data?.screenshots ?? [],
						run.id,
					)
				: undefined,
		[guide, params, evidence.isPending, evidence.data, run.id],
	);
	if (!model) return <p role="status">Loading review guide…</p>;
	if (variant === "F")
		return (
			<div className="rp-root">
				<style>{CSS}</style>
				<style>{UNIFIED_CSS}</style>
				<VariantF
					model={model}
					run={run}
					onSettled={onSettled}
					settling={settling}
				/>
			</div>
		);
	const V =
		{ B: VariantB, C: VariantC, D: VariantD, E: VariantE }[variant] ?? VariantB;
	return (
		<div className="rp-root">
			<style>{CSS}</style>
			<V model={model} />
		</div>
	);
}

export function PrototypeSwitcher({ guide }: { guide?: any }): ReactNode {
	const [params, setParams] = useSearchParams(),
		current = params.get("variant") ?? "A",
		i = Math.max(
			0,
			VARIANTS.findIndex(([k]) => k === current),
		),
		enrichedOff = params.get("enriched") === "0";
	const go = (d: number) => {
		const next = new URLSearchParams(params);
		next.set(
			"variant",
			VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length]![0],
		);
		setParams(next, { replace: true });
	};
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (
				(e.target as HTMLElement)?.closest?.(
					"input,textarea,select,[contenteditable]",
				)
			)
				return;
			if (e.key === "ArrowLeft") go(-1);
			if (e.key === "ArrowRight") go(1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});
	return (
		<div className="rp-switcher">
			<style>{SWITCHER_CSS}</style>
			<button
				type="button"
				onClick={() => go(-1)}
				aria-label="Previous variant"
			>
				←
			</button>
			<span>
				<b>{VARIANTS[i]![0]}</b> {VARIANTS[i]![1]}
			</span>
			<button type="button" onClick={() => go(1)} aria-label="Next variant">
				→
			</button>
			{guide && enrichedFor(guide) && (
				<label title="Use hand-written mock fields for a proposed schema extension">
					<input
						type="checkbox"
						checked={!enrichedOff}
						onChange={() => {
							const next = new URLSearchParams(params);
							if (enrichedOff) next.delete("enriched");
							else next.set("enriched", "0");
							setParams(next, { replace: true });
						}}
					/>{" "}
					enriched mock
				</label>
			)}
		</div>
	);
}

const SWITCHER_CSS = `
.rp-switcher{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:1000;display:flex;gap:10px;align-items:center;
 background:#111;color:#fff;border-radius:999px;padding:6px 10px;box-shadow:0 10px 30px #0006;font:13px ui-monospace,monospace}
.rp-switcher button{background:#333;color:#fff;border:0;border-radius:999px;width:30px;height:30px;cursor:pointer;font-size:15px}
.rp-switcher button:hover{background:#555}
.rp-switcher span{min-width:220px;text-align:center}
.rp-switcher input{width:14px;height:14px;padding:0;vertical-align:middle;accent-color:#7b61ff}
.rp-switcher label{border-left:1px solid #444;padding-left:10px;cursor:pointer}
`;

const CSS = `
.page:has(.rp-root){max-width:1280px;padding-left:20px;padding-right:20px}
.rp-root input[type=checkbox],.rp-switcher input[type=checkbox]{width:16px;height:16px;padding:0;border-radius:4px;flex:none}
.rp-root{--c:#7b61ff;padding-bottom:90px}
.rp-root button{font:inherit;cursor:pointer}
.rp-root .muted{color:var(--muted)}
.rp-tldr{font-size:22px;font-weight:700;line-height:1.3;margin:8px 0 18px;max-width:46ch}
.rp-tldr.small{font-size:17px;font-weight:600;margin:4px 0 14px}
.rp-panel{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:16px 18px;margin-bottom:16px;box-shadow:var(--shadow)}
.rp-panel h3{margin:0 0 10px;font-size:14px;letter-spacing:.04em;text-transform:uppercase;color:var(--secondary)}
.rp-row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.rp-row h3{margin:0}
.rp-row button,.rp-deck-nav button{border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:12px;padding:8px 14px}
.rp-row button:disabled{opacity:.4}
.rp-deck-nav .primary{background:var(--primary);color:var(--primary-text);border-color:var(--primary)}
.rp-seg{display:inline-flex;background:var(--quiet);border-radius:999px;padding:3px}
.rp-seg button{border:0;background:none;border-radius:999px;padding:5px 14px;color:var(--secondary)}
.rp-seg button.on{background:var(--surface);color:var(--text);box-shadow:var(--shadow);font-weight:700}
.rp-needs{background:var(--yellow);border-radius:12px;padding:10px 14px}

/* system diagram */
.rp-system{width:100%;height:auto;display:block;font-family:inherit}
.rp-lane{font-size:10px;font-weight:700;letter-spacing:.08em;fill:var(--muted);text-anchor:middle}
.rp-edge path{fill:none;stroke:var(--secondary);stroke-width:1.6;opacity:.55;transition:all .25s}
.rp-edge.weak path{stroke-dasharray:4 4;opacity:.35}
.rp-edge.hot path{stroke:inherit;opacity:1;stroke-width:3}
.rp-edge-label{font-size:10.5px;font-weight:700;fill:var(--secondary);text-anchor:middle;paint-order:stroke;stroke:var(--surface);stroke-width:4px}
.rp-node{cursor:pointer;transition:opacity .25s}
.rp-node rect{fill:var(--surface);stroke:var(--line);stroke-width:1.5;transition:all .25s}
.rp-node.new rect{fill:var(--indigo)}
.rp-node.legacy rect{fill:var(--quiet)}
.rp-node text{font-size:12.5px;font-weight:600;fill:var(--text);text-anchor:middle;pointer-events:none}
.rp-node .rp-badge{font-size:8px;font-weight:800;fill:#7b61ff;text-anchor:end}
.rp-node.on rect{stroke:var(--tint,#7b61ff);stroke-width:3;fill:color-mix(in srgb,var(--tint,#7b61ff) 16%,var(--surface))}
.rp-node.gone{opacity:.18}
.rp-node.gone rect{stroke-dasharray:4 3}
.rp-node.dim{opacity:.45}

/* footprint */
.rp-footprint{display:flex;flex-wrap:wrap;gap:14px 22px}
.rp-area small{display:block;font-weight:700;font-size:12px;margin-bottom:4px}
.rp-tiles{display:flex;flex-wrap:wrap;gap:3px;max-width:230px}
.rp-tile{display:inline-block;width:16px;height:16px;border-radius:4px;background:var(--c,#999);border:2px solid var(--c,#999);padding:0;transition:opacity .2s}
.rp-tile.test{background:transparent}
.rp-tile.faded{opacity:.15}
.rp-legend{flex-basis:100%;font-size:12px;display:flex;gap:6px;align-items:center;margin:4px 0 0}
.rp-legend .rp-tile{width:11px;height:11px;--c:var(--secondary)}

/* atlas */
.rp-atlas{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:20px;align-items:start}
.rp-atlas-main{min-width:0}
.rp-pins{display:flex;flex-wrap:wrap;gap:6px;margin:-4px 0 16px}
.rp-pins button,.rp-legend-list button{display:inline-flex;gap:6px;align-items:center;border:1.5px solid var(--line);background:var(--surface);color:var(--text);border-radius:999px;padding:4px 12px 4px 4px;font-size:13px}
.rp-pins button span,.rp-legend-list button span{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--c);color:#fff;font-weight:800;font-size:11px}
.rp-pins button.on{border-color:var(--c);background:color-mix(in srgb,var(--c) 14%,var(--surface));font-weight:700}
.rp-drawer{position:sticky;top:16px;background:var(--surface);border:1px solid var(--line);border-top:6px solid var(--c);border-radius:18px;padding:16px 18px;max-height:calc(100vh - 32px);overflow:auto;box-shadow:var(--pop)}
.rp-drawer > small{font-weight:800;letter-spacing:.08em;color:var(--c)}
.rp-drawer h2{margin:2px 0 0;font-size:21px}
.rp-drawer h4{margin:16px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.rp-link{border:0;background:none;color:inherit;text-decoration:underline;padding:0}

/* before/after */
.rp-ba{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:stretch;margin:6px 0 12px}
.rp-ba > div{border-radius:12px;padding:8px 10px;font-size:14px;font-weight:600;line-height:1.3}
.rp-ba small{display:block;font-size:9.5px;letter-spacing:.1em;font-weight:800;opacity:.6;margin-bottom:2px}
.rp-ba .before{background:var(--quiet);color:var(--secondary);text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--secondary) 40%,transparent)}
.rp-ba .before small{text-decoration:none}
.rp-ba .after{background:color-mix(in srgb,var(--c) 12%,var(--surface));border:2px solid}
.rp-ba .arrow{align-self:center;font-size:20px;color:var(--muted)}
.rp-ba.big > div{font-size:22px;padding:18px 20px}

/* flow strip */
.rp-strip{list-style:none;padding:0;margin:10px 0;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.rp-strip li{display:flex;align-items:center;gap:6px;background:color-mix(in srgb,var(--c) 12%,var(--surface));border-radius:999px;padding:4px 10px 4px 4px;font-size:12.5px;font-weight:600;cursor:help}
.rp-strip li span{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:var(--c);color:#fff;font-size:10px}
.rp-strip li:not(:last-child)::after{content:"→";margin-left:6px;color:var(--muted)}

/* risk + checks */
.rp-risk{display:inline-block;width:11px;height:11px;border-radius:50%;flex:none}
.rp-risk.low{background:#3ddc97}.rp-risk.medium{background:#ffb020}.rp-risk.high{background:#ff5d73}
.rp-riskline{display:flex;gap:8px;align-items:center;font-size:13.5px;background:var(--quiet);border-radius:10px;padding:6px 10px;margin:8px 0}
.rp-riskline.big{font-size:18px;padding:12px 16px}
.rp-checks{list-style:none;padding:0;margin:0;display:grid;gap:6px}
.rp-checks label{display:flex;gap:10px;align-items:flex-start;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:8px 10px;cursor:pointer;font-size:14px}
.rp-checks input{margin-top:3px;accent-color:var(--c)}
.rp-checks em{color:var(--secondary);font-style:normal}
.rp-checks label:has(input:checked){opacity:.55}
.rp-more{margin-top:14px;font-size:13.5px}
.rp-more summary{cursor:pointer;color:var(--secondary);font-weight:600}
.rp-more h4{margin:10px 0 4px}
.rp-filelist{font-size:12px}
.rp-filelist .test code{opacity:.6}

/* deck */
.rp-deck{max-width:820px;margin:0 auto}
.rp-deck-progress{display:flex;gap:4px;margin-bottom:14px}
.rp-deck-progress button{flex:1;height:8px;border:0;border-radius:4px;background:var(--track);padding:0}
.rp-deck-progress button.seen{background:color-mix(in srgb,var(--c) 45%,var(--track))}
.rp-deck-progress button.on{background:var(--c)}
.rp-card{min-height:440px;background:var(--surface);border:1px solid var(--line);border-radius:26px;padding:32px 36px;box-shadow:var(--pop);background-image:linear-gradient(160deg,var(--soft,transparent),transparent 40%);animation:rp-in .22s ease-out}
@keyframes rp-in{from{opacity:0;transform:translateY(8px)}}
.rp-kicker{font-weight:800;letter-spacing:.08em;color:var(--c);text-transform:uppercase;font-size:12px}
.rp-huge{color:var(--text);font-size:32px;font-weight:800;line-height:1.2;margin:14px 0 26px;max-width:24ch}
.rp-card h3{font-size:20px;margin:10px 0 18px}
.rp-mini-toc{display:grid;gap:6px;padding:0;list-style:none;counter-reset:t}
.rp-mini-toc li{counter-increment:t;border-left:4px solid var(--c);padding:2px 10px;font-weight:600}
.rp-mini-toc li::before{content:counter(t) ". ";color:var(--muted)}
.rp-reveal{list-style:none;padding:0;display:grid;gap:10px}
.rp-reveal li{display:flex;gap:14px;align-items:flex-start;transition:all .25s}
.rp-reveal li > span{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--track);font-weight:800}
.rp-reveal li.now > span{background:var(--c);color:#fff;transform:scale(1.1)}
.rp-reveal li.past > span{background:color-mix(in srgb,var(--c) 30%,var(--surface))}
.rp-reveal li.future{opacity:.3}
.rp-reveal li b{font-size:18px;line-height:34px}
.rp-reveal li.now b{font-size:22px}
.rp-reveal li p{margin:2px 0 0;font-size:16px;color:var(--secondary);max-width:50ch}
.rp-deck-nav{margin-top:14px}
.rp-endgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.rp-endgrid div{display:flex;gap:8px;align-items:center;border-left:4px solid var(--c);padding:4px 10px}

/* matrix */
.rp-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px}
.rp-kpis div{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:12px 14px;font-size:12.5px;color:var(--secondary)}
.rp-kpis b{display:block;font-size:26px;color:var(--text)}
.rp-kpis .good{background:var(--green)}.rp-kpis .warn{background:var(--orange)}
.rp-matrix table{width:100%;border-collapse:separate;border-spacing:0 6px}
.rp-matrix th{text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:0 10px}
.rp-matrix tbody tr:not(.rp-expanded){cursor:pointer}
.rp-matrix td{background:var(--surface);padding:10px;vertical-align:middle;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:13.5px}
.rp-matrix td:first-child{border-left:5px solid var(--c);border-radius:12px 0 0 12px}
.rp-matrix td:last-child{border-right:1px solid var(--line);border-radius:0 12px 12px 0}
.rp-matrix tr:hover td,.rp-matrix tr.open td{background:color-mix(in srgb,var(--c) 7%,var(--surface))}
.rp-matrix .rp-expanded td{border-top:0;padding-top:0}
.rp-num{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--c);color:#fff;font-weight:800;font-size:12px}
.rp-ba-cell s{display:block;color:var(--muted);font-size:12.5px}
.rp-ba-cell span{font-weight:600}
.rp-bars{display:flex;width:120px;height:10px;border-radius:5px;overflow:hidden;gap:1px}
.rp-proof{display:flex;gap:3px}
.rp-proof span{font-size:10.5px;font-weight:800;border-radius:6px;padding:2px 5px}
.rp-proof .yes{background:var(--green);color:var(--review-text)}
.rp-proof .no{background:var(--quiet);color:var(--muted);opacity:.5}
.rp-proof .gap{background:var(--orange);color:var(--question-text)}
.rp-exp-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}

/* life of an update */
.rp-life-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:20px;align-items:start}
.rp-seq{width:100%;height:auto;font-family:inherit}
.rp-lifeline{stroke:var(--line);stroke-width:2;stroke-dasharray:3 4}
.rp-actor{fill:var(--quiet);stroke:var(--line)}
.rp-actor-label{font-size:12px;font-weight:700;text-anchor:middle;fill:var(--text)}
.rp-msg{cursor:pointer;transition:opacity .2s;stroke-width:2}
.rp-msg.faded{opacity:.14}
.rp-hit{fill:transparent;stroke:none}
.rp-msg:hover .rp-hit{fill:var(--quiet)}
.rp-msg-label{font-size:11.5px;font-weight:700;text-anchor:middle;stroke:none;paint-order:stroke}
.rp-msg-label.left{text-anchor:start}
.rp-msg-note{font-size:10.5px;fill:var(--muted);stroke:none;font-style:italic}
.rp-step-num{font-size:10px;font-weight:800;fill:#fff;stroke:none;text-anchor:middle}
.rp-legend-list{list-style:none;padding:0;display:grid;gap:6px}

@media (max-width:1000px){.rp-atlas,.rp-life-grid{grid-template-columns:1fr}.rp-drawer{position:static;max-height:none}.rp-kpis{grid-template-columns:repeat(2,1fr)}}
`;
