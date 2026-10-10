import { useQuery } from "@tanstack/react-query";
import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useMemo,
	useState,
} from "react";
import type { GuideChapter } from "../FactoryResults";
import type { BriefProof, BriefRequirement, ReviewBrief } from "../ReviewBrief";
import { api } from "./client";
import { LazyVideo, type VideoInventory } from "./media";
import { useRestorableState } from "./restoration";
import { useApproval } from "./review-approval";
import { BriefSystem, type FlowFocus } from "./review-brief-system";
import {
	CollectedFeedback,
	Commentable,
	type FeedbackController,
	useReviewFeedback,
} from "./review-comments";
import { reviewFileTarget } from "./review-context";
import type { FeedbackTarget } from "./review-feedback";
import { ChangedFiles, FileLink, useReviewFiles } from "./review-files";
import { fileTotals } from "./review-model";
import { readStored, signature, writeStored } from "./review-state";
import { Button, External, Modal } from "./ui";

type Inventory = {
	area: string;
	state: string;
	caption: string;
	context?: string;
	imageSha256?: string;
	index: number;
};
type Focus = { x: number; y: number; w: number; h: number };
type Shot = { src: string; label: string; focus?: Focus; caption?: string };

const STATUS: Record<
	BriefRequirement["status"],
	{ icon: string; label: string }
> = {
	shown: { icon: "●", label: "Shown working" },
	tested: { icon: "◐", label: "Tests only" },
	partly: { icon: "◑", label: "Partly proven" },
	"not-shown": { icon: "○", label: "No evidence" },
	gap: { icon: "✕", label: "Not met" },
	waived: { icon: "⏭", label: "Waived" },
};
const ORIGIN = {
	ask: "from the ask",
	"your-answer": "your answer",
	bob: "Bob added",
};
const DECIDED = {
	you: "You decided",
	ticket: "In the ticket",
	bob: "Bob decided",
};
const READINESS = {
	ready: "Ready to approve",
	"ready-with-caveats": "Ready, with decisions for you",
	"not-ready": "Not ready",
};

/** Requirement-first review: the ask, proof per requirement, human judgment, then everything else. */
export function BriefReview({
	brief,
	run,
	storageKey,
	controls,
}: {
	brief: ReviewBrief;
	run: any;
	storageKey: string;
	controls?: (identity: string, decisionPage: boolean) => ReactNode;
}) {
	const feedback = useReviewFeedback();
	const [agreed, setAgreed] = useRestorableState<Record<string, boolean>>(
		`review/brief/${storageKey}`,
		() => readStored(`${storageKey}/agreed`, {}),
	);
	useEffect(
		() => writeStored(`${storageKey}/agreed`, agreed),
		[agreed, storageKey],
	);
	const [lightbox, setLightbox] = useState<Shot>();
	const [flowFocus, setFlowFocus] = useState<FlowFocus>();
	const evidence = useQuery({
		queryKey: [
			"guide-evidence",
			run.id,
			run.outputs.capture?.__artifactHash ??
				signature(run.outputs.capture ?? {}),
		],
		queryFn: ({ signal }) => api(`/api/runs/${run.id}/evidence`, { signal }),
		staleTime: Infinity,
	});
	const inventory: Inventory[] = evidence.data?.screenshots ?? [];
	const videos: VideoInventory[] = evidence.data?.videos ?? [];
	const fileQuery = useReviewFiles(run, brief as never);
	// File groups in reading order; each remembers the line it scrolls back to.
	const groups = useMemo(
		() => [
			...brief.requirements.map((r) => ({
				id: r.id,
				title: r.text,
				files: r.files,
				anchor: `brief-line-${r.id}`,
			})),
			...brief.beyondAsk.flatMap((b, i) =>
				b.files.length
					? [
							{
								id: `beyond-${i}`,
								title: `Beyond the ask: ${b.what}`,
								files: b.files,
								anchor: `brief-line-beyond-${i}`,
							},
						]
					: [],
			),
		],
		[brief],
	);
	const linePaths = [
		...brief.requirements.map((_, i) => `/requirements/${i}`),
		...brief.yourCall.map((_, i) => `/yourCall/${i}`),
	];
	const commented = new Set(
		(feedback?.draft.items ?? [])
			.filter((item) => item.text.trim())
			.map((item) => item.target.path),
	);
	const comments = commented.size;
	const objections = linePaths.filter((path) => commented.has(path)).length;
	const judged = (paths: string[]) =>
		paths.filter((path) => agreed[path] || commented.has(path)).length;
	const flows = brief.system?.flows ?? [];
	const requirementNumber = (id: string) => {
		const i = brief.requirements.findIndex((r) => r.id === id);
		return i < 0 ? undefined : i + 1;
	};
	const showFlow = (flow: string, steps: number[]) => {
		setFlowFocus({ flow, steps });
		requestAnimationFrame(() =>
			document
				.getElementById(`brief-flow-${flow}`)
				?.scrollIntoView({ behavior: "smooth", block: "start" }),
		);
	};
	const screenshot = (area: string, state: string) => {
		const shot = inventory.find((s) => s.area === area && s.state === state);
		return shot
			? {
					src: `/api/runs/${encodeURIComponent(run.id)}/screenshots/${shot.index}?v=${shot.imageSha256 ?? ""}`,
					caption: shot.caption,
				}
			: undefined;
	};
	const proof = (value: BriefProof) => (
		<Proof
			proof={value}
			flows={flows}
			screenshot={screenshot}
			loading={evidence.isPending}
			videos={videos}
			runId={run.id}
			onOpen={setLightbox}
			onFlow={showFlow}
		/>
	);
	const target = (
		path: string,
		label: string,
		kind: string,
		context: string,
		section: number,
		order: number,
	): FeedbackTarget => ({
		path,
		label,
		kind,
		context,
		page: 0,
		pageTitle:
			[
				"Verdict",
				"The ask",
				"Requirements",
				"Your call",
				"How it’s built",
				"Beyond the ask",
			][section] ?? "Review",
		order: [section, order],
	});
	const goToComment = (item: FeedbackTarget) => {
		feedback?.update((d) => ({ ...d, editing: item.path }));
		requestAnimationFrame(() =>
			document
				.querySelector<HTMLElement>(
					`[data-comment-path="${CSS.escape(item.path)}"]`,
				)
				?.scrollIntoView({ block: "center" }),
		);
	};
	const judge = (path: string, labels: [string, string]) =>
		feedback && (
			<Judge
				agreed={agreed[path] ?? false}
				objected={commented.has(path)}
				labels={labels}
				onAgree={() =>
					setAgreed((current) => ({ ...current, [path]: !current[path] }))
				}
				onObject={() => {
					setAgreed((current) => ({ ...current, [path]: false }));
					feedback.update((d) => ({ ...d, editing: path }));
				}}
			/>
		);
	const assessments = brief.requirementCoverage?.assessments ?? [];
	const section = {
		ask: 1,
		requirements: 2,
		calls: 3,
		system: 4,
		beyond: brief.system ? 5 : 4,
	};
	const files = fileQuery.data?.manifest.files;
	const totals = files ? fileTotals(files) : undefined;
	const receipt = run.outputs?.["merge-readiness"] ?? run.outputs?.ci;
	// Older and scripted receipts may not carry provider checks; never let them break reading.
	const checks: { bucket?: string }[] | undefined = Array.isArray(
		receipt?.checks,
	)
		? receipt.checks.filter((c: unknown) => c && typeof c === "object")
		: undefined;
	const passed = checks?.filter((c) => c.bucket === "pass").length ?? 0;
	const skipped = checks?.filter((c) => c.bucket === "skipping").length ?? 0;
	return (
		<div className="brief">
			<div className="brief-main">
				<section
					className={`brief-verdict ${brief.verdict.readiness}`}
					aria-labelledby="brief-verdict"
				>
					<p className="brief-readiness">
						{brief.verdict.readiness === "ready-with-caveats" &&
						brief.yourCall.length
							? `Ready, with ${brief.yourCall.length} decision${brief.yourCall.length === 1 ? "" : "s"} for you`
							: READINESS[brief.verdict.readiness]}
					</p>
					<h2 id="brief-verdict" tabIndex={-1}>
						{brief.verdict.headline}
					</h2>
					<p className="brief-why">{brief.verdict.why}</p>
					<div className="brief-tally">
						{(Object.keys(STATUS) as BriefRequirement["status"][]).map(
							(status) => {
								const count = brief.requirements.filter(
									(r) => r.status === status,
								).length;
								return count ? (
									<span key={status} className={`brief-pill status-${status}`}>
										{STATUS[status].icon} {count}{" "}
										{STATUS[status].label.toLowerCase()}
									</span>
								) : null;
							},
						)}
						{totals && (
							<span className="brief-pill quiet">
								{totals.files} {totals.files === 1 ? "file" : "files"}
								{totals.additions !== null &&
									` · +${totals.additions} −${totals.deletions}`}
							</span>
						)}
					</div>
				</section>

				{brief.sinceLastReview && (
					<section className="brief-since" aria-labelledby="brief-since">
						<h3 id="brief-since">Since your last review</h3>
						<p>{brief.sinceLastReview.summary}</p>
						<ul>
							{brief.sinceLastReview.changes.map((change) => (
								<li key={change.what}>{change.what}</li>
							))}
						</ul>
					</section>
				)}

				<section className="brief-section" aria-labelledby="brief-ask">
					<h3 id="brief-ask">
						<span className="brief-step">{section.ask}</span> What you asked for
					</h3>
					<blockquote className="brief-quote">
						<p>{brief.ask.quote}</p>
						<footer>
							{brief.ask.url ? (
								<External href={brief.ask.url}>{brief.ask.source} ↗</External>
							) : (
								brief.ask.source
							)}
						</footer>
					</blockquote>
					{brief.interpretation.length > 0 && (
						<>
							<h4 className="brief-sub">How Bob read it</h4>
							<ul className="brief-decisions">
								{brief.interpretation.map((d, i) => (
									<li key={d.topic} className={`by-${d.decidedBy}`}>
										<Commentable
											target={target(
												`/interpretation/${i}`,
												d.topic,
												"Interpretation",
												`${d.topic}: ${d.chosen}`,
												1,
												i,
											)}
										>
											<div className="brief-decision">
												<strong>{d.topic}</strong>
												<span className="brief-decision-chosen">
													{d.chosen}
													{d.alternatives?.length ? (
														<small>
															Instead of: {d.alternatives.join(" · ")}
														</small>
													) : null}
													{d.note && <small>{d.note}</small>}
												</span>
												<span className={`brief-by by-${d.decidedBy}`}>
													{DECIDED[d.decidedBy]}
												</span>
											</div>
										</Commentable>
									</li>
								))}
							</ul>
						</>
					)}
				</section>

				<section className="brief-section" aria-labelledby="brief-requirements">
					<h3 id="brief-requirements">
						<span className="brief-step">{section.requirements}</span> Does it
						do that?
					</h3>
					<p className="muted">
						Each line carries its strongest proof. ● seen working at this
						revision · ◐ only tests prove it · ◑ some cases unproven.
					</p>
					<ol className="brief-lines">
						{brief.requirements.map((r, i) => {
							const path = `/requirements/${i}`;
							const notes = assessments.filter((a) =>
								r.covers?.includes(a.requirementId),
							);
							return (
								<li
									key={r.id}
									id={`brief-line-${r.id}`}
									className={`brief-line status-${r.status} ${commented.has(path) ? "objected" : agreed[path] ? "agreed" : ""}`}
								>
									<Commentable
										target={target(
											path,
											r.text,
											"Requirement",
											`${r.text} (${STATUS[r.status].label})`,
											2,
											i,
										)}
									>
										<header className="brief-line-head">
											<span
												className={`brief-status status-${r.status}`}
												role="img"
												aria-label={STATUS[r.status].label}
											>
												{STATUS[r.status].icon}
											</span>
											<div>
												<p className="brief-line-text">
													<span className="muted">{i + 1}.</span> {r.text}
												</p>
												<small className="muted">
													{STATUS[r.status].label} · {ORIGIN[r.origin]}
												</small>
											</div>
											{judge(path, ["Met", "Not met"])}
										</header>
									</Commentable>
									{proof(r.proof)}
									{r.caveat && <p className="brief-caveat">⚠ {r.caveat}</p>}
									{r.more?.length || r.files.length || notes.length ? (
										<details className="brief-more">
											<summary>
												{[
													r.more?.length && `${r.more.length} more proof`,
													r.files.length &&
														`${r.files.length} ${r.files.length === 1 ? "file" : "files"}`,
													notes.length && "review notes",
												]
													.filter(Boolean)
													.join(" · ")}
											</summary>
											{r.more?.map((value, j) => (
												<div key={j}>{proof(value)}</div>
											))}
											<FileChips files={r.files} run={run} />
											{notes.map((a) => (
												<p key={a.requirementId} className="brief-review-note">
													<strong>
														{a.requirementId} · {a.status.replaceAll("_", " ")}
													</strong>{" "}
													{a.reason}
												</p>
											))}
										</details>
									) : null}
								</li>
							);
						})}
					</ol>
				</section>

				<section className="brief-section" aria-labelledby="brief-calls">
					<h3 id="brief-calls">
						<span className="brief-step">{section.calls}</span> Your call
					</h3>
					{brief.yourCall.length === 0 ? (
						<p className="brief-empty">
							Nothing here needs taste or a trade-off from you. This change is
							mechanical.
						</p>
					) : (
						<ol className="brief-lines">
							{brief.yourCall.map((c, i) => {
								const path = `/yourCall/${i}`;
								return (
									<li
										key={c.question}
										className={`brief-line ${commented.has(path) ? "objected" : agreed[path] ? "agreed" : ""}`}
									>
										<Commentable
											target={target(
												path,
												c.question,
												"Decision",
												`${c.question} Bob chose: ${c.bobChose}`,
												3,
												i,
											)}
										>
											<header className="brief-line-head call">
												<p className="brief-line-text">{c.question}</p>
												{judge(path, ["Fine", "Change it"])}
											</header>
										</Commentable>
										<p>{c.context}</p>
										<p className="brief-bob">
											<strong>Bob chose:</strong> {c.bobChose}
										</p>
										{c.proof && proof(c.proof)}
									</li>
								);
							})}
						</ol>
					)}
				</section>

				{brief.system && (
					<section className="brief-section" aria-labelledby="brief-system">
						<h3 id="brief-system">
							<span className="brief-step">{section.system}</span> How it’s
							built
						</h3>
						<BriefSystem
							system={brief.system}
							focus={flowFocus}
							requirementNumber={requirementNumber}
						/>
					</section>
				)}

				<section className="brief-section" aria-labelledby="brief-beyond">
					<h3 id="brief-beyond">
						<span className="brief-step">{section.beyond}</span> Changed beyond
						the ask
					</h3>
					{brief.beyondAsk.length === 0 ? (
						<p className="brief-empty">
							Every changed file serves a requirement above.
						</p>
					) : (
						<ul className="brief-beyond">
							{brief.beyondAsk.map((b, i) => (
								<li
									key={b.what}
									id={`brief-line-beyond-${i}`}
									className={`attention-${b.attention}`}
								>
									<Commentable
										target={target(
											`/beyondAsk/${i}`,
											b.what,
											"Change beyond the ask",
											`${b.what} ${b.why}`,
											5,
											i,
										)}
									>
										<span
											className="brief-dot"
											role="img"
											aria-label={`Attention: ${b.attention}`}
										/>
										<div>
											<p>
												<strong>{b.what}</strong>
											</p>
											<p className="muted">{b.why}</p>
											<FileChips files={b.files} run={run} />
										</div>
									</Commentable>
								</li>
							))}
						</ul>
					)}
					{brief.notVerified.length > 0 || brief.noticed?.length ? (
						<div className="brief-limits">
							{brief.notVerified.length > 0 && (
								<div>
									<h4 className="brief-sub">Not verified</h4>
									<ul>
										{brief.notVerified.map((n) => (
											<li key={n.what}>
												<strong>{n.what}.</strong>{" "}
												<span className="muted">{n.why}</span>
											</li>
										))}
									</ul>
								</div>
							)}
							{brief.noticed?.length ? (
								<div>
									<h4 className="brief-sub">Noticed along the way</h4>
									<ul>
										{brief.noticed.map((n) => (
											<li key={n} className="muted">
												{n}
											</li>
										))}
									</ul>
								</div>
							) : null}
						</div>
					) : null}
				</section>

				<details
					className="brief-section brief-files"
					aria-labelledby="brief-files"
				>
					<summary id="brief-files">Every changed file, by requirement</summary>
					<ChangedFiles
						query={fileQuery}
						chapters={groups as unknown as GuideChapter[]}
						run={run}
						noun="requirement"
						onChapter={(i) =>
							document
								.getElementById(groups[i - 1]?.anchor ?? "")
								?.scrollIntoView({ behavior: "smooth", block: "center" })
						}
					/>
				</details>

				<section className="brief-delivery" aria-label="Delivery facts">
					{checks?.length ? (
						<span>
							CI ✓ {passed}/{checks.length}
							{skipped ? ` (${skipped} skipped)` : ""}
						</span>
					) : null}
					{brief.hygiene.length > 0 && (
						<ul>
							{brief.hygiene.map((h) => (
								<li key={h.text}>{h.text}</li>
							))}
						</ul>
					)}
				</section>

				{(controls || feedback) && (
					<section
						className="brief-decide"
						id="brief-decide"
						aria-labelledby="brief-decide-title"
					>
						<h3 id="brief-decide-title">Decide</h3>
						<CollectedFeedback go={goToComment} />
						{controls?.(storageKey, true)}
					</section>
				)}
			</div>

			{feedback && (
				<DecisionPanel
					run={run}
					controller={feedback}
					requirements={judged(linePaths.slice(0, brief.requirements.length))}
					requirementTotal={brief.requirements.length}
					calls={judged(linePaths.slice(brief.requirements.length))}
					callTotal={brief.yourCall.length}
					objections={objections}
					comments={comments}
				/>
			)}

			<Modal
				open={Boolean(lightbox)}
				onOpenChange={(open) => {
					if (!open) setLightbox(undefined);
				}}
				className="brief-lightbox"
				title={lightbox?.label ?? "Screenshot"}
				description={lightbox?.caption}
			>
				{lightbox && (
					<div className="brief-lightbox-frame">
						<img src={lightbox.src} alt={lightbox.label} />
						{lightbox.focus && (
							<span
								className="brief-focus-ring"
								style={{
									left: `${lightbox.focus.x}%`,
									top: `${lightbox.focus.y}%`,
									width: `${lightbox.focus.w}%`,
									height: `${lightbox.focus.h}%`,
								}}
							/>
						)}
					</div>
				)}
			</Modal>
		</div>
	);
}

function Judge({
	agreed,
	objected,
	labels,
	onAgree,
	onObject,
}: {
	agreed: boolean;
	objected: boolean;
	labels: [string, string];
	onAgree: () => void;
	onObject: () => void;
}) {
	return (
		<fieldset className="brief-judge" aria-label="Your judgment">
			<button type="button" aria-pressed={agreed} onClick={onAgree}>
				✓ {labels[0]}
			</button>
			<button type="button" aria-pressed={objected} onClick={onObject}>
				✕ {labels[1]}
			</button>
		</fieldset>
	);
}

function DecisionPanel({
	run,
	controller,
	requirements,
	requirementTotal,
	calls,
	callTotal,
	objections,
	comments,
}: {
	run: any;
	controller: FeedbackController;
	requirements: number;
	requirementTotal: number;
	calls: number;
	callTotal: number;
	objections: number;
	comments: number;
}) {
	const { approve, action, waiting, matching } = useApproval(run, controller);
	const decide = () => {
		controller.update((d) => ({ ...d, collectedOpen: true }));
		requestAnimationFrame(() =>
			document
				.getElementById("brief-decide")
				?.scrollIntoView({ behavior: "smooth", block: "start" }),
		);
	};
	return (
		<aside className="brief-panel" aria-label="Your decision">
			<p className="brief-panel-title">Your decision</p>
			<Progress
				label="Requirements"
				done={requirements}
				total={requirementTotal}
			/>
			{callTotal > 0 && (
				<Progress label="Your calls" done={calls} total={callTotal} />
			)}
			{comments > 0 && (
				<p className="brief-objections" role="status">
					{objections > 0
						? `${objections} objection${objections === 1 ? "" : "s"}`
						: `${comments} comment${comments === 1 ? "" : "s"}`}{" "}
					will be sent as feedback
				</p>
			)}
			{waiting && (
				<Button
					variant="rainbow"
					requiresConnection
					busy={controller.busy || action.isPending}
					disabled={!matching || comments > 0}
					onClick={approve}
				>
					Approve {String(run.reviewGate?.headSha ?? "").slice(0, 8)}
				</Button>
			)}
			<Button variant="secondary" onClick={decide}>
				{comments ? `Request changes (${comments})` : "Request changes"}
			</Button>
			<p className="brief-panel-foot">
				{comments > 0 && waiting
					? "Send or remove your comments before approving."
					: "Marking lines is optional and never blocks approval."}
			</p>
		</aside>
	);
}

function Progress({
	label,
	done,
	total,
}: {
	label: string;
	done: number;
	total: number;
}) {
	return (
		<div className="brief-progress">
			<span>
				{label} <strong>{done}</strong>/{total}
			</span>
			<progress max={total} value={done} aria-label={`${label} judged`} />
		</div>
	);
}

function FileChips({ files, run }: { files: string[]; run: any }) {
	if (!files.length) return null;
	return (
		<ul className="brief-files-list">
			{files.map((file) => (
				<li key={file}>
					<FileLink {...reviewFileTarget(run, file)}>
						{file.split("/").at(-1)}
					</FileLink>
				</li>
			))}
		</ul>
	);
}

function Proof({
	proof,
	flows,
	screenshot,
	loading,
	videos,
	runId,
	onOpen,
	onFlow,
}: {
	proof: BriefProof;
	flows: NonNullable<ReviewBrief["system"]>["flows"];
	screenshot: (
		area: string,
		state: string,
	) => { src: string; caption: string } | undefined;
	loading: boolean;
	videos: VideoInventory[];
	runId: string;
	onOpen: (shot: Shot) => void;
	onFlow: (flow: string, steps: number[]) => void;
}) {
	switch (proof.kind) {
		case "screens":
			return (
				<div className="brief-proof">
					<div className={`brief-shots count-${proof.shots.length}`}>
						{proof.shots.map((shot) => {
							const image = screenshot(shot.area, shot.state);
							return image ? (
								<button
									type="button"
									key={`${shot.area}/${shot.state}/${shot.label}`}
									className="brief-shot"
									onClick={() =>
										onOpen({
											src: image.src,
											label: shot.label,
											focus: shot.focus,
											caption: image.caption,
										})
									}
								>
									<Crop src={image.src} focus={shot.focus} alt={shot.label} />
									<span>{shot.label}</span>
								</button>
							) : (
								<p key={`${shot.area}/${shot.state}`} role="status">
									{loading
										? "Loading screenshot…"
										: `Screenshot unavailable: ${shot.label}`}
								</p>
							);
						})}
					</div>
					{proof.note && <p className="brief-note-text">{proof.note}</p>}
				</div>
			);
		case "video": {
			const video = videos.find(
				(v) => v.taskId === proof.taskId && v.sha256 === proof.sha256,
			);
			return (
				<div className="brief-proof">
					{video ? (
						<LazyVideo runId={runId} video={video} />
					) : (
						<p role="status">Recording unavailable; refresh evidence.</p>
					)}
				</div>
			);
		}
		case "table":
			return (
				<div className="brief-proof brief-table-wrap">
					<table className="brief-table">
						{proof.method && <caption>{proof.method}</caption>}
						<thead>
							<tr>
								{proof.columns.map((column) => (
									<th key={column}>{column}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{proof.rows.map((row, i) => (
								<tr key={i} className={`mark-${row.mark ?? "neutral"}`}>
									{row.cells.map((cell, j) => (
										<td key={j}>
											{j === row.cells.length - 1 ? (
												<code>
													{row.mark === "good" && (
														<span aria-hidden="true">✓ </span>
													)}
													{row.mark === "bad" && (
														<>
															<span aria-hidden="true">! </span>
															<span className="sr-only">Problem: </span>
														</>
													)}
													{cell}
												</code>
											) : (
												cell
											)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		case "code":
		case "test":
		case "command": {
			const body = proof.kind === "command" ? proof.output : proof.excerpt;
			return (
				<div className="brief-proof">
					<p className="brief-proof-file">
						{proof.kind === "command" ? `$ ${proof.command}` : proof.file}
					</p>
					<pre className="brief-code">
						{body.split("\n").map((line, i) => (
							<span
								key={i}
								className={
									proof.kind === "code" && line.startsWith("+")
										? "added"
										: proof.kind === "code" && line.startsWith("-")
											? "removed"
											: undefined
								}
							>
								{line}
								{"\n"}
							</span>
						))}
					</pre>
					<p className="brief-note-text">
						{proof.kind === "test" ? `✓ ${proof.result}` : proof.note}
					</p>
				</div>
			);
		}
		case "steps":
			return (
				<div className="brief-proof">
					<ol className="brief-steps">
						{proof.steps.map((step) => (
							<li
								key={step.label}
								className={step.change ? `change-${step.change}` : ""}
							>
								{step.change && (
									<span className="brief-mark">{step.change}</span>
								)}
								<strong>{step.label}</strong>
								<span>{step.detail}</span>
							</li>
						))}
					</ol>
					{proof.note && <p className="brief-note-text">{proof.note}</p>}
				</div>
			);
		case "flowRef":
			return (
				<button
					type="button"
					className="brief-flowref"
					onClick={() => onFlow(proof.flow, proof.steps)}
				>
					<span className="brief-flowref-title">
						↳ {flows.find((f) => f.id === proof.flow)?.title ?? proof.flow},
						step
						{proof.steps.length === 1 ? "" : "s"} {proof.steps.join(", ")}
					</span>
					<small className="brief-flowref-note">{proof.note}</small>
				</button>
			);
	}
}

/** Only the pixels that prove the claim; the full frame is one click away. */
function Crop({
	src,
	focus,
	alt,
}: {
	src: string;
	focus?: Focus;
	alt: string;
}) {
	const [size, setSize] = useState<[number, number]>();
	const [failed, setFailed] = useState(false);
	const f = focus ?? { x: 0, y: 0, w: 100, h: 100 };
	if (failed)
		return <span role="status">This screenshot could not be loaded.</span>;
	return (
		<span
			className="brief-crop"
			style={
				{
					aspectRatio: size ? (f.w * size[0]) / (f.h * size[1]) : 16 / 9,
				} as CSSProperties
			}
		>
			<img
				src={src}
				alt={alt}
				loading="lazy"
				decoding="async"
				onLoad={(e) =>
					setSize([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])
				}
				onError={() => setFailed(true)}
				style={{
					width: `${(100 * 100) / f.w}%`,
					left: `${(-100 * f.x) / f.w}%`,
					top: `${(-100 * f.y) / f.h}%`,
				}}
			/>
		</span>
	);
}
