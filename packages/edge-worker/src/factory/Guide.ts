import { GeneratedGuideSchema, GuideSchema } from "./FactoryResults.js";
import { legacyGuidePrompt } from "./legacyGuidePrompt.js";
import {
	OutputValidationError,
	outputValidationError,
} from "./OutputValidation.js";
import {
	GeneratedBriefSchema,
	isReviewBrief,
	validateBriefCoverage,
} from "./ReviewBrief.js";
import {
	activeRequirements,
	aggregateForContext,
	assertAggregateRevision,
} from "./SpecialistReview.js";
import type { VideoCapture } from "./Video.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

/** Validate guide coverage against the entire PR, not the last agent's delta. */
export function validateGuideCoverage(
	context: ExecutionContext,
	value: unknown,
): void {
	if (isReviewBrief(value)) {
		validateBriefCoverage(context, value);
		return;
	}
	const guide = GuideSchema.parse(value);
	const aggregate = aggregateForContext(context);
	if (aggregate) {
		assertAggregateRevision(
			aggregate,
			context.progress?.currentRevision?.headSha ?? "",
		);
		const requirements = activeRequirements(aggregate.baseline.inventory);
		if (
			guide.requirements.length !== requirements.length ||
			requirements.some(
				(r, i) =>
					guide.requirements[i]?.requirementId !== r.id ||
					guide.requirements[i]?.criterion !== r.criterion,
			)
		)
			throw new Error(
				"Guide requirements must match every active frozen inventory ID and criterion in inventory order",
			);
		for (const [i, r] of requirements.entries()) {
			const assessment = aggregate.coverage.find(
				(a) => a.requirementId === r.id,
			)!;
			const expected = {
				met: "supported",
				not_met: "gap",
				deliberately_skipped: "waived",
			}[assessment.status];
			if (guide.requirements[i]!.status !== expected)
				throw new Error(
					`${r.id}: guide status cannot differ from validated review coverage`,
				);
		}
	}
	// Chapter guides authored from any release of the stock chapter prompt.
	const stockPrompt = context.step.prompt?.startsWith(legacyGuidePrompt);
	if (!guide.chapters) {
		if (stockPrompt)
			throw new Error(
				"The review guide needs feature chapters covering the whole PR",
			);
		return; // Older/custom guides remain readable.
	}
	const ids = new Set<string>(),
		requirements = new Set<number>(),
		files = new Set<string>();
	const shots =
		(
			context.run.outputs.capture as
				| { screenshots?: { area: string; state: string }[] }
				| undefined
		)?.screenshots ?? [];
	const videos =
		(context.run.outputs.capture as VideoCapture | undefined)?.videos ?? [];
	const receipts =
		(
			context.run.outputs["visual-review"] as
				| {
						acceptedVideos?: {
							taskId: string;
							sha256: string;
							inspectedPlayback: boolean;
						}[];
				  }
				| undefined
		)?.acceptedVideos ?? [];
	for (const chapter of guide.chapters) {
		for (const ref of chapter.videos ?? []) {
			const video = videos.find(
				(v) => v.taskId === ref.taskId && v.validation?.sha256 === ref.sha256,
			);
			if (
				!video?.validation ||
				video.validation.dirty ||
				video.validation.validatedRevision !==
					context.progress?.currentRevision?.headSha ||
				!receipts.some(
					(r) =>
						r.taskId === ref.taskId &&
						r.sha256 === ref.sha256 &&
						r.inspectedPlayback,
				)
			)
				throw new Error(`Guide video is stale or unaccepted: ${ref.taskId}`);
		}
		if (ids.has(chapter.id))
			throw new Error(`Duplicate guide chapter: ${chapter.id}`);
		ids.add(chapter.id);
		for (const i of chapter.requirementIndexes) {
			if (i >= guide.requirements.length)
				throw new Error(`Unknown guide requirement: ${i}`);
			requirements.add(i);
		}
		for (const file of chapter.files) files.add(file);
		for (const shot of chapter.screenshots) {
			if (!shots.some((s) => s.area === shot.area && s.state === shot.state))
				throw new Error(
					`Guide screenshot is not in the accepted inventory: ${shot.area} / ${shot.state}`,
				);
		}
	}
	if (requirements.size !== guide.requirements.length)
		throw new Error("Guide chapters omit acceptance criteria");
	const scope = context.progress?.reviewScope;
	if (guide.scope && scope) {
		const declared = new Set(guide.scope.files);
		if (
			declared.size !== guide.scope.files.length ||
			declared.size !== scope.files.length ||
			scope.files.some((file) => !declared.has(file))
		)
			throw new OutputValidationError(value, [
				{
					path: "/scope/files",
					message:
						"Scope classification must account for every whole-PR changed file exactly once",
					expected: scope.files,
					actual: guide.scope.files,
				},
			]);
	}
	const visualScope = context.run.outputs["visual-scope"] as
		| { nonVisualFiles?: string[] }
		| undefined;
	if (
		guide.scope?.kind === "purely-visual" &&
		visualScope?.nonVisualFiles?.some((file) => scope?.files.includes(file))
	)
		throw new OutputValidationError(value, [
			{
				path: "/scope/kind",
				message:
					"The accepted QA scope contains nonvisual changes; classify as nonvisual and supply a system map",
			},
		]);
	if (!scope && stockPrompt && !context.step.inputs)
		throw new Error(
			"Whole-PR revision scope is unavailable; cannot produce a complete guide",
		);
	if (scope) {
		const omitted = scope.files.filter((file) => !files.has(file));
		if (omitted.length)
			throw new OutputValidationError(value, [
				{
					path: "/chapters/files",
					message: `Guide chapters omit PR files: ${omitted.join(", ")}`,
					expected: scope.files,
					actual: [...files],
				},
			]);
		const extra = [...files].filter((file) => !scope.files.includes(file));
		if (extra.length)
			throw new OutputValidationError(value, [
				{
					path: "/chapters/files",
					message:
						"Guide chapter files must be actual changed PR files; move integration/approval-delta information to evidence or revisionNote",
					expected: scope.files,
					actual: extra,
				},
			]);
	}
	if (
		guide.revisionSummary &&
		!(context.run.humanDecisions ?? []).some(
			(d) => d.headSha === guide.previousHeadSha,
		)
	)
		throw new Error(
			"A revision summary requires a previous human-reviewed guide",
		);
}

/**
 * Validate a newly authored guide. Briefs report authoring-rule and evidence
 * problems together, so one correction round can fix them all.
 */
export function validateGuide(context: ExecutionContext, value: unknown): void {
	if (!isReviewBrief(value)) {
		GeneratedGuideSchema.parse(value);
		validateGuideCoverage(context, value);
		return;
	}
	const issues: OutputValidationError["issues"] = [];
	const add = (error: unknown) => {
		for (const issue of outputValidationError(value, error).issues)
			if (
				!issues.some(
					(i) => i.path === issue.path && i.message === issue.message,
				)
			)
				issues.push(issue);
	};
	const authored = GeneratedBriefSchema.safeParse(value);
	if (!authored.success) add(authored.error);
	try {
		validateBriefCoverage(context, value);
	} catch (error) {
		add(error);
	}
	if (issues.length) throw new OutputValidationError(value, issues);
}

export function validateGuideGeneration(value: unknown): void {
	if (isReviewBrief(value)) GeneratedBriefSchema.parse(value);
	else GeneratedGuideSchema.parse(value);
}

/** Brief steps own their contract; agents never need to author it. */
export function stampGuideContract(
	step: { id: string; guideContract?: string },
	value: unknown,
): unknown {
	if (
		step.id !== "guide" ||
		!step.guideContract ||
		!value ||
		typeof value !== "object" ||
		Array.isArray(value)
	)
		return value;
	return { ...value, contract: step.guideContract };
}

/** Attach authoritative coverage instead of trusting an agent-authored coverage table. */
export function attachRequirementCoverage(
	context: ExecutionContext,
	value: unknown,
): unknown {
	const aggregate = aggregateForContext(context);
	if (!aggregate) return value;
	const guide = isReviewBrief(value) ? value : GuideSchema.parse(value);
	const inventory = aggregate.baseline.inventory;
	return {
		...guide,
		requirementCoverage: {
			inventoryVersion: inventory.version,
			inventoryDigest: inventory.digest,
			headSha: aggregate.baseline.headSha,
			baseSha: aggregate.baseline.baseSha,
			assessments: activeRequirements(inventory).map((r) => {
				const assessment = aggregate.coverage.find(
					(a) => a.requirementId === r.id,
				)!;
				return {
					...assessment,
					criterion: r.criterion,
					decision: inventory.decisions.find(
						(d) => d.id === assessment.decisionId,
					),
				};
			}),
			reviewers: [
				...new Set([
					...aggregate.reviewers.map((r) => r.stamp.reviewer),
					...aggregate.rawFindings.map((f) => f.reviewer),
				]),
			].map((reviewer) => {
				const receipt = aggregate.reviewers.find(
					(r) => r.stamp.reviewer === reviewer,
				);
				return {
					reviewer,
					summary:
						receipt?.summary ?? "Retained findings from prior review rounds",
					findings: aggregate.rawFindings
						.filter((f) => f.reviewer === reviewer)
						.map((f) => ({ ...f, id: f.id.slice(reviewer.length + 1) })),
					disagreements: receipt?.disagreements ?? [],
					disputeResolutions: receipt?.disputeResolutions ?? [],
				};
			}),
		},
	};
}
