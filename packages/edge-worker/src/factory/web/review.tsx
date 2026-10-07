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
import { revisionOf, useRestorableState } from "./restoration";
import {
	CollectedFeedback,
	Commentable,
	FeedbackContext,
	useFeedbackController,
	useReviewFeedback,
} from "./review-comments";
import { type FeedbackTarget, feedbackKey } from "./review-feedback";
import { ChangedFiles, FileLink, useReviewFiles } from "./review-files";
import { useReviewInput } from "./review-input";
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

export type Annotate = (
	path: string,
	label: string,
	kind: string,
	context: string,
	order: number[],
	children: ReactNode,
) => ReactNode;
export function Lines({
	items,
	path,
	order = [],
	annotate,
}: {
	items: string[];
	path?: string;
	order?: number[];
	annotate?: Annotate;
}) {
	return (
		<ul className="guide-lines">
			{items.map((item, i) => (
				<li key={i}>
					{annotate && path ? (
						annotate(
							`${path}/${i}`,
							item,
							"Text item",
							item,
							[...order, i],
							<Markdown>{item}</Markdown>,
						)
					) : (
						<Markdown>{item}</Markdown>
					)}
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
		<ReviewSession
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
function ReviewSession(props: React.ComponentProps<typeof ReviewReader>) {
	const controller = useFeedbackController(
		feedbackKey(props.storageKey, props.run.reviewGate?.id),
		revisionOf([
			feedbackKey(props.storageKey, props.run.reviewGate?.id),
			props.run.reviewGate,
			props.run.status,
			props.run.chat?.mode,
		]),
	);
	return (
		<FeedbackContext.Provider value={props.controls ? controller : null}>
			<ReviewReader {...props} />
		</FeedbackContext.Provider>
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
	useReviewInput();
	const feedback = useReviewFeedback();
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
	const [progress, setProgress] = useRestorableState<
			ReturnType<typeof readProgress>
		>(`review/progress/${storageKey}`, () => {
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
		segments = useRef<HTMLElement>(null),
		explicit = useRef(false),
		lastLocation = useRef(location.key),
		initialReset = useRef(revisionChanged),
		page = progress.page,
		chapter =
			page > 0 && page <= chapters.length ? chapters[page - 1] : undefined,
		files = page === chapters.length + 1,
		final = page === tokens.length - 1;
	useEffect(() => {
		const bar = segments.current,
			current = bar?.children[page] as HTMLElement | undefined;
		if (!bar || !current) return;
		if (current.offsetLeft < bar.scrollLeft)
			bar.scrollLeft = current.offsetLeft;
		else if (
			current.offsetLeft + current.offsetWidth >
			bar.scrollLeft + bar.clientWidth
		)
			bar.scrollLeft =
				current.offsetLeft + current.offsetWidth - bar.clientWidth;
	}, [page]);
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
				// URL navigation can settle after a collected comment has opened its editor.
				const editor = document.querySelector<HTMLTextAreaElement>(
					".comment-popover:popover-open textarea",
				);
				if (editor) {
					editor.focus({ preventScroll: true });
					return;
				}
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
			setProgress,
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
		setProgress,
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
	const base = guide.chapters?.length
		? `/chapters/${page - 1}`
		: `/behavior/${page - 1}`;
	const annotate: Annotate = (path, label, kind, context, order, children) => (
		<Commentable
			target={{
				path,
				label,
				kind,
				context,
				order: [page, ...order],
				page,
				pageTitle: `${titles[page]}${chapter?.id ? ` (${chapter.id})` : ""}`,
			}}
		>
			{children}
		</Commentable>
	);
	const lines = (items: string[], path: string, order: number[]) => (
		<Lines items={items} path={path} order={order} annotate={annotate} />
	);
	const goToItem = (target: FeedbackTarget) => {
		if (
			!Number.isInteger(target.page) ||
			target.page < 0 ||
			target.page >= tokens.length
		)
			return;
		feedback?.update((d) => ({ ...d, editing: target.path }));
		go(target.page);
		setProgress((p) => ({
			...p,
			disclosures: {
				...p.disclosures,
				[`${target.page}/detail`]: true,
				[`${target.page}/overview`]: true,
				[`${target.page}/risks`]: true,
				[`${target.page}/instructions`]: true,
				[`${target.page}/criteria`]: true,
				[`${target.page}/verification`]: true,
			},
		}));
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				const item = document.querySelector<HTMLElement>(
					`[data-comment-path="${CSS.escape(target.path)}"]`,
				);
				item?.scrollIntoView({ block: "center" });
				document
					.querySelector<HTMLTextAreaElement>(".comment-popover textarea")
					?.focus({ preventScroll: true });
			}),
		);
	};
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
				ref={segments}
				className={`guide-segments ${tokens.length > 14 ? "many-pages" : ""}`}
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
			<label className={`guide-jump ${tokens.length > 14 ? "many-pages" : ""}`}>
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
				{annotate(
					page === 0
						? guide.tldr
							? "/tldr"
							: "/goal"
						: files
							? "/reviewFiles/title"
							: final
								? "/decision/title"
								: `${base}/${guide.chapters?.length ? "title" : "scenario"}`,
					titles[page]!,
					"Heading",
					titles[page]!,
					[0],
					<h2 ref={heading} tabIndex={-1}>
						{page === 0
							? (guide.tldr ?? guide.goal)
							: files
								? "What each step touched"
								: final
									? "Ready to decide?"
									: chapter!.title}
					</h2>,
				)}
				{page === 0 ? (
					<>
						<div className="guide-facts">
							<span className="chip">
								{chapters.length} {chapters.length === 1 ? "step" : "steps"}
							</span>
							<span className="chip">
								{fileQuery.data
									? `${fileQuery.data.manifest.files.length} ${fileQuery.data.manifest.files.length === 1 ? "file" : "files"}`
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
								onSelect={(i) =>
									go(
										chapters.findIndex((c) =>
											c.screenshots.includes(shots[i]!),
										) + 1,
									)
								}
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
									{annotate(
										`${guide.chapters?.length ? "/chapters" : "/behavior"}/${i}/outline`,
										c.title,
										"Chapter outline",
										c.title,
										[2, i],
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
										</button>,
									)}
								</li>
							))}
						</ol>
						<details {...disclosure("overview")}>
							<summary>Full overview</summary>
							{annotate(
								"/summary",
								guide.summary,
								"Text block",
								guide.summary,
								[1],
								<Markdown>{guide.summary}</Markdown>,
							)}
						</details>
						{(guide.revisionSummary || guide.revisionNote) && (
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
							reviewed={progress.reviewed}
						/>
					</>
				) : final ? (
					<>
						{annotate(
							guide.decision.summaryShort
								? "/decision/summaryShort"
								: "/decision/summary",
							guide.decision.summaryShort ?? guide.decision.summary,
							"Text block",
							guide.decision.summaryShort ?? guide.decision.summary,
							[1],
							<Markdown>
								{guide.decision.summaryShort ?? guide.decision.summary}
							</Markdown>,
						)}
						<ol className="guide-route decision-route">
							{chapters.map((c, i) => (
								<li
									key={c.id}
									style={
										{ "--chapter": chapterColor(i) } as React.CSSProperties
									}
								>
									<button type="button" onClick={() => go(i + 1)}>
										<span className="step-badge">
											{progress.reviewed[c.id] ? "✓" : i + 1}
										</span>
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
								{lines(guide.risks, "/risks", [2])}
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
									{annotate(
										`/requirements/${i}/criterion`,
										r.criterion,
										"Acceptance criterion",
										r.criterion,
										[4, i, 0],
										<strong>
											{r.status === "supported" ? "✓" : "⚠"} {r.criterion}
										</strong>,
									)}
									{lines(r.evidence, `/requirements/${i}/evidence`, [4, i, 1])}
								</section>
							))}
						</details>
						<details {...disclosure("verification")}>
							<summary>Verification evidence ({guide.checks.length})</summary>
							{lines(guide.checks, "/checks", [3])}
						</details>
						<details {...disclosure("instructions")}>
							<summary>Final review instructions</summary>
							{lines(guide.reviewInstructions, "/reviewInstructions", [5])}
						</details>
						<p className="muted">
							Review markers record reading progress. Approval is a separate
							action.
						</p>
					</>
				) : chapter ? (
					<>
						{chapter.tldr &&
							annotate(
								`${base}/tldr`,
								"Change summary",
								"Text block",
								chapter.tldr,
								[1],
								<p className="guide-lead">{chapter.tldr}</p>,
							)}
						{(chapter.beforeShort || chapter.afterShort) && (
							<div className="compact-comparison">
								<section>
									<small>BEFORE</small>
									{annotate(
										`${base}/beforeShort`,
										"Before",
										"Text block",
										chapter.beforeShort ?? "",
										[2],
										<p>
											<s>{chapter.beforeShort}</s>
										</p>,
									)}
								</section>
								<span aria-hidden="true" className="comparison-arrow">
									→
								</span>
								<section>
									<small>AFTER</small>
									{annotate(
										`${base}/afterShort`,
										"After",
										"Text block",
										chapter.afterShort ?? "",
										[3],
										<p>{chapter.afterShort}</p>,
									)}
								</section>
							</div>
						)}
						<ChapterVisual
							chapter={chapter}
							annotate={annotate}
							base={base}
							system={guide.system}
							inventory={inventory}
							runId={run.id}
							loading={evidence.isPending}
							error={Boolean(evidence.error)}
						/>
						{chapter.risk &&
							annotate(
								`${base}/risk`,
								"Risk",
								"Text block",
								chapter.risk.text,
								[6],
								<p className={`compact-risk ${chapter.risk.level}`}>
									<strong>{chapter.risk.level.toUpperCase()} RISK</strong> ·{" "}
									{chapter.risk.text}
								</p>,
							)}
						{chapter.keyChecks?.length ? <h3>CHECK</h3> : null}
						{chapter.keyChecks?.map((check, i) => {
							const id = `${chapter.id}/${i}`,
								checked = progress.checked?.[id] ?? false;
							return (
								<Commentable
									key={id}
									target={{
										path: `${base}/keyChecks/${i}`,
										label: check.do,
										kind: "Review check",
										context: `${check.do} → ${check.expect}`,
										page,
										pageTitle: `${titles[page]} (${chapter.id})`,
										order: [page, 7, i],
									}}
								>
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
											<strong>{check.do}</strong>{" "}
											<span className="muted">→ {check.expect}</span>
										</span>
									</label>
								</Commentable>
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
							I've reviewed this step
						</label>
						<details {...disclosure("detail")}>
							<summary>
								More detail · Full text, evidence & {chapter.files.length}{" "}
								{chapter.files.length === 1 ? "file" : "files"}
							</summary>
							{annotate(
								`${base}/summary`,
								chapter.summary,
								"Text block",
								chapter.summary,
								[1],
								<Markdown>{chapter.summary}</Markdown>,
							)}
							<h3>Before</h3>
							{annotate(
								`${base}/before`,
								chapter.before,
								"Text block",
								chapter.before,
								[2],
								<Markdown>{chapter.before}</Markdown>,
							)}
							<h3>After</h3>
							{annotate(
								`${base}/after`,
								chapter.after,
								"Text block",
								chapter.after,
								[3],
								<Markdown>{chapter.after}</Markdown>,
							)}
							{chapter.reviewChecks.length > 0 && (
								<>
									<h3>Review checks</h3>
									{lines(chapter.reviewChecks, `${base}/reviewChecks`, [7])}
								</>
							)}
							{chapter.risks.length > 0 && (
								<>
									<h3>Risks</h3>
									{lines(chapter.risks, `${base}/risks`, [6])}
								</>
							)}
							{chapter.diagrams.map((d, i) => (
								<section key={i}>
									{annotate(
										`${base}/diagrams/${i}/title`,
										d.title,
										"Diagram",
										d.title,
										[4, i, 0],
										<h3>{d.title}</h3>,
									)}
									<ol>
										{d.steps.map((step, j) => (
											<li key={j}>
												{annotate(
													`${base}/diagrams/${i}/steps/${j}`,
													step.label,
													"Diagram step",
													`${step.label}: ${step.detail}`,
													[4, i, 1, j],
													<>
														<strong>{step.label}</strong>
														<p>{step.detail}</p>
													</>,
												)}
											</li>
										))}
									</ol>
								</section>
							))}
							<ul className="guide-files">
								{chapter.files.map((file, i) => (
									<li key={file}>
										<span className="muted">
											{isTestFile(file) ? "TEST" : "SOURCE"} ·{" "}
										</span>
										{annotate(
											`${base}/files/${i}`,
											file,
											"File",
											file,
											[8, i],
											<FileLink path={file} url={url} />,
										)}
									</li>
								))}
							</ul>
							{lines(chapter.evidence, `${base}/evidence`, [9])}
							{chapter.requirementIndexes.map((i) => (
								<section key={i}>
									{annotate(
										`/requirements/${i}/criterion`,
										guide.requirements[i]?.criterion ?? "",
										"Acceptance criterion",
										guide.requirements[i]?.criterion ?? "",
										[10, i, 0],
										<strong>{guide.requirements[i]?.criterion}</strong>,
									)}
									{lines(
										guide.requirements[i]?.evidence ?? [],
										`/requirements/${i}/evidence`,
										[10, i, 1],
									)}
								</section>
							))}
						</details>
					</>
				) : null}
			</section>
			{final && (
				<>
					<CollectedFeedback go={goToItem} />
					{controls?.(storageKey, true)}
				</>
			)}
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
				{feedback && (
					<Button
						variant="secondary"
						className="feedback-count"
						aria-label={`Collected feedback: ${feedback.draft.items.filter((i) => i.text.trim()).length} comments. Open Decide`}
						onClick={() => {
							feedback.update((d) => ({ ...d, collectedOpen: true }));
							go(tokens.length - 1);
							requestAnimationFrame(() =>
								requestAnimationFrame(() =>
									document
										.querySelector<HTMLElement>(".collected-feedback")
										?.scrollIntoView({ block: "center" }),
								),
							);
						}}
					>
						✎{" "}
						<span>
							{feedback.draft.items.filter((i) => i.text.trim()).length}
						</span>
					</Button>
				)}
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
