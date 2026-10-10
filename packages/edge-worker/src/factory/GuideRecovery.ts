import { createHash } from "node:crypto";
import type { Guide } from "./FactoryResults.js";
import { feedbackInstructionFingerprint } from "./FeedbackPolicy.js";
import type { MergeReadiness } from "./MergeReadiness.js";
import { groupedOutput } from "./RepositoryScope.js";
import {
	guideGaps,
	guideReady,
	guideWhy,
	isReviewBrief,
} from "./ReviewBrief.js";
import { readPath } from "./Workflow.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

export const guideGapFixInstructions = `Read /feedback/handoff and /feedback/guide for unresolved human-guide requirements and delivery gaps. Correct every actionable gap against the accepted plan, including PR continuity and description reconciliation, and provide concrete evidence for the next guide. Do not silently substitute a PR, waive scope, upgrade unsupported evidence, or rewrite the guide to claim success. Missing access, a replacement-PR decision, tracker conflicts owned by the runtime, or other human-only actions require specific questions alongside summary and checks. Read /feedback/userInstructions for the original input and human answers before retrying, even when recipe inputs are restricted. Set reviewRequired=true for changed requirements, source changes or disputed scope; metadata-only corrections may set false when accepted requirements and code are unchanged. The pipeline rebuilds the guide and rechecks readiness; human approval remains required.`;

/** A guide is another source of corrective work, rather than a terminal failure. */
export function guideGapRecovery(
	context: ExecutionContext,
	readiness: MergeReadiness,
): MergeReadiness | undefined {
	const guide = context.run.outputs.guide;
	if (!isReviewBrief(guide) && !(guide as Partial<Guide> | undefined)?.decision)
		return;
	const gaps = guideGaps(guide);
	const ready = guideReady(guide);
	if (ready && !gaps.length) return;
	const correction = context.step.branches.find(
		(branch) =>
			branch.when.path === "fix" &&
			branch.when.equals === true &&
			branch.next !== "end",
	);
	if (!correction)
		throw new Error(
			"Review guide reports unresolved gaps; handoff blocked: configure a correction route",
		);

	const fingerprint = createHash("sha256")
		.update(
			JSON.stringify({
				url: readiness.url,
				headSha: readiness.headSha,
				baseSha: readiness.baseSha,
				instructions: feedbackInstructionFingerprint(context),
				gaps: gaps.length
					? gaps.map((gap) => [gap.id, gap.status]).sort()
					: isReviewBrief(guide)
						? guide.verdict.readiness
						: (guide as Partial<Guide>).decision?.status,
			}),
		)
		.digest("hex");
	const key = context.stepKey ?? context.run.step ?? context.step.id;
	const repeated = context.run.history.some((item, index, history) => {
		if (item.step !== key) return false;
		const previous =
			groupedOutput(item.output)?.deliveries.find(
				(delivery) => delivery.output.url === readiness.url,
			)?.output ?? item.output;
		return (
			readPath(previous, "guideRecovery.fingerprint") === fingerprint &&
			readPath(previous, "fix") === true &&
			history
				.slice(index + 1)
				.some(
					(entry) =>
						entry.step === `${key.replace(/[^/]+$/, "")}${correction.next}`,
				)
		);
	});
	const message = [guideWhy(guide), ...gaps.map((gap) => gap.line)].join(
		"\n\n",
	);
	context.log(
		repeated
			? "The same guide gaps remain after correction; waiting for specific assistance."
			: "Review guide found unresolved gaps; returning to the configured fixer.",
	);
	return {
		...readiness,
		approved: false,
		reviewReady: false,
		fix: !repeated,
		blockers: [
			...readiness.blockers,
			{ kind: "guide", action: repeated ? "human" : "fix", message },
		],
		guideRecovery: { fingerprint },
		...(repeated
			? {
					ciAssistance: [
						`The same guide gaps remain after a corrective attempt:\n\n${message}\n\nProvide the missing access, evidence or accepted delivery decision. Your answer resumes correction; it does not waive requirements or approve this revision.`,
					],
				}
			: {}),
	};
}
