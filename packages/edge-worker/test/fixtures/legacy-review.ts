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
