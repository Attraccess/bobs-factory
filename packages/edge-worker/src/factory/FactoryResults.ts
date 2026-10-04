import { z } from "zod";
import { CaptureSchema, filterReview } from "./FactoryTools.js";

const text = z.string().min(1);
export const VisualScopeSchema = z
	.object({
		changed: z.boolean(),
		areas: z.array(
			z.object({
				name: text,
				url: text,
				states: z.array(text).min(1),
				instructions: text,
			}),
		),
	})
	.refine(
		(scope) =>
			scope.changed ? scope.areas.length > 0 : scope.areas.length === 0,
		"Visual changes require an area inventory",
	);
export const GuideSchema = z.object({
	goal: text,
	summary: text,
	decision: z.object({
		status: z.enum(["ready", "needs-attention", "blocked"]),
		summary: text,
	}),
	requirements: z
		.array(
			z.object({
				criterion: text,
				status: z.enum(["supported", "gap", "unverified", "waived"]),
				evidence: z.array(text).min(1),
			}),
		)
		.min(1),
	behavior: z.array(z.object({ scenario: text, before: text, after: text })),
	checks: z.array(text),
	risks: z.array(text),
	reviewInstructions: z.array(text).min(1),
});
export function validateFactoryResult(step: string, output: unknown): unknown {
	switch (step) {
		case "clarify":
			return z
				.object({
					questions: z.array(text),
					decisions: z.array(
						z.object({ question: text, answer: text, reason: text }),
					),
					requirements: z.array(text).min(1),
				})
				.parse(output);
		case "plan":
			return z
				.object({
					plan: text,
					assets: z.array(z.object({ path: text, purpose: text })),
				})
				.parse(output);
		case "plan-review":
			return z
				.object({ approved: z.boolean(), feedback: z.array(text) })
				.parse(output);
		case "code-review":
		case "visual-review":
			return filterReview(output);
		case "visual-scope":
			return VisualScopeSchema.parse(output);
		case "capture":
			return CaptureSchema.parse(output);
		case "guide":
			return GuideSchema.parse(output);
		case "code-fix":
		case "visual-fix":
			return z
				.object({
					summary: text,
					dispositions: z.array(
						z.object({
							id: text,
							status: z.enum(["fixed", "rejected"]),
							reason: text,
						}),
					),
				})
				.parse(output);
		default:
			return output;
	}
}
