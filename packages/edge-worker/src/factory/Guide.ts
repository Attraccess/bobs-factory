import { defaultWorkflows } from "./defaultWorkflows.js";
import { GuideSchema } from "./FactoryResults.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

/** Validate guide coverage against the entire PR, not the last agent's delta. */
export function validateGuideCoverage(
	context: ExecutionContext,
	value: unknown,
): void {
	const guide = GuideSchema.parse(value);
	const stock = defaultWorkflows
		.find((w) => w.id === "factory-pipeline")!
		.steps.find((s) => s.id === "guide")!;
	if (!guide.chapters) {
		if (context.step.prompt === stock.prompt)
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
	for (const chapter of guide.chapters) {
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
	if (!scope && context.step.prompt === stock.prompt && !context.step.inputs)
		throw new Error(
			"Whole-PR revision scope is unavailable; cannot produce a complete guide",
		);
	if (scope) {
		const omitted = scope.files.filter((file) => !files.has(file));
		if (omitted.length)
			throw new Error(`Guide chapters omit PR files: ${omitted.join(", ")}`);
		if ([...files].some((file) => !scope.files.includes(file)))
			throw new Error("Guide chapter files must be actual changed PR files");
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
