import { useQueryClient } from "@tanstack/react-query";
import type { Architecture, ArchitectureProposal } from "../Architecture";
import { useAction } from "./client";
import { useFormState } from "./form-state";
import { SystemMap } from "./review-visuals";
import { Button, Markdown } from "./ui";

export function ArchitectureContent({ content }: { content: Architecture }) {
	return (
		<>
			<p>
				<strong>
					{content.classification === "routine"
						? "Routine change"
						: "Architecture choice"}
				</strong>{" "}
				· {content.rationale}
			</p>
			<Markdown>{content.recommendation}</Markdown>
			{content.visual && (
				<section>
					<h3>Responsibilities and interfaces</h3>
					<p>{content.visual.explanation}</p>
					<SystemMap system={content.visual.system} afterOnly />
				</section>
			)}
			<ul>
				{content.interfaces.map((item, i) => (
					<li key={i}>{item}</li>
				))}
			</ul>
			<h3>Repository evidence</h3>
			{content.evidence.map((item, i) => (
				<p key={i}>
					<strong>{item.repository}</strong> · {item.paths.join(", ")}
					<br />
					{item.observation}
				</p>
			))}
			<h3>Alternatives and trade-offs</h3>
			{content.alternatives.map((item, i) => (
				<p key={i}>
					<strong>{item.option}</strong>
					<br />
					{item.tradeoffs}
				</p>
			))}
			{content.risks.length > 0 && (
				<>
					<h3>Risks</h3>
					<ul>
						{content.risks.map((item, i) => (
							<li key={i}>{item}</li>
						))}
					</ul>
				</>
			)}
			{content.unresolvedDecisions.length > 0 && (
				<>
					<h3>Unresolved decisions</h3>
					<ul>
						{content.unresolvedDecisions.map((item, i) => (
							<li key={i}>{item}</li>
						))}
					</ul>
				</>
			)}
			<details>
				<summary>Complete candidate implementation plan and assets</summary>
				<Markdown>{content.candidate.plan}</Markdown>
				<ul>
					{content.candidate.assets.map((item, i) => (
						<li key={i}>
							{item.purpose}: <code>{item.path}</code>
						</li>
					))}
				</ul>
			</details>
		</>
	);
}
export function ArchitecturePanel({ run }: { run: any }) {
	const proposals: ArchitectureProposal[] = run.architectureProposals ?? [];
	const proposal = proposals.at(-1);
	const context = `${run.id}/${proposal?.id}/${proposal?.digest}/${proposal?.status}/${run.status}`;
	const [feedback, setFeedback] = useFormState(context, "");
	const [error, setError] = useFormState<string | undefined>(
		context,
		undefined,
	);
	const action = useAction(`architecture:${run.id}`, context);
	const cache = useQueryClient();
	if (!proposal) return null;
	const pending =
		run.status === "waiting" &&
		run.architectureGate?.proposalId === proposal.id &&
		proposal.status === "pending";
	const submit = async (decision: "accept" | "revise" | "explain") => {
		try {
			await action.mutateAsync({
				path: `/api/runs/${run.id}/architecture-decision`,
				body: {
					proposalId: proposal.id,
					version: proposal.version,
					digest: proposal.digest,
					decision,
					...(decision === "accept" ? {} : { feedback }),
				},
			});
			setFeedback("");
			setError(undefined);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			void cache.invalidateQueries({ queryKey: ["run", run.id] });
		}
	};
	return (
		<section className="review-surface" aria-label="Architecture proposal">
			<h2>Architecture proposal · version {proposal.version}</h2>
			<p role="status">
				{proposal.status === "routine"
					? "Approval bypass recorded"
					: proposal.status}
			</p>
			{proposal.bypassReason && <p>{proposal.bypassReason}</p>}
			<ArchitectureContent content={proposal.content} />
			{proposal.feedback.map((item, i) => (
				<p key={i}>
					<strong>{item.kind}:</strong> {item.text}
				</p>
			))}
			{run.questions?.length > 0 && pending && (
				<div>
					{run.questions.map((q: string, i: number) => (
						<Markdown key={i}>{q}</Markdown>
					))}
				</div>
			)}
			{run.status === "stopped" &&
				run.architectureGate?.proposalId === proposal.id && (
					<Button
						requiresConnection
						disabled={action.isPending}
						onClick={() =>
							void action
								.mutateAsync({ path: `/api/runs/${run.id}/retry` })
								.catch((e) => setError(String(e)))
						}
					>
						Resume proposal discussion
					</Button>
				)}
			{pending && (
				<>
					<p>
						Acceptance authorizes implementation of this exact plan and assets.
						Final PR review remains a separate decision.
					</p>
					<label>
						Feedback or explanation request
						<textarea
							value={feedback}
							onChange={(e) => setFeedback(e.target.value)}
							rows={4}
						/>
					</label>
					<div className="actions">
						<Button
							requiresConnection
							disabled={action.isPending}
							onClick={() => void submit("accept")}
						>
							Accept proposal
						</Button>
						<Button
							requiresConnection
							variant="ghost"
							disabled={action.isPending || !feedback.trim()}
							onClick={() => void submit("revise")}
						>
							Request changes
						</Button>
						<Button
							requiresConnection
							variant="ghost"
							disabled={action.isPending || !feedback.trim()}
							onClick={() => void submit("explain")}
						>
							Explain
						</Button>
					</div>
					{error && (
						<p className="error" role="alert">
							{error}
						</p>
					)}
				</>
			)}
			{proposals.length > 1 && (
				<details>
					<summary>Previous proposal versions</summary>
					{proposals.slice(0, -1).map((p) => (
						<details key={p.id}>
							<summary>
								Version {p.version} · {p.status}
							</summary>
							<ArchitectureContent content={p.content} />
							{p.feedback.map((item, i) => (
								<p key={i}>
									{item.kind}: {item.text}
								</p>
							))}
						</details>
					))}
				</details>
			)}
		</section>
	);
}
