import { z } from "zod";
import { CaptureSchema, filterReview } from "./FactoryTools.js";

const text = z.string().min(1);
export const VisualScopeSchema = z
	.object({
		changed: z.boolean(),
		captureBudget: z.number().int().min(1).max(48).default(24),
		budgetReason: text.optional(),
		nonVisualFiles: z.array(text).optional(),
		areas: z.array(
			z.object({
				name: text,
				url: text,
				states: z.array(text).min(1),
				instructions: text,
				rationale: text.optional(),
				dependencies: z.array(text).optional(),
				changed: z.boolean().optional(),
			}),
		),
	})
	.refine(
		(scope) =>
			scope.changed ? scope.areas.length > 0 : scope.areas.length === 0,
		"Visual changes require an area inventory",
	)
	.superRefine((scope, context) => {
		const count = scope.areas.reduce(
			(total, area) => total + area.states.length,
			0,
		);
		if (count > scope.captureBudget)
			context.addIssue({
				code: "custom",
				message: `Select representative states: ${count} exceeds captureBudget ${scope.captureBudget}`,
			});
		if (scope.captureBudget > 24 && !scope.budgetReason)
			context.addIssue({
				code: "custom",
				message: "Capture budgets above 24 require a concrete budgetReason",
			});
		const names = scope.areas.map((area) => area.name);
		if (
			new Set(names).size !== names.length ||
			scope.areas.some(
				(area) => new Set(area.states).size !== area.states.length,
			)
		)
			context.addIssue({
				code: "custom",
				message: "Visual areas/states must be unique",
			});
	});
export const GuideSchema = z.object({
	revisionSummary: z.boolean().optional(),
	revisionNote: text.max(600).optional(),
	previousHeadSha: text.optional(),
	chapters: z
		.array(
			z.object({
				id: text.max(80),
				title: text.max(120),
				summary: text.max(600),
				before: text.max(600),
				after: text.max(600),
				requirementIndexes: z.array(z.number().int().nonnegative()).min(1),
				files: z.array(text),
				screenshots: z.array(
					z.object({ area: text, state: text, caption: text }),
				),
				diagrams: z
					.array(
						z.object({
							title: text,
							steps: z
								.array(
									z.object({ label: text.max(100), detail: text.max(300) }),
								)
								.min(2)
								.max(8),
						}),
					)
					.max(3),
				reviewChecks: z.array(text.max(300)).min(1).max(8),
				risks: z.array(text),
				evidence: z.array(text),
			}),
		)
		.min(1)
		.max(20)
		.optional(),
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
