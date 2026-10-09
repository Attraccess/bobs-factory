import { releaseDelivery } from "./DeliveryCoordination.js";
import type { GitProvider } from "./GitProvider.js";
import type { MergeReadiness, ProviderCheck } from "./MergeReadiness.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

export interface CIRetryReceipt {
	key: string;
	url: string;
	headSha: string;
	check: string;
	provider: NonNullable<ProviderCheck["retry"]>;
	failure: NonNullable<ProviderCheck["failure"]>;
	requestedAt: string;
	state: "requested" | "accepted" | "unknown";
	error?: string;
}
export interface CISupervision {
	retries: CIRetryReceipt[];
	checkReceipts?: Record<
		string,
		{
			failure: NonNullable<ProviderCheck["failure"]>;
			metadataRecheck?: boolean;
		}
	>;
}
export const ciFixRuntimeInstructions = `Runtime supervises queued checks and proven recoverable infrastructure failures. Diagnose unknown failures from their concrete receipts, and correct actionable source, merge conflict or PR metadata problems. Do not stay running to poll CI or retry unavailable runners. After a bounded corrective action, return promptly; runtime rechecks provider readiness. Separate PR title/description validation from source commits. Inspect the repository workflow before requesting a metadata recheck: a rerun may replay the old event payload, while edited events or workflows reading live PR metadata can recheck the current title. Prefer their supported current-SHA recheck. Do not create an empty commit solely to refresh checks. Commit/push only actual source changes, retain honest revision/base evidence, and do not bypass any review or approval requirement.`;

/** Provider failure evidence stays factual; only the routing decision becomes a wait. */
export async function superviseCI(
	context: ExecutionContext,
	provider: GitProvider,
	snapshot: MergeReadiness,
): Promise<MergeReadiness> {
	const coordination = context.run.deliveryCoordination;
	if (
		coordination?.phase === "active" &&
		!context.run.deliveryReservations &&
		(snapshot.queued ||
			snapshot.checks.some(
				(check) =>
					check.bucket === "pending" ||
					check.failure?.kind === "infrastructure" ||
					(check.retry?.status && check.retry.status !== "completed"),
			))
	) {
		if (!coordination.waitingSince) {
			coordination.waitingSince = new Date().toISOString();
			context.save?.();
		}
		if (Date.now() - Date.parse(coordination.waitingSince) >= 120000) {
			releaseDelivery(
				context.run,
				"Provider wait exceeded two minutes; eligible deliveries may proceed",
			);
			context.log(
				"Provider checks are still queued or unavailable. Releasing the delivery target for other eligible work; completed evidence remains subject to current revision/base validation.",
			);
			context.save?.();
		}
	} else if (coordination?.waitingSince) {
		delete coordination.waitingSince;
		context.save?.();
	}
	const failed = snapshot.checks.filter((check) => check.bucket === "fail");
	if (
		failed.length &&
		failed.every(
			(check) =>
				check.retry?.headSha === snapshot.headSha &&
				check.retry.status &&
				check.retry.status !== "completed",
		)
	) {
		// A provider-confirmed live attempt can coexist with its previous failed
		// check context. Keep that failure factual while waiting for the new result.
		for (const blocker of snapshot.blockers)
			if (blocker.kind === "checks" && blocker.action === "fix") {
				blocker.action = "wait";
				blocker.message = "Provider confirms the CI retry is queued or running";
			}
		snapshot.fix = snapshot.blockers.some(
			(blocker) => blocker.action === "fix",
		);
		snapshot.approved = false;
		snapshot.reviewReady = false;
		return snapshot;
	}
	context.run.ciSupervision ??= { retries: [] };
	const supervision = context.run.ciSupervision;
	const keyFor = (check: ProviderCheck) =>
		JSON.stringify([
			snapshot.url,
			snapshot.headSha,
			check.retry!.kind,
			check.retry!.id,
			check.retry!.attempt,
		]);
	const previous = (context.run.outputs["merge-readiness"] ??
		context.run.outputs.ci) as MergeReadiness | undefined;
	if (
		failed.length &&
		failed.every((check) => check.failure?.kind === "infrastructure") &&
		failed.some(
			(check) => !check.retry || check.retry.headSha !== snapshot.headSha,
		)
	) {
		for (const blocker of snapshot.blockers)
			if (blocker.kind === "checks" && blocker.action === "fix") {
				blocker.action = "wait";
				blocker.message = "CI infrastructure needs assistance";
			}
		snapshot.fix = snapshot.blockers.some(
			(blocker) => blocker.action === "fix",
		);
		snapshot.approved = false;
		snapshot.reviewReady = false;
		snapshot.ciAssistance = [
			"The provider cannot safely retry the current infrastructure failure without a check/run identity bound to this source revision. Restore CI or provide a supported retry receipt; failed checks remain blocking.",
		];
		return snapshot;
	}
	if (
		!failed.length ||
		failed.some(
			(check) =>
				!check.retry ||
				check.retry.headSha !== snapshot.headSha ||
				(check.failure?.kind !== "infrastructure" &&
					!(
						check.failure?.kind === "metadata" &&
						check.retry.metadataRecheck &&
						(supervision.retries.some(
							(receipt) => receipt.key === keyFor(check),
						) ||
							(previous?.metadata?.title &&
								snapshot.metadata?.title &&
								previous.metadata.title !== snapshot.metadata.title))
					)),
		)
	)
		return snapshot;
	const assistance: string[] = [];
	for (const check of [
		...new Map(
			failed.map((value) => [`${value.retry!.kind}:${value.retry!.id}`, value]),
		).values(),
	]) {
		const retry = check.retry!;
		const key = keyFor(check);
		const prior = supervision.retries.find((receipt) => receipt.key === key);
		if (prior) {
			// Never repeat an ambiguous side effect after a restart or a transport error.
			if (
				prior.state === "unknown" ||
				Date.now() - Date.parse(prior.requestedAt) > 120000
			)
				assistance.push(
					`The provider has not confirmed a new attempt for ${check.name} after the recorded retry. Inspect ${check.link ?? retry.id} and restore CI; the current failed checks remain blocking.`,
				);
			continue;
		}
		const attempts = supervision.retries.filter(
			(receipt) =>
				receipt.url === snapshot.url &&
				receipt.headSha === snapshot.headSha &&
				receipt.provider.kind === retry.kind &&
				(receipt.provider.lineage ?? receipt.provider.id) ===
					(retry.lineage ?? retry.id),
		).length;
		if (!provider.retryCheck || attempts >= 2) {
			assistance.push(
				`CI infrastructure failed for ${check.name}: ${check.failure!.evidence}. ${attempts >= 2 ? "Two runtime retries are exhausted." : "This provider cannot safely retry this check."} Restore the runner/provider before continuing. Required checks are not waived.`,
			);
			continue;
		}
		const receipt: CIRetryReceipt = {
			key,
			url: snapshot.url,
			headSha: snapshot.headSha,
			check: check.name,
			provider: retry,
			failure: check.failure!,
			requestedAt: new Date().toISOString(),
			state: "requested",
		};
		supervision.retries.push(receipt);
		context.save?.();
		context.log(
			`CI infrastructure failure: ${check.name}. Runtime requests bounded retry ${attempts + 1}/2; no agent is kept running to poll checks.`,
		);
		try {
			await provider.retryCheck(snapshot.url, retry);
			receipt.state = "accepted";
		} catch (error) {
			context.signal.throwIfAborted();
			receipt.state = "unknown";
			receipt.error = error instanceof Error ? error.message : String(error);
			assistance.push(
				`CI retry outcome is uncertain for ${check.name}: ${receipt.error}. Inspect the provider before retrying; the runtime will not duplicate a potentially accepted request.`,
			);
		}
		context.save?.();
	}
	for (const blocker of snapshot.blockers)
		if (blocker.kind === "checks" && blocker.action === "fix") {
			blocker.action = "wait";
			blocker.message = assistance.length
				? "CI infrastructure needs assistance"
				: "Runtime is supervising a CI infrastructure retry";
		}
	snapshot.fix = snapshot.blockers.some((blocker) => blocker.action === "fix");
	snapshot.approved = false;
	snapshot.reviewReady = false;
	if (assistance.length) snapshot.ciAssistance = assistance;
	return snapshot;
}
