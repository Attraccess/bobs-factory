// biome-ignore-all lint/a11y/useKeyWithClickEvents: throwaway prototype
// PROTOTYPE (throwaway) — bobs-factory#71, variant G "Guided Atlas".
// Step-by-step: one Atlas-style overview, then ONE focus area per step (a chapter), then
// the decision. Each chapter page shows a single primary visual at a time (screens OR how
// it works), with the rest folded away. Single column, sticky nav, works on mobile.
// The current step lives in the URL (`&step=`), so it is shareable and reload-stable.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DecisionActions } from "./focus";
import { LazyImage } from "./media";
import {
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
		total = n + 2, // overview + chapters + decide
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
						{step === 0 ? "Start →" : step === n ? "Decide →" : "Next →"}
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

export const GUIDED_CSS = `
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
