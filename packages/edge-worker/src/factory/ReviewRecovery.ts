import { createHash } from "node:crypto";
import { feedbackInstructionFingerprint } from "./FeedbackPolicy.js";
import type { RoleRevision } from "./Incremental.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

interface Finding {
	id: string;
	rating: number;
	status: string;
	summary: string;
	evidence: string;
}
interface FixAssessment {
	fingerprint: string;
	headSha?: string;
	unchangedCode: boolean;
	instructionsSha256: string;
}

export const reviewFixInstructions = `Read /reviewFix/findings for ALL unresolved consequential findings, even when customized recipe inputs hide the gate. Return a fixed or evidence-backed rejected disposition for each finding you can address. If missing deployment, access, fixtures, evidence or a necessary decision prevents progress, return questions:["specific assistance needed"] alongside summary and dispositions; asking only in summary does not pause the workflow. Never mark blocked findings fixed or rejected merely to advance. Return questions:[] when assistance is unnecessary. Read /reviewFix/answers before retrying. An answer does not waive findings, required QA or approval. A rejected complaint still receives reviewer reassessment.`;

function openFindings(value: unknown): Finding[] {
	const findings = (value as { findings?: Finding[] } | undefined)?.findings;
	return Array.isArray(findings)
		? findings.filter(
				(finding) => finding.rating > 1 && finding.status === "open",
			)
		: [];
}
function findingFingerprint(findings: Finding[]): string {
	// Stable IDs survive wording, timestamps and new probes of the same blocker.
	return createHash("sha256")
		.update(
			JSON.stringify(findings.map(({ id, rating }) => [id, rating]).sort()),
		)
		.digest("hex");
}
export function factoryReviewFixContext(context: ExecutionContext) {
	const gate = context.step.id === "visual-fix" ? "visual-gate" : "review-gate";
	return {
		findings: openFindings(context.run.outputs[gate]),
		answers: context.run.answers ?? [],
	};
}
/** Missing dispositions are corrected inside the role rather than replaying review. */
export function validateReviewFix(
	context: ExecutionContext,
	output: unknown,
): void {
	const value = output as {
		dispositions: { id: string }[];
		questions?: string[];
	};
	const missing = factoryReviewFixContext(context).findings.filter(
		(finding) => !value.dispositions.some((item) => item.id === finding.id),
	);
	if (missing.length && !value.questions?.length)
		throw new Error(
			`Disposition every unresolved finding or return questions for assistance. Missing finding IDs: ${missing.map((finding) => finding.id).join(", ")}`,
		);
}
/** Persist runtime-owned before/after provenance, independent of agent claims. */
export function recordReviewFix(
	context: ExecutionContext,
	output: unknown,
	completed?: RoleRevision,
) {
	const prefix = (context.run.step ?? context.step.id).replace(/[^/]+$/, "");
	const source =
		context.step.id === "visual-fix" ? "visual-review" : "code-review";
	const started = context.run.roleRevisions?.[`${prefix}${source}`];
	return {
		...(output as Record<string, unknown>),
		reviewAssessment: {
			fingerprint: findingFingerprint(
				factoryReviewFixContext(context).findings,
			),
			headSha: completed?.headSha,
			unchangedCode: Boolean(
				started &&
					completed &&
					!started.dirty &&
					!completed.dirty &&
					started.headSha === completed.headSha,
			),
			instructionsSha256: feedbackInstructionFingerprint(context),
		} satisfies FixAssessment,
	};
}
/** A rejected unchanged attempt needs new direction, not another automatic cycle. */
export function reviewRecoveryQuestions(
	context: ExecutionContext,
	gate: unknown,
	revision: { headSha: string; dirty: boolean },
): string[] {
	const findings = openFindings(gate);
	if (!findings.length || revision.dirty) return [];
	const visual = context.step.tool === "visual-gate";
	const prefix = (context.run.step ?? context.step.id).replace(/[^/]+$/, "");
	const fixer = visual ? "visual-fix" : "code-fix";
	const previous = [...context.run.history]
		.reverse()
		.find((item) => item.step === `${prefix}${fixer}`);
	const assessed = (
		previous?.output as { reviewAssessment?: FixAssessment } | undefined
	)?.reviewAssessment;
	if (
		!assessed?.unchangedCode ||
		assessed.headSha !== revision.headSha ||
		assessed.fingerprint !== findingFingerprint(findings) ||
		assessed.instructionsSha256 !== feedbackInstructionFingerprint(context)
	)
		return [];
	return [
		`Review still rejects the same findings after an unchanged fix attempt:\n\n${findings.map((finding) => `${finding.id}: ${finding.summary}\n${finding.evidence}`).join("\n\n")}\n\nProvide the missing access, deployment, evidence or corrective direction before retrying. Your answer resumes the existing fixer; these findings and required validation remain blocking.`,
	];
}
