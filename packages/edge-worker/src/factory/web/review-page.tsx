import { useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { useRun } from "./client";
import { FullReview, RunMeta } from "./focus";
import { ReviewContextRow } from "./review-context-row";
import { useReviewInput } from "./review-input";
import { writeTextStored } from "./review-state";
import { Button } from "./ui";

export function ReviewPage({
	config,
	onSettled,
	settling,
}: {
	config: any;
	onSettled: (run: any) => void;
	settling?: boolean;
}) {
	useReviewInput();
	const { id } = useParams(),
		query = useRun(id),
		run = query.data,
		heading = useRef<HTMLHeadingElement>(null),
		hasRun = Boolean(run);
	useEffect(() => {
		if (hasRun) heading.current?.focus({ preventScroll: true });
		// Direct links also have a return target when this run is still eligible.
		if (id) writeTextStored("bob-selected", id, true);
	}, [id, hasRun]);
	if (query.isLoading) return <p role="status">Loading the review guide…</p>;
	if (!run)
		return (
			<>
				<h1>
					{query.error?.message === "Run not found"
						? "Run not found"
						: "Could not load this run"}
				</h1>
				{query.error && <p role="alert">{query.error.message}</p>}
				<Button variant="secondary" onClick={() => void query.refetch()}>
					Try again
				</Button>
				<Link className="back-link" to="/">
					← Today
				</Link>
			</>
		);
	const gate = run.reviewGate,
		guide = run.outputs?.guide,
		complete = ["complete", "completed"].includes(run.status);
	return (
		<div className="review-document">
			<nav className="review-links" aria-label="Review navigation">
				<Link to="/" state={{ focusRunId: run.id }}>
					← Back to Today
				</Link>
				<Link to={`/runs/${run.id}`} state={{ focusRunId: run.id }}>
					Run story →
				</Link>
			</nav>
			<header className="run-header">
				<div>
					<small className="muted">REVIEW GUIDE</small>
					<h1 ref={heading} tabIndex={-1}>
						{run.title}
					</h1>
					<div className="run-page-meta">
						<span className="chip review">
							{gate?.status === "pending" ? "Awaiting your review" : run.status}
						</span>
						<RunMeta run={run} config={config} />
						{gate?.headSha && (
							<span>
								Revision <code>{gate.headSha.slice(0, 8)}</code>
							</span>
						)}
					</div>
					<ReviewContextRow key={run.id} run={run} />
				</div>
			</header>
			{query.error && (
				<p className="connection-error" role="alert">
					Could not refresh this run: {query.error.message}. Showing the last
					loaded review.
				</p>
			)}
			{guide && gate?.status !== "pending" && (
				<p className="notice" role="status">
					{gate?.status === "approve"
						? complete
							? "This revision was approved. The run is complete."
							: "You approved this revision. Bob is checking merge criteria."
						: gate?.status === "reject"
							? "Changes were requested for this revision."
							: "This guide remains available for reading."}{" "}
					{complete
						? "You can settle the run or send a follow-up."
						: "Approval is available only while a matching review is pending."}
				</p>
			)}
			{guide ? (
				<div className="review-surface">
					<FullReview
						run={run}
						onSettled={() => onSettled(run)}
						settling={settling}
					/>
				</div>
			) : (
				<div className="review-surface">
					<h2>No review guide yet</h2>
					<p>
						This run has no guide to read. Open its story for questions,
						progress and follow-up actions.
					</p>
					<Link className="button secondary" to={`/runs/${run.id}`}>
						Open run
					</Link>
				</div>
			)}
		</div>
	);
}
