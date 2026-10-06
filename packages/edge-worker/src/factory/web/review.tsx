import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api, client } from "./client";
import { LazyImage } from "./media";
import { useReadingPosition } from "./reading-position";
import {
	CollectedFeedback,
	Commentable,
	FeedbackContext,
	useFeedbackController,
	useReviewFeedback,
} from "./review-comments";
import { type FeedbackTarget, feedbackKey } from "./review-feedback";
import {
	readProgress,
	readStored,
	reviewKey,
	signature,
	writeStored,
} from "./review-state";
import { Button, External, Markdown } from "./ui";

function FileLink({ path, url }: { path: string; url?: string }) {
	const [anchor, setAnchor] = useState<string>();
	useEffect(() => {
		let current = true;
		void crypto.subtle
			.digest("SHA-256", new TextEncoder().encode(path))
			.then((bytes) => {
				if (current)
					setAnchor(
						[...new Uint8Array(bytes)]
							.map((n) => n.toString(16).padStart(2, "0"))
							.join(""),
					);
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [path]);
	return url ? (
		<External href={`${url}/files${anchor ? `#diff-${anchor}` : ""}`}>
			{path} ↗
		</External>
	) : (
		<code>{path}</code>
	);
}
type Annotate = (
	path: string,
	label: string,
	kind: string,
	context: string,
	order: number[],
	children: ReactNode,
) => ReactNode;
function Lines({
	items,
	path,
	order,
	annotate,
}: {
	items: string[];
	path: string;
	order: number[];
	annotate: Annotate;
}) {
	return (
		<ul className="guide-lines">
			{items.map((item, i) => (
				<li key={i}>
					{annotate(
						`${path}/${i}`,
						item,
						"Text item",
						item,
						[...order, i],
						<Markdown>{item}</Markdown>,
					)}
				</li>
			))}
		</ul>
	);
}
function Flow({
	diagram,
	path,
	order,
	annotate,
}: {
	diagram: any;
	path: string;
	order: number[];
	annotate: Annotate;
}) {
	return (
		<figure className="guide-flow">
			<figcaption>
				{annotate(
					`${path}/title`,
					diagram.title,
					"Diagram",
					diagram.title,
					[...order, 0],
					diagram.title,
				)}
			</figcaption>
			<ol>
				{diagram.steps.map((step: any, i: number) => (
					<li key={i}>
						<span className="flow-number">{i + 1}</span>
						<div>
							{annotate(
								`${path}/steps/${i}`,
								step.label,
								"Diagram step",
								`${step.label}: ${step.detail}`,
								[...order, 1, i],
								<>
									<strong>{step.label}</strong>
									<p>{step.detail}</p>
								</>,
							)}
						</div>
					</li>
				))}
			</ol>
		</figure>
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
			key={`${key}/${run.reviewGate?.id ?? "finished"}`}
			storageKey={key}
			guide={guide}
			run={run}
			documentPage={documentPage}
			controls={controls}
		/>
	);
}
function ReviewSession(props: any) {
	const controller = useFeedbackController(
		feedbackKey(props.storageKey, props.run.reviewGate?.id),
	);
	return (
		<FeedbackContext.Provider value={props.controls ? controller : null}>
			<ReviewReader {...props} />
		</FeedbackContext.Provider>
	);
}
function ReviewReader({ storageKey, guide, run, documentPage, controls }: any) {
	const feedback = useReviewFeedback();
	const chapters = guide.chapters?.length
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
				})),
		pages = [
			"Overview",
			...chapters.map((c: any) => c.title),
			"Checks & decision",
		],
		[progress, setProgress] = useState(() =>
			readProgress(readStored(storageKey, null), pages.length),
		),
		explicitNavigation = useRef(false),
		heading = useRef<HTMLHeadingElement>(null),
		evidence = useQuery({
			queryKey: [
				"guide-evidence",
				run.id,
				run.outputs.capture?.__artifactHash ??
					signature(run.outputs.capture ?? {}),
			],
			queryFn: ({ signal }) => api(`/api/runs/${run.id}/evidence`, { signal }),
			staleTime: Infinity,
		}),
		page = progress.page,
		chapter = chapters[page - 1],
		final = page === pages.length - 1,
		url = run.reviewGate?.url ?? run.outputs["draft-pr"]?.url;
	useReadingPosition(
		documentPage ? `${storageKey}/position/${page}` : undefined,
		!explicitNavigation.current,
	);
	useEffect(() => {
		writeStored(storageKey, progress);
	}, [progress, storageKey]);
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
	const go = (next: number) => {
		explicitNavigation.current = true;
		setProgress((p) => ({ ...p, page: next }));
		requestAnimationFrame(() => {
			heading.current?.focus({ preventScroll: true });
			heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
		});
	};
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
				pageTitle: `${pages[page]}${chapter?.id ? ` (${chapter.id})` : ""}`,
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
			target.page >= pages.length
		)
			return;
		feedback?.update((d) => ({ ...d, editing: target.path }));
		go(target.page);
		setProgress((p) => ({
			...p,
			disclosures: {
				...p.disclosures,
				[`${target.page}/code`]: true,
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
				item
					?.querySelector<HTMLButtonElement>(".item-comment-actions button")
					?.focus({ preventScroll: true });
			}),
		);
	};
	return (
		<article className="guided-review">
			<header className="guide-topline">
				<span>WHOLE PR REVIEW</span>
				<button
					type="button"
					className={`chip ${guide.decision.status === "ready" ? "green" : ""}`}
					onClick={() => go(pages.length - 1)}
				>
					{guide.decision.status === "ready"
						? "Ready for your review"
						: "Needs your attention"}
				</button>
			</header>
			<div className="guide-progress">
				<span>
					Step {page + 1} of {pages.length}
				</span>
				<span>
					{Object.values(progress.reviewed).filter(Boolean).length}/
					{chapters.length} chapters reviewed
				</span>
			</div>
			<progress
				aria-label="Guide progress"
				max={pages.length}
				value={page + 1}
			/>
			<label className="guide-jump">
				Jump to a chapter
				<select
					aria-label="Review chapter"
					value={page}
					onChange={(e) => go(Number(e.target.value))}
				>
					{pages.map((title: string, i: number) => (
						<option value={i} key={i}>
							{i + 1}. {title}
							{progress.reviewed[chapters[i - 1]?.id] ? " ✓" : ""}
						</option>
					))}
				</select>
			</label>
			<CollectedFeedback go={goToItem} />
			<section className="guide-page" key={page}>
				{annotate(
					page === 0
						? "/goal"
						: final
							? "/decision/title"
							: `${base}/${guide.chapters?.length ? "title" : "scenario"}`,
					page === 0 ? guide.goal : final ? "Ready to decide?" : chapter.title,
					"Heading",
					page === 0 ? guide.goal : final ? "Checks & decision" : chapter.title,
					[0],
					<h2 ref={heading} tabIndex={-1}>
						{page === 0
							? guide.goal
							: final
								? "Ready to decide?"
								: chapter.title}
					</h2>,
				)}
				{page === 0 ? (
					<>
						{annotate(
							"/summary",
							"Review summary",
							"Text block",
							guide.summary,
							[1],
							<Markdown>{guide.summary}</Markdown>,
						)}
						<p className="muted">
							This guide covers the complete pull request. Each chapter explains
							one change, then shows the evidence to review it.
						</p>
						<ol className="guide-outline">
							{chapters.map((c: any, i: number) => (
								<li key={c.id}>
									{annotate(
										`${guide.chapters?.length ? "/chapters" : "/behavior"}/${i}/outline`,
										c.title,
										"Chapter outline",
										c.title,
										[2, i],
										<button type="button" onClick={() => go(i + 1)}>
											<span>{String(i + 1).padStart(2, "0")}</span>
											<strong>{c.title}</strong>
											<span aria-hidden="true">→</span>
										</button>,
									)}
								</li>
							))}
						</ol>
						{(guide.revisionSummary || guide.revisionNote) &&
							annotate(
								"/revisionNote",
								"Revision note",
								"Text block",
								guide.revisionNote ?? "Updated since your previous review.",
								[3],
								<p className="notice">
									{guide.revisionNote ??
										"Updated since your previous review. The complete feature guide remains available below."}
								</p>,
							)}
					</>
				) : final ? (
					<>
						{annotate(
							"/decision/summary",
							"Decision summary",
							"Text block",
							guide.decision.summary,
							[1],
							<Markdown>{guide.decision.summary}</Markdown>,
						)}
						{guide.risks.length > 0 && (
							<section className="guide-risk">
								<h3>Know before approving</h3>
								{lines(guide.risks, "/risks", [2])}
							</section>
						)}
						<details {...disclosure("verification")}>
							<summary>Verification evidence ({guide.checks.length})</summary>
							{lines(guide.checks, "/checks", [3])}
						</details>
						<details {...disclosure("criteria")}>
							<summary>
								All acceptance criteria ({guide.requirements.length})
							</summary>
							{guide.requirements.map((r: any, i: number) => (
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
						<h3>Your final checks</h3>
						{lines(guide.reviewInstructions, "/reviewInstructions", [5])}
						<p className="muted">
							{Object.values(progress.reviewed).filter(Boolean).length}/
							{chapters.length} chapters marked reviewed. This records your
							reading progress; approval is a separate action.
						</p>
					</>
				) : (
					<>
						{annotate(
							`${base}/summary`,
							"Change summary",
							"Text block",
							chapter.summary,
							[1],
							<Markdown>{chapter.summary}</Markdown>,
						)}
						<div className="guide-comparison">
							<section>
								<small>BEFORE</small>
								{annotate(
									`${base}/before`,
									"Before",
									"Text block",
									chapter.before,
									[2],
									<Markdown>{chapter.before}</Markdown>,
								)}
							</section>
							<section>
								<small>AFTER</small>
								{annotate(
									`${base}/after`,
									"After",
									"Text block",
									chapter.after,
									[3],
									<Markdown>{chapter.after}</Markdown>,
								)}
							</section>
						</div>
						{chapter.diagrams.map((d: any, i: number) => (
							<Flow
								diagram={d}
								key={i}
								path={`${base}/diagrams/${i}`}
								order={[4, i]}
								annotate={annotate}
							/>
						))}
						<div className="guide-visuals">
							{chapter.screenshots.map((ref: any, i: number) => {
								const shot = evidence.data?.screenshots.find(
									(s: any) => s.area === ref.area && s.state === ref.state,
								);
								return (
									<Commentable
										key={i}
										target={{
											path: `${base}/screenshots/${i}`,
											page,
											pageTitle: `${chapter.title} (${chapter.id})`,
											kind: "Screenshot",
											label: ref.caption,
											context: `Area: ${ref.area}; state: ${ref.state}; caption: ${ref.caption}`,
											order: [page, 5, i],
										}}
									>
										<figure>
											{shot ? (
												<External
													href={`${location.origin}/api/runs/${run.id}/screenshots/${shot.index}?v=${shot.imageSha256 ?? ""}`}
												>
													<LazyImage
														key={shot.imageSha256 ?? shot.index}
														src={`/api/runs/${run.id}/screenshots/${shot.index}?v=${shot.imageSha256 ?? ""}`}
														alt={ref.caption}
														style={{ aspectRatio: "auto", width: "100%" }}
													/>
												</External>
											) : (
												<p role="status">
													{evidence.error
														? "Could not load image evidence"
														: evidence.isPending
															? "Loading image evidence…"
															: "This screenshot is unavailable"}
												</p>
											)}
											<figcaption>{ref.caption}</figcaption>
											{shot && <small>{shot.state}</small>}
										</figure>
									</Commentable>
								);
							})}
						</div>
						{chapter.risks.length > 0 && (
							<section className="guide-risk">
								<h3>Watch out for</h3>
								{lines(chapter.risks, `${base}/risks`, [6])}
							</section>
						)}
						{chapter.reviewChecks.length > 0 && (
							<section>
								<h3>What to check</h3>
								{lines(chapter.reviewChecks, `${base}/reviewChecks`, [7])}
							</section>
						)}
						<details {...disclosure("code")}>
							<summary>Code & evidence · {chapter.files.length} files</summary>
							<ul className="guide-files">
								{chapter.files.map((file: string, i: number) => (
									<li key={i}>
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
							{chapter.requirementIndexes.map((i: number, j: number) => (
								<section key={i}>
									{annotate(
										`${base}/requirementIndexes/${j}/criterion`,
										guide.requirements[i]?.criterion ?? "Criterion",
										"Acceptance criterion",
										guide.requirements[i]?.criterion ?? "",
										[10, j, 0],
										<strong>{guide.requirements[i]?.criterion}</strong>,
									)}
									{lines(
										guide.requirements[i]?.evidence ?? [],
										`${base}/requirementIndexes/${j}/evidence`,
										[10, j, 1],
									)}
								</section>
							))}
						</details>
						<label className="guide-reviewed">
							<input
								type="checkbox"
								checked={progress.reviewed[chapter.id] ?? false}
								onChange={(e) =>
									setProgress((p) => ({
										...p,
										reviewed: { ...p.reviewed, [chapter.id]: e.target.checked },
									}))
								}
							/>{" "}
							I’ve reviewed this change
						</label>
					</>
				)}
			</section>
			<footer className="guide-navigation">
				<Button
					variant="secondary"
					disabled={page === 0}
					onClick={() => go(page - 1)}
				>
					← Back
				</Button>
				{!final && (
					<Button onClick={() => go(page + 1)}>
						{page === 0
							? "Start review →"
							: page === pages.length - 2
								? "Checks & decision →"
								: "Next change →"}
					</Button>
				)}
			</footer>
			{controls?.(storageKey, final)}
		</article>
	);
}
