import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
	active,
	ago,
	attention,
	elapsed,
	finished,
	icons,
	phase,
	stepsOf,
	useAction,
	useRun,
	workflowOf,
	workingLabel,
} from "./client";
import { activitiesOf } from "./conversation";
import { useCurrentForm, useFormState } from "./form-state";
import {
	type AnswerDraft,
	answerChoice,
	type Recommendation,
	resolveAnswers,
	serializeAnswers,
} from "./question-answers";
import { revisionOf } from "./restoration";
import { GuidedReview } from "./review";
import { useApproval } from "./review-approval";
import {
	type FeedbackController,
	useFeedbackController,
	useReviewFeedback,
} from "./review-comments";
import { reviewDiffUrl } from "./review-context";
import {
	emptyFeedback,
	feedbackKey,
	hasFeedback,
	serializeFeedback,
} from "./review-feedback";
import { guideMatchesGate, reviewRevision, signature } from "./review-state";
import { Bob, Button, ConfirmStop, External, Markdown, useToast } from "./ui";
export const labels: Record<string, string> = {
	question: "💬 Question",
	stuck: "🩹 Stuck",
	review: "🎁 Ready to review",
};
export function RunMeta({ run, config }: { run: any; config: any }) {
	const repo = config.repositories.find(
			(r: any) =>
				r.id === run.repositoryId ||
				r.repositoryIds?.includes(run.repositoryId),
		),
		workflow = workflowOf(run, config);
	return (
		<span className="run-meta">
			<span className="repo-dot" /> {repo?.name ?? "Workspace"} ·{" "}
			{workflow.icon ?? "🧩"} {workflow.name} ·{" "}
			{ago(run.updatedAt ?? run.createdAt)}
			<span> · {originLabel(run)}</span>
		</span>
	);
}
export function originLabel(run: any): string {
	const origin = run.triggerOrigin;
	if (!origin) return "Origin unavailable for this older run";
	if (origin.type === "manual")
		return origin.manual?.method === "follow-up"
			? "Manual follow-up"
			: "Manual start";
	const ticket = origin.ticket;
	return `${ticket?.provider === "cli" ? "CLI fixture" : "Linear"} ${ticket?.subtype ?? "ticket start"}${ticket?.identifier ? ` · ${ticket.identifier}` : ""} · ${origin.workflowId} · ${selectionLabel(origin)}`;
}

function selectionLabel(origin: any): string {
	const selection = origin?.selection;
	switch (selection?.source) {
		case "manual":
			return "manual workflow choice";
		case "comment-selector":
			return `triggering comment ${selection.selector}`;
		case "description-selector":
			return `issue description ${selection.selector}`;
		case "label":
			return `configured label ${selection.label ?? "(label unavailable)"}`;
		case "default":
			return "saved default";
	}
	return origin?.selectionMethod === "label"
		? "configured label (label unavailable)"
		: origin?.selectionMethod === "default"
			? "saved default"
			: "selection source unavailable for this older run";
}

export function RunTitleStatus({ run }: { run: any }) {
	const action = useAction();
	const job = run.titleGeneration;
	if (job?.state === "pending")
		return (
			<p className="run-title-status" role="status">
				{job.retries ? "Retrying title…" : "Generating title…"}
			</p>
		);
	if (job?.state !== "failed") return null;
	return (
		<div className="run-title-status">
			<p>Title generation failed: {job.error ?? "Unknown error"}</p>
			<Button
				variant="ghost"
				requiresConnection
				busy={action.isPending}
				onClick={() =>
					void action
						.mutateAsync({
							path: `/api/runs/${encodeURIComponent(run.id)}/retry-title`,
						})
						.catch(() => {})
				}
			>
				Retry title
			</Button>
			{action.error && (
				<p className="error" role="alert">
					{action.error.message}
				</p>
			)}
		</div>
	);
}

export function RunOrigin({ run }: { run: any }) {
	const origin = run.triggerOrigin;
	const calls =
		run.workflowCalls ?? (run.events ?? []).filter((event: any) => event.call);
	return (
		<section className="run-origin" aria-label="Launch origin">
			<p>
				{originLabel(run)}{" "}
				{origin?.ticket?.url && (
					<External href={origin.ticket.url}>Source ticket ↗</External>
				)}
				{origin?.manual?.sourceRunId && (
					<Link to={`/runs/${origin.manual.sourceRunId}`}>Source run</Link>
				)}
			</p>
			{origin && (
				<p>
					Workflow: {origin.workflowId} · Selected by {selectionLabel(origin)}
				</p>
			)}
			{(origin || calls.length > 0) && (
				<details>
					<summary>
						Launch details
						{calls.length ? ` and ${calls.length} workflow call(s)` : ""}
					</summary>
					<pre>{JSON.stringify(origin, null, 2)}</pre>
					{calls.map((event: any, index: number) => (
						<div key={event.sequence ?? index}>
							<p>
								Called {event.call.workflowId} from{" "}
								{event.call.callerWorkflowId}/{event.call.step} · {event.at}
							</p>
							<pre>{JSON.stringify(event.call, null, 2)}</pre>
						</div>
					))}
				</details>
			)}
		</section>
	);
}
export function QuestionForm({ run }: { run: any }) {
	const toast = useToast();
	const questions: string[] = run.questions ?? [];
	const recommendations: Recommendation[] = run.questionRecommendations ?? [];
	const context = revisionOf([
		run.id,
		run.questionBatchId,
		questions,
		recommendations,
		run.step,
		run.status,
	]);
	const action = useAction(`answers/${run.id}`, context);
	const [draft, setDraft] = useFormState<AnswerDraft>(context, {});
	const fields = useRef<Record<number, HTMLTextAreaElement | null>>({});
	const submitting = useRef(false);
	const focusCustom = useRef<number | undefined>(undefined);
	useEffect(() => {
		if (focusCustom.current === undefined) return;
		fields.current[focusCustom.current]?.focus();
		focusCustom.current = undefined;
	});
	const answers = resolveAnswers(questions, recommendations, draft);
	const incomplete =
		!questions.length || answers.some((answer) => !answer.trim());
	const submit = async () => {
		if (
			submitting.current ||
			action.isPending ||
			action.isBlocked ||
			incomplete
		)
			return;
		submitting.current = true;
		try {
			await action.mutateAsync({
				path: `/api/runs/${run.id}/answer`,
				body: {
					context: {
						questions,
						step: run.step,
						questionBatchId: run.questionBatchId,
					},
					answer: serializeAnswers(questions, answers),
				},
			});
			setDraft({});
			toast({ text: "Reply sent" });
		} catch {
			/* error stays visible; draft is retained */
		} finally {
			submitting.current = false;
		}
	};
	return (
		<form
			className="question-form"
			onSubmit={(e) => {
				e.preventDefault();
				void submit();
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
					e.preventDefault();
					void submit();
				}
			}}
		>
			<fieldset disabled={action.isPending}>
				<legend className="sr-only">
					Answers to Bob's clarification questions
				</legend>
				{questions.map((q, i) => {
					const recommendation = recommendations.find(
						(item) => item.questionIndex === i,
					);
					const choice = answerChoice(draft[i], recommendation);
					const custom = !recommendation || choice.mode === "custom";
					const select = (mode: "custom" | "recommendation") => {
						if (mode === "custom") focusCustom.current = i;
						setDraft({ ...draft, [i]: { ...choice, mode } });
					};
					return (
						<div className="question" key={`${i}/${q}`}>
							<div className="question-heading">
								<Bob mood="alert" size={32} />
								<div
									id={`question-${run.id}-${i}`}
									className="question-content"
								>
									<Markdown>{q}</Markdown>
								</div>
							</div>
							<fieldset
								className="answer-controls"
								aria-labelledby={`question-${run.id}-${i}`}
							>
								<legend className="sr-only">
									Choose an answer for question {i + 1}
								</legend>
								{recommendation && (
									<>
										<div className="answer-modes">
											<label>
												<input
													type="radio"
													name={`answer-mode-${run.id}-${i}`}
													checked={!custom}
													onChange={() => select("recommendation")}
												/>
												Use recommendation
											</label>
											<label>
												<input
													type="radio"
													name={`answer-mode-${run.id}-${i}`}
													checked={custom}
													onChange={() => select("custom")}
												/>
												Custom answer
											</label>
										</div>
										<div className="answer-recommendation">
											<Markdown>{recommendation.answer}</Markdown>
											<div className="recommendation-reason">
												<Markdown>{recommendation.reason}</Markdown>
											</div>
										</div>
									</>
								)}
								{custom && (
									<textarea
										ref={(el) => {
											fields.current[i] = el;
										}}
										id={`answer-${run.id}-${i}`}
										aria-labelledby={`question-${run.id}-${i}`}
										required
										rows={2}
										placeholder="Type your answer…"
										value={choice.custom}
										onChange={(e) =>
											setDraft({
												...draft,
												[i]: { mode: "custom", custom: e.target.value },
											})
										}
									/>
								)}
							</fieldset>
						</div>
					);
				})}
			</fieldset>
			{action.error && (
				<p className="error" role="alert">
					{action.error.message}
				</p>
			)}
			<Button
				type="submit"
				requiresConnection
				busy={action.isPending}
				disabled={incomplete}
			>
				Send answers <kbd>⌘⏎</kbd>
			</Button>
		</form>
	);
}
export function ReviewEntry({ run }: { run: any }) {
	const guide = run.outputs.guide,
		gate = run.reviewGate,
		url = gate?.url ?? run.outputs["draft-pr"]?.url;
	return (
		<div className="review-entry">
			<p>
				{String(
					guide.verdict?.headline ??
						guide.summary ??
						guide.goal ??
						"Read the changes, evidence and final checks before deciding.",
				).slice(0, 320)}
			</p>
			<p className="muted">
				{gate?.status === "pending"
					? "Awaiting your review"
					: `Review guide · ${run.status}`}
				{gate?.headSha && (
					<>
						{" "}
						· revision <code>{gate.headSha.slice(0, 8)}</code>
					</>
				)}
			</p>
			<div className="actions">
				<Link
					className="button primary"
					to={`/runs/${run.id}/review`}
					state={{ focusRunId: run.id }}
				>
					Open review guide →
				</Link>
				<Link
					className="button ghost"
					to={`/runs/${run.id}`}
					state={{ focusRunId: run.id }}
				>
					Open run
				</Link>
				{url && (
					<External className="button secondary" href={url}>
						Open PR ↗
					</External>
				)}
			</div>
		</div>
	);
}

export function FullReview({
	run,
	onSettled,
	settling,
}: {
	run: any;
	onSettled: () => void;
	settling?: boolean;
}) {
	const guide = run.outputs.guide,
		version = `${run.reviewGate?.id ?? "historical"}/${run.reviewGate?.headSha ?? ""}/${guide?.__artifactHash ?? signature(guide)}`,
		previous = useRef(version),
		[updated, setUpdated] = useState(false);
	useEffect(() => {
		if (previous.current !== version) setUpdated(true);
		previous.current = version;
	}, [version]);
	return (
		<>
			{updated && (
				<p className="notice" role="status">
					This review has been updated. Review the current guide and revision
					before deciding. Unsent feedback has been discarded.
				</p>
			)}
			<GuidedReview
				value={guide}
				run={run}
				documentPage
				controls={(identity, decisionPage) => (
					<DecisionActions
						key={`${identity}/${run.reviewGate?.id ?? "finished"}`}
						identity={identity}
						decisionPage={decisionPage}
						run={run}
						onSettled={onSettled}
						settling={settling}
					/>
				)}
			/>
		</>
	);
}

type DecisionProps = {
	run: any;
	identity?: string;
	decisionPage?: boolean;
	onSettled: () => void;
	settling?: boolean;
};
function DecisionActions(props: DecisionProps) {
	const controller = useReviewFeedback();
	return controller ? (
		<ReviewDecisions {...props} controller={controller} />
	) : (
		<LocalDecisions {...props} />
	);
}
function LocalDecisions(props: DecisionProps) {
	const controller = useFeedbackController(
		feedbackKey(
			props.identity ?? `factory-review/${props.run.id}/finished`,
			props.run.reviewGate?.id,
		),
		revisionOf([props.run.reviewGate, props.run.status, props.run.chat?.mode]),
	);
	return <ReviewDecisions {...props} controller={controller} />;
}
function ReviewDecisions({
	run,
	identity = `factory-review/${run.id}/finished`,
	decisionPage = true,
	onSettled,
	settling,
	controller,
}: DecisionProps & { controller: FeedbackController }) {
	const toast = useToast(),
		navigate = useNavigate(),
		{ action, approve } = useApproval(run, controller),
		[validationError, setValidationError] = useFormState(
			controller.context,
			"",
		);
	const isCurrent = useCurrentForm(controller.context);
	const { draft, update, busy } = controller;
	const feedback = draft.feedback,
		feedbackOpen = draft.open;
	const setFeedback = (feedback: string) => update((d) => ({ ...d, feedback }));
	const setFeedbackOpen = (open: boolean) => update((d) => ({ ...d, open }));
	const guide = run.outputs?.guide,
		gate = run.reviewGate,
		waiting = gate?.status === "pending",
		matching = !waiting || (run.status === "waiting" && guideMatchesGate(run)),
		url = run.outputs?.["draft-pr"]?.url ?? gate?.url;
	const reject = async () => {
		if (!hasFeedback(draft) || busy || action.isPending || !matching) return;
		let feedback: string;
		try {
			feedback = serializeFeedback(
				draft,
				guide
					? {
							revision: reviewRevision(run) || "historical",
							goal:
								guide.verdict?.headline ??
								guide.goal ??
								guide.summary ??
								"Review guide",
							identity,
						}
					: undefined,
			);
			setValidationError("");
		} catch (error) {
			setValidationError((error as Error).message);
			return;
		}
		if (!controller.lock()) return;
		try {
			if (waiting) {
				await action.mutateAsync({
					path: `/api/runs/${run.id}/review`,
					body: {
						reviewId: gate.id,
						headSha: gate.headSha,
						decision: "reject",
						feedback,
					},
				});
			} else if (run.chat?.available && run.chat.mode === "continue") {
				await action.mutateAsync({
					path: `/api/runs/${run.id}/messages`,
					body: { text: feedback },
				});
				if (isCurrent()) navigate(`/runs/${run.id}`);
			} else {
				const next = await action.mutateAsync({
					path: `/api/runs/${run.id}/followup`,
					body: { feedback },
				});
				if (isCurrent()) navigate(`/runs/${next.id}`);
			}
			toast({ text: "Feedback sent — Bob is on it" });
			controller.clear(draft);
		} catch {
			/* error stays visible; the submitted draft is retained. */
		} finally {
			controller.unlock();
		}
	};
	return (
		<>
			{waiting && !matching && (
				<p className="notice" role="status">
					The pending revision changed. Decisions are unavailable until its
					matching guide is loaded.
				</p>
			)}
			{!guide && (
				<div className="final-message">
					<Bob mood="happy" size={32} />
					<Markdown>
						{activitiesOf(run)
							.filter((i) => i.type === "response" || i.type === "thought")
							.at(-1)?.body ?? "Bob finished this run."}
					</Markdown>
				</div>
			)}
			{(guide || feedbackOpen) && (
				<form
					className="feedback-form"
					onSubmit={(e) => {
						e.preventDefault();
						void reject();
					}}
				>
					{(!guide || decisionPage || feedbackOpen) && (
						<label>
							{guide ? "Additional feedback" : "What should Bob change?"}
							<textarea
								rows={guide ? 6 : 3}
								disabled={busy}
								placeholder="What else should Bob change?"
								value={feedback}
								onChange={(e) => setFeedback(e.target.value)}
							/>
						</label>
					)}
					<div className="actions">
						<Button
							type="submit"
							busy={busy || action.isPending}
							requiresConnection
							disabled={!hasFeedback(draft) || !matching}
						>
							Submit feedback to Bob
						</Button>
						{!decisionPage && (
							<Button
								variant="ghost"
								disabled={busy}
								onClick={() => setFeedbackOpen(!feedbackOpen)}
							>
								{feedbackOpen
									? "Hide additional feedback"
									: "Add additional feedback"}
							</Button>
						)}
						{!guide && (
							<Button
								variant="ghost"
								disabled={busy}
								onClick={() => {
									update(emptyFeedback);
									setValidationError("");
								}}
							>
								Cancel
							</Button>
						)}
					</div>
					{validationError && (
						<p className="error" role="alert">
							{validationError}
						</p>
					)}
				</form>
			)}
			{(guide || !feedbackOpen) && (
				<div className="actions">
					{(!guide || decisionPage) &&
						!["running", "interrupted"].includes(run.status) && (
							<Button
								variant={guide ? "rainbow" : "primary"}
								requiresConnection
								busy={busy || action.isPending || settling}
								disabled={
									busy || !matching || (!waiting && !finished(run.status))
								}
								onClick={() => {
									if (waiting) return approve();
									if (!matching || action.isPending || !controller.lock())
										return;
									onSettled();
									controller.unlock();
								}}
							>
								{waiting
									? "Approve this PR"
									: guide
										? "Settle"
										: "Got it — settle"}
							</Button>
						)}
					{waiting && (
						<Button
							variant="ghost"
							requiresConnection
							busy={busy || action.isPending}
							onClick={() => {
								if (!controller.lock()) return;
								void action
									.mutateAsync({
										path: `/api/runs/${run.id}/guide/refresh`,
										body: { reviewId: gate.id },
									})
									.then(() =>
										toast({
											text: "Refreshing the guide — existing reviews and images are retained",
										}),
									)
									.catch(() => {})
									.finally(() => controller.unlock());
							}}
						>
							Refresh guide
						</Button>
					)}
					{url && (
						<External className="button secondary" href={reviewDiffUrl(url)}>
							Open diff ↗
						</External>
					)}
					{url && (
						<External className="button secondary" href={url}>
							Open PR #{url.split("/").at(-1)} ↗
						</External>
					)}
					{!guide && (
						<Button
							variant="ghost"
							disabled={busy}
							onClick={() => setFeedbackOpen(true)}
						>
							Ask a follow-up
						</Button>
					)}
					{!guide && (
						<Link className="button ghost" to={`/runs/${run.id}`}>
							Open run
						</Link>
					)}
				</div>
			)}

			{waiting && (
				<small className="muted">
					Approval applies to {gate.headSha.slice(0, 8)}. Settles after the Git
					provider confirms the merge.
				</small>
			)}
			{action.error && (
				<p className="error" role="alert">
					{action.error.message}
				</p>
			)}
		</>
	);
}
export function FocusCard({
	summary,
	config,
	full = false,
	onInspect: _onInspect,
	onSettled,
	settling,
	onSkip,
	navigation,
}: {
	summary: any;
	config: any;
	full?: boolean;
	onInspect: (run: any, name: string, image?: number) => void;
	onSettled: () => void;
	settling?: boolean;
	onSkip?: () => void;
	navigation?: React.ReactNode;
}) {
	const detail = useRun(summary.id),
		run = detail.data ?? summary,
		kind = attention(run) ?? "review",
		toast = useToast(),
		action = useAction();
	return (
		<section
			className={`focus-card kind-${kind}`}
			aria-label={`${labels[kind]}: ${run.title}`}
		>
			<div className="focus-top">
				{!full && (
					<>
						<span className={`chip ${kind}`}>{labels[kind]}</span>
						<RunMeta run={run} config={config} />
						{navigation}
					</>
				)}
			</div>
			{!full && (
				<h2>
					<Link to={`/runs/${run.id}`}>{run.title}</Link>
				</h2>
			)}
			{detail.isLoading ? (
				<p role="status">Bob is loading this run…</p>
			) : kind === "question" ? (
				<QuestionForm
					key={`${run.id}/${JSON.stringify(run.questions)}`}
					run={run}
				/>
			) : kind === "stuck" ? (
				<>
					<div className="stuck-panel">
						<Bob mood="oops" size={48} />
						<div>
							<strong>
								{run.status === "interrupted" ? "Interrupted" : "Stuck"} at{" "}
								{icons[run.step?.split("/").at(-1)] ?? "⚙️"}{" "}
								{stepsOf(run, config).find((s) => s.key === run.step)?.name ??
									run.step ??
									"Bob’s Factory session"}
							</strong>
							<Markdown>
								{run.workflowBlock?.reason ??
									run.error ??
									"The run stopped before finishing."}
							</Markdown>
							<small>
								{run.workflowBlock
									? "Enable the workflow and its dependencies in Recipes. Resume continues this saved checkpoint after the previous executor stops."
									: run.iterationLimit
										? "Continue grants 4 more passes for this step. Your work and history stay intact."
										: "Retry keeps the worktree, your answers and every finished step."}
							</small>
						</div>
					</div>
					<div className="actions">
						<Button
							requiresConnection
							busy={action.isPending}
							disabled={!!run.workflowBlock && !run.resumeEligible}
							onClick={() =>
								void action
									.mutateAsync({
										path: `/api/runs/${run.id}/${run.workflowBlock ? "resume" : "retry"}`,
									})
									.then(() => toast({ text: "Retrying from saved progress" }))
									.catch(() => {})
							}
						>
							↻{" "}
							{run.workflowBlock
								? "Resume"
								: run.iterationLimit
									? "Continue (+4 passes)"
									: "Retry step"}{" "}
							<kbd>r</kbd>
						</Button>
						<Link className="button secondary" to={`/runs/${run.id}`}>
							What happened?
						</Link>
						<Button variant="ghost" busy={settling} onClick={onSettled}>
							Settle <kbd>e</kbd>
						</Button>
					</div>
					{action.error && (
						<p className="error" role="alert">
							{action.error.message}
						</p>
					)}
				</>
			) : run.outputs?.guide ? (
				<ReviewEntry run={run} />
			) : (
				<DecisionActions
					key={`${run.id}/${run.reviewGate?.id ?? "finished"}`}
					run={run}
					onSettled={onSettled}
					settling={settling}
				/>
			)}
			{onSkip && (
				<Button variant="ghost" className="skip-action" onClick={onSkip}>
					{kind === "review" ? "Later" : "Skip for now"} <kbd>s</kbd>
				</Button>
			)}
		</section>
	);
}
export function Progress({ run, config }: { run: any; config: any }) {
	const steps = stepsOf(run, config),
		visited = new Set(run.history?.map((h: any) => h.step));
	return (
		<span
			className={`progress ${!steps.length ? "single" : ""}`}
			role="img"
			aria-label={
				steps.length
					? `${visited.size} of ${steps.length} steps completed`
					: "Bob’s Factory session working"
			}
		>
			{(steps.length ? steps : [{ key: "simple" }]).map((step) => (
				<i
					key={step.key}
					className={
						run.capacityLeaves?.[step.key] ||
						run.step === step.key ||
						(!steps.length && active(run.status))
							? ["failed", "error"].includes(run.status)
								? "failed"
								: "current"
							: visited.has(step.key)
								? "done"
								: ""
					}
				/>
			))}
		</span>
	);
}
export function WorkingRow({
	run,
	config,
	expanded,
	onExpand,
}: {
	run: any;
	config: any;
	expanded: boolean;
	onExpand: () => void;
}) {
	const detail = useRun(expanded ? run.id : undefined),
		data = detail.data ?? run,
		action = useAction(),
		toast = useToast(),
		step = stepsOf(data, config).find((s) => s.key === data.step),
		stepId = run.step?.split("/").at(-1) ?? "simple",
		latest = expanded ? activitiesOf(data).at(-1) : undefined;
	const visits =
		(data.history ?? []).filter((h: any) => h.step === data.step).length + 1;
	return (
		<article className="working-row">
			<button
				type="button"
				className="working-main"
				aria-expanded={expanded}
				onClick={onExpand}
			>
				<span className="repo-dot" />
				<strong>{run.title}</strong>
				<span className={`step-chip ${phase(stepId)}`}>
					{workingLabel(data)} · {icons[stepId] ?? "⚙️"}{" "}
					{step?.name ?? run.step ?? "Bob’s Factory session"}
					{/fix/.test(stepId) && " · fixing"}
					{visits > 1 && ` · ↺${visits}`}
				</span>
				<Progress run={data} config={config} />
				<small>{elapsed(run.createdAt)}</small>
			</button>
			{expanded && (
				<div className="working-peek">
					<small>LATEST</small>
					<Markdown>
						{latest?.body ??
							`${latest?.title ?? "Bob is working"} ${latest?.parameter ?? ""}`}
					</Markdown>
					{data.outputs?.["merge-readiness"]?.blockers?.length > 0 && (
						<ul>
							{data.outputs["merge-readiness"].blockers.map(
								(b: any, i: number) => (
									<li key={i}>{b.message}</li>
								),
							)}
						</ul>
					)}
					<div className="actions">
						<Link className="button secondary" to={`/runs/${run.id}`}>
							Open run
						</Link>
						<ConfirmStop
							requiresConnection
							busy={action.isPending}
							onStop={() =>
								void action
									.mutateAsync({ path: `/api/runs/${run.id}/stop` })
									.then(() => toast({ text: "Run stopped" }))
									.catch(() => {})
							}
						/>
					</div>
					{action.error && <p role="alert">{action.error.message}</p>}
				</div>
			)}
		</article>
	);
}
