import { createHash } from "node:crypto";
import type { MergeReadiness } from "./MergeReadiness.js";
import type { FactoryRun } from "./WorkflowRuntime.js";

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
export function runPushEvent(run: FactoryRun): PushEvent | undefined {
	const destination = `/#/runs/${encodeURIComponent(run.id)}`;
	if (run.status === "waiting" && run.reviewGate?.status === "pending")
		return {
			category: "review",
			identity: digest([run.reviewGate.id, run.reviewGate.headSha]),
			destination: `${destination}/review`,
		};
	if (run.status === "waiting" && run.questions.length)
		return {
			category: "question",
			identity: digest([
				run.step,
				run.answers.length,
				[...run.questions].sort(),
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
}
export function sessionPushEvent(session: PushSession): PushEvent | undefined {
	if (session.stopped || session.recovering) return undefined;
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
