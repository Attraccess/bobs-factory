import { createHash } from "node:crypto";
import { z } from "zod";
import type { Inventory } from "./SpecialistReview.js";

export const QA_CONTRACT = "qa-v1" as const;
const text = z.string().min(1);
const task = z.object({ area: text, state: text });
export const QaScopeFields = {
	qaContract: z.literal(QA_CONTRACT),
	stories: z.array(
		z.object({
			id: text,
			goal: text,
			requirementRefs: z.array(text).min(1),
			interface: z.enum(["ui", "api", "cli", "other"]),
			preconditions: z.array(text),
			fixtures: z.array(text),
			actions: z.array(text).min(1),
			criteria: z.array(z.object({ id: text, expected: text })).min(1),
			evidenceInstructions: text,
			screenshotTasks: z.array(task),
		}),
	),
	exclusions: z.array(z.object({ requirementRef: text, reason: text })),
	notApplicableReason: text.min(20).optional(),
};
export const QaScopeFieldsSchema = z.object(QaScopeFields);
export type QaScope = z.infer<typeof QaScopeFieldsSchema> & {
	areas: { name: string; states: string[] }[];
};
export function scopeIssues(scope: QaScope): string[] {
	const issues: string[] = [];
	const unique = (ids: string[], label: string) => {
		if (new Set(ids).size !== ids.length)
			issues.push(`${label} must be unique`);
	};
	unique(
		scope.stories.map((s) => s.id),
		"Story IDs",
	);
	unique(
		scope.stories.flatMap((s) => s.criteria.map((c) => c.id)),
		"Criterion IDs",
	);
	if (!scope.stories.length && !scope.notApplicableReason)
		issues.push(
			"No executable stories requires a concrete notApplicableReason; no visual changes is insufficient",
		);
	const selected = new Set(
		scope.areas.flatMap((a) =>
			a.states.map((s) => JSON.stringify([a.name, s])),
		),
	);
	const linked = new Set<string>();
	for (const story of scope.stories) {
		unique(
			story.screenshotTasks.map((t) => JSON.stringify([t.area, t.state])),
			`Screenshot tasks for ${story.id}`,
		);
		for (const t of story.screenshotTasks) {
			const key = JSON.stringify([t.area, t.state]);
			if (!selected.has(key))
				issues.push(`Unknown screenshot task ${t.area}/${t.state}`);
			linked.add(key);
		}
	}
	for (const key of selected)
		if (!linked.has(key))
			issues.push(`Selected screenshot ${key} has no story`);
	return issues;
}

export const QaFindingSchema = z.object({
	id: text,
	rating: z.union([z.literal(2), z.literal(3)]),
	summary: text,
	evidence: text,
	status: z.enum(["open", "resolved", "accepted-rejection"]).default("open"),
	storyId: text,
	criterionId: text,
	requirementRefs: z.array(text).min(1),
	reproduction: z.array(text).min(1),
	expected: text,
	actual: text,
});
const outcome = z.enum(["passed", "failed", "blocked"]);
export const QaExecutionFields = {
	qaContract: z.literal(QA_CONTRACT),
	results: z.array(
		z.object({
			storyId: text,
			goal: text.optional(),
			outcome,
			criteria: z.array(
				z.object({
					criterionId: text,
					outcome,
					expected: text,
					observed: text,
					blockedReason: text.optional(),
					evidence: z.array(
						z.object({
							kind: z.enum(["command", "test", "http", "browser", "log"]),
							executed: z.literal(true),
							action: text,
							details: text,
							exitCode: z.number().int().optional(),
							screenshotTasks: z.array(task).default([]),
						}),
					),
				}),
			),
		}),
	),
	findings: z.array(QaFindingSchema),
	observations: z.array(
		z.object({
			id: text,
			summary: text,
			evidence: text,
			storyId: text.optional(),
		}),
	),
	coverage: z
		.object({
			plannedStories: z.number().int(),
			plannedCriteria: z.number().int(),
			reportedStories: z.number().int(),
			reportedCriteria: z.number().int(),
		})
		.optional(),
	notApplicableReason: text.optional(),
	// Always replaced by the runtime; never trust a runner's revision claim.
	testedRevision: z
		.object({ headSha: text, dirty: z.boolean(), scopeHash: text })
		.optional(),
};
export const QaExecutionSchema = z.object(QaExecutionFields);
export type QaExecution = z.infer<typeof QaExecutionSchema>;
export function qaDigest(value: unknown): string {
	const canonical = (item: unknown): unknown =>
		Array.isArray(item)
			? item.map(canonical)
			: item && typeof item === "object"
				? Object.fromEntries(
						Object.entries(item)
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([key, v]) => [key, canonical(v)]),
					)
				: item;
	return createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex");
}
export function qaCoverage(scope: QaScope, capture: QaExecution) {
	const blocked: string[] = [],
		errors: string[] = [],
		failed: z.infer<typeof QaFindingSchema>[] = [];
	const knownStories = new Set(scope.stories.map((s) => s.id));
	if (
		capture.results.some((r) => !knownStories.has(r.storyId)) ||
		new Set(capture.results.map((r) => r.storyId)).size !==
			capture.results.length
	)
		errors.push(
			"QA execution contains unknown or duplicate stories. Supply one result per planned story.",
		);
	const tasks = new Set(
		scope.areas.flatMap((a) =>
			a.states.map((s) => JSON.stringify([a.name, s])),
		),
	);
	for (const story of scope.stories) {
		const result = capture.results.find((r) => r.storyId === story.id);
		if (!result) {
			errors.push(`${story.id}: no execution result supplied`);
			continue;
		}
		const known = new Set(story.criteria.map((c) => c.id));
		if (
			result.criteria.some((c) => !known.has(c.criterionId)) ||
			new Set(result.criteria.map((c) => c.criterionId)).size !==
				result.criteria.length
		)
			errors.push(`${story.id}: unknown or duplicate criterion results`);
		for (const criterion of story.criteria) {
			const receipt = result.criteria.find(
				(c) => c.criterionId === criterion.id,
			);
			if (!receipt) {
				errors.push(
					`${story.id}/${criterion.id}: no execution evidence supplied`,
				);
				continue;
			}
			if (receipt.expected !== criterion.expected)
				errors.push(
					`${story.id}/${criterion.id}: expected outcome differs from the accepted QA scope`,
				);
			if (
				receipt.evidence.some((e) =>
					e.screenshotTasks.some(
						(t) => !tasks.has(JSON.stringify([t.area, t.state])),
					),
				)
			)
				errors.push(
					`${story.id}/${criterion.id}: unknown screenshot evidence reference`,
				);
			if (receipt.outcome === "blocked")
				blocked.push(
					`${story.id}/${criterion.id}: ${receipt.blockedReason ?? receipt.observed}`,
				);
			else if (!receipt.evidence.length)
				errors.push(
					`${story.id}/${criterion.id}: the check was not executed with evidence`,
				);
			if (receipt.outcome === "failed")
				failed.push({
					id: `qa-${qaDigest([story.id, criterion.id]).slice(0, 16)}`,
					rating: 3,
					status: "open",
					summary: `${story.goal}: ${criterion.expected}`,
					evidence: receipt.observed,
					storyId: story.id,
					criterionId: criterion.id,
					requirementRefs: story.requirementRefs,
					reproduction: story.actions,
					expected: criterion.expected,
					actual: receipt.observed,
				});
		}
		const expectedOutcome = result.criteria.some((c) => c.outcome === "failed")
			? "failed"
			: result.criteria.some((c) => c.outcome === "blocked")
				? "blocked"
				: "passed";
		if (result.outcome !== expectedOutcome)
			errors.push(`${story.id}: story outcome disagrees with its criteria`);
	}
	for (const finding of capture.findings) {
		const story = scope.stories.find((s) => s.id === finding.storyId);
		if (
			!story?.criteria.some((c) => c.id === finding.criterionId) ||
			finding.requirementRefs.some((r) => !story.requirementRefs.includes(r))
		)
			errors.push(
				`${finding.id}: finding references an unknown story, criterion or requirement`,
			);
	}
	return { blocked, errors, failed };
}

/** References identify the actual accepted record, rather than invented requirements. */
export function qaRequirementIssues(
	scope: QaScope,
	outputs: Record<string, unknown>,
	answers: unknown[],
	inventory?: Inventory,
) {
	if (inventory) {
		const ids = inventory.requirements
			.filter((r) => r.classification === "active")
			.map((r) => r.id);
		const issues = scope.stories.flatMap((s) =>
			s.requirementRefs
				.filter((r) => !ids.includes(r))
				.map((r) => `${s.id}: unknown active requirement ID ${r}`),
		);
		for (const id of ids)
			if (
				!scope.stories.some((s) => s.requirementRefs.includes(id)) &&
				!scope.exclusions.some((e) => e.requirementRef === id)
			)
				issues.push(`${id}: no QA story or explicit justified exclusion`);
		return issues;
	}
	const clarify = (outputs.clarify ?? outputs.decisions) as
		| { requirements?: string[]; decisions?: unknown[] }
		| undefined;
	const requirements = clarify?.requirements ?? [];
	const refs = new Set([
		...requirements,
		...requirements.map((_r, i) => `requirements/${i}`),
		...(clarify?.decisions ?? []).map((_r, i) => `decisions/${i}`),
		...answers.map((_r, i) => `answers/${i}`),
	]);
	const issues = scope.stories.flatMap((s) =>
		s.requirementRefs
			.filter((r) => !refs.has(r))
			.map(
				(r) => `${s.id}: unknown accepted requirement/decision reference ${r}`,
			),
	);
	for (const [i, requirement] of requirements.entries()) {
		if (
			!scope.stories.some(
				(s) =>
					s.requirementRefs.includes(requirement) ||
					s.requirementRefs.includes(`requirements/${i}`),
			) &&
			!(
				scope as QaScope & { exclusions: { requirementRef: string }[] }
			).exclusions.some(
				(e) =>
					e.requirementRef === requirement ||
					e.requirementRef === `requirements/${i}`,
			) &&
			scope.stories.length
		)
			issues.push(`requirements/${i}: no QA story or explicit exclusion`);
	}
	return issues;
}
