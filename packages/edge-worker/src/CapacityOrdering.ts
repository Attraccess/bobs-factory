import type { CapacityWorkflow } from "bobs-factory-core";

/** Exchange only eligible workflow positions; consumed positions never return. */
export function orderWorkflowPositions<
	T extends {
		sequence: number;
		admissionPosition?: number;
		background: boolean;
		workflowRun?: CapacityWorkflow;
	},
>(eligible: T[]): void {
	for (const request of eligible)
		request.admissionPosition ??= request.sequence;
	const workflows = eligible.filter((r) => !r.background && r.workflowRun);
	const positions = workflows
		.map((r) => r.admissionPosition!)
		.sort((a, b) => a - b);
	workflows.sort(
		(a, b) =>
			Date.parse(a.workflowRun!.createdAt) -
				Date.parse(b.workflowRun!.createdAt) ||
			(a.workflowRun!.identity < b.workflowRun!.identity
				? -1
				: a.workflowRun!.identity > b.workflowRun!.identity
					? 1
					: 0) ||
			a.sequence - b.sequence,
	);
	workflows.forEach((r, i) => {
		r.admissionPosition = positions[i]!;
	});
	eligible.sort((a, b) => a.admissionPosition! - b.admissionPosition!);
}
