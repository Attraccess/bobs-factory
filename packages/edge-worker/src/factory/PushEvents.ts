import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { MergeReadiness } from "./MergeReadiness.js";
import type { FactoryRun, GraphCheckpoint } from "./WorkflowRuntime.js";

export type PushCategory =
	| "question"
	| "review"
	| "failure"
	| "blocker"
	| "completion"
	| "test";
export interface PushEvent {
	category: PushCategory;
	identity: string;
	destination: string;
}
export const digest = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("base64url");
function questionSource(
	checkpoint: GraphCheckpoint | undefined,
	questions: string[],
): string[] | undefined {
	const display = checkpoint?.active?.questionDisplay;
	// A rephrasing changes presentation, while its saved source remains the decision.
	// Match the displayed questions so stale provenance cannot hide new attention.
	if (display?.source && isDeepStrictEqual(display.questions, questions))
		return display.source.questions;
	for (const child of checkpoint?.active?.children ?? []) {
		const source = questionSource(child, questions);
		if (source) return source;
	}
	return undefined;
}
export function runPushEvent(run: FactoryRun): PushEvent | undefined {
	const destination = `/#/runs/${encodeURIComponent(run.id)}`;
	// Ticket preparation temporarily marks restored waits as running. Unanswered
	// questions and pending gates remain authoritative until answer/decide clears them.
	const unresolved = run.status === "waiting" || run.status === "running";
	if (unresolved && run.architectureGate)
		return {
			category: "question",
			identity: digest(["architecture", run.architectureGate.proposalId]),
			destination,
		};
	if (unresolved && run.reviewGate?.status === "pending")
		return {
			category: "review",
			identity: digest([run.reviewGate.id, run.reviewGate.headSha]),
			destination: `${destination}/review`,
		};
	if (unresolved && run.questions.length)
		return {
			category: "question",
			identity: digest([
				run.step,
				run.answers.length,
				[
					...(questionSource(run.checkpoint, run.questions) ?? run.questions),
				].sort(),
			]),
			destination,
		};
	if (["failed", "interrupted"].includes(run.status))
		return {
			category: "failure",
			identity: digest([run.status, run.step, run.checkpoint?.visits]),
			destination,
		};
	if (run.status === "completed")
		return { category: "completion", identity: "completed", destination };
	const readiness = run.outputs["merge-readiness"] as
		| MergeReadiness
		| undefined;
	const human = readiness?.blockers?.filter(
		(b) =>
			b.action === "human" &&
			!(b.kind === "draft" && run.reviewGate?.headSha === readiness.headSha),
	);
	// Mixed automated fix/wait states are still recovering. Explicit human-only blocks need attention.
	if (
		run.status === "running" &&
		human?.length &&
		readiness?.blockers.every((b) => b.action === "human")
	)
		return {
			category: "blocker",
			identity: digest([
				readiness.headSha,
				human.map((b) => [b.kind, b.message]),
			]),
			destination,
		};
	return undefined;
}
export interface PushSession {
	id: string;
	status: string;
	stopped?: boolean;
	recovering?: boolean;
	pendingWork?: boolean;
}
export function sessionPushEvent(session: PushSession): PushEvent | undefined {
	if (session.stopped || session.recovering) return undefined;
	// A successful turn can leave scheduled wakeups or background tasks in flight.
	if (session.status === "complete" && session.pendingWork) return undefined;
	const category =
		session.status === "complete"
			? "completion"
			: session.status === "error"
				? "failure"
				: session.status === "awaitingInput"
					? "question"
					: undefined;
	return category
		? {
				category,
				identity: session.status,
				destination: `/#/runs/${encodeURIComponent(session.id)}`,
			}
		: undefined;
}
