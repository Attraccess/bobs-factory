import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	Component,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Link } from "react-router-dom";
import { api, artifactsOf, friendly, screenshotUrl } from "./client";
import { LazyImage } from "./media";
import { GuidedReview } from "./review";
import { Button, External, Markdown, Modal, useToast } from "./ui";
export function artifactType(v: any) {
	if (!v || typeof v !== "object")
		return typeof v === "string" ? "document" : "structure";
	const keys = new Set([
		...Object.keys(v),
		...(Array.isArray(v.keys) ? v.keys : []),
	]);
	if (keys.has("qaContract") && keys.has("results")) return "qa";
	if (
		Array.isArray(v.screenshots) ||
		(v.__artifactPreview && keys.has("screenshots"))
	)
		return "screenshots";
	if (keys.has("goal") && keys.has("decision")) return "guide";
	if (keys.has("decisions")) return "decisions";
	if (keys.has("completed") && keys.has("remaining")) return "assessment";
	if (keys.has("identifier") && keys.has("description")) return "ticket";
	if (keys.has("reviews") && keys.has("headRefName")) return "source";
	if (keys.has("diff")) return "existing";
	if (keys.has("checks") && (keys.has("headSha") || keys.has("approved")))
		return "ci";
	if (keys.has("findings") && !keys.has("approved")) return "review";
	if (keys.has("approved")) return "gate";
	if (keys.has("areas")) return "scope";
	if (keys.has("plan")) return "document";
	if (keys.has("url") && keys.has("headSha")) return "pr";
	if (keys.has("summary")) return "report";
	return "structure";
}
const typeIcons: Record<string, string> = {
	qa: "🧪",
	screenshots: "🖼️",
	guide: "📖",
	decisions: "📌",
	assessment: "🧭",
	ticket: "🎫",
	source: "🔀",
	existing: "🌿",
	ci: "🧪",
	review: "👀",
	gate: "✅",
	scope: "🎯",
	document: "📄",
	pr: "🚀",
	report: "📝",
	structure: "🗂️",
};
export function artifactSummary(v: any): string {
	if (v?.__artifactPreview)
		return `${Math.ceil(v.size / 1024)} KB · open to inspect`;
	if (v?.qaBlocked) return "QA assistance needed";
	if (v?.qaContract && v?.results) {
		const criteria = v.results.flatMap((r: any) => r.criteria ?? []);
		return `${criteria.filter((c: any) => c.outcome === "passed").length}/${criteria.length} criteria passed · ${v.screenshots?.length ?? 0} screenshots`;
	}
	if (v?.qaContract && v?.stories)
		return `${v.stories.length} QA stories · ${v.stories.reduce((n: number, story: any) => n + story.criteria.length, 0)} criteria · ${v.areas?.length ?? 0} visual areas`;
	if (v?.captureBlocked) return "Capture assistance needed";
	if (v?.screenshots) return `${v.screenshots.length} screenshots`;
	if (v?.decisions) return `${v.decisions.length} decisions`;
	if (v?.checks && v?.headSha)
		return `${v.checks.filter((c: any) => ["pass", "skipping"].includes(c.bucket)).length}/${v.checks.length} passing${v.blockers?.length ? ` · ${v.blockers.length} blockers` : ""}`;
	if (v?.findings)
		return v.findings.length
			? `${v.findings.length} findings`
			: "No findings 🎉";
	if (typeof v?.approved === "boolean")
		return v.approved
			? "Approved"
			: `Changes needed${v.feedback?.length ? ` · ${v.feedback.length} items` : ""}`;
	if (v?.completed && v?.remaining)
		return `${v.completed.length} done · ${v.remaining.length} remaining`;
	if (v?.areas) return `${v.areas.length} areas`;
	if (v?.identifier) return `${v.identifier} · ${v.title}`;
	if (v?.plan)
		return (
			v.plan
				.split("\n")
				.find((l: string) => l.trim())
				?.replace(/^#+\s*/, "") ?? "Implementation plan"
		);
	if (v?.goal) return v.goal;
	return String(
		v?.summary ??
			v?.branch ??
			v?.title ??
			(typeof v === "string" ? v : "Step result"),
	).slice(0, 180);
}
export function ArtifactCard({
	artifact,
	run,
	onOpen,
}: {
	artifact: any;
	run: any;
	onOpen: (name: string, image?: number) => void;
}) {
	const kind = artifactType(artifact.value);
	return (
		<button
			type="button"
			className={`artifact-card artifact-${kind}`}
			onClick={() => onOpen(artifact.name)}
		>
			<span className="artifact-icon">{typeIcons[kind]}</span>
			<span className="artifact-copy">
				<strong>{artifact.title}</strong>
				<span>{artifactSummary(artifact.value)}</span>
				{(kind === "screenshots" || kind === "qa") && (
					<span className="artifact-thumbs">
						{(artifact.value.screenshots ?? [])
							.slice(0, 3)
							.map((shot: any, i: number) => (
								<LazyImage
									key={shot.path}
									src={screenshotUrl(run, i, artifact.name)}
									alt={shot.caption}
									loading="lazy"
								/>
							))}
					</span>
				)}
			</span>
		</button>
	);
}
export function Pairs({ pairs = [] }: { pairs?: any[] }) {
	return (
		<div className="pairs">
			{(Array.isArray(pairs) ? pairs : []).map((pair: any, i: number) => (
				<section key={`${pair.scenario}/${i}`}>
					<strong>{pair.scenario}</strong>
					<div className="pair">
						<div>
							<small>BEFORE</small>
							<Markdown>{pair.before}</Markdown>
						</div>
						<div>
							<small>AFTER</small>
							<Markdown>{pair.after}</Markdown>
						</div>
					</div>
				</section>
			))}
		</div>
	);
}
function List({ items = [] }: { items?: any[] }) {
	return (
		<ul>
			{(Array.isArray(items) ? items : []).map((item, i) => (
				<li key={i}>
					{typeof item === "string" ? (
						<Markdown>{item}</Markdown>
					) : (
						<Structure value={item} />
					)}
				</li>
			))}
		</ul>
	);
}
function Findings({ items = [] }: { items?: any[] }) {
	return items.length ? (
		<div className="findings">
			{items.map((f: any, i: number) => (
				<article
					key={f.id ?? i}
					className={`finding severity-${f.rating ?? f.severity ?? 2}`}
				>
					<div className="meta">
						<code>{f.id}</code>
						<span className="chip">Severity {f.rating ?? f.severity}</span>
						<span>{f.status}</span>
					</div>
					<strong>{f.summary}</strong>
					<pre>{f.evidence}</pre>
					{f.reproduction && (
						<details>
							<summary>Reproduce and compare</summary>
							<p>
								<strong>Expected:</strong> {f.expected}
							</p>
							<p>
								<strong>Actual:</strong> {f.actual}
							</p>
							<List items={f.reproduction} />
						</details>
					)}
					{f.reason && <Markdown>{f.reason}</Markdown>}
				</article>
			))}
		</div>
	) : (
		<p className="success">🎉 No findings</p>
	);
}
export function Structure({
	value,
	depth = 0,
}: {
	value: any;
	depth?: number;
}): any {
	const [limit, setLimit] = useState(40);
	if (value === null || value === undefined || value === "")
		return <span className="muted">—</span>;
	if (typeof value === "boolean")
		return <span>{value ? "✅ Yes" : "❌ No"}</span>;
	if (typeof value === "string")
		return /^https?:\/\/\S+$/.test(value) ? (
			<External href={value}>{value} ↗</External>
		) : (
			<Markdown>{value}</Markdown>
		);
	if (typeof value !== "object") return String(value);
	if (Array.isArray(value))
		return (
			<ul>
				{value.slice(0, limit).map((item, i) => (
					<li key={i}>
						{depth > 1 && typeof item === "object" ? (
							<details>
								<summary>Item {i + 1}</summary>
								<Structure value={item} depth={depth + 1} />
							</details>
						) : (
							<Structure value={item} depth={depth + 1} />
						)}
					</li>
				))}
				{value.length > limit && (
					<li>
						<Button variant="ghost" onClick={() => setLimit(limit + 40)}>
							Show 40 more ({value.length - limit} remaining)
						</Button>
					</li>
				)}
			</ul>
		);
	return (
		<dl className="structure">
			{Object.entries(value).map(([key, item]) => (
				<div key={key}>
					<dt>
						{key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ")}
					</dt>
					<dd>
						<Structure value={item} depth={depth + 1} />
					</dd>
				</div>
			))}
		</dl>
	);
}
function Discussion({ title, items }: { title: string; items: any[] }) {
	return (
		<details>
			<summary>
				{title} {items?.length ?? 0}
			</summary>
			{(Array.isArray(items) ? items : []).map((c: any, i: number) => (
				<article className="discussion" key={c.id ?? i}>
					<strong>
						{c.author?.name ?? c.author?.login ?? c.user?.login ?? "Comment"}
					</strong>
					{c.path && <code>{c.path}</code>}
					<Markdown>{c.body}</Markdown>
				</article>
			))}
		</details>
	);
}
function Diff({ value }: { value: string }) {
	const [all, setAll] = useState(false);
	const lines = value.split("\n");
	return (
		<>
			<pre className="diff">
				{lines.slice(0, all ? undefined : 400).map((line, i) => (
					<span
						key={i}
						className={
							line.startsWith("+++") || line.startsWith("---")
								? "diff-file"
								: line.startsWith("+")
									? "diff-add"
									: line.startsWith("-")
										? "diff-remove"
										: line.startsWith("@@")
											? "diff-hunk"
											: ""
						}
					>
						{line}
						{"\n"}
					</span>
				))}
			</pre>
			{lines.length > 400 && !all && (
				<Button variant="secondary" onClick={() => setAll(true)}>
					Show all {lines.length} lines
				</Button>
			)}
		</>
	);
}
function ScreenshotGallery({ shots, run, name, onImage }: any) {
	const box = useRef<HTMLElement>(null);
	const virtual = useVirtualizer({
		count: Math.ceil(shots.length / 2),
		getScrollElement: () => box.current,
		estimateSize: () => 240,
		overscan: 2,
	});
	return (
		<section
			ref={box}
			className="gallery-scroll"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: virtual gallery must support keyboard scrolling
			tabIndex={0}
			aria-label={`${shots.length} screenshots`}
		>
			<div style={{ height: virtual.getTotalSize(), position: "relative" }}>
				{virtual.getVirtualItems().map((row) => (
					<div
						className="gallery"
						key={row.key}
						data-index={row.index}
						ref={virtual.measureElement}
						style={{
							position: "absolute",
							top: 0,
							width: "100%",
							transform: `translateY(${row.start}px)`,
						}}
					>
						{shots
							.slice(row.index * 2, row.index * 2 + 2)
							.map((shot: any, column: number) => {
								const index = row.index * 2 + column;
								return (
									<button
										type="button"
										key={`${shot.path}/${index}`}
										onClick={() => onImage(index)}
									>
										<LazyImage
											src={screenshotUrl(run, index, name)}
											alt={shot.caption}
										/>
										<strong>{shot.caption}</strong>
										<small>{shot.area}</small>
									</button>
								);
							})}
					</div>
				))}
			</div>
		</section>
	);
}
export function RenderArtifact({
	name,
	v,
	run,
	onImage,
}: {
	v: any;
	name: string;
	run: any;
	onImage: (i: number) => void;
}) {
	switch (artifactType(v)) {
		case "qa":
			return (
				<>
					<h3>QA execution</h3>
					<p>{artifactSummary(v)}</p>
					{v.coverage && (
						<p>
							Coverage: {v.coverage.reportedCriteria}/
							{v.coverage.plannedCriteria} required criteria reported across{" "}
							{v.coverage.plannedStories} stories.
						</p>
					)}
					{!v.results?.length && (
						<p>
							{v.notApplicableReason ??
								"No executable stories selected; see the QA scope rationale."}
						</p>
					)}
					{(v.results ?? []).map((story: any) => (
						<article className="scope-card" key={story.storyId}>
							<strong>
								{story.goal ?? story.storyId} · {story.outcome}
							</strong>
							{(story.criteria ?? []).map((criterion: any) => (
								<section key={criterion.criterionId}>
									<h4>
										{criterion.criterionId} · {criterion.outcome}
									</h4>
									<p>
										<strong>Expected:</strong> {criterion.expected}
									</p>
									<p>
										<strong>Observed:</strong> {criterion.observed}
									</p>
									{criterion.blockedReason && (
										<p className="warning">{criterion.blockedReason}</p>
									)}
									<details>
										<summary>Executed checks and evidence</summary>
										<List items={criterion.evidence} />
									</details>
								</section>
							))}
						</article>
					))}
					<h3>Consequential findings</h3>
					{v.findings?.length ? (
						<Findings items={v.findings} />
					) : (
						<p>No reported consequential findings.</p>
					)}
					{v.observations?.length > 0 && (
						<>
							<h3>Optional improvements</h3>
							<List items={v.observations} />
						</>
					)}
					{v.unavailable?.length > 0 && (
						<>
							<h3>Capture assistance needed</h3>
							<List
								items={v.unavailable.map((x: any) => `${x.area}: ${x.reason}`)}
							/>
						</>
					)}
					{v.screenshots?.length > 0 && (
						<ScreenshotGallery
							shots={v.screenshots}
							run={run}
							name={name}
							onImage={onImage}
						/>
					)}
				</>
			);

		case "screenshots":
			return (
				<>
					<ScreenshotGallery
						shots={v.screenshots}
						run={run}
						name={name}
						onImage={onImage}
					/>
					{v.unavailable?.length > 0 && (
						<div className="warning">
							<strong>Not captured</strong>
							<List
								items={v.unavailable.map((x: any) => `${x.area}: ${x.reason}`)}
							/>
						</div>
					)}
				</>
			);
		case "guide":
			return <GuidedReview value={v} run={run} />;
		case "decisions":
			return (
				<>
					{v.questions?.length > 0 && (
						<div className="warning">
							<List items={v.questions} />
						</div>
					)}
					{v.decisions.map((d: any, i: number) => (
						<article className="decision-card" key={i}>
							<span className="number">{i + 1}</span>
							<div>
								<strong>{d.question}</strong>
								<div className="answer">
									<Markdown>{d.answer}</Markdown>
								</div>
								<small>Why: {d.reason}</small>
							</div>
						</article>
					))}
					<h3>Requirements</h3>
					<List items={v.requirements} />
				</>
			);
		case "assessment":
			return (
				<div className="assessment">
					{[
						["✅ Done", v.completed],
						["⏳ Remaining", v.remaining],
						["⚠️ Risks", v.risks],
					].map(([name, list]) => (
						<section key={String(name)}>
							<h3>
								{String(name)}{" "}
								<span className="count">{(list as any[])?.length ?? 0}</span>
							</h3>
							<List items={list as any[]} />
						</section>
					))}
				</div>
			);
		case "ticket":
			return (
				<>
					<div className="chips">
						<span className="chip">{v.identifier}</span>
						<span className="chip">{v.state?.name ?? v.state}</span>
						{(v.labels ?? []).map((l: any, i: number) => (
							<span className="chip" key={i}>
								{l.name ?? l}
							</span>
						))}
						<External href={v.url}>Open ticket ↗</External>
					</div>
					<h3>{v.title}</h3>
					<Markdown>{v.description}</Markdown>
					{(v.attachments ?? []).map((a: any, i: number) => (
						<External key={i} href={a.url}>
							{a.title ?? a.url}
						</External>
					))}
					<Discussion title="Comments" items={v.comments} />
				</>
			);
		case "source":
			return (
				<>
					<div className="chips">
						<span className="chip">#{v.number}</span>
						{v.isDraft && <span className="chip">Draft</span>}
						<span className="chip">{v.state}</span>
						<code>
							{v.headRefName} → {v.baseRefName}
						</code>
						<External href={v.url}>Open PR ↗</External>
					</div>
					<h3>{v.title}</h3>
					<Markdown>{v.body}</Markdown>
					<Discussion title="Comments" items={v.comments} />
					<Discussion title="Reviews" items={v.reviews} />
					<Discussion title="Inline comments" items={v.reviewComments} />
				</>
			);
		case "existing":
			return (
				<>
					<div className="chips">
						<span className="chip">{v.branch}</span>
						<External href={v.pr?.url ?? v.url}>Open PR ↗</External>
					</div>
					{(v.stats ?? v.diffSummary) && (
						<p className="chip">
							📊{" "}
							{typeof (v.stats ?? v.diffSummary) === "string"
								? (v.stats ?? v.diffSummary)
								: JSON.stringify(v.stats)}
						</p>
					)}
					<details>
						<summary>Changed files</summary>
						<Structure
							value={v.changedFiles ?? v.files ?? v.diffSummary ?? v.diffStat}
						/>
					</details>
					<details>
						<summary>Commits</summary>
						<Structure value={v.commits} />
					</details>
					<h3>Working tree</h3>
					<pre>
						{typeof v.status === "string"
							? v.status
							: JSON.stringify(v.status ?? v.workingTree, null, 2)}
					</pre>
					<h3>Diff</h3>
					<Diff value={String(v.diff ?? "")} />
				</>
			);
		case "ci":
			return (
				<>
					<p className={`chip ${v.approved ? "green" : "orange"}`}>
						{v.approved
							? `✅ All required checks passed at ${v.headSha?.slice(0, 8)}`
							: "⛔ Merge criteria not met yet"}
					</p>
					{v.blockers?.length > 0 && (
						<List items={v.blockers.map((b: any) => b.message)} />
					)}
					<ul className="check-list">
						{(v.checks ?? []).map((c: any, i: number) => (
							<li key={i}>
								<span>
									{["pass", "skipping"].includes(c.bucket)
										? "✓"
										: c.bucket === "fail"
											? "✕"
											: "…"}
								</span>
								<strong>{c.name}</strong>
								<External href={c.link}>Logs ↗</External>
							</li>
						))}
					</ul>
				</>
			);
		case "review":
			return (
				<>
					<Markdown>{v.summary}</Markdown>
					<Findings items={v.findings} />
				</>
			);
		case "gate":
			return (
				<>
					<p
						className={`chip ${v.qaBlocked || v.captureBlocked ? "orange" : v.approved ? "green" : "red"}`}
					>
						{v.qaBlocked
							? "⏸ QA assistance needed"
							: v.captureBlocked
								? "⏸ Capture assistance needed"
								: v.approved
									? "✅ Approved"
									: "⛔ Changes needed"}
					</p>
					{(v.qaBlocked || v.captureBlocked) && <List items={v.questions} />}
					{v.observations?.length > 0 && (
						<>
							<h3>Optional improvements</h3>
							<List items={v.observations} />
						</>
					)}
					<List items={v.feedback} />
					{v.findings && (!v.captureBlocked || v.findings.length > 0) && (
						<Findings items={v.findings} />
					)}
				</>
			);
		case "scope":
			if (v.qaContract)
				return (
					<>
						<h3>QA stories</h3>
						<List items={v.stories} />
						<h3>Screenshot plan</h3>
						<List items={v.areas} />
						<h3>Coverage exclusions</h3>
						<List items={v.exclusions} />
						{v.notApplicableReason && (
							<Markdown>{v.notApplicableReason}</Markdown>
						)}
					</>
				);
			return v.changed === false ? (
				<p>No visual changes</p>
			) : (
				<div>
					{(v.areas ?? []).map((a: any, i: number) => (
						<article className="scope-card" key={i}>
							<strong>{a.name}</strong>
							<code>{a.url}</code>
							<div className="chips">
								{a.states?.map((s: string) => (
									<span className="chip" key={s}>
										{s}
									</span>
								))}
							</div>
							<Markdown>{a.instructions}</Markdown>
						</article>
					))}
				</div>
			);
		case "document":
			return <Markdown>{typeof v === "string" ? v : v.plan}</Markdown>;
		case "pr":
			return (
				<section>
					<External href={v.url}>{v.url} ↗</External>
					<p>
						<code>{v.branch}</code> · <code>{v.headSha?.slice(0, 8)}</code>
					</p>
				</section>
			);
		case "report":
			return (
				<>
					<Markdown>{v.summary}</Markdown>
					{v.checks && (
						<>
							<h3>Verification</h3>
							<List
								items={v.checks.map((c: any) =>
									typeof c === "string" ? `✓ ${c}` : c,
								)}
							/>
						</>
					)}
					{v.dispositions && <Structure value={v.dispositions} />}
				</>
			);
		default:
			return <Structure value={v} />;
	}
}
export function Inspector({
	run,
	selected,
	onClose,
	onChange,
}: {
	run: any;
	selected: { name: string; image?: number } | undefined;
	onClose: () => void;
	onChange: (name: string, image?: number) => void;
}) {
	const toast = useToast(),
		cache = useQueryClient(),
		artifacts = useMemo(
			() => artifactsOf({ outputs: run.outputs }),
			[run.outputs],
		),
		index = artifacts.findIndex((a) => a.name === selected?.name),
		artifact = artifacts[index];
	const [raw, setRaw] = useState(false);
	const full = useQuery({
		queryKey: [
			"artifact",
			run.id,
			selected?.name,
			artifact?.value?.__artifactHash,
		],
		enabled: Boolean(selected && artifact?.value?.__artifactPreview),
		queryFn: ({ signal }) =>
			api(
				`/api/runs/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(selected!.name)}?v=${encodeURIComponent(artifact?.value?.__artifactHash ?? "")}`,
				{ signal },
			),
		staleTime: 60000,
		gcTime: 300000,
	});
	const v = full.data ?? artifact?.value;
	useEffect(() => {
		if (!selected) return;
		// Do not prefetch large documents on mobile/data-saving connections.
		const connection = (navigator as any).connection;
		if (
			connection?.saveData ||
			/(^|-)2g$/.test(connection?.effectiveType ?? "")
		)
			return;
		for (const adjacent of [artifacts[index - 1], artifacts[index + 1]]) {
			if (adjacent?.value?.__artifactPreview && adjacent.value.size < 512000)
				void cache.prefetchQuery({
					queryKey: [
						"artifact",
						run.id,
						adjacent.name,
						adjacent.value.__artifactHash,
					],
					queryFn: ({ signal }) =>
						api(
							`/api/runs/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(adjacent.name)}?v=${encodeURIComponent(adjacent.value.__artifactHash ?? "")}`,
							{ signal },
						),
					staleTime: 60000,
					gcTime: 300000,
				});
		}
		if (selected.image !== undefined) {
			const next = selected.image + 1;
			if (v?.screenshots?.[next]) {
				const image = new Image();
				image.src = screenshotUrl(run, next, selected.name);
			}
		}
	}, [selected, index, run, artifacts, cache, v?.screenshots]);

	useEffect(() => {
		if (selected?.name) setRaw(false);
	}, [selected?.name]);
	const move = (delta: number) => {
		if (!selected) return;
		if (selected.image !== undefined) {
			const length = v?.screenshots?.length ?? 0;
			if (length)
				onChange(selected.name, (selected.image + delta + length) % length);
		} else if (artifacts.length)
			onChange(
				artifacts[(index + delta + artifacts.length) % artifacts.length]!.name,
			);
	};
	const shot = v?.screenshots?.[selected?.image ?? -1];
	return (
		<Modal
			open={Boolean(selected)}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			title={
				<>
					<span className="artifact-icon">{typeIcons[artifactType(v)]}</span>
					{artifact?.title ?? friendly[selected?.name ?? ""] ?? "Artifact"}
				</>
			}
			description={`from ${artifact?.name ?? "step"} · ${run.title}`}
			className="inspector"
			onKeyDown={(event: any) => {
				if (event.target.closest("input,textarea,select")) return;
				if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
					event.preventDefault();
					move(event.key === "ArrowLeft" ? -1 : 1);
				}
				if (event.key === "Escape" && selected?.image !== undefined) {
					event.preventDefault();
					event.stopPropagation();
					onChange(selected.name);
				}
			}}
		>
			<div className="inspector-toolbar">
				{artifactType(v) === "guide" && (
					<Link
						className="button secondary"
						to={`/runs/${run.id}/review`}
						state={{ focusRunId: run.id }}
						onClick={onClose}
					>
						Open review guide →
					</Link>
				)}
				<div className="toggle">
					<button
						type="button"
						aria-pressed={!raw}
						onClick={() => setRaw(false)}
					>
						Rendered
					</button>
					<button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>
						Raw JSON
					</button>
				</div>
				<Button
					variant="ghost"
					onClick={() =>
						void navigator.clipboard
							.writeText(JSON.stringify(v, null, 2))
							.then(() => toast({ text: "Copied JSON" }))
							.catch(() => toast({ text: "Could not copy JSON" }))
					}
				>
					Copy JSON
				</Button>
				<div className="artifact-nav">
					<Button
						variant="icon"
						aria-label="Previous artifact"
						onClick={() => move(-1)}
					>
						‹
					</Button>
					<strong>
						{index + 1} of {artifacts.length}
					</strong>
					<Button
						variant="icon"
						aria-label="Next artifact"
						onClick={() => move(1)}
					>
						›
					</Button>
				</div>
			</div>
			<div
				className="inspector-body"
				key={`${selected?.name}/${selected?.image ?? "all"}/${raw}`}
			>
				{full.isLoading ? (
					<p role="status">
						Loading {Math.ceil((artifact?.value as any)?.size / 1024)} KB…
					</p>
				) : full.error ? (
					<p role="alert">{full.error.message}</p>
				) : raw ? (
					<pre>{JSON.stringify(v, null, 2)}</pre>
				) : shot ? (
					<div className="lightbox">
						<LazyImage
							src={screenshotUrl(run, selected!.image!, selected!.name)}
							alt={shot.caption}
						/>
						<h3>{shot.caption}</h3>
						<p className="muted">
							{shot.area} · {shot.state}
						</p>
						<div className="actions">
							<Button variant="secondary" onClick={() => move(-1)}>
								‹ Prev
							</Button>
							<span>
								{selected!.image! + 1} of {v.screenshots.length}
							</span>
							<Button variant="secondary" onClick={() => move(1)}>
								Next ›
							</Button>
							<Button variant="ghost" onClick={() => onChange(selected!.name)}>
								All screenshots
							</Button>
							<External
								href={`${location.origin}${screenshotUrl(run, selected!.image!, selected!.name)}`}
							>
								Open original ↗
							</External>
						</div>
					</div>
				) : (
					<ArtifactBoundary key={selected!.name} value={v}>
						<RenderArtifact
							name={selected!.name}
							v={v}
							run={run}
							onImage={(i) => onChange(selected!.name, i)}
						/>
					</ArtifactBoundary>
				)}
			</div>
		</Modal>
	);
}

class ArtifactBoundary extends Component<
	{ value: unknown; children: ReactNode },
	{ fallback: boolean }
> {
	state = { fallback: false };
	static getDerivedStateFromError() {
		return { fallback: true };
	}
	render() {
		return this.state.fallback ? (
			<Structure value={this.props.value} />
		) : (
			this.props.children
		);
	}
}
