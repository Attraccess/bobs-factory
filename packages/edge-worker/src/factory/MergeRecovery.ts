import { readPath, type WorkflowStep } from "./Workflow.js";
import type { FactoryRun, GraphCheckpoint } from "./WorkflowRuntime.js";

/** Locate a merge candidate; the confirmed receipt must validate its terminal route. */
export function pendingMergeConfirmation(
	run: FactoryRun,
	output?: unknown,
):
	| { checkpoint: GraphCheckpoint; step: WorkflowStep; key: string }
	| undefined {
	const finishes = (
		steps: WorkflowStep[],
		step: WorkflowStep,
		output: unknown,
	) =>
		(step.branches.find(
			(branch) =>
				JSON.stringify(readPath(output, branch.when.path)) ===
				JSON.stringify(branch.when.equals),
		)?.next ??
			step.next ??
			steps[steps.indexOf(step) + 1]?.id ??
			"end") === "end";
	const find = (
		checkpoint: GraphCheckpoint | undefined,
		steps: WorkflowStep[],
		prefix: string,
	): ReturnType<typeof pendingMergeConfirmation> => {
		if (
			!checkpoint?.active ||
			!["executing", "result"].includes(checkpoint.active.phase)
		)
			return;
		const step = steps.find((item) => item.id === checkpoint.current);
		if (!step) return;
		const key = `${prefix}${step.id}`;
		if (
			step.type === "tool" &&
			step.tool === "merge" &&
			key === run.step &&
			(!output || finishes(steps, step, output))
		)
			return { checkpoint, step, key };
		if (
			step.type === "workflow" &&
			checkpoint.active.phase === "executing" &&
			finishes(steps, step, { workflow: step.workflow, completed: true })
		) {
			const child = run.workflowDefinitions?.find(
				(item) => item.id === step.workflow,
			);
			if (child)
				return find(checkpoint.active.children?.[0], child.steps, `${key}/`);
		}
		return undefined;
	};
	return find(run.checkpoint, run.workflow.steps, "");
}

/** A merged provider revision is authoritative even after local cleanup. */
export function confirmedMerge(
	run: FactoryRun,
	pr: { state: string; headSha: string },
): { merged: true; url: string; headSha: string } | undefined {
	if (pr.state !== "MERGED") return;
	const approval = run.humanDecisions?.at(-1);
	const url = readPath(run.outputs, "draft-pr.url");
	if (
		approval?.decision !== "approve" ||
		typeof pr.headSha !== "string" ||
		!pr.headSha ||
		approval.headSha !== pr.headSha ||
		typeof url !== "string" ||
		!url
	)
		throw new Error(
			"Merged PR does not match the explicitly approved revision",
		);
	return { merged: true, url, headSha: pr.headSha };
}
