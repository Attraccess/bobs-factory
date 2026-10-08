import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { qaDigest } from "./Qa.js";
import { QuestionFieldsSchema } from "./Questions.js";
import type { WorkflowStep } from "./Workflow.js";
import type { ExecutionContext, FactoryRun } from "./WorkflowRuntime.js";

const text = z.string().trim().min(1);
const id = text.regex(/^[a-zA-Z0-9_-]+$/);
const source = z.object({ source: text, reference: text });
const decision = z.object({
	id,
	acceptedBy: text,
	rationale: text,
	source,
	kind: z.enum(["scope", "skip"]),
	requirementIds: z.array(id).min(1),
});
export const InventorySchema = QuestionFieldsSchema.safeExtend({
	schemaVersion: z.literal(1),
	requirements: z
		.array(
			z.object({
				id,
				criterion: text,
				classification: z.enum(["active", "suggestion", "superseded"]),
				sources: z.array(source).min(1),
				changeReason: text.optional(),
				supersedes: z.array(id).default([]),
			}),
		)
		.min(1),
	decisions: z.array(decision),
	conflicts: z.array(
		z.object({ id, description: text, sources: z.array(source).min(1) }),
	),
	sourceReceipt: z.object({
		considered: z.array(source).min(1),
		unavailable: z.array(text),
	}),
	questions: z.array(text),
});
export type Inventory = z.infer<typeof InventorySchema> & {
	version: number;
	digest: string;
	sourceContextDigest?: string;
};
export const AssessmentSchema = z.object({
	requirementId: id,
	status: z.enum(["met", "not_met", "deliberately_skipped"]),
	evidence: z.array(text).min(1),
	reason: text,
	decisionId: id.optional(),
});
export const SpecialistSchema = z.object({
	summary: text,
	findings: z.array(
		z.object({
			id,
			rating: z.number().int().min(1).max(3),
			summary: text,
			evidence: text,
			status: z
				.enum(["open", "resolved", "accepted-rejection"])
				.default("open"),
			requirementIds: z.array(id).default([]),
			reason: text.optional(),
			freshEvidence: text.optional(),
		}),
	),
	disagreements: z.array(text).default([]),
	disputeResolutions: z
		.array(z.object({ disagreement: text, reason: text, evidence: text }))
		.default([]),
	inheritedDispositions: z
		.array(
			z.object({
				id: text,
				status: z.enum(["resolved", "accepted-rejection"]),
				reason: text,
				evidence: text,
			}),
		)
		.default([]),
});
export const CoverageSchema = SpecialistSchema.extend({
	coverage: z.array(AssessmentSchema),
});
export type ReviewBaseline = {
	schemaVersion: 1;
	round: number;
	key: string;
	inventory: Inventory;
	headSha: string;
	baseSha: string;
	historyLength: number;
	reviewers: { id: string; key: string; group: number; contract: string }[];
	context: unknown;
	at: string;
};
export type ReviewerReceipt = z.infer<typeof CoverageSchema> & {
	stamp: {
		reviewer: string;
		stepKey: string;
		round: number;
		inventoryDigest: string;
		inventoryVersion: number;
		headSha: string;
		baseSha: string;
	};
};
export type AggregateReview = {
	approved: boolean;
	findings: (z.infer<typeof SpecialistSchema>["findings"][number] & {
		reviewer: string;
	})[];
	rawFindings: AggregateReview["findings"];
	coverage: z.infer<typeof AssessmentSchema>[];
	reviewers: ReviewerReceipt[];
	disagreements: string[];
	baseline: ReviewBaseline;
};
const unique = (values: string[], label: string) => {
	if (new Set(values).size !== values.length)
		throw new Error(`${label} must be unique`);
};
export function validateInventory(
	value: unknown,
	previous?: Inventory,
): Inventory {
	const inventory = InventorySchema.parse(value);
	unique(
		inventory.requirements.map((r) => r.id),
		"Requirement IDs",
	);
	unique(
		inventory.decisions.map((d) => d.id),
		"Accepted decision IDs",
	);
	unique(
		inventory.conflicts.map((c) => c.id),
		"Conflict IDs",
	);
	if (
		(inventory.conflicts.length ||
			inventory.sourceReceipt.unavailable.length) &&
		!inventory.questions.length
	)
		throw new Error(
			"Unresolved scope conflicts or unavailable sources require an outside-fanout clarification question",
		);
	const known = new Set(inventory.requirements.map((r) => r.id));
	for (const d of inventory.decisions)
		if (d.requirementIds.some((id) => !known.has(id)))
			throw new Error(
				`${d.id}: decision references unknown inventory requirements`,
			);
	for (const requirement of inventory.requirements)
		if (
			requirement.supersedes.some(
				(id) => !known.has(id) || id === requirement.id,
			)
		)
			throw new Error(
				`${requirement.id}: supersedes must reference another retained requirement`,
			);
	for (const old of previous?.requirements ?? []) {
		const current = inventory.requirements.find((r) => r.id === old.id);
		if (!current)
			throw new Error(
				`Preserve historical requirement ${old.id}; mark superseded instead of deleting it`,
			);
		if (
			(current.criterion !== old.criterion ||
				current.classification !== old.classification) &&
			!current.changeReason
		)
			throw new Error(`${old.id}: amendments require a traceable changeReason`);
	}
	for (const current of inventory.requirements) {
		const old = previous?.requirements.find(
			(r) => r.criterion === current.criterion,
		);
		if (old && old.id !== current.id)
			throw new Error(`Preserve stable ID ${old.id} for unchanged criterion`);
	}
	for (const old of previous?.decisions ?? []) {
		if (!inventory.decisions.some((d) => qaDigest(d) === qaDigest(old)))
			throw new Error(
				`Preserve accepted scope decision ${old.id}; append a new decision for changes`,
			);
	}
	const digest = qaDigest(inventory);
	return {
		...inventory,
		digest,
		version:
			previous?.digest === digest
				? previous.version
				: (previous?.version ?? 0) + 1,
	};
}
export function activeRequirements(inventory: Inventory) {
	return inventory.requirements.filter((r) => r.classification === "active");
}
export function validateSpecialist(
	value: unknown,
	baseline: ReviewBaseline,
	coverage: boolean,
	previous?: Pick<ReviewerReceipt, "findings" | "disagreements">,
): z.infer<typeof CoverageSchema> {
	const review = coverage
		? CoverageSchema.parse(value)
		: { ...SpecialistSchema.parse(value), coverage: [] };
	unique(
		review.findings.map((f) => f.id),
		"Local finding IDs",
	);
	const requirements = new Set(
		activeRequirements(baseline.inventory).map((r) => r.id),
	);
	for (const finding of review.findings) {
		if (finding.requirementIds.some((id) => !requirements.has(id)))
			throw new Error(`${finding.id}: unknown active requirement`);
		if (finding.status !== "open" && !finding.reason)
			throw new Error(
				`${finding.id}: settled findings require reason and evidence`,
			);
	}
	for (const disagreement of previous?.disagreements ?? []) {
		if (
			!review.disagreements.includes(disagreement) &&
			!review.disputeResolutions.some((r) => r.disagreement === disagreement)
		)
			throw new Error(
				"Prior disagreement needs an explicit evidence-backed resolution",
			);
	}
	for (const old of previous?.findings ?? []) {
		const current = review.findings.find((f) => f.id === old.id);
		if (old.status === "open" && old.rating > 1 && !current)
			throw new Error(
				`Reassess prior open finding ${old.id}; omission does not resolve it`,
			);
		if (
			old.status !== "open" &&
			current?.status === "open" &&
			!current.freshEvidence
		)
			throw new Error(
				`${old.id}: reopening a settled finding requires fresh evidence or changed requirements`,
			);
	}
	if (coverage) {
		unique(
			review.coverage.map((a) => a.requirementId),
			"Coverage requirement IDs",
		);
		if (
			review.coverage.length !== requirements.size ||
			review.coverage.some((a) => !requirements.has(a.requirementId))
		)
			throw new Error(
				"Coverage must assess every active requirement exactly once, with no unknown IDs",
			);
		for (const assessment of review.coverage) {
			if (
				assessment.status === "deliberately_skipped" &&
				!baseline.inventory.decisions.some(
					(d) =>
						d.id === assessment.decisionId &&
						d.kind === "skip" &&
						d.requirementIds.includes(assessment.requirementId),
				)
			)
				throw new Error(
					`${assessment.requirementId}: deliberate skip requires an explicitly accepted scope decision, person and rationale`,
				);
			if (
				assessment.status === "not_met" &&
				!review.findings.some(
					(f) =>
						f.status === "open" &&
						f.rating > 1 &&
						f.requirementIds.includes(assessment.requirementId),
				)
			)
				throw new Error(
					`${assessment.requirementId}: unmet requirements need actionable rating 2/3 findings`,
				);
		}
	}
	return review;
}
export function validateReviewConfiguration(
	steps: WorkflowStep[],
	specialistBranch = false,
): void {
	const byId = new Map(steps.map((s) => [s.id, s]));
	for (const step of steps) {
		if (
			["specialist-v1", "coverage-v1"].includes(step.reviewContract ?? "") &&
			!specialistBranch
		)
			throw new Error(
				`${step.id}: specialist output contracts belong inside a configured review fanout`,
			);
		if (step.reviewContract === "inventory-v1" && step.inputs)
			throw new Error(
				`${step.id}: requirement extraction needs complete context; remove the inputs restriction`,
			);
		if (step.reviewContract && (step.type !== "agent" || step.json === false))
			throw new Error(
				`${step.id}: review contracts require structured JSON agent output`,
			);
		if (step.reviewContract === "inventory-v1" && !step.askQuestions)
			throw new Error(
				`${step.id}: requirement extraction needs an outside-fanout question checkpoint`,
			);
		if (step.review) {
			const inventory = byId.get(step.review.inventory);
			if (inventory?.reviewContract !== "inventory-v1")
				throw new Error(
					`${step.id}: review.inventory must name a requirement extraction agent in this graph`,
				);
			const fanout =
				step.type === "fanout" ? step : byId.get(step.review.fanout ?? "");
			if (
				fanout?.type !== "fanout" ||
				fanout.review?.inventory !== step.review.inventory
			)
				throw new Error(
					`${step.id}: review.fanout must name a configured specialist fanout with the same inventory`,
				);
			const reviewers = (fanout.groups ?? []).flat();
			if (
				reviewers.some(
					(s) =>
						s.type !== "agent" ||
						!["specialist-v1", "coverage-v1"].includes(
							s.reviewContract ?? "",
						) ||
						s.askQuestions,
				)
			)
				throw new Error(
					`${step.id}: specialist branches must contain only contracted review agents without human checkpoints`,
				);
			unique(
				reviewers.map((s) => s.id),
				"Reviewer identities within a round",
			);
			if (
				reviewers.filter((s) => s.reviewContract === "coverage-v1").length !== 1
			)
				throw new Error(
					`${step.id}: configure exactly one coverage-v1 reviewer. Replace the coverage supplier before removing it; removed roles never execute implicitly.`,
				);
			if (
				step.type !== "fanout" &&
				!(step.type === "tool" && step.tool === "review-gate")
			)
				throw new Error(
					`${step.id}: review sources belong on a specialist fanout or review-gate tool`,
				);
		}
		for (const group of step.groups ?? [])
			validateReviewConfiguration(group, Boolean(step.review));
	}
}
const exec = promisify(execFile);
export async function reviewedRevision(
	workspace: string,
	base?: string,
	{ requireClean = true }: { requireClean?: boolean } = {},
) {
	const git = async (...args: string[]) =>
		(await exec("git", args, { cwd: workspace, timeout: 10000 })).stdout.trim();
	const headSha = await git("rev-parse", "HEAD");
	if (requireClean && (await git("status", "--porcelain")))
		throw new Error(
			"Specialist review requires a clean worktree; commit changes before review",
		);
	const baseSha = await git("rev-parse", base ?? "refs/remotes/origin/main");
	return { headSha, baseSha };
}
export function latestAggregate(
	run: FactoryRun,
	key?: string,
): AggregateReview | undefined {
	return [...run.history]
		.reverse()
		.map((h) => h.output as AggregateReview)
		.find(
			(o) =>
				o?.baseline?.schemaVersion === 1 &&
				(!key || o.baseline.key === key) &&
				Array.isArray(o.reviewers),
		);
}
export function roundFor(
	context: ExecutionContext,
): ReviewBaseline | undefined {
	const key = context.stepKey ?? context.step.id;
	return [...(context.run.reviewRounds ?? [])]
		.reverse()
		.find((r) => key.startsWith(`${r.key}/`));
}
export function validateContractOutput(
	context: ExecutionContext,
	value: unknown,
): unknown {
	const contract = context.step.reviewContract;
	if (!contract) return value;
	if (contract === "inventory-v1")
		return validateInventory(
			value,
			(context.outputs ?? context.run.outputs)[context.step.id] as
				| Inventory
				| undefined,
		);
	const baseline = roundFor(context);
	if (!baseline)
		throw new Error("Specialist has no runtime-owned review baseline");
	const previous = priorReviewer(
		latestAggregate(context.run, baseline.key),
		context.step.id,
	);
	return validateSpecialist(
		value,
		baseline,
		contract === "coverage-v1",
		previous,
	);
}
/** The aggregate retains dispositions even when a later receipt omits them. */
function priorReviewer(
	aggregate: AggregateReview | undefined,
	reviewer: string,
) {
	if (!aggregate) return;
	return {
		findings: aggregate.rawFindings
			.filter((f) => f.reviewer === reviewer)
			.map((f) => ({ ...f, id: f.id.slice(reviewer.length + 1) })),
		disagreements: aggregate.disagreements
			.filter((d) => d.startsWith(`${reviewer}: `))
			.map((d) => d.slice(reviewer.length + 2)),
	};
}
export function stampSpecialist(
	context: ExecutionContext,
	value: unknown,
): ReviewerReceipt {
	const baseline = roundFor(context)!;
	return {
		...(validateContractOutput(context, value) as z.infer<
			typeof CoverageSchema
		>),
		stamp: {
			reviewer: context.step.id,
			stepKey: context.stepKey ?? context.step.id,
			round: baseline.round,
			inventoryDigest: baseline.inventory.digest,
			inventoryVersion: baseline.inventory.version,
			headSha: baseline.headSha,
			baseSha: baseline.baseSha,
		},
	};
}
export function aggregateReview(
	baseline: ReviewBaseline,
	branches: Record<string, unknown>[],
	previous?: AggregateReview,
): AggregateReview {
	if (
		qaDigest(InventorySchema.parse(baseline.inventory)) !==
		baseline.inventory.digest
	)
		throw new Error(
			"Frozen requirement inventory digest no longer matches its contents",
		);
	if (
		baseline.inventory.questions.length ||
		baseline.inventory.conflicts.length ||
		baseline.inventory.sourceReceipt.unavailable.length
	)
		throw new Error(
			"Requirement baseline has unresolved scope or source blockers",
		);
	const reviewers = baseline.reviewers.map((expected) => {
		const receipt = branches[expected.group]?.[expected.id] as
			| ReviewerReceipt
			| undefined;
		const stamp = receipt?.stamp;
		if (
			!stamp ||
			stamp.stepKey !== expected.key ||
			stamp.reviewer !== expected.id ||
			stamp.round !== baseline.round ||
			stamp.inventoryDigest !== baseline.inventory.digest ||
			stamp.inventoryVersion !== baseline.inventory.version ||
			stamp.headSha !== baseline.headSha ||
			stamp.baseSha !== baseline.baseSha
		)
			throw new Error(
				`${expected.id}: missing, incomplete or stale specialist receipt`,
			);
		validateSpecialist(
			receipt,
			baseline,
			expected.contract === "coverage-v1",
			priorReviewer(previous, expected.id),
		);
		return receipt!;
	});
	const rawFindings = reviewers.flatMap((r) =>
		r.findings.map((f) => ({
			...f,
			id: `${r.stamp.reviewer}:${f.id}`,
			reviewer: r.stamp.reviewer,
		})),
	);
	const retained =
		previous?.rawFindings.filter(
			(old) => !rawFindings.some((f) => f.id === old.id),
		) ?? [];
	for (const old of retained) {
		const disposition = reviewers
			.flatMap((r) => r.inheritedDispositions)
			.find((d) => d.id === old.id);
		rawFindings.push(disposition ? { ...old, ...disposition } : old);
	}
	const findings = rawFindings.filter(
		(f) => f.rating > 1 && f.status === "open",
	);
	const coverage = reviewers.find(
		(r) =>
			baseline.reviewers.find((e) => e.id === r.stamp.reviewer)?.contract ===
			"coverage-v1",
	)!.coverage;
	const disagreements = reviewers.flatMap((r) =>
		r.disagreements.map((d) => `${r.stamp.reviewer}: ${d}`),
	);
	for (const dispute of previous?.disagreements ?? [])
		if (
			!disagreements.includes(dispute) &&
			!reviewers.some((r) =>
				r.disputeResolutions.some(
					(d) =>
						d.disagreement === dispute ||
						`${r.stamp.reviewer}: ${d.disagreement}` === dispute,
				),
			)
		)
			disagreements.push(dispute);
	return {
		approved:
			!findings.length &&
			!disagreements.length &&
			coverage.every((a) => a.status !== "not_met"),
		findings,
		rawFindings,
		coverage,
		reviewers,
		disagreements,
		baseline,
	};
}
export function assertAggregateRevision(
	aggregate: AggregateReview | undefined,
	headSha: string,
	baseSha?: string,
): void {
	if (
		!aggregate?.approved ||
		aggregate.baseline.headSha !== headSha ||
		(baseSha && aggregate.baseline.baseSha !== baseSha)
	)
		throw new Error(
			"Specialist review is missing, unresolved or bound to a different revision/base; run a new requirement extraction and review round",
		);
	const regenerated = aggregateReview(
		aggregate.baseline,
		aggregate.baseline.reviewers.reduce<Record<string, unknown>[]>(
			(branches, reviewer) => {
				branches[reviewer.group] ??= {};
				branches[reviewer.group]![reviewer.id] = aggregate.reviewers.find(
					(r) => r.stamp.stepKey === reviewer.key,
				);
				return branches;
			},
			[],
		),
		aggregate,
	);
	if (qaDigest(regenerated) !== qaDigest(aggregate))
		throw new Error("Aggregate review evidence changed after approval");
}

export function aggregateForContext(
	context: ExecutionContext,
): AggregateReview | undefined {
	if (!context.run.reviewRounds?.length) return;
	const prefix = (
		context.stepKey ??
		context.run.step ??
		context.step.id
	).replace(/[^/]+$/, "");
	const baseline = [...context.run.reviewRounds].reverse().find((r) => {
		if (context.reviewKey) return r.key === context.reviewKey;
		// Older persisted checkpoints have no association. Retain safeguards for
		// the current graph and its callers/callees, excluding sibling branches.
		const reviewPrefix = r.key.replace(/[^/]+$/, "");
		return reviewPrefix.startsWith(prefix) || prefix.startsWith(reviewPrefix);
	});
	if (!baseline) return;
	const aggregate = latestAggregate(context.run, baseline.key);
	if (!aggregate || aggregate.baseline.round !== baseline.round)
		throw new Error(
			"Latest configured specialist round has no complete aggregate; approval is blocked",
		);
	return aggregate;
}

export function scopeContextDigest(input: unknown): string {
	const context = input as Record<string, unknown>;
	const outputs = (context.outputs ?? {}) as Record<string, unknown>;
	return qaDigest({
		originalInput: context.originalInput,
		answers: context.answers,
		chatMessages: context.chatMessages,
		humanDecisions: Array.isArray(context.humanDecisions)
			? context.humanDecisions.filter(
					(d) =>
						!(
							d &&
							typeof d === "object" &&
							"decision" in d &&
							d.decision === "approve"
						),
				)
			: context.humanDecisions,
		accepted: Object.fromEntries(
			[
				"clarify",
				"decisions",
				"plan",
				"existing-work",
				"assess-existing",
				"source",
				"ticket",
			].map((k) => [k, outputs[k]]),
		),
	});
}

/** Keep prior evidence, but avoid recursively copying old immutable source snapshots. */
export function frozenReviewContext(input: unknown): unknown {
	const compact = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(compact);
		if (!value || typeof value !== "object") return value;
		return Object.fromEntries(
			Object.entries(value)
				.filter(([key]) => key !== "reviewBaseline")
				.map(([key, item]) => [
					key,
					key === "baseline" && item && typeof item === "object"
						? Object.fromEntries(
								Object.entries(item).filter(([field]) => field !== "context"),
							)
						: compact(item),
				]),
		);
	};
	return compact(structuredClone(input));
}
