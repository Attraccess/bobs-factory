import { z } from "zod";
import {
	CaptureSchema,
	filterReview,
	QaCaptureSchema,
} from "./FactoryTools.js";
import { FeedbackPolicySchema } from "./FeedbackPolicy.js";

import { QaScopeFieldsSchema, scopeIssues } from "./Qa.js";

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
const short = (max: number) => z.string().trim().min(1).max(max);
const compactChapter = {
	tldr: short(70),
	beforeShort: short(50),
	afterShort: short(50),
	risk: z.object({ level: z.enum(["low", "medium", "high"]), text: short(70) }),
	keyChecks: z
		.array(z.object({ do: short(60), expect: short(60) }))
		.min(1)
		.max(3),
};
export const FlowSchema = z.object({
	title: short(100),
	steps: z
		.array(z.object({ label: short(60), detail: short(300) }))
		.min(2)
		.max(8),
});
const connection = z.object({
	source: short(80),
	target: short(80),
	label: short(50).optional(),
	weak: z.boolean().optional(),
});
export const SystemSchema = z.object({
	lanes: z
		.array(z.object({ id: short(80), name: short(60) }))
		.min(1)
		.max(8),
	parts: z
		.array(
			z.object({
				id: short(80),
				label: short(60),
				laneId: short(80),
				status: z.enum(["new", "changed", "unchanged", "legacy"]),
			}),
		)
		.min(1)
		.max(48),
	before: z.array(connection).max(96),
	after: z.array(connection).max(96),
});
export type GuideSystem = z.infer<typeof SystemSchema>;
export type GuideFlow = z.infer<typeof FlowSchema>;
export const ReviewFilesReferenceSchema = z.object({
	snapshotId: text,
	baseSha: text,
	headSha: text,
});

export const QaScopeSchema = VisualScopeSchema.and(
	QaScopeFieldsSchema,
).superRefine((scope, context) => {
	for (const message of scopeIssues(scope))
		context.addIssue({ code: "custom", message });
});
export const GuideSchema = z.object({
	tldr: short(90).optional(),
	system: SystemSchema.optional(),
	reviewFiles: ReviewFilesReferenceSchema.optional(),
	revisionSummary: z.boolean().optional(),
	revisionNote: text.max(600).optional(),
	previousHeadSha: text.optional(),
	chapters: z
		.array(
			z.object({
				tldr: compactChapter.tldr.optional(),
				beforeShort: compactChapter.beforeShort.optional(),
				afterShort: compactChapter.afterShort.optional(),
				risk: compactChapter.risk.optional(),
				keyChecks: compactChapter.keyChecks.optional(),
				systemPartIds: z.array(short(80)).optional(),
				flow: FlowSchema.optional(),
				id: text.max(80),
				title: text.max(120),
				summary: text.max(600),
				before: text.max(600),
				after: text.max(600),
				requirementIndexes: z.array(z.number().int().nonnegative()).min(1),
				files: z.array(text),
				screenshots: z.array(
					z.object({
						area: text,
						state: text,
						caption: text,
						device: z.enum(["Desktop", "Mobile", "Email", "Reader"]).optional(),
						language: short(50).optional(),
					}),
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
		summaryShort: short(160).optional(),
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
/** Reading remains additive; all newly authored guides require the compact contract. */
export const GeneratedGuideSchema = GuideSchema.extend({
	tldr: short(90),
	decision: GuideSchema.shape.decision.extend({ summaryShort: short(160) }),
	chapters: z
		.array(GuideSchema.shape.chapters.unwrap().element.extend(compactChapter))
		.min(1)
		.max(20),
}).superRefine((guide, ctx) => {
	const fail = (path: (string | number)[], message: string) =>
		ctx.addIssue({ code: "custom", path, message });
	const unique = (items: { id: string }[], path: string[]) => {
		const ids = new Set<string>();
		items.forEach((item, i) => {
			if (ids.has(item.id)) fail([...path, i, "id"], "IDs must be unique");
			ids.add(item.id);
		});
		return ids;
	};
	unique(guide.chapters, ["chapters"]);
	const system = guide.system;
	const partIds = system
		? unique(system.parts, ["system", "parts"])
		: new Set<string>();
	if (system) {
		const lanes = unique(system.lanes, ["system", "lanes"]);
		system.parts.forEach((part, i) => {
			if (!lanes.has(part.laneId))
				fail(["system", "parts", i, "laneId"], "Unknown lane ID");
		});
		for (const mode of ["before", "after"] as const) {
			const edges = new Set<string>();
			system[mode].forEach((edge, i) => {
				for (const endpoint of ["source", "target"] as const)
					if (!partIds.has(edge[endpoint]))
						fail(["system", mode, i, endpoint], "Unknown part ID");
				const key = JSON.stringify([edge.source, edge.target]);
				if (edges.has(key))
					fail(
						["system", mode, i],
						"Directed endpoint pairs must be unique; combine labels for the same connection",
					);
				edges.add(key);
			});
		}
	}
	guide.chapters.forEach((chapter, i) => {
		const seen = new Set<string>();
		chapter.systemPartIds?.forEach((id, j) => {
			if (!partIds.has(id) || seen.has(id))
				fail(
					["chapters", i, "systemPartIds", j],
					"Part ID must exist in system and appear only once",
				);
			seen.add(id);
		});
	});
});
export type Guide = z.infer<typeof GuideSchema>;
export type GuideChapter = NonNullable<Guide["chapters"]>[number];
export function validateFactoryResult(
	step: string,
	output: unknown,
	qaContract?: "qa-v1",
): unknown {
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
		case "implement":
			return z
				.object({
					status: z.enum(["completed", "blocked"]),
					summary: text,
					checks: z.array(text),
					questions: z.array(text),
				})
				.refine(
					(result) =>
						result.status === "blocked"
							? result.questions.length > 0
							: result.questions.length === 0,
					"Blocked implementation requires a question to resolve the blocker; completed implementation must have no questions",
				)
				.parse(output);
		case "code-review":
		case "visual-review": {
			const review = filterReview(output);
			if (step === "visual-review" && qaContract) {
				z.object({ qaContract: z.literal(qaContract) }).parse(output);
				return { ...review, qaContract };
			}
			// Only the frozen step definition can opt a run into QA.
			delete review.qaContract;
			delete review.qaReviewStamp;
			return review;
		}
		case "visual-scope":
			return qaContract
				? QaScopeSchema.parse(output)
				: VisualScopeSchema.parse(output);
		case "capture":
			return qaContract
				? QaCaptureSchema.parse(output)
				: CaptureSchema.parse(output);
		case "guide":
			return GuideSchema.parse(output);
		case "ci-fix":
			return z
				.object({
					questions: z.array(text).optional(),
					addressedCommentIds: z.array(text).optional(),
					addressedReviewIds: z.array(text).optional(),
					reviewRequired: z.boolean().optional(),
					feedbackPolicies: z.array(FeedbackPolicySchema).optional(),
					commentAssessments: z
						.array(
							z.object({
								id: text,
								bodySha256: z.string().regex(/^[a-f0-9]{64}$/),
							}),
						)
						.optional(),
				})
				.passthrough()
				.parse(output);
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
