// biome-ignore-all lint/a11y/noNoninteractiveTabindex: scrollable maps need keyboard focus
import { useEffect, useId, useState } from "react";
import type { GuideChapter, GuideFlow, GuideSystem } from "../FactoryResults";
import { LazyImage } from "./media";
import type { Annotate } from "./review";
import { useReviewFeedback } from "./review-comments";
import { mapConnections, screenshotDevice } from "./review-model";
import { Button, Modal } from "./ui";

function wrapLabel(
	value: string,
	max: number,
	measure = (text: string) => text.length,
): string[] {
	const result: string[] = [];
	let remaining = value;
	while (measure(remaining) > max) {
		let fitting = 0;
		for (const character of remaining) {
			const next = fitting + character.length;
			if (fitting && measure(remaining.slice(0, next)) > max) break;
			fitting = next;
		}
		const space = remaining.lastIndexOf(" ", fitting),
			cut = space > 0 ? space : fitting;
		result.push(remaining.slice(0, cut));
		remaining = remaining.slice(cut).trimStart();
	}
	if (remaining) result.push(remaining);
	return result;
}
export function SystemMap({
	system,
	highlighted = [],
	afterOnly = false,
}: {
	system: GuideSystem;
	highlighted?: string[];
	afterOnly?: boolean;
}) {
	const [before, setBefore] = useState(!afterOnly),
		[after, setAfter] = useState(true),
		id = useId().replace(/:/g, "");
	const edges = mapConnections(system, before, after),
		pitch = 176,
		boxWidth = 124,
		width = system.lanes.length * pitch;
	const context = document.createElement("canvas").getContext("2d")!,
		font = getComputedStyle(document.body).fontFamily;
	const labelsFor = (
		value: string,
		max: number,
		size: number,
		weight: number,
	) => {
		context.font = `${weight} ${size}px ${font}`;
		return wrapLabel(value, max, (text) => context.measureText(text).width);
	};
	const lanes = system.lanes.map((lane) =>
		labelsFor(lane.name.toUpperCase(), pitch - 16, 10, 800),
	);
	const headingBottom = Math.max(
		38,
		...lanes.map((lines) => 30 + lines.length * 12),
	);
	const prepared = edges.map((edge) => {
		const sourceLane = system.lanes.findIndex(
				(l) => l.id === system.parts.find((p) => p.id === edge.source)?.laneId,
			),
			targetLane = system.lanes.findIndex(
				(l) => l.id === system.parts.find((p) => p.id === edge.target)?.laneId,
			),
			adjacent = Math.abs(targetLane - sourceLane) === 1,
			labelWidth =
				sourceLane === targetLane
					? pitch - boxWidth - 10
					: adjacent
						? pitch - boxWidth - 10
						: Math.min(
								220,
								pitch * Math.max(1, Math.abs(targetLane - sourceLane)) - 24,
							),
			oldLines =
				edge.kind === "changed" && edge.oldLabel
					? labelsFor(edge.oldLabel, labelWidth, 10.5, 700)
					: [],
			label =
				edge.kind === "changed"
					? `${edge.oldLabel ?? ""} → ${edge.newLabel ?? ""}`
					: (edge.label ?? ""),
			labels =
				edge.kind === "changed"
					? [
							...oldLines,
							...labelsFor(`→ ${edge.newLabel ?? ""}`, labelWidth, 10.5, 700),
						]
					: labelsFor(label, labelWidth, 10.5, 700);
		return {
			adjacent,
			sourceLane,
			targetLane,
			label,
			labels,
			labelWidth,
			labelHeight: labels.length * 13,
			oldCount: oldLines.length,
		};
	});
	// Skipped-lane curves arch above the components. Allocate label space only
	// where intervals collide; there is no routing strip beneath the boxes.
	const tracks: { left: number; right: number; bottom: number }[] = [];
	const arches = prepared.map((e, i) => {
		if (e.adjacent) return 0;
		if (!e.label) return headingBottom + 12 + (i % 3) * 8;
		const center = ((e.sourceLane + e.targetLane + 1) * pitch) / 2,
			left = center - e.labelWidth / 2,
			right = center + e.labelWidth / 2;
		let y = headingBottom + e.labelHeight / 2 + 10;
		for (const track of tracks)
			if (left < track.right && right > track.left)
				y = Math.max(y, track.bottom + e.labelHeight / 2 + 10);
		tracks.push({ left, right, bottom: y + e.labelHeight / 2 });
		return y;
	});
	const top = Math.max(
		headingBottom + 24,
		...tracks.map((t) => t.bottom + 28),
		...prepared
			.filter((e) => e.adjacent)
			.map((e) => headingBottom + e.labelHeight / 2 + 12),
	);
	const positions = new Map<
		string,
		{ x: number; y: number; lane: number; height: number; labels: string[] }
	>();
	let bottom = top;
	system.lanes.forEach((lane, i) => {
		let y = top;
		for (const part of system.parts.filter((p) => p.laneId === lane.id)) {
			const labels = labelsFor(part.label, boxWidth - 16, 12.5, 600),
				height = Math.max(40, labels.length * 15 + 24);
			positions.set(part.id, { x: i * pitch + 26, y, lane: i, height, labels });
			bottom = Math.max(bottom, y + height);
			y += height + 22;
		}
	});
	const port = (part: string, source: boolean, i: number, height: number) => {
		const peers = edges.flatMap((e, j) =>
			(source ? e.source : e.target) === part ? [j] : [],
		);
		return (height * (peers.indexOf(i) + 1)) / (peers.length + 1);
	};
	const layout = edges.map((edge, i) => {
		const source = positions.get(edge.source)!,
			target = positions.get(edge.target)!,
			e = prepared[i]!,
			forward = target.lane >= source.lane,
			sx = source.x + (forward ? boxWidth : 0),
			tx = target.x + (forward ? 0 : boxWidth),
			sy = source.y + port(edge.source, true, i, source.height),
			ty = target.y + port(edge.target, false, i, target.height),
			x = Math.max(
				e.labelWidth / 2 + 8,
				Math.min(width - e.labelWidth / 2 - 8, (sx + tx) / 2),
			),
			y = e.adjacent ? (sy + ty) / 2 : arches[i]!,
			bend = (forward ? 1 : -1) * Math.max(20, Math.abs(tx - sx) * 0.4);
		const sameSide = source.lane === system.lanes.length - 1 ? -1 : 1;
		const loopX = source.x + (sameSide > 0 ? boxWidth : 0);
		const path = e.adjacent
			? `M${sx},${sy} C${sx + bend},${sy} ${tx - bend},${ty} ${tx},${ty}`
			: source.lane === target.lane
				? `M${loopX},${sy} C${loopX + sameSide * 24},${sy - 28} ${loopX + sameSide * 24},${ty + 28} ${loopX},${ty}`
				: `M${sx},${sy} C${sx + bend},${y - 32} ${tx - bend},${y - 32} ${tx},${ty}`;
		return {
			...e,
			path,
			x: source.lane === target.lane ? loopX + sameSide * 22 : x,
			y: source.lane === target.lane ? (sy + ty) / 2 : y,
		};
	});
	const height =
		Math.max(
			bottom,
			...layout.filter((l) => l.adjacent).map((l) => l.y + l.labelHeight / 2),
		) + 24;

	return (
		<figure className="system-map">
			{!afterOnly && (
				<div className="actions map-controls">
					<Button
						variant="secondary"
						className="map-before"
						aria-pressed={before}
						onClick={() => setBefore(!before)}
					>
						<span className="map-check" aria-hidden="true">
							{before ? "✓" : ""}
						</span>
						Before
					</Button>
					<Button
						variant="secondary"
						className="map-after"
						aria-pressed={after}
						onClick={() => setAfter(!after)}
					>
						<span className="map-check" aria-hidden="true">
							{after ? "✓" : ""}
						</span>
						After
					</Button>
				</div>
			)}
			<figcaption>
				{before && after ? (
					<span className="map-legend">
						<span>
							<i className="legend-added" /> added
						</span>
						<span>
							<i className="legend-removed" /> removed
						</span>
						<span>
							<i className="legend-changed" /> changed
						</span>
					</span>
				) : before ? (
					"Before: old connections; new parts are ghosted"
				) : after ? (
					"After: new connections; legacy parts are dimmed"
				) : (
					"All components · no connections"
				)}
			</figcaption>
			<section
				className="map-scroll"
				tabIndex={0}
				aria-label="System map, scroll horizontally for all lanes"
			>
				<svg
					width={width}
					height={height}
					viewBox={`0 0 ${width} ${height}`}
					aria-hidden="true"
				>
					<defs>
						{["added", "removed", "changed", "kept", "highlight"].map(
							(kind) => (
								<marker
									key={kind}
									id={`${id}-${kind}`}
									viewBox="0 0 10 10"
									refX="9"
									refY="5"
									markerWidth="7"
									markerHeight="7"
									orient="auto-start-reverse"
								>
									<path
										d="M 0 0 L 10 5 L 0 10 z"
										className={`map-arrow ${kind}`}
									/>
								</marker>
							),
						)}
					</defs>
					{system.lanes.map((lane, i) => (
						<text
							key={lane.id}
							x={i * pitch + pitch / 2}
							y={24}
							textAnchor="middle"
							className="map-lane"
						>
							{lanes[i]!.map((line, j) => (
								<tspan key={j} x={i * pitch + pitch / 2} dy={j ? 12 : 0}>
									{line}
								</tspan>
							))}
						</text>
					))}
					{edges.map((edge, i) => {
						const routed = layout[i]!,
							selected =
								highlighted.includes(edge.source) &&
								highlighted.includes(edge.target),
							label = routed.label;
						return (
							<g
								key={`${edge.source}/${edge.target}`}
								className={`map-edge ${edge.kind} ${selected ? "highlight" : ""} ${edge.weak ? "weak" : ""}`}
							>
								<path
									d={routed.path}
									fill="none"
									markerEnd={`url(#${id}-${selected ? "highlight" : edge.kind})`}
								/>
								{label && (
									<text
										x={routed.x}
										y={routed.y - routed.labelHeight / 2 + 5}
										textAnchor="middle"
										className="map-edge-label"
									>
										{routed.labels.map((line, j) => (
											<tspan
												key={j}
												x={routed.x}
												dy={j ? 13 : 0}
												className={
													j < routed.oldCount ? "old-label" : undefined
												}
											>
												{line}
											</tspan>
										))}
									</text>
								)}
							</g>
						);
					})}
					{system.parts.map((part) => {
						const pos = positions.get(part.id)!,
							ghost =
								(before && !after && part.status === "new") ||
								(after && !before && part.status === "legacy"),
							selected = highlighted.includes(part.id),
							labels = pos.labels;
						return (
							<g
								key={part.id}
								className={`map-part ${part.status} ${ghost ? "ghost" : ""} ${selected ? "highlight" : ""}`}
							>
								<rect
									x={pos.x}
									y={pos.y}
									width={boxWidth}
									height={pos.height}
									rx={12}
								/>
								<text
									x={pos.x + boxWidth / 2}
									y={pos.y + 26}
									textAnchor="middle"
								>
									{labels.map((line, j) => (
										<tspan key={j} x={pos.x + boxWidth / 2} dy={j ? 13 : 0}>
											{line}
										</tspan>
									))}
								</text>
								{part.status !== "unchanged" && (
									<text
										x={pos.x + boxWidth - 8}
										y={pos.y + 13}
										textAnchor="end"
										className="map-status"
									>
										{part.status.toUpperCase()}
									</text>
								)}
							</g>
						);
					})}
				</svg>
			</section>
			<div className="sr-only">
				<ul>
					{system.parts.map((p) => (
						<li key={p.id}>
							{p.label}, {p.status}, lane{" "}
							{system.lanes.find((l) => l.id === p.laneId)?.name}
							{highlighted.includes(p.id) ? ", highlighted for this step" : ""}
						</li>
					))}
				</ul>
				<ul>
					{edges.map((e) => (
						<li key={`${e.source}/${e.target}`}>
							{e.source} → {e.target}: {e.kind},{" "}
							{e.kind === "changed"
								? `${e.oldLabel ?? ""} → ${e.newLabel ?? ""}`
								: e.label}
						</li>
					))}
				</ul>
			</div>
		</figure>
	);
}
export function FlowReveal({
	flow,
	path = "",
	annotate,
}: {
	flow: GuideFlow;
	path?: string;
	annotate?: Annotate;
}) {
	const [stage, setStage] = useState(0);
	const editing = useReviewFeedback()?.draft.editing;
	useEffect(() => {
		if (!editing?.startsWith(`${path}/steps/`)) return;
		const index = Number(editing.slice(`${path}/steps/`.length));
		if (Number.isInteger(index) && index >= 0 && index < flow.steps.length)
			setStage(index);
	}, [editing, path, flow.steps.length]);
	return (
		<section className="flow-reveal">
			{annotate ? (
				annotate(
					`${path}/title`,
					flow.title,
					"Diagram",
					flow.title,
					[4, 0],
					<h3>{flow.title}</h3>,
				)
			) : (
				<h3>{flow.title}</h3>
			)}
			<ol>
				{flow.steps.map((step, i) => (
					<li key={i}>
						<button
							type="button"
							aria-expanded={stage === i}
							className={i <= stage ? "reached" : ""}
							onClick={() => setStage(i)}
						>
							<span className="step-badge">{i + 1}</span>
							<strong>{step.label}</strong>
						</button>
						{stage === i && (
							<div>
								{annotate ? (
									annotate(
										`${path}/steps/${i}`,
										step.label,
										"Diagram step",
										`${step.label}: ${step.detail}`,
										[4, 1, i],
										<p>{step.detail}</p>,
									)
								) : (
									<p>{step.detail}</p>
								)}
								{i < flow.steps.length - 1 && (
									<button
										type="button"
										className="text-button"
										onClick={() => setStage(i + 1)}
									>
										Next stage ↓
									</button>
								)}
							</div>
						)}
					</li>
				))}
			</ol>
		</section>
	);
}
function EvidenceImage({ src, alt }: { src: string; alt: string }) {
	const [failed, setFailed] = useState(false);
	return failed ? (
		<p role="status">This screenshot could not be loaded.</p>
	) : (
		<LazyImage
			src={src}
			alt={alt}
			onError={() => setFailed(true)}
			style={{ aspectRatio: "auto" }}
		/>
	);
}
export function Screens({
	refs,
	inventory,
	runId,
	error,
	loading,
	strip = false,
	onSelect,
	annotate,
	base = "",
}: {
	strip?: boolean;
	onSelect?: (index: number) => void;
	annotate?: Annotate;
	base?: string;
	refs: GuideChapter["screenshots"];
	inventory: any[];
	runId: string;
	error?: boolean;
	loading?: boolean;
}) {
	const [index, setIndex] = useState(0),
		[open, setOpen] = useState(false),
		[touch, setTouch] = useState<{ x: number; y: number }>();
	const editing = useReviewFeedback()?.draft.editing;
	useEffect(() => {
		if (!editing?.startsWith(`${base}/screenshots/`)) return;
		const selected = Number(editing.slice(`${base}/screenshots/`.length));
		if (Number.isInteger(selected) && selected >= 0 && selected < refs.length)
			setIndex(selected);
	}, [editing, base, refs.length]);
	const ref = refs[index]!,
		shot = inventory.find((s) => s.area === ref.area && s.state === ref.state),
		src = shot
			? `/api/runs/${encodeURIComponent(runId)}/screenshots/${shot.index}?v=${shot.imageSha256 ?? ""}`
			: undefined;
	const device = screenshotDevice(ref, shot);
	const context = [device, ref.language, ref.state].filter(Boolean).join(" · ");
	const move = (delta: number) =>
		setIndex((i) => (i + delta + refs.length) % refs.length);
	const picture = src ? (
		<EvidenceImage key={src} src={src} alt={ref.caption} />
	) : (
		<p role="status">
			{loading
				? "Loading image evidence…"
				: error
					? "Could not load image evidence"
					: "This screenshot is unavailable"}
		</p>
	);
	const navigation = (
		<div className="screen-navigation">
			<Button
				variant="secondary"
				aria-label="Previous image"
				onClick={() => move(-1)}
				disabled={refs.length < 2}
			>
				←
			</Button>
			<span>
				{index + 1} / {refs.length}
			</span>
			<Button
				variant="secondary"
				aria-label="Next image"
				onClick={() => move(1)}
				disabled={refs.length < 2}
			>
				→
			</Button>
		</div>
	);
	return (
		<figure
			className="chapter-screen"
			onTouchStart={(e) =>
				setTouch({ x: e.touches[0]!.clientX, y: e.touches[0]!.clientY })
			}
			onTouchEnd={(e) => {
				if (!touch) return;
				const dx = e.changedTouches[0]!.clientX - touch.x,
					dy = e.changedTouches[0]!.clientY - touch.y;
				if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.7)
					move(dx < 0 ? 1 : -1);
				setTouch(undefined);
			}}
		>
			{!strip && <span className="device-tag">{device}</span>}
			{strip ? (
				<div className="screenshot-strip">
					{refs.slice(0, 8).map((ref, i) => {
						const shot = inventory.find(
							(s) => s.area === ref.area && s.state === ref.state,
						);
						return (
							<button
								type="button"
								key={`${ref.area}/${ref.state}/${i}`}
								onClick={() => {
									if (onSelect) onSelect(i);
									else {
										setIndex(i);
										setOpen(true);
									}
								}}
								aria-label={ref.caption}
								title={ref.caption}
							>
								{shot ? (
									<EvidenceImage
										src={`/api/runs/${encodeURIComponent(runId)}/screenshots/${shot.index}?v=${shot.imageSha256 ?? ""}`}
										alt={ref.caption}
									/>
								) : (
									<p>Screenshot unavailable</p>
								)}
								<span className="device-tag">
									{screenshotDevice(ref, shot)}
								</span>
							</button>
						);
					})}
				</div>
			) : (
				<>
					{annotate ? (
						annotate(
							`${base}/screenshots/${index}`,
							ref.caption,
							"Screenshot",
							`Area: ${ref.area}; state: ${ref.state}; caption: ${ref.caption}`,
							[5, index],
							<>
								<button
									type="button"
									className="screen-open"
									onClick={() => setOpen(true)}
									aria-label={`Enlarge image: ${ref.caption}`}
								>
									{picture}
								</button>
								<figcaption>{ref.caption}</figcaption>
							</>,
						)
					) : (
						<>
							<button
								type="button"
								className="screen-open"
								onClick={() => setOpen(true)}
								aria-label={ref.caption}
								title={ref.caption}
							>
								{picture}
							</button>
							<figcaption>{ref.caption}</figcaption>
						</>
					)}
					{refs.length > 1 && (
						<>
							{navigation}
							<div className="screen-dots">
								{refs.map((r, i) => (
									<button
										type="button"
										key={`${r.area}/${r.state}/${i}`}
										aria-label={`Image ${i + 1}: ${r.caption}`}
										aria-pressed={i === index}
										onClick={() => setIndex(i)}
									>
										●
									</button>
								))}
							</div>
						</>
					)}
				</>
			)}

			<Modal
				open={open}
				onOpenChange={setOpen}
				className="image-viewer"
				title={ref.caption}
				description={`${context} · ${index + 1} / ${refs.length} · Esc to close`}
				onKeyDown={(e: React.KeyboardEvent) => {
					if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
						e.preventDefault();
						e.stopPropagation();
						move(e.key === "ArrowLeft" ? -1 : 1);
					}
				}}
			>
				{picture}
				{navigation}
				<strong>{ref.caption}</strong>
				<p className="muted">{context}</p>
			</Modal>
		</figure>
	);
}
export function ChapterVisual({
	chapter,
	annotate,
	base,
	system,
	inventory,
	runId,
	error,
	loading,
}: {
	chapter: GuideChapter;
	annotate?: Annotate;
	base?: string;
	system?: GuideSystem;
	inventory: any[];
	runId: string;
	error?: boolean;
	loading?: boolean;
}) {
	const visual = chapter.screenshots.length > 0,
		flow = chapter.flow ?? chapter.diagrams[0],
		parts = chapter.systemPartIds ?? [],
		logic = Boolean(flow || parts.length),
		[mode, setMode] = useState(visual ? "visual" : "logic");
	const editing = useReviewFeedback()?.draft.editing;
	useEffect(() => {
		if (editing?.startsWith(`${base}/screenshots/`) && visual)
			setMode("visual");
		if (editing?.startsWith(`${base}/flow/`) && logic) setMode("logic");
	}, [editing, base, visual, logic]);
	if (!visual && !logic) return null;
	return (
		<section className="primary-visual">
			{visual && logic && (
				<div className="actions">
					<Button
						variant="secondary"
						aria-pressed={mode === "visual"}
						onClick={() => setMode("visual")}
					>
						See it · {chapter.screenshots.length}
					</Button>
					<Button
						variant="secondary"
						aria-pressed={mode === "logic"}
						onClick={() => setMode("logic")}
					>
						How it works
					</Button>
				</div>
			)}
			{mode === "visual" ? (
				<Screens
					refs={chapter.screenshots}
					annotate={annotate}
					base={base}
					inventory={inventory}
					runId={runId}
					error={error}
					loading={loading}
				/>
			) : (
				<>
					{system && parts.length > 0 && (
						<details className="where-map">
							<summary>
								Where:{" "}
								{parts.map((id) => (
									<span className="where-chip" key={id}>
										{system.parts.find((p) => p.id === id)?.label ?? id}
									</span>
								))}
							</summary>
							<SystemMap system={system} highlighted={parts} afterOnly />
						</details>
					)}
					{flow && (
						<FlowReveal
							flow={flow}
							annotate={chapter.flow ? annotate : undefined}
							path={`${base}/${chapter.flow ? "flow" : "diagrams/0"}`}
						/>
					)}
				</>
			)}
		</section>
	);
}
