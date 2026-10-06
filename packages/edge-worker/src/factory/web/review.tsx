import { useQuery } from "@tanstack/react-query";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Guide } from "../FactoryResults";
import { api, client } from "./client";
import { useReadingPosition } from "./reading-position";
import { ChangedFiles, FileLink, useReviewFiles } from "./review-files";
import {
	chapterColor,
	chaptersFor,
	isTestFile,
	pageTokens,
	resolvePage,
} from "./review-model";
import {
	readProgress,
	readStored,
	reviewKey,
	signature,
	writeStored,
} from "./review-state";
import { ChapterVisual, Screens, SystemMap } from "./review-visuals";
import { Button, Markdown } from "./ui";

export function Lines({ items }: { items: string[] }) {
	return (
		<ul className="guide-lines">
			{items.map((item, i) => (
				<li key={i}>
					<Markdown>{item}</Markdown>
				</li>
			))}
		</ul>
	);
}
/** Mount only the current chapter; keep progress scoped to this exact guide and revision. */
export function GuidedReview({
	value,
	run,
	documentPage = false,
	controls,
}: {
	value: any;
	run: any;
	documentPage?: boolean;
	controls?: (identity: string, decisionPage: boolean) => ReactNode;
}) {
	const previousIdentity = useRef<string>(undefined);
	const version = value?.__artifactHash ?? signature(value),
		full = useQuery({
			queryKey: ["guide", run.id, version],
			enabled: Boolean(value?.__artifactPreview),
			queryFn: async ({ signal }) => {
				const guide = await api(`/api/runs/${run.id}/artifacts/guide`, {
					signal,
				});
				// An artifact endpoint returns the latest value. Refuse to label a
				// replacement guide with the revision from an older dashboard response.
				const bytes = await crypto.subtle.digest(
					"SHA-256",
					new TextEncoder().encode(JSON.stringify(guide)),
				);
				const hash = [...new Uint8Array(bytes)]
					.map((n) => n.toString(16).padStart(2, "0"))
					.join("");
				if (hash !== version) {
					void client.invalidateQueries({ queryKey: ["run", run.id] });
					throw new Error(
						"The guide changed while loading. Loading the current review again.",
					);
				}
				return guide;
			},
			staleTime: Infinity,
		}),
		guide = value?.__artifactPreview ? full.data : value,
		key = guide ? reviewKey(run, guide) : "";
	const revisionChanged = Boolean(
		previousIdentity.current && key && previousIdentity.current !== key,
	);
	useEffect(() => {
		if (key) previousIdentity.current = key;
	}, [key]);
	if (!guide)
		return (
			<div role={full.error ? "alert" : "status"}>
				{full.error
					? `Could not load review guide: ${full.error.message}`
					: "Loading review guide…"}
				{full.error && (
					<Button variant="secondary" onClick={() => void full.refetch()}>
						Try again
					</Button>
				)}
			</div>
		);
	return (
		<ReviewReader
			key={key}
			storageKey={key}
			revisionChanged={revisionChanged}
			guide={guide}
			run={run}
			documentPage={documentPage}
			controls={controls}
		/>
	);
}
function ReviewReader({
	storageKey,
	guide,
	run,
	documentPage,
	controls,
	revisionChanged,
}: {
	storageKey: string;
	guide: Guide;
	run: any;
	documentPage: boolean;
	controls?: (identity: string, decisionPage: boolean) => ReactNode;
	revisionChanged: boolean;
}) {
	const chapters = useMemo(() => chaptersFor(guide), [guide]),
		tokens = useMemo(() => pageTokens(chapters), [chapters]),
		titles = [
			"Overview",
			...chapters.map((c) => c.title),
			"Changed files",
			"Decide",
		],
		location = useLocation(),
		navigate = useNavigate(),
		revision = signature(storageKey),
		params = new URLSearchParams(location.search);
	const [progress, setProgress] = useState(() => {
			const saved = readProgress(readStored(storageKey, null), tokens.length),
				stale = params.has("rev") && params.get("rev") !== revision;
			return {
				...saved,
				page:
					revisionChanged || stale
						? 0
						: resolvePage(params.get("page"), tokens, saved.page),
			};
		}),
		[highlight, setHighlight] = useState<number | null>(null),
		heading = useRef<HTMLHeadingElement>(null),
		explicit = useRef(false),
		lastLocation = useRef(location.key),
		initialReset = useRef(revisionChanged),
		page = progress.page,
		chapter =
			page > 0 && page <= chapters.length ? chapters[page - 1] : undefined,
		files = page === chapters.length + 1,
		final = page === tokens.length - 1;
	const evidence = useQuery({
			queryKey: [
				"guide-evidence",
				run.id,
				run.outputs.capture?.__artifactHash ??
					signature(run.outputs.capture ?? {}),
			],
			queryFn: ({ signal }) => api(`/api/runs/${run.id}/evidence`, { signal }),
			staleTime: Infinity,
		}),
		inventory = evidence.data?.screenshots ?? [],
		fileQuery = useReviewFiles(run, guide),
		url = run.reviewGate?.url ?? run.outputs["draft-pr"]?.url;
	useReadingPosition(
		documentPage ? `${storageKey}/position/${page}` : undefined,
		!explicit.current,
	);
	useEffect(() => {
		writeStored(storageKey, progress);
	}, [progress, storageKey]);
	const focusPage = useCallback(
		() =>
			requestAnimationFrame(() => {
				heading.current?.focus({ preventScroll: true });
				heading.current?.scrollIntoView({
					block: "start",
					behavior: "instant",
				});
			}),
		[],
	);
	const go = useCallback(
		(next: number, forward = false) => {
			const target = Math.max(0, Math.min(tokens.length - 1, next));
			if (target === page) return;
			explicit.current = true;
			setProgress((p) => ({
				...p,
				page: target,
				visited: {
					...p.visited,
					[tokens[page]!]: true,
					[tokens[target]!]: true,
				},
				reviewed:
					forward && chapter
						? { ...p.reviewed, [chapter.id]: true }
						: p.reviewed,
			}));
			const search = new URLSearchParams(location.search);
			search.set("page", tokens[target]!);
			search.set("rev", revision);
			navigate(
				{ pathname: location.pathname, search: `?${search}` },
				{ preventScrollReset: true },
			);
			focusPage();
		},
		[
			page,
			tokens,
			chapter,
			location.search,
			location.pathname,
			navigate,
			revision,
			focusPage,
		],
	);
	useEffect(() => {
		const search = new URLSearchParams(location.search),
			stale = search.has("rev") && search.get("rev") !== revision;
		const locationChanged = lastLocation.current !== location.key;
		lastLocation.current = location.key;
		if (initialReset.current || stale) {
			initialReset.current = false;
			search.set("page", "overview");
			search.set("rev", revision);
			navigate(
				{ pathname: location.pathname, search: `?${search}` },
				{ replace: true, preventScrollReset: true },
			);
			return;
		}
		if (search.has("page") || locationChanged) {
			const next = resolvePage(search.get("page"), tokens, 0);
			setProgress((p) =>
				p.page === next
					? p
					: {
							...p,
							page: next,
							visited: { ...p.visited, [tokens[next]!]: true },
						},
			);
			if (next !== page) focusPage();
		}
	}, [
		location.key,
		location.search,
		location.pathname,
		revision,
		navigate,
		tokens,
		page,
		focusPage,
	]);
	useEffect(() => {
		const key = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement;
			if (
				event.defaultPrevented ||
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				event.shiftKey ||
				target.closest(
					"input,textarea,select,[contenteditable]:not([contenteditable='false'])",
				) ||
				document.querySelector('[role="dialog"],[role="menu"]')
			)
				return;
			const direction = ["ArrowUp", "k"].includes(event.key)
				? -1
				: ["ArrowDown", "j"].includes(event.key)
					? 1
					: 0;
			if (direction) {
				event.preventDefault();
				go(page + direction, direction > 0);
			}
		};
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, [page, go]);
	const disclosure = (id: string) => ({
		open: progress.disclosures?.[`${page}/${id}`] ?? false,
		onToggle: (event: React.SyntheticEvent<HTMLDetailsElement>) => {
			const open = event.currentTarget.open;
			setProgress((p) =>
				p.disclosures?.[`${page}/${id}`] === open
					? p
					: {
							...p,
							disclosures: { ...p.disclosures, [`${page}/${id}`]: open },
						},
			);
		},
	});
	const care = chapters.filter((c) => c.risk && c.risk.level !== "low").length,
		shots = chapters.flatMap((c) => c.screenshots),
		kind = chapter
			? chapter.screenshots.length
				? chapter.flow ||
					chapter.diagrams.length ||
					chapter.systemPartIds?.length
					? "VISUAL + LOGIC"
					: "VISUAL"
				: chapter.flow ||
						chapter.diagrams.length ||
						chapter.systemPartIds?.length
					? "LOGIC"
					: "SUPPORTING"
			: "";
	return (
		<article
			className={`guided-review ${page === 0 ? "overview-reader" : "chapter-reader"}`}
			style={
				{
					"--chapter": chapter ? chapterColor(page - 1) : "var(--muted)",
				} as React.CSSProperties
			}
		>
			<nav
				className={`guide-segments ${tokens.length > 8 ? "many-pages" : ""}`}
				aria-label="Review pages"
			>
				{tokens.map((token, i) => (
					<button
						type="button"
						key={token}
						aria-label={`${titles[i]}${progress.reviewed[chapters[i - 1]?.id ?? ""] ? ", reviewed" : ""}`}
						aria-current={page === i ? "step" : undefined}
						onClick={() => go(i)}
						className={`${page === i ? "current" : ""} ${progress.visited?.[token] || progress.reviewed[chapters[i - 1]?.id ?? ""] ? "visited" : ""}`}
						style={
							{
								"--segment":
									i > 0 && i <= chapters.length
										? chapterColor(i - 1)
										: "var(--muted)",
							} as React.CSSProperties
						}
					/>
				))}
			</nav>
			<label className="guide-jump">
				Review page
				<select
					aria-label="Review page"
					value={page}
					onChange={(e) => go(Number(e.target.value))}
				>
					{titles.map((title, i) => (
						<option key={i} value={i}>
							{title}
						</option>
					))}
				</select>
			</label>
			<section className="guide-page" key={page}>
				<small className="guide-eyebrow">
					{page === 0
						? "OVERVIEW"
						: files
							? "CHANGED FILES"
							: final
								? "LAST STEP · DECIDE"
								: `STEP ${page} OF ${chapters.length} · ${kind}`}
				</small>
				<h2 ref={heading} tabIndex={-1}>
					{page === 0
						? (guide.tldr ?? guide.goal)
						: files
							? "What each step touched"
							: final
								? "Ready to decide?"
								: chapter!.title}
				</h2>
				{page === 0 ? (
					<>
						<div className="guide-facts">
							<span className="chip">{chapters.length} steps</span>
							<span className="chip">
								{fileQuery.data
									? `${fileQuery.data.manifest.files.length} files`
									: fileQuery.isPending
										? "Files loading…"
										: "File count unavailable"}
							</span>
							{shots.length > 0 && (
								<span className="chip">
									{new Set(shots.map((s) => `${s.area}/${s.state}`)).size}{" "}
									screens
								</span>
							)}
							{chapters.some((c) => c.risk) && (
								<span className={`chip ${care ? "amber" : "green"}`}>
									{care} need care
								</span>
							)}
						</div>
						{guide.system ? (
							<div
								style={
									{
										"--chapter":
											highlight === null
												? "var(--muted)"
												: chapterColor(highlight),
									} as React.CSSProperties
								}
							>
								<SystemMap
									system={guide.system}
									highlighted={
										highlight === null ? [] : chapters[highlight]?.systemPartIds
									}
								/>
							</div>
						) : shots.length > 0 ? (
							<Screens
								strip
								refs={shots}
								inventory={inventory}
								runId={run.id}
								loading={evidence.isPending}
								error={Boolean(evidence.error)}
							/>
						) : null}
						<h3>Your route</h3>
						<ol className="guide-route">
							{chapters.map((c, i) => (
								<li
									key={c.id}
									style={
										{ "--chapter": chapterColor(i) } as React.CSSProperties
									}
								>
									<button
										type="button"
										onClick={() => go(i + 1)}
										onMouseEnter={() => setHighlight(i)}
										onMouseLeave={() => setHighlight(null)}
										onFocus={() => setHighlight(i)}
										onBlur={() => setHighlight(null)}
									>
										<span className="step-badge">
											{progress.reviewed[c.id] ? "✓" : i + 1}
										</span>
										<span>
											<strong>{c.title}</strong>
											{c.tldr && <small>{c.tldr}</small>}
										</span>
										{c.risk && (
											<span className={`risk-label ${c.risk.level}`}>
												{c.risk.level} risk
											</span>
										)}
									</button>
								</li>
							))}
						</ol>
						<details {...disclosure("overview")}>
							<summary>Full overview</summary>
							<Markdown>{guide.summary}</Markdown>
						</details>
						{guide.revisionSummary && (
							<p className="notice">
								{guide.revisionNote ??
									"Updated since your previous human review."}
							</p>
						)}
					</>
				) : files ? (
					<>
						<p className="guide-lead">
							Every changed file, grouped by step. Look for files that don’t fit
							their step.
						</p>
						<ChangedFiles
							query={fileQuery}
							chapters={chapters}
							run={run}
							onChapter={(i) => go(i)}
						/>
					</>
				) : final ? (
					<>
						<Markdown>
							{guide.decision.summaryShort ?? guide.decision.summary}
						</Markdown>
						<ol className="guide-route decision-route">
							{chapters.map((c, i) => (
								<li
									key={c.id}
									style={
										{ "--chapter": chapterColor(i) } as React.CSSProperties
									}
								>
									<button type="button" onClick={() => go(i + 1)}>
										<span className="step-badge">{i + 1}</span>
										<span>
											<strong>{c.title}</strong>
											{c.risk && (
												<small>
													{c.risk.level} risk · {c.risk.text}
												</small>
											)}
										</span>
										<span
											role="img"
											aria-label={
												progress.reviewed[c.id]
													? "Reviewed"
													: "Not yet reviewed"
											}
										>
											{progress.reviewed[c.id] ? "✓" : "—"}
										</span>
									</button>
								</li>
							))}
						</ol>
						{guide.risks.length > 0 && (
							<details {...disclosure("risks")}>
								<summary>Overall risks ({guide.risks.length})</summary>
								<Lines items={guide.risks} />
							</details>
						)}
						<details {...disclosure("criteria")}>
							<summary>
								Acceptance criteria ·{" "}
								{
									guide.requirements.filter((r) => r.status === "supported")
										.length
								}{" "}
								/ {guide.requirements.length} supported
							</summary>
							{guide.requirements.map((r, i) => (
								<section key={i}>
									<strong>
										{r.status === "supported" ? "✓" : "⚠"} {r.criterion}
									</strong>
									<Lines items={r.evidence} />
								</section>
							))}
						</details>
						<details {...disclosure("verification")}>
							<summary>Verification evidence ({guide.checks.length})</summary>
							<Lines items={guide.checks} />
						</details>
						<details {...disclosure("instructions")}>
							<summary>Final review instructions</summary>
							<Lines items={guide.reviewInstructions} />
						</details>
						<p className="muted">
							Review markers record reading progress. Approval is a separate
							action.
						</p>
					</>
				) : chapter ? (
					<>
						{chapter.tldr && <p className="guide-lead">{chapter.tldr}</p>}
						{(chapter.beforeShort || chapter.afterShort) && (
							<div className="compact-comparison">
								<section>
									<small>BEFORE</small>
									<p>
										<s>{chapter.beforeShort}</s>
									</p>
								</section>
								<span aria-hidden="true" className="comparison-arrow">
									→
								</span>
								<section>
									<small>AFTER</small>
									<p>{chapter.afterShort}</p>
								</section>
							</div>
						)}
						<ChapterVisual
							chapter={chapter}
							system={guide.system}
							inventory={inventory}
							runId={run.id}
							loading={evidence.isPending}
							error={Boolean(evidence.error)}
						/>
						{chapter.risk && (
							<p className={`compact-risk ${chapter.risk.level}`}>
								<strong>{chapter.risk.level.toUpperCase()} RISK</strong> ·{" "}
								{chapter.risk.text}
							</p>
						)}
						{chapter.keyChecks?.map((check, i) => {
							const id = `${chapter.id}/${i}`,
								checked = progress.checked?.[id] ?? false;
							return (
								<label
									key={id}
									className={`guide-check ${checked ? "checked" : ""}`}
								>
									<input
										type="checkbox"
										checked={checked}
										onChange={(e) => {
											const checked = e.target.checked;
											setProgress((p) => ({
												...p,
												checked: { ...p.checked, [id]: checked },
											}));
										}}
									/>
									<span>
										<small>CHECK</small>
										<strong>{check.do}</strong>{" "}
										<span className="muted">→ {check.expect}</span>
									</span>
								</label>
							);
						})}
						<label className="guide-reviewed">
							<input
								type="checkbox"
								checked={progress.reviewed[chapter.id] ?? false}
								onChange={(e) => {
									const checked = e.target.checked;
									setProgress((p) => ({
										...p,
										reviewed: { ...p.reviewed, [chapter.id]: checked },
									}));
								}}
							/>{" "}
							I’ve reviewed this change
						</label>
						<details {...disclosure("detail")}>
							<summary>
								More detail · Full text, evidence & {chapter.files.length} files
							</summary>
							<Markdown>{chapter.summary}</Markdown>
							<h3>Before</h3>
							<Markdown>{chapter.before}</Markdown>
							<h3>After</h3>
							<Markdown>{chapter.after}</Markdown>
							{chapter.reviewChecks.length > 0 && (
								<>
									<h3>Review checks</h3>
									<Lines items={chapter.reviewChecks} />
								</>
							)}
							{chapter.risks.length > 0 && (
								<>
									<h3>Risks</h3>
									<Lines items={chapter.risks} />
								</>
							)}
							{chapter.diagrams.map((d, i) => (
								<section key={i}>
									<h3>{d.title}</h3>
									<ol>
										{d.steps.map((step, j) => (
											<li key={j}>
												<strong>{step.label}</strong>
												<p>{step.detail}</p>
											</li>
										))}
									</ol>
								</section>
							))}
							<ul className="guide-files">
								{chapter.files.map((file) => (
									<li key={file}>
										<span className="muted">
											{isTestFile(file) ? "TEST" : "SOURCE"} ·{" "}
										</span>
										<FileLink path={file} url={url} />
									</li>
								))}
							</ul>
							<Lines items={chapter.evidence} />
							{chapter.requirementIndexes.map((i) => (
								<section key={i}>
									<strong>{guide.requirements[i]?.criterion}</strong>
									<Lines items={guide.requirements[i]?.evidence ?? []} />
								</section>
							))}
						</details>
					</>
				) : null}
			</section>
			{controls?.(storageKey, final)}
			<footer className="guide-navigation">
				<Button
					variant="secondary"
					disabled={page === 0}
					onClick={() => go(page - 1)}
				>
					← Back
				</Button>
				<span>
					{page === 0
						? "Overview"
						: files
							? "Files"
							: final
								? "Decide"
								: `${page} / ${chapters.length}`}
				</span>
				{!final && (
					<Button onClick={() => go(page + 1, true)}>
						{page === 0
							? "Start →"
							: files
								? "Decide →"
								: page === chapters.length
									? "Files →"
									: "Next →"}
					</Button>
				)}
			</footer>
		</article>
	);
}
