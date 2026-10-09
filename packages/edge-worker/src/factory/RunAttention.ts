// Shared by the web dashboard and the terminal UI: which runs need the operator,
// which are still working, and which have settled out of Today.

/** The subset of /api/runs items these rules read. */
export interface RunSummary {
	id?: string;
	status: string;
	createdAt: string;
	updatedAt?: string;
	capacityLeaves?: Record<string, { phase: string }>;
	deliveryCoordination?: { phase: string; reason?: string };
	reviewGate?: { status?: string };
	viewState?: { settledAt?: string; seenAt?: string; keptOpen?: boolean };
	triggerOrigin?: { manual?: { sourceRunId?: string } };
	hasGuide?: boolean;
	outputs?: { guide?: unknown };
}
export type Attention = "question" | "stuck" | "review";

export const finished = (status: string) =>
	[
		"completed",
		"complete",
		"failed",
		"error",
		"interrupted",
		"stopped",
		"cancelled",
	].includes(status);
export const active = (status: string) =>
	["running", "active", "waiting", "capacity-waiting", "stopping"].includes(
		status,
	);
export function capacityPhaseLabel(phase?: string): string {
	if (phase === "waiting-human") return "Waiting for review";
	return phase === "queued"
		? "Waiting for capacity"
		: phase === "waiting-ci"
			? "Waiting for CI"
			: phase === "stopping"
				? "Stopping"
				: "Executing";
}
/** Persisted target keys stay stable; operational surfaces show their actual meaning. */
export function deliveryTargetLabel(target: string): string {
	try {
		const parts: unknown = JSON.parse(target);
		if (
			Array.isArray(parts) &&
			parts.length === 2 &&
			parts.every((part) => typeof part === "string")
		) {
			if (parts[0] === "resource") return `Shared resource ${parts[1]}`;
			if (parts[0] === "qa") return `QA environment for ${parts[1]}`;
			return `${parts[0]} → ${parts[1]}`;
		}
	} catch {
		/* Legacy keys remain readable without changing reservation identity. */
	}
	return target;
}
export function workingLabel(run: RunSummary): string {
	if (run.deliveryCoordination?.phase === "queued")
		return run.deliveryCoordination.reason === "Shared QA/environment resource"
			? "Waiting for shared QA environment"
			: "Waiting for delivery admission";
	if (run.status === "capacity-waiting") return "Waiting for capacity";
	if (run.status === "stopping") return "Stopping";
	const leaves = Object.values(run.capacityLeaves ?? {}) as { phase: string }[];
	return leaves.length && leaves.every((leaf) => leaf.phase === "waiting-ci")
		? "Waiting for CI"
		: "Working";
}
export function settleReason(
	run: RunSummary,
	runs: RunSummary[],
	now = Date.now(),
): string | undefined {
	if (!finished(run.status)) return undefined;
	const view = run.viewState ?? {};
	if (view.keptOpen) return undefined;
	if (view.settledAt) return "✓ Settled by you";
	if (
		view.seenAt &&
		["complete", "completed"].includes(run.status) &&
		!run.outputs?.guide &&
		!run.hasGuide
	)
		return "👀 Seen after it finished";
	if (["stopped", "cancelled"].includes(run.status)) return "■ Stopped";
	if (
		["failed", "error", "interrupted"].includes(run.status) &&
		runs.some(
			(other) =>
				other.triggerOrigin?.manual?.sourceRunId === run.id &&
				other.createdAt > run.createdAt,
		)
	)
		return "↻ Replaced by a newer run";
	if (now - Date.parse(run.updatedAt ?? run.createdAt) > 48 * 3600000)
		return "💤 Quiet for 48h+";
	return undefined;
}
export function attention(run: RunSummary): Attention | undefined {
	if (run.reviewGate?.status === "pending" && run.status === "waiting")
		return "review";
	if (run.status === "waiting") return "question";
	if (["failed", "error", "interrupted"].includes(run.status)) return "stuck";
	if (["complete", "completed"].includes(run.status)) return "review";
	return undefined;
}
