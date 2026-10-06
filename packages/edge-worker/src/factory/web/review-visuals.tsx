// biome-ignore-all lint/a11y/noNoninteractiveTabindex: scrollable maps need keyboard focus
import { useId, useState } from "react";
import type { GuideChapter, GuideFlow, GuideSystem } from "../FactoryResults";
import { LazyImage } from "./media";
import { mapConnections } from "./review-model";
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
		width = system.lanes.length * 260;
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
	const lanes = system.lanes.map((lane) => labelsFor(lane.name, 216, 12, 800)),
		top = Math.max(52, ...lanes.map((lines) => 45 + (lines.length - 1) * 14));
	const positions = new Map<
		string,
		{ x: number; y: number; lane: number; height: number; labels: string[] }
	>();
	let bottom = top;
	system.lanes.forEach((lane, i) => {
		let y = top;
		for (const part of system.parts.filter((p) => p.laneId === lane.id)) {
			const labels = labelsFor(part.label, 142, 13, 700),
				height = Math.max(66, labels.length * 15 + 30);
			positions.set(part.id, { x: i * 260 + 24, y, lane: i, height, labels });
			bottom = Math.max(bottom, y + height + 20);
			y += height + 34;
		}
	});
	const tracks: { x: number; y: number; width: number; height: number }[] = [];
	let lower = bottom;
	const layout = edges.map((edge) => {
		const source = positions.get(edge.source)!,
			target = positions.get(edge.target)!;
		const adjacent = target.lane === source.lane + 1;
		const labelWidth = adjacent ? 72 : 220;
		const label =
			edge.kind === "removed"
				? `✕ ${edge.label ?? "connection"}`
				: edge.kind === "changed"
					? `${edge.oldLabel ?? "unlabelled"} → ${edge.newLabel ?? "unlabelled"}`
					: (edge.label ?? "");
		const oldLines =
				edge.kind === "changed"
					? labelsFor(edge.oldLabel ?? "unlabelled", labelWidth, 12, 400)
					: [],
			labels =
				edge.kind === "changed"
					? [
							...oldLines,
							...labelsFor(
								`→ ${edge.newLabel ?? "unlabelled"}`,
								labelWidth,
								12,
								400,
							),
						]
					: labelsFor(label, labelWidth, 12, 400),
			labelHeight = Math.max(1, labels.length) * 15;
		// Wide labels on same-lane connections need an inset at the map edges.
		const x = Math.max(
			labelWidth / 2 + 12,
			Math.min(
				width - labelWidth / 2 - 12,
				adjacent ? source.x + 213 : (source.x + target.x) / 2 + 83,
			),
		);
		const sourceMiddle = source.y + source.height / 2,
			targetMiddle = target.y + target.height / 2;
		// Keep the whole wrapped label below the lane headings, even when it
		// is taller than the components it connects.
		let y = adjacent
			? Math.max((sourceMiddle + targetMiddle) / 2, top + labelHeight / 2 + 12)
			: lower + labelHeight + 12;
		while (
			tracks.some(
				(t) =>
					Math.abs(t.x - x) < (t.width + labelWidth) / 2 + 12 &&
					Math.abs(t.y - y) < (t.height + labelHeight) / 2 + 12,
			)
		)
			y += labelHeight + 14;
		tracks.push({ x, y, width: labelWidth, height: labelHeight });
		if (!adjacent) lower = y + 26;
		const path = adjacent
			? `M${source.x + 166},${sourceMiddle} C${source.x + 194},${sourceMiddle} ${x - 20},${y} ${x},${y} C${x + 20},${y} ${target.x - 28},${targetMiddle} ${target.x},${targetMiddle}`
			: `M${source.x + 83},${source.y + source.height} C${source.x + 83},${y + 12} ${source.x + 83},${y + 12} ${source.x + 83},${y + 12} L${target.x + 83},${y + 12} C${target.x + 83},${y + 12} ${target.x + 83},${y + 12} ${target.x + 83},${target.y + target.height}`;
		return { path, x, y, labels, labelHeight, oldCount: oldLines.length };
	});
	const height =
		Math.max(bottom, ...layout.map((l) => l.y + l.labelHeight / 2)) + 24;

	return (
		<figure className="system-map">
			{!afterOnly && (
				<div className="actions map-controls">
					<Button
						variant="secondary"
						aria-pressed={before}
						onClick={() => setBefore(!before)}
					>
						Before
					</Button>
					<Button
						variant="secondary"
						aria-pressed={after}
						onClick={() => setAfter(!after)}
					>
						After
					</Button>
				</div>
			)}
			<figcaption>
				{before && after
					? "＋ added · ✕ removed · ↔ changed"
					: before
						? "Before: old connections; new parts are ghosted"
						: after
							? "After: new connections; legacy parts are dimmed"
							: "All components · no connections"}
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
							x={i * 260 + 107}
							y={24}
							textAnchor="middle"
							className="map-lane"
						>
							{lanes[i]!.map((line, j) => (
								<tspan key={j} x={i * 260 + 107} dy={j ? 14 : 0}>
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
							label =
								edge.kind === "removed"
									? `✕ ${edge.label ?? "connection"}`
									: edge.kind === "changed"
										? `${edge.oldLabel ?? "unlabelled"} → ${edge.newLabel ?? "unlabelled"}`
										: edge.label;
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
												dy={j ? 15 : 0}
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
									width={166}
									height={pos.height}
									rx={12}
								/>
								<text x={pos.x + 83} y={pos.y + 32} textAnchor="middle">
									{labels.map((line, j) => (
										<tspan key={j} x={pos.x + 83} dy={j ? 15 : 0}>
											{line}
										</tspan>
									))}
								</text>
								{part.status !== "unchanged" && (
									<text
										x={pos.x + 154}
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
							{e.kind === "changed" ? `${e.oldLabel} → ${e.newLabel}` : e.label}
						</li>
					))}
				</ul>
			</div>
		</figure>
	);
}
export function FlowReveal({ flow }: { flow: GuideFlow }) {
	const [stage, setStage] = useState(0);
	return (
		<section className="flow-reveal">
			<h3>{flow.title}</h3>
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
								<p>{step.detail}</p>
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
}: {
	strip?: boolean;
	refs: GuideChapter["screenshots"];
	inventory: any[];
	runId: string;
	error?: boolean;
	loading?: boolean;
}) {
	const [index, setIndex] = useState(0),
		[open, setOpen] = useState(false),
		[touch, setTouch] = useState<{ x: number; y: number }>();
	const ref = refs[index]!,
		shot = inventory.find((s) => s.area === ref.area && s.state === ref.state),
		src = shot
			? `/api/runs/${encodeURIComponent(runId)}/screenshots/${shot.index}?v=${shot.imageSha256 ?? ""}`
			: undefined;
	const context = [ref.device, ref.language, ref.state]
		.filter(Boolean)
		.join(" · ");
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
			{!strip && ref.device && <span className="device-tag">{ref.device}</span>}
			{strip ? (
				<div className="screenshot-strip">
					{refs.map((ref, i) => {
						const shot = inventory.find(
							(s) => s.area === ref.area && s.state === ref.state,
						);
						return (
							<button
								type="button"
								key={`${ref.area}/${ref.state}/${i}`}
								onClick={() => {
									setIndex(i);
									setOpen(true);
								}}
								aria-label={`Enlarge image: ${ref.caption}`}
							>
								{shot ? (
									<EvidenceImage
										src={`/api/runs/${encodeURIComponent(runId)}/screenshots/${shot.index}?v=${shot.imageSha256 ?? ""}`}
										alt={ref.caption}
									/>
								) : (
									<p>Screenshot unavailable</p>
								)}
								<small>{ref.caption}</small>
							</button>
						);
					})}
				</div>
			) : (
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
	system,
	inventory,
	runId,
	error,
	loading,
}: {
	chapter: GuideChapter;
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
								{parts
									.map(
										(id) => system.parts.find((p) => p.id === id)?.label ?? id,
									)
									.join(" · ")}
							</summary>
							<SystemMap system={system} highlighted={parts} afterOnly />
						</details>
					)}
					{flow && <FlowReveal flow={flow} />}
				</>
			)}
		</section>
	);
}
