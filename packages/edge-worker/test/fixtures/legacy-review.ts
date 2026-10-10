import {
	defaultWorkflows,
	legacyReviewSteps,
} from "../../src/factory/defaultWorkflows.js";
import { StepSchema, type Workflow } from "../../src/factory/Workflow.js";

/** Exercise accepted/custom legacy contracts independently of new stock review. */
export function legacyReviewWorkflows(): Workflow[] {
	return structuredClone(defaultWorkflows).map((w) => {
		if (w.id !== "factory-pipeline") return w;
		w.steps = legacyReviewSteps.map((step) => StepSchema.parse(step));
		w.steps.find((s) => s.id === "code-review")!.name =
			"Legacy reviewer fixture";
		return w;
	});
}

/** Independent editable graphs for tests that launch custom behavior. */
export function localReviewWorkflows(
	definitions = legacyReviewWorkflows(),
): Workflow[] {
	const mapping: Record<string, string> = {
		factory: "fixture-factory",
		takeover: "fixture-takeover",
		"factory-pipeline": "fixture-pipeline",
	};
	const locals = structuredClone(definitions)
		.filter((w) => w.id !== "simple")
		.map((w) => {
			const original = w.id;
			w.id = mapping[w.id] ?? w.id;
			w.labels = [];
			const rewrite = (steps: Workflow["steps"]) => {
				for (const step of steps) {
					if (step.workflow)
						step.workflow = mapping[step.workflow] ?? step.workflow;
					for (const group of step.groups ?? []) rewrite(group);
				}
			};
			rewrite(w.steps);
			if (original === "factory-pipeline") w.internal = true;
			return w;
		});
	return [...structuredClone(defaultWorkflows), ...locals];
}
