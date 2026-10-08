import { createHash, randomUUID } from "node:crypto";
import {
	factoryRuntimeIdentity,
	type RuntimeIdentity,
} from "bobs-factory-core";
import { FACTORY_RESULT_CONTRACT_VERSION } from "./FactoryResults.js";
import type { ExecutionContext, FactoryRun } from "./WorkflowRuntime.js";

export type AttemptReason =
	| "initial"
	| "workflow-transition"
	| "resume"
	| "new-feedback"
	| "code-change"
	| "base-change"
	| "infrastructure-retry"
	| "output-correction"
	| "human-direction";
export type AttemptOutcome =
	| "running"
	| "completed"
	| "failed"
	| "blocked"
	| "interrupted";
export interface StepAttempt {
	id: string;
	parentAttemptId?: string;
	kind: "step" | "agent-turn";
	step: string;
	type: string;
	startedAt: string;
	endedAt?: string;
	reason: AttemptReason;
	outcome: AttemptOutcome;
	runtime: RuntimeIdentity;
	workflowHash: string;
	contract: {
		validator: string;
		version: number | null;
		review: string | null;
		qa: string | null;
		video: string | null;
		hash: string;
	};
	instructionsHash: string;
	instructionsSource: "recipe" | "effective";
	contextHashes: { human: string; feedback: string };
	revision?: { headSha: string; baseSha?: string };
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object")
		return `{${Object.entries(value)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
			.join(",")}}`;
	return JSON.stringify(value) ?? "null";
}
const digest = (value: string) =>
	createHash("sha256").update(value).digest("hex");

export function beginStepAttempt(
	context: ExecutionContext,
	options: {
		reason?: AttemptReason;
		kind?: StepAttempt["kind"];
		parentAttemptId?: string;
	} = {},
): string {
	const { run, step } = context;
	const prior = run.stepAttempts?.find((a) => a.id === context.attemptId);
	if (prior && options.kind !== "agent-turn") {
		// A process crash cannot run native-turn finalizers. Replacing its graph
		// attempt also closes linked running turns, without touching other branches
		// or completed evidence. Set iteration includes newly discovered descendants.
		const replaced = new Set([prior.id]);
		for (const id of replaced)
			for (const attempt of run.stepAttempts ?? [])
				if (attempt.parentAttemptId === id) replaced.add(attempt.id);
		const endedAt = new Date().toISOString();
		for (const attempt of run.stepAttempts ?? [])
			if (replaced.has(attempt.id) && attempt.outcome === "running") {
				attempt.outcome = "interrupted";
				attempt.endedAt = endedAt;
			}
	}
	const contract = {
		validator: FACTORY_RESULT_CONTRACT_VERSION,
		version: run.contractVersion ?? null,
		review: step.reviewContract ?? null,
		qa: step.qaContract ?? null,
		video: step.videoContract ?? null,
	};
	const contextHashes = {
		human: digest(
			canonical({
				input: run.input,
				answers: run.answers,
				messages: context.chatMessages ?? [],
				decisions: run.humanDecisions ?? [],
			}),
		),
		feedback: digest(
			canonical(
				(context.input as { feedback?: unknown } | null)?.feedback ?? null,
			),
		),
	};
	const previous = [...(run.stepAttempts ?? [])]
		.reverse()
		.find(
			(a) =>
				a.step === (context.stepKey ?? run.step ?? step.id) &&
				a.kind === (options.kind ?? "step"),
		);
	const reason =
		previous?.contextHashes &&
		previous.contextHashes.human !== contextHashes.human
			? "human-direction"
			: previous?.contextHashes &&
					previous.contextHashes.feedback !== contextHashes.feedback
				? "new-feedback"
				: undefined;
	const attempt: StepAttempt = {
		id: randomUUID(),
		...(options.parentAttemptId
			? { parentAttemptId: options.parentAttemptId }
			: {}),
		kind: options.kind ?? "step",
		step: context.stepKey ?? run.step ?? step.id,
		type: step.type,
		startedAt: new Date().toISOString(),
		reason:
			options.reason ??
			(context.resumeAgent?.infrastructureFailure
				? "infrastructure-retry"
				: undefined) ??
			reason ??
			(context.resumeAgent
				? "resume"
				: run.history.length
					? "workflow-transition"
					: "initial"),
		outcome: "running",
		runtime: { ...factoryRuntimeIdentity },
		workflowHash: digest(
			canonical({
				workflow: run.workflow,
				definitions: run.workflowDefinitions ?? [],
			}),
		),
		contract: {
			...contract,
			hash: digest(canonical({ ...contract, json: step.json })),
		},
		instructionsHash: digest(step.prompt ?? ""),
		instructionsSource: "recipe",
		contextHashes,
	};
	run.stepAttempts ??= [];
	run.stepAttempts.push(attempt);
	context.attemptId = attempt.id;
	context.save?.();
	return attempt.id;
}

export function finishStepAttempt(
	context: ExecutionContext,
	outcome: Exclude<AttemptOutcome, "running">,
): void {
	const attempt = context.run.stepAttempts?.find(
		(a) => a.id === context.attemptId,
	);
	if (!attempt || attempt.outcome !== "running") return;
	attempt.outcome = outcome;
	attempt.endedAt = new Date().toISOString();
	context.save?.();
}

export function recordAttemptInstructions(
	context: ExecutionContext,
	instructions: string,
): void {
	const attempt = context.run.stepAttempts?.find(
		(a) => a.id === context.attemptId,
	);
	if (!attempt) return;
	attempt.instructionsHash = digest(instructions);
	attempt.instructionsSource = "effective";
	const progress = context.progress;
	const previous = [...(context.run.stepAttempts ?? [])]
		.reverse()
		.find(
			(a) =>
				a.id !== attempt.id &&
				a.step === attempt.step &&
				a.kind === attempt.kind,
		);
	if (progress?.currentRevision)
		attempt.revision = {
			headSha: progress.currentRevision.headSha,
			...(progress.reviewScope?.baseSha
				? { baseSha: progress.reviewScope.baseSha }
				: {}),
		};
	if (attempt.reason === "resume" || attempt.reason === "workflow-transition") {
		if (context.resumeAgent?.rejected) attempt.reason = "output-correction";
		else if (
			previous?.revision?.baseSha &&
			progress?.reviewScope?.baseSha &&
			previous.revision.baseSha !== progress.reviewScope.baseSha
		)
			attempt.reason = "base-change";
		else if (progress && !progress.uncertain && !progress.unchangedCode)
			attempt.reason = "code-change";
	}
	context.save?.();
}

/** Deliberately excludes task text, outputs, configuration, accounts and credentials. */
export function runProvenance(run: FactoryRun) {
	return {
		schemaVersion: 1,
		runId: run.id,
		currentRuntime: { ...factoryRuntimeIdentity },
		knownSource: null,
		legacyProvenance: run.stepAttempts === undefined,
		attempts: (run.stepAttempts ?? []).map((attempt) => ({
			id: attempt.id,
			parentAttemptId: attempt.parentAttemptId,
			kind: attempt.kind,
			step: attempt.step,
			type: attempt.type,
			startedAt: attempt.startedAt,
			endedAt: attempt.endedAt,
			reason: attempt.reason,
			outcome: attempt.outcome,
			runtime: {
				version: attempt.runtime.version,
				commit: attempt.runtime.commit,
				dirty: attempt.runtime.dirty,
				target: attempt.runtime.target,
				resourceDigest: attempt.runtime.resourceDigest,
				packaged: attempt.runtime.packaged,
			},
			workflowHash: attempt.workflowHash,
			contract: {
				validator: attempt.contract.validator,
				version: attempt.contract.version,
				review: attempt.contract.review,
				qa: attempt.contract.qa,
				video: attempt.contract.video,
				hash: attempt.contract.hash,
			},
			instructionsHash: attempt.instructionsHash,
			instructionsSource: attempt.instructionsSource,
			contextHashes: attempt.contextHashes
				? {
						human: attempt.contextHashes.human,
						feedback: attempt.contextHashes.feedback,
					}
				: undefined,
			revision: attempt.revision
				? {
						headSha: attempt.revision.headSha,
						baseSha: attempt.revision.baseSha,
					}
				: undefined,
		})),
	};
}
