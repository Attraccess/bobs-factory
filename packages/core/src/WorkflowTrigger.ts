/** Launch permissions are independent; assignment and mention share one permission. */
export type WorkflowTrigger = "workflow" | "manual" | "ticket-assignment";

/** A receipt of the original launch, never replaced by subsequent replies. */
export interface WorkflowTriggerOrigin {
	type: "manual" | "ticket-assignment";
	workflowId: string;
	selectionMethod?: "explicit" | "label" | "default";
	at: string;
	manual?: { method: "composer-api" | "follow-up"; sourceRunId?: string };
	ticket?: {
		provider: "linear" | "cli";
		subtype?: "assignment" | "mention";
		workspaceId: string;
		issueId: string;
		identifier?: string;
		url?: string;
		agentSessionId: string;
		commentId?: string;
		activityId?: string;
		eventId?: string;
		sourceTimestamp?: string;
	};
}
