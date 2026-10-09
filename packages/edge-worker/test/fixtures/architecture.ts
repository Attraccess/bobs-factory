import type { Architecture } from "../../src/factory/Architecture.js";
export function proposal(
	classification: Architecture["classification"] = "meaningful",
): Architecture {
	return {
		architectureContract: "architecture-v1",
		classification,
		rationale:
			"Keep the runtime checkpoint as the owner of the approval boundary.",
		evidence: [
			{
				repository: "bobs-factory",
				paths: ["src/factory/WorkflowRuntime.ts"],
				observation: "Checkpoints persist graph transitions.",
			},
		],
		recommendation:
			"Persist the proposal alongside the checkpoint; keep merge approval separate.",
		interfaces: ["Decision accepts an exact proposal digest"],
		alternatives: [
			{
				option: "Reuse PR approval",
				tradeoffs: "Couples design authorization to a published revision.",
			},
		],
		risks: ["Recovery can replay a transition"],
		unresolvedDecisions: [],
		visual: {
			explanation: "A proposal is reviewed before a human accepts it.",
			system: {
				lanes: [
					{ id: "runtime", name: "Runtime" },
					{ id: "human", name: "Human" },
				],
				parts: [
					{
						id: "proposal",
						label: "Proposal",
						laneId: "runtime",
						status: "new",
					},
					{
						id: "decision",
						label: "Acceptance",
						laneId: "human",
						status: "new",
					},
				],
				before: [],
				after: [
					{ source: "proposal", target: "decision", label: "Exact version" },
				],
			},
		},
		candidate: {
			plan: "Preserve existing PR https://github.com/JappyJan/bobs-factory/pull/90 and branch existing. Implement the approved runtime boundary. Validate restart and rejection.",
			assets: [],
		},
	};
}
