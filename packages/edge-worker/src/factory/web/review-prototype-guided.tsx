// biome-ignore-all lint/a11y/noStaticElementInteractions: throwaway prototype
// biome-ignore-all lint/complexity/noCommaOperator: throwaway prototype
// biome-ignore-all lint/a11y/useKeyWithClickEvents: throwaway prototype
// PROTOTYPE (throwaway) — bobs-factory#71, variant G "Guided Atlas".
// Step-by-step: one Atlas-style overview, then ONE focus area per step (a chapter), then
// the decision. Each chapter page shows a single primary visual at a time (screens OR how
// it works), with the rest folded away. Single column, sticky nav, works on mobile.
// The current step lives in the URL (`&step=`), so it is shareable and reload-stable.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "./client";
import { DecisionActions } from "./focus";
import { LazyImage } from "./media";
import {
	areaOf,
	BeforeAfter,
	type Chapter,
	Checks,
	device,
	FullText,
	kindOf,
	Lightbox,
	type Model,
	RiskDot,
	SystemDiagram,
	shorten,
	shotUrl,
	useChecks,
} from "./review-prototype";

export function VariantG({
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
	const [params, setParams] = useSearchParams(),
		n = model.chapters.length,
		total = n + 3, // overview + chapters + files + decide
		FILES = n + 1,
		step = Math.max(0, Math.min(total - 1, Number(params.get("step") ?? 0))),
		[done, toggle] = useChecks(),
		[reviewed, setReviewed] = useState<Record<string, boolean>>({}),
		top = useRef<HTMLDivElement>(null);
	const go = (next: number) => {
		const p = new URLSearchParams(params);
		p.set("step", String(Math.max(0, Math.min(total - 1, next))));
		setParams(p, { replace: true });
	};
	useEffect(() => {
		top.current?.scrollIntoView({ block: "start", behavior: "instant" });
	}, []);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (
				(e.target as HTMLElement)?.closest?.(
					"input,textarea,select,[contenteditable],.rp-lightbox",
				)
			)
				return;
			if (e.key === "ArrowDown" || e.key === "j")
				e.preventDefault(), go(step + 1);
			if (e.key === "ArrowUp" || e.key === "k")
				e.preventDefault(), go(step - 1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});
	const c = step >= 1 && step <= n ? model.chapters[step - 1] : undefined;
	return (
		<div className="rp-guided" ref={top}>
			<nav className="rp-g-stepper" aria-label="Review steps">
				<button
					type="button"
					className={step === 0 ? "on" : "seen"}
					onClick={() => go(0)}
					title="Overview"
				/>
				{model.chapters.map((x: Chapter) => (
					<button
						type="button"
						key={x.id}
						title={`${x.index + 1}. ${x.title}`}
						style={{ "--c": x.color } as any}
						className={
							step === x.index + 1 ? "on" : reviewed[x.id] ? "seen" : ""
						}
						onClick={() => go(x.index + 1)}
					/>
				))}
				<button
					type="button"
					className={step === FILES ? "on" : step > FILES ? "seen" : ""}
					onClick={() => go(FILES)}
					title="Changed files"
				/>
				<button
					type="button"
					className={step === total - 1 ? "on" : ""}
					onClick={() => go(total - 1)}
					title="Decide"
				/>
			</nav>
			{step === 0 && <Overview model={model} reviewed={reviewed} go={go} />}
			{c && (
				<ChapterStep
					key={c.id}
					model={model}
					c={c}
					done={done}
					toggle={toggle}
					reviewed={!!reviewed[c.id]}
					setReviewed={(v) => setReviewed((r) => ({ ...r, [c.id]: v }))}
				/>
			)}
			{step === FILES && <FilesStep model={model} run={run} go={go} />}
			{step === total - 1 && (
				<section className="rp-g-page">
					<small className="rp-g-kicker">LAST STEP · DECIDE</small>
					<h2>Ready to decide?</h2>
					<p className="rp-g-lead">
						{shorten(model.guide.decision.summary, 140)}
					</p>
					<ul className="rp-decide-list">
						{model.chapters.map((x: Chapter) => (
							<li key={x.id} style={{ "--c": x.color } as any}>
								<RiskDot level={x.risk.level} />
								<button
									type="button"
									className="rp-link"
									onClick={() => go(x.index + 1)}
								>
									{x.title}
								</button>
								<span>{reviewed[x.id] ? "✓" : "—"}</span>
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
							{model.guide.requirements.length})
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
				</section>
			)}
			<footer className="rp-g-nav">
				<button
					type="button"
					disabled={step === 0}
					onClick={() => go(step - 1)}
				>
					← Back
				</button>
				<span>
					{step === 0
						? "Overview"
						: step === total - 1
							? "Decide"
							: step === FILES
								? "Files"
								: `${step} / ${n}`}
				</span>
				{step < total - 1 ? (
					<button
						type="button"
						className="primary"
						onClick={() => {
							if (c) setReviewed((r) => ({ ...r, [c.id]: true }));
							go(step + 1);
						}}
					>
						{step === 0
							? "Start →"
							: step === n
								? "Files →"
								: step === FILES
									? "Decide →"
									: "Next →"}
					</button>
				) : (
					<span />
				)}
			</footer>
		</div>
	);
}

/* ---- step 0: rough Atlas overview ---- */
function Overview({
	model,
	reviewed,
	go,
}: {
	model: Model;
	reviewed: Record<string, boolean>;
	go: (i: number) => void;
}) {
	const [hover, setHover] = useState<number>(),
		[show, setShow] = useState({ before: true, after: true }),
		mode =
			show.before && show.after
				? "diff"
				: show.before
					? "before"
					: show.after
						? "after"
						: "none";
	const h = hover !== undefined ? model.chapters[hover] : undefined;
	const care = model.chapters.filter(
		(x: Chapter) => x.risk.level !== "low",
	).length;
	return (
		<section className="rp-g-page">
			<small className="rp-g-kicker">OVERVIEW</small>
			<h2 className="rp-g-big">{model.tldr}</h2>
			<div className="rp-u-kpis">
				<span>
					<b>{model.chapters.length}</b> steps
				</span>
				<span>
					<b>{model.files.length}</b> files
				</span>
				{model.shots.length > 0 && (
					<span>
						<b>{model.shots.length}</b> screens
					</span>
				)}
				<span className={care ? "warn" : "good"}>
					<b>{care}</b> need care
				</span>
			</div>
			{model.enriched?.system ? (
				<div className="rp-g-diff">
					<div className="rp-g-diff-bar">
						{(["before", "after"] as const).map((k) => (
							<button
								type="button"
								key={k}
								aria-pressed={show[k]}
								className={`rp-g-tog ${k} ${show[k] ? "on" : ""}`}
								onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
							>
								<span className="box">{show[k] ? "✓" : ""}</span>
								{k === "before" ? "Before" : "After"}
							</button>
						))}
						<span className="rp-g-legend">
							{mode === "diff" && (
								<>
									<i className="added" /> added <i className="removed" />{" "}
									removed <i className="changed" /> changed
								</>
							)}
							{mode === "before" && "How it worked before this PR"}
							{mode === "after" && "How it works with this PR"}
							{mode === "none" && "Components only"}
						</span>
					</div>
					<div className="rp-g-map">
						<SystemDiagram
							system={model.enriched.system}
							mode={mode}
							highlight={h?.nodes ?? []}
							tint={h?.color}
						/>
					</div>
				</div>
			) : model.shots.length > 0 ? (
				<div className="rp-g-strip">
					{model.shots.slice(0, 8).map((s: any) => (
						<LazyImage key={s.index} src={shotUrl(model, s)} alt={s.caption} />
					))}
				</div>
			) : null}
			<h3 className="rp-g-h">Your route</h3>
			<ol className="rp-g-route">
				{model.chapters.map((x: Chapter) => (
					<li key={x.id}>
						<button
							type="button"
							style={{ "--c": x.color } as any}
							onClick={() => go(x.index + 1)}
							onMouseEnter={() => setHover(x.index)}
							onMouseLeave={() => setHover(undefined)}
							onFocus={() => setHover(x.index)}
						>
							<span className="rp-num">
								{reviewed[x.id] ? "✓" : x.index + 1}
							</span>
							<span className="rp-g-route-text">
								<b>{x.title}</b>
								<small>{x.tldr}</small>
							</span>
							<RiskDot level={x.risk.level} />
						</button>
					</li>
				))}
			</ol>
		</section>
	);
}

/* ---- steps 1..n: one chapter, one primary visual ---- */
function ChapterStep({
	model,
	c,
	done,
	toggle,
	reviewed,
	setReviewed,
}: {
	model: Model;
	c: Chapter;
	done: Record<string, boolean>;
	toggle: (k: string) => void;
	reviewed: boolean;
	setReviewed: (v: boolean) => void;
}) {
	const hasScreens = c.shots.length > 0,
		hasLogic = c.diagrams.length > 0 || c.nodes.length > 0,
		[view, setView] = useState<"screens" | "logic">(
			hasScreens ? "screens" : "logic",
		);
	return (
		<section className="rp-g-page" style={{ "--c": c.color } as any}>
			<small className="rp-g-kicker">
				STEP {c.index + 1} OF {model.chapters.length} ·{" "}
				{kindOf(c).toUpperCase()}
			</small>
			<h2>{c.title}</h2>
			<p className="rp-g-lead">{c.tldr}</p>
			<BeforeAfter c={c} />
			{hasScreens && hasLogic && (
				<div className="rp-seg rp-g-toggle" role="tablist">
					<button
						type="button"
						role="tab"
						aria-selected={view === "screens"}
						className={view === "screens" ? "on" : ""}
						onClick={() => setView("screens")}
					>
						See it · {c.shots.length}
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={view === "logic"}
						className={view === "logic" ? "on" : ""}
						onClick={() => setView("logic")}
					>
						How it works
					</button>
				</div>
			)}
			{hasScreens && view === "screens" && <Carousel model={model} c={c} />}
			{hasLogic && view === "logic" && <HowItWorks model={model} c={c} />}
			<div className="rp-g-check">
				<div className="rp-riskline">
					<RiskDot level={c.risk.level} /> {c.risk.text}
				</div>
				<h3 className="rp-g-h">Check</h3>
				<Checks c={c} done={done} toggle={toggle} />
				<label className="rp-reviewed">
					<input
						type="checkbox"
						checked={reviewed}
						onChange={(e) => setReviewed(e.target.checked)}
					/>{" "}
					I’ve reviewed this step
				</label>
			</div>
			<FullText c={c} />
		</section>
	);
}

function Carousel({ model, c }: { model: Model; c: Chapter }) {
	const [i, setI] = useState(0),
		[box, setBox] = useState<{ list: any[]; i: number }>(),
		touch = useRef<number>(undefined),
		item = c.shots[i]!,
		go = (d: number) => setI((i + d + c.shots.length) % c.shots.length);
	return (
		<figure
			className="rp-g-carousel"
			onTouchStart={(e) => {
				touch.current = e.touches[0]!.clientX;
			}}
			onTouchEnd={(e) => {
				const dx = e.changedTouches[0]!.clientX - (touch.current ?? 0);
				if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
			}}
		>
			<button
				type="button"
				className="rp-g-shot"
				onClick={() => setBox({ list: c.shots, i })}
			>
				<img src={shotUrl(model, item.shot)} alt={item.caption} />
				<span className="rp-g-device">{device(item.shot.state)}</span>
			</button>
			<figcaption>{item.caption}</figcaption>
			{c.shots.length > 1 && (
				<div className="rp-g-dots">
					<button type="button" onClick={() => go(-1)} aria-label="Previous">
						‹
					</button>
					{c.shots.map((_: any, k: number) => (
						<button
							type="button"
							key={k}
							className={k === i ? "on" : ""}
							onClick={() => setI(k)}
							aria-label={`Screenshot ${k + 1}`}
						/>
					))}
					<button type="button" onClick={() => go(1)} aria-label="Next">
						›
					</button>
				</div>
			)}
			{box && (
				<Lightbox model={model} box={box} onClose={(next) => setBox(next)} />
			)}
		</figure>
	);
}

function HowItWorks({ model, c }: { model: Model; c: Chapter }) {
	const [at, setAt] = useState(0),
		d = c.diagrams[0],
		labels = (model.enriched?.system.nodes ?? [])
			.filter((x) => c.nodes.includes(x.id))
			.map((x) => x.label);
	return (
		<div className="rp-g-how">
			{labels.length > 0 && (
				<details className="rp-g-where">
					<summary>
						Where:{" "}
						{labels.map((l) => (
							<span key={l} className="rp-g-chip">
								{l}
							</span>
						))}
					</summary>
					<div className="rp-g-map">
						<SystemDiagram
							system={model.enriched!.system}
							mode="after"
							highlight={c.nodes}
							tint={c.color}
						/>
					</div>
				</details>
			)}
			{d && (
				<>
					<h3 className="rp-g-h">{d.title}</h3>
					<ol className="rp-g-flow">
						{d.steps.map((s: any, i: number) => (
							<li key={i} className={i === at ? "now" : i < at ? "past" : ""}>
								<button type="button" onClick={() => setAt(i)}>
									<span>{i + 1}</span>
									<b>{s.label}</b>
								</button>
								{i === at && (
									<div>
										<p>{s.detail}</p>
										{i < d.steps.length - 1 && (
											<button
												type="button"
												className="rp-link"
												onClick={() => setAt(i + 1)}
											>
												next step ↓
											</button>
										)}
									</div>
								)}
							</li>
						))}
					</ol>
				</>
			)}
		</div>
	);
}

/* ---- step n+1: changed files grouped by step, with a diff viewer ---- */

type PrFile = {
	path: string;
	previous?: string;
	status: string;
	additions: number;
	deletions: number;
	patch: string | null;
	demo?: boolean;
};
const AREA_HUES = [262, 200, 150, 32, 330, 95, 12, 230, 300, 175];
const areaColor = (area: string, all: string[]) =>
	`hsl(${AREA_HUES[all.indexOf(area) % AREA_HUES.length]} 60% 58%)`;
const STATUS: Record<string, [string, string]> = {
	added: ["A", "added"],
	modified: ["M", "modified"],
	removed: ["D", "deleted"],
	renamed: ["R", "renamed"],
	copied: ["C", "copied"],
	changed: ["M", "modified"],
};
// PROTOTYPE-only demo data so the "went rogue" UI can be judged on PRs that are clean.
const DEMO_ROGUE: PrFile[] = [
	{
		path: "libs/ui-kit/src/theme/colors.ts",
		status: "modified",
		additions: 48,
		deletions: 52,
		demo: true,
		patch:
			"@@ -1,8 +1,8 @@\n-export const primary = '#2b2346';\n-export const accent = '#7b61ff';\n+export const primary = palette.ink[900];\n+export const accent = palette.violet[500];\n import { palette } from './palette';\n \n export const surface = '#fff';\n-export const muted = '#6f6889';\n+export const muted = palette.ink[400];",
	},
	{
		path: "libs/date-utils/src/format.ts",
		status: "modified",
		additions: 31,
		deletions: 27,
		demo: true,
		patch:
			"@@ -10,6 +10,7 @@ export function formatDate(d: Date) {\n-  return d.toLocaleDateString();\n+  // Unrelated refactor slipped into this PR\n+  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' }).format(d);\n }",
	},
];

function FilesStep({
	model,
	run,
	go,
}: {
	model: Model;
	run: any;
	go: (i: number) => void;
}) {
	const [params] = useSearchParams(),
		pr = run.reviewGate?.url ?? run.outputs?.["draft-pr"]?.url,
		q = useQuery({
			queryKey: ["prototype-pr-files", pr],
			enabled: Boolean(pr),
			queryFn: ({ signal }) =>
				api<PrFile[]>(`/prototype-api/pr-files?pr=${encodeURIComponent(pr)}`, {
					signal,
				}),
			staleTime: Infinity,
		}),
		demo = params.get("demoRogue") === "1",
		[open, setOpen] = useState<Record<string, boolean>>({ unassigned: true }),
		[viewer, setViewer] = useState<{ list: PrFile[]; i: number }>();
	if (!pr)
		return (
			<section className="rp-g-page">
				<p>No pull request is linked to this run.</p>
			</section>
		);
	if (!q.data)
		return (
			<section className="rp-g-page">
				<p role={q.error ? "alert" : "status"}>
					{q.error
						? `Could not load changed files: ${q.error.message}`
						: "Loading changed files…"}
				</p>
			</section>
		);
	const files = [...q.data, ...(demo ? DEMO_ROGUE : [])],
		byPath = new Map(files.map((f) => [f.path, f])),
		claimed = new Map<string, number[]>();
	for (const c of model.chapters)
		for (const f of c.files)
			claimed.set(f.path, [...(claimed.get(f.path) ?? []), c.index]);
	if (demo) claimed.set(DEMO_ROGUE[0]!.path, [1]); // pretend step 2 also touched a UI lib
	const groups = model.chapters.map((c: Chapter) => ({
		key: c.id,
		chapter: c,
		files: [...claimed.entries()]
			.filter(([, owners]) => owners.includes(c.index))
			.map(([path]) => byPath.get(path))
			.filter(Boolean) as PrFile[],
	}));
	const unassigned = files.filter((f) => !claimed.has(f.path));
	const areas = [...new Set(files.map((f) => areaOf(f.path).area))];
	// Areas touched by exactly one step: the cheapest "did this step wander off?" signal.
	const areaSteps = new Map<string, Set<number>>();
	for (const g of groups)
		for (const f of g.files) {
			const a = areaOf(f.path).area;
			areaSteps.set(a, (areaSteps.get(a) ?? new Set()).add(g.chapter.index));
		}
	const adds = files.reduce((n, f) => n + f.additions, 0),
		dels = files.reduce((n, f) => n + f.deletions, 0);
	const group = (
		key: string,
		title: string,
		list: PrFile[],
		c?: Chapter,
		warn?: boolean,
	) => {
		const a = list.reduce((n, f) => n + f.additions, 0),
			d = list.reduce((n, f) => n + f.deletions, 0),
			byArea = areas
				.map((x) => [x, list.filter((f) => areaOf(f.path).area === x)] as const)
				.filter(([, fs]) => fs.length),
			isOpen = !!open[key];
		const n = model.chapters.length;
		const soloCount = c
			? byArea.filter(([x]) => areaSteps.get(x)?.size === 1).length
			: 0;
		const sorted = [...list].sort(
			(x, y) =>
				Number(areaOf(x.path).test) - Number(areaOf(y.path).test) ||
				x.path.localeCompare(y.path),
		);
		return (
			<section
				key={key}
				className={`rp-f-group ${warn ? "warn" : ""}`}
				style={{ "--c": c?.color ?? "#ff5d73" } as any}
			>
				<button
					type="button"
					className="rp-f-head"
					aria-expanded={isOpen}
					onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
				>
					<span className="rp-num">{c ? c.index + 1 : "!"}</span>
					<span className="rp-f-title">
						<b>{title}</b>
						<small>
							{list.length} file{list.length === 1 ? "" : "s"} ·{" "}
							<i className="add">+{a}</i> <i className="del">−{d}</i>
							{soloCount > 0 && n > 1 && (
								<span className="rp-f-solo-count">
									{" "}
									· {soloCount} area{soloCount === 1 ? "" : "s"} only this step
									touches
								</span>
							)}
						</small>
					</span>
					<span className="rp-f-areabar" aria-hidden>
						{byArea.map(([x, fs]) => (
							<i
								key={x}
								style={{
									flexGrow: fs.length,
									background: areaColor(x, areas),
								}}
								title={`${x}: ${fs.length}`}
							/>
						))}
					</span>
					<span className="rp-f-chev">{isOpen ? "▾" : "▸"}</span>
				</button>
				{isOpen && (
					<div className="rp-f-body">
						<div className="rp-f-areas">
							{byArea.map(([x, fs]) => {
								const solo = c && areaSteps.get(x)?.size === 1 && n > 1;
								return (
									<span
										key={x}
										className={solo ? "solo" : ""}
										title={solo ? "No other step touches this area" : undefined}
									>
										<i style={{ background: areaColor(x, areas) }} />
										{x} · {fs.length}
										{solo && <em>only this step</em>}
									</span>
								);
							})}
							{c && (
								<button
									type="button"
									className="rp-link"
									onClick={() => go(c.index + 1)}
								>
									back to this step
								</button>
							)}
						</div>
						<ul className="rp-f-list">
							{sorted.map((f, i) => {
								const { test } = areaOf(f.path),
									dir = f.path.slice(0, f.path.lastIndexOf("/") + 1),
									name = f.path.slice(dir.length),
									others = (claimed.get(f.path) ?? []).filter(
										(o) => o !== c?.index,
									),
									[letter, label] = STATUS[f.status] ?? ["M", f.status];
								return (
									<li key={f.path}>
										<button
											type="button"
											onClick={() => setViewer({ list: sorted, i })}
										>
											<span className={`rp-f-status ${f.status}`} title={label}>
												{letter}
											</span>
											<span className="rp-f-path">
												<span className="dir">{dir}</span>
												<b>{name}</b>
												{test && <span className="rp-f-tag">TEST</span>}
												{f.demo && <span className="rp-f-tag demo">DEMO</span>}
												{others.map((o) => (
													<span
														key={o}
														className="rp-f-also"
														style={{ "--c": model.chapters[o]!.color } as any}
													>
														also step {o + 1}
													</span>
												))}
											</span>
											<span className="rp-f-stat">
												<i className="add">+{f.additions}</i>{" "}
												<i className="del">−{f.deletions}</i>
												<span className="rp-f-mini" aria-hidden>
													<i
														className="add"
														style={{ flexGrow: f.additions || 0.01 }}
													/>
													<i
														className="del"
														style={{ flexGrow: f.deletions || 0.01 }}
													/>
												</span>
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					</div>
				)}
			</section>
		);
	};
	return (
		<section className="rp-g-page">
			<small className="rp-g-kicker">CHANGED FILES</small>
			<h2>What each step touched</h2>
			<p className="rp-g-lead">
				Every changed file, grouped by step. Look for files that don’t fit their
				step.
			</p>
			<div className="rp-u-kpis">
				<span>
					<b>{files.length}</b> files
				</span>
				<span>
					<b className="add">+{adds}</b> <b className="del">−{dels}</b>
				</span>
				<span>
					<b>{files.filter((f) => areaOf(f.path).test).length}</b> tests
				</span>
				<span className={unassigned.length ? "bad" : "good"}>
					{unassigned.length ? (
						<>
							⚠ <b>{unassigned.length}</b> not explained by any step
						</>
					) : (
						<>✓ every file belongs to a step</>
					)}
				</span>
			</div>
			{unassigned.length > 0 &&
				group(
					"unassigned",
					"Not explained by any step",
					unassigned,
					undefined,
					true,
				)}
			{groups.map((g) => group(g.key, g.chapter.title, g.files, g.chapter))}
			{viewer && (
				<DiffViewer
					viewer={viewer}
					prUrl={pr}
					onClose={(next) => setViewer(next)}
				/>
			)}
		</section>
	);
}

type Row = {
	kind: "hunk" | "ctx" | "add" | "del" | "note";
	old?: number;
	new?: number;
	text: string;
};
function parsePatch(patch: string): Row[] {
	const rows: Row[] = [];
	let o = 0,
		n = 0;
	for (const line of patch.split("\n")) {
		const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
		if (h) {
			o = Number(h[1]);
			n = Number(h[2]);
			rows.push({ kind: "hunk", text: line });
		} else if (line.startsWith("+"))
			rows.push({ kind: "add", new: n++, text: line.slice(1) });
		else if (line.startsWith("-"))
			rows.push({ kind: "del", old: o++, text: line.slice(1) });
		else if (line.startsWith("\\"))
			rows.push({ kind: "note", text: line.slice(2) });
		else rows.push({ kind: "ctx", old: o++, new: n++, text: line.slice(1) });
	}
	return rows;
}
/** Pair deletions with following additions so a split view lines them up. */
function toSplit(rows: Row[]) {
	const out: { left?: Row; right?: Row; full?: Row }[] = [];
	for (let i = 0; i < rows.length; ) {
		const r = rows[i]!;
		if (r.kind === "hunk" || r.kind === "note") {
			out.push({ full: r });
			i++;
		} else if (r.kind === "ctx") {
			out.push({ left: r, right: r });
			i++;
		} else {
			const dels: Row[] = [],
				adds: Row[] = [];
			while (rows[i]?.kind === "del") dels.push(rows[i++]!);
			while (rows[i]?.kind === "add") adds.push(rows[i++]!);
			for (let k = 0; k < Math.max(dels.length, adds.length); k++)
				out.push({ left: dels[k], right: adds[k] });
		}
	}
	return out;
}

function DiffViewer({
	viewer,
	prUrl,
	onClose,
}: {
	viewer: { list: PrFile[]; i: number };
	prUrl: string;
	onClose: (next?: { list: PrFile[]; i: number }) => void;
}) {
	const f = viewer.list[viewer.i]!,
		[split, setSplit] = useState(
			() => typeof window !== "undefined" && window.innerWidth >= 900,
		),
		[all, setAll] = useState(false),
		rows = f.patch ? parsePatch(f.patch) : [],
		LIMIT = 500,
		shown = all ? rows : rows.slice(0, LIMIT),
		go = (d: number) =>
			onClose({
				...viewer,
				i: (viewer.i + d + viewer.list.length) % viewer.list.length,
			});
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!["Escape", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
			e.stopImmediatePropagation();
			e.preventDefault();
			if (e.key === "Escape") onClose();
			else go(e.key === "ArrowLeft" ? -1 : 1);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	});
	useEffect(() => setAll(false), []);
	const dir = f.path.slice(0, f.path.lastIndexOf("/") + 1);
	const num = (v?: number) => <td className="ln">{v ?? ""}</td>;
	return (
		<div className="rp-diff-overlay" onClick={() => onClose()}>
			<div
				className="rp-diff"
				role="dialog"
				aria-label={`Diff of ${f.path}`}
				onClick={(e) => e.stopPropagation()}
			>
				<header>
					<div className="rp-diff-file">
						<span className={`rp-f-status ${f.status}`}>
							{(STATUS[f.status] ?? ["M"])[0]}
						</span>
						<span className="rp-f-path">
							<span className="dir">{dir}</span>
							<b>{f.path.slice(dir.length)}</b>
						</span>
						<span className="rp-f-stat">
							<i className="add">+{f.additions}</i>{" "}
							<i className="del">−{f.deletions}</i>
						</span>
					</div>
					<div className="rp-diff-tools">
						<div className="rp-seg rp-diff-mode">
							<button
								type="button"
								className={!split ? "on" : ""}
								onClick={() => setSplit(false)}
							>
								Unified
							</button>
							<button
								type="button"
								className={split ? "on" : ""}
								onClick={() => setSplit(true)}
							>
								Split
							</button>
						</div>
						<button
							type="button"
							onClick={() => go(-1)}
							aria-label="Previous file"
						>
							←
						</button>
						<span className="muted">
							{viewer.i + 1} / {viewer.list.length}
						</span>
						<button type="button" onClick={() => go(1)} aria-label="Next file">
							→
						</button>
						<a href={`${prUrl}/files`} target="_blank" rel="noreferrer">
							PR ↗
						</a>
						<button type="button" onClick={() => onClose()} aria-label="Close">
							✕
						</button>
					</div>
				</header>
				{f.previous && (
					<p className="rp-diff-note">Renamed from {f.previous}</p>
				)}
				<div className="rp-diff-body">
					{!f.patch ? (
						<p className="rp-diff-note">
							No inline diff available (binary or too large). Open it in the
							pull request.
						</p>
					) : split ? (
						<table className="rp-diff-table split">
							<tbody>
								{toSplit(shown).map((r, i) =>
									r.full ? (
										<tr key={i} className={r.full.kind}>
											<td colSpan={4}>{r.full.text}</td>
										</tr>
									) : (
										<tr key={i}>
											{num(r.left?.old)}
											<td className={`code ${r.left ? r.left.kind : "empty"}`}>
												{r.left?.text}
											</td>
											{num(r.right?.new)}
											<td
												className={`code ${r.right ? r.right.kind : "empty"}`}
											>
												{r.right?.text}
											</td>
										</tr>
									),
								)}
							</tbody>
						</table>
					) : (
						<table className="rp-diff-table">
							<tbody>
								{shown.map((r, i) =>
									r.kind === "hunk" || r.kind === "note" ? (
										<tr key={i} className={r.kind}>
											<td colSpan={3}>{r.text}</td>
										</tr>
									) : (
										<tr key={i} className={r.kind}>
											{num(r.old)}
											{num(r.new)}
											<td className="code">
												<span className="sign">
													{r.kind === "add"
														? "+"
														: r.kind === "del"
															? "−"
															: " "}
												</span>
												{r.text}
											</td>
										</tr>
									),
								)}
							</tbody>
						</table>
					)}
					{rows.length > shown.length && (
						<button
							type="button"
							className="rp-diff-more"
							onClick={() => setAll(true)}
						>
							Show remaining {rows.length - shown.length} lines
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

const FILES_CSS = `
.page:has(.rp-f-group){max-width:980px}
.rp-u-kpis .bad{background:var(--red);color:var(--stuck-text)}
.rp-u-kpis b.add,.rp-f-stat .add,.rp-f-title .add{color:#2fbf7f;font-style:normal}
.rp-u-kpis b.del,.rp-f-stat .del,.rp-f-title .del{color:#ff5d73;font-style:normal}
.rp-f-group{border:1px solid var(--line);border-left:5px solid var(--c);border-radius:14px;margin-top:8px;background:var(--surface);overflow:hidden}
.rp-f-group.warn{border-color:#ff5d73;background:color-mix(in srgb,#ff5d73 8%,var(--surface))}
.rp-f-head{width:100%;display:grid;grid-template-columns:28px minmax(0,1fr) minmax(60px,160px) 16px;gap:10px;align-items:center;text-align:left;background:none;border:0;color:var(--text);padding:10px 12px;cursor:pointer}
.rp-f-head .rp-num{background:var(--c);color:#fff}
.rp-f-title b{display:block;font-size:14.5px}
.rp-f-title small{color:var(--muted)}
.rp-f-areabar{display:flex;height:8px;border-radius:4px;overflow:hidden;gap:1px}
.rp-f-chev{color:var(--muted)}
.rp-f-body{padding:0 12px 10px}
.rp-f-areas{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:12.5px;color:var(--secondary);margin-bottom:6px}
.rp-f-areas i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px}
.rp-f-areas .solo{background:color-mix(in srgb,#ffb020 18%,transparent);border:1px solid #ffb020;border-radius:999px;padding:1px 8px;color:var(--text)}
.rp-f-areas .solo em{font-style:normal;font-weight:800;font-size:10.5px;color:#d08a00;margin-left:6px;text-transform:uppercase;letter-spacing:.04em}
.rp-f-solo-count{color:#d08a00;font-weight:700}
.rp-f-areas .rp-link{margin-left:auto;font-size:12.5px}
.rp-f-list{list-style:none;padding:0;margin:0;display:grid;gap:2px}
.rp-f-list button{width:100%;display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:8px;align-items:center;text-align:left;background:none;border:1px solid transparent;border-radius:8px;padding:6px 8px;color:var(--text);cursor:pointer;font-size:13px}
.rp-f-list button:hover,.rp-f-list button:focus-visible{background:var(--quiet);border-color:var(--line)}
.rp-f-status{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:5px;font-size:11px;font-weight:800;background:var(--quiet);color:var(--secondary)}
.rp-f-status.added{background:color-mix(in srgb,#3ddc97 25%,transparent);color:#2fbf7f}
.rp-f-status.removed{background:color-mix(in srgb,#ff5d73 25%,transparent);color:#ff5d73}
.rp-f-status.modified,.rp-f-status.changed{background:color-mix(in srgb,#ffb020 22%,transparent);color:#d08a00}
.rp-f-status.renamed{background:color-mix(in srgb,#4cc9f0 25%,transparent);color:#2aa5cc}
.rp-f-path{min-width:0;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.rp-f-path .dir{color:var(--muted)}
.rp-f-tag{margin-left:6px;font-family:inherit;font-size:9.5px;font-weight:800;letter-spacing:.05em;border-radius:4px;padding:1px 5px;background:var(--quiet);color:var(--secondary)}
.rp-f-tag.demo{background:#ff5d73;color:#fff}
.rp-f-also{margin-left:6px;font-family:ui-rounded,sans-serif;font-size:10.5px;font-weight:700;border:1px solid var(--c);color:var(--text);border-radius:999px;padding:0 6px}
.rp-f-stat{display:flex;gap:4px;align-items:center;font-size:12px;font-weight:700;white-space:nowrap}
.rp-f-mini{display:flex;width:44px;height:6px;border-radius:3px;overflow:hidden;gap:1px;margin-left:4px}
.rp-f-mini .add{background:#3ddc97}.rp-f-mini .del{background:#ff5d73}
.rp-diff-overlay{position:fixed;inset:0;z-index:950;background:#000b;display:grid;place-items:center;padding:20px}
.rp-diff{width:min(1400px,96vw);height:min(90vh,1100px);display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:var(--pop)}
.rp-diff header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--line)}
.rp-diff-file{display:flex;gap:8px;align-items:center;min-width:0;flex:1 1 320px}
.rp-diff-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.rp-diff-tools > button,.rp-diff-tools > a{border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:10px;padding:5px 10px;font-weight:700;text-decoration:none}
.rp-diff-body{flex:1;overflow:auto}
.rp-diff-note{margin:10px 14px;color:var(--muted)}
.rp-diff-table{border-collapse:collapse;width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.5}
.rp-diff-table td{padding:0 8px;vertical-align:top;white-space:pre}
.rp-diff-table td.code{width:100%}
.rp-diff-table.split td.code{width:50%;white-space:pre-wrap;overflow-wrap:anywhere}
.rp-diff-table .ln{color:var(--muted);text-align:right;user-select:none;min-width:44px;border-right:1px solid var(--line);opacity:.8}
.rp-diff-table tr.hunk td{background:color-mix(in srgb,#4cc9f0 14%,var(--surface));color:var(--secondary);padding:4px 10px}
.rp-diff-table tr.note td{color:var(--muted);font-style:italic}
.rp-diff-table tr.add td,.rp-diff-table td.code.add{background:color-mix(in srgb,#3ddc97 16%,transparent)}
.rp-diff-table tr.del td,.rp-diff-table td.code.del{background:color-mix(in srgb,#ff5d73 16%,transparent)}
.rp-diff-table tr.add .ln,.rp-diff-table tr.del .ln{opacity:1}
.rp-diff-table td.code.empty{background:var(--quiet)}
.rp-diff-table .sign{display:inline-block;width:14px;color:var(--muted);user-select:none}
.rp-diff-more{display:block;margin:10px auto;border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:10px;padding:6px 14px}
@media (max-width:640px){
 .rp-f-head{grid-template-columns:28px minmax(0,1fr) 16px}
 .rp-f-areabar{grid-column:2;height:6px}
 .rp-f-list button{grid-template-columns:22px minmax(0,1fr)}
 .rp-f-stat{grid-column:2}
 .rp-diff-overlay{padding:0}
 .rp-diff{width:100vw;height:100dvh;border-radius:0}
 .rp-diff-mode{display:none}
}
`;

export const GUIDED_CSS = `${FILES_CSS}
.page:has(.rp-guided){max-width:820px}
.page:has(.rp-g-diff){max-width:1120px}
.rp-guided{scroll-margin-top:80px;padding-bottom:40px}
.rp-g-stepper{display:flex;gap:3px;margin:0 0 18px}
.rp-g-stepper button{flex:1;height:8px;border:0;border-radius:4px;background:var(--track);padding:0;--c:var(--primary)}
.rp-g-stepper button.seen{background:color-mix(in srgb,var(--c) 45%,var(--track))}
.rp-g-stepper button.on{background:var(--c);height:10px;margin-top:-1px}
.rp-g-page{background:var(--surface);border:1px solid var(--line);border-top:6px solid var(--c,var(--primary));border-radius:22px;padding:22px 24px;box-shadow:var(--pop);animation:rp-in .2s ease-out}
.rp-g-kicker{font-weight:800;letter-spacing:.08em;color:var(--c,var(--secondary));font-size:11.5px}
.rp-g-page h2{margin:4px 0 6px;font-size:24px;line-height:1.2}
.rp-g-big{font-size:26px!important}
.rp-g-lead{font-size:18px;font-weight:600;margin:0 0 14px;color:var(--secondary);line-height:1.35}
.rp-g-h{margin:18px 0 8px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.rp-g-page .rp-u-kpis{margin:12px 0 4px}
.rp-g-map{overflow-x:auto;margin:12px -6px 0;padding:0 6px;-webkit-overflow-scrolling:touch}
.rp-g-map .rp-system{min-width:640px}
.rp-g-diff{margin-top:12px}
.rp-g-diff-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.rp-g-tog{display:inline-flex;gap:6px;align-items:center;border:1.5px solid var(--line);border-radius:999px;padding:4px 12px 4px 8px;font-weight:700;font-size:13px;cursor:pointer;color:var(--muted)}
.rp-g-tog{background:var(--surface)}
.rp-g-tog .box{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:4px;border:2px solid currentColor;font-size:11px;line-height:1}
.rp-g-tog.before.on .box{background:#ff5d73;border-color:#ff5d73;color:#fff}
.rp-g-tog.after.on .box{background:#3ddc97;border-color:#3ddc97;color:#08241a}
.rp-g-tog.before.on{border-color:#ff5d73;color:var(--text);background:color-mix(in srgb,#ff5d73 12%,var(--surface))}
.rp-g-tog.after.on{border-color:#3ddc97;color:var(--text);background:color-mix(in srgb,#3ddc97 12%,var(--surface))}
.rp-g-legend{font-size:12.5px;color:var(--muted);display:inline-flex;gap:5px;align-items:center;flex-wrap:wrap}
.rp-g-legend i{display:inline-block;width:18px;height:0;border-top:2.5px solid}
.rp-g-legend i.added{border-color:#3ddc97}
.rp-g-legend i.removed{border-color:#ff5d73;border-top-style:dashed}
.rp-g-legend i.changed{width:12px;height:12px;border:2px solid #ffb020;border-radius:4px}
.rp-g-strip{display:flex;gap:6px;overflow-x:auto;margin-top:12px}
.rp-g-strip img{height:110px;border-radius:8px;border:1px solid var(--line)}
.rp-g-route{list-style:none;padding:0;margin:0;display:grid;gap:5px}
.rp-g-route button{width:100%;display:grid;grid-template-columns:28px minmax(0,1fr) 12px;gap:10px;align-items:center;text-align:left;background:var(--surface);color:var(--text);border:1px solid var(--line);border-left:5px solid var(--c);border-radius:12px;padding:8px 10px}
.rp-g-route button:hover{background:color-mix(in srgb,var(--c) 10%,var(--surface))}
.rp-g-route .rp-num{background:var(--c);color:#fff}
.rp-g-route-text b{display:block;font-size:14.5px}
.rp-g-route-text small{display:block;color:var(--muted)}
.rp-g-toggle{margin:4px 0 10px}
.rp-g-carousel{margin:0}
.rp-g-shot{position:relative;display:block;width:100%;padding:0;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--quiet);cursor:zoom-in}
.rp-g-shot img{display:block;width:100%;max-height:46vh;object-fit:contain}
.rp-g-device{position:absolute;left:8px;top:8px;font-size:11px;font-weight:800;background:#000a;color:#fff;border-radius:6px;padding:2px 8px}
.rp-g-carousel figcaption{font-size:14px;margin:8px 2px;color:var(--secondary)}
.rp-g-dots{display:flex;justify-content:center;align-items:center;gap:6px}
.rp-g-dots button{width:10px;height:10px;border-radius:50%;border:0;padding:0;background:var(--track)}
.rp-g-dots button.on{background:var(--c)}
.rp-g-dots button[aria-label=Previous],.rp-g-dots button[aria-label=Next]{width:34px;height:34px;background:var(--quiet);color:var(--text);font-size:20px;line-height:1}
.rp-g-where summary{cursor:pointer;font-size:13.5px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;color:var(--secondary)}
.rp-g-chip{background:color-mix(in srgb,var(--c) 14%,var(--surface));border:1px solid var(--c);border-radius:999px;padding:1px 9px;font-weight:700;color:var(--text);font-size:12.5px}
.rp-g-flow{list-style:none;padding:0;margin:0;display:grid;gap:5px}
.rp-g-flow > li > button{display:flex;gap:10px;align-items:center;width:100%;text-align:left;background:var(--quiet);border:1px solid transparent;border-radius:12px;padding:8px 10px;color:var(--text);font-size:15px}
.rp-g-flow > li > button span{display:inline-grid;place-items:center;flex:none;width:24px;height:24px;border-radius:50%;background:var(--track);font-weight:800;font-size:12px}
.rp-g-flow li.past > button span{background:color-mix(in srgb,var(--c) 40%,var(--track))}
.rp-g-flow li.now > button{border-color:var(--c);background:color-mix(in srgb,var(--c) 12%,var(--surface))}
.rp-g-flow li.now > button span{background:var(--c);color:#fff}
.rp-g-flow li > div{padding:6px 10px 4px 44px}
.rp-g-flow p{margin:0 0 4px;font-size:15px;color:var(--secondary)}
.rp-g-check{margin-top:16px}
.rp-g-nav{position:sticky;bottom:72px;z-index:5;display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;margin-top:16px;padding:10px;background:color-mix(in srgb,var(--surface) 92%,transparent);backdrop-filter:blur(10px);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow)}
.rp-g-nav span{text-align:center;color:var(--muted);font-size:13px;font-weight:700}
.rp-g-nav button{border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:12px;padding:10px 16px;font-weight:700}
.rp-g-nav > :first-child{justify-self:start}
.rp-g-nav > :last-child{justify-self:end}
.rp-g-nav button.primary{background:var(--primary);color:var(--primary-text);border-color:var(--primary)}
.rp-g-nav button:disabled{opacity:.35}
@media (max-width:640px){
 .page:has(.rp-guided){padding-left:10px;padding-right:10px}
 .rp-g-page{padding:16px 14px;border-radius:18px}
 .rp-g-page h2{font-size:21px}
 .rp-g-big{font-size:21px!important}
 .rp-g-lead{font-size:16px}
 .rp-ba{grid-template-columns:1fr;gap:4px}
 .rp-ba .arrow{transform:rotate(90deg);justify-self:center;line-height:1}
 .rp-g-nav{bottom:64px}
 .rp-switcher span{min-width:0;max-width:150px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
 .rp-switcher{bottom:8px;font-size:11px;gap:6px;padding:5px 8px;white-space:nowrap}
 .rp-switcher label{font-size:0}
 .rp-switcher label input{font-size:11px}
 .rp-lightbox{padding:6px}
}
`;
