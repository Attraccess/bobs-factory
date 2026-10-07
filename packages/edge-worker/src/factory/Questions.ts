import { z } from "zod";

export const QuestionRecommendationSchema = z.object({
	questionIndex: z.number().int().nonnegative(),
	answer: z.string().trim().min(1),
	reason: z.string().trim().min(1),
});
export type QuestionRecommendation = z.infer<
	typeof QuestionRecommendationSchema
>;
export const QuestionFieldsSchema = z
	.object({
		questions: z.array(
			z.string().refine((value) => !!value.trim(), "Question must be nonblank"),
		),
		questionRecommendations: z.array(QuestionRecommendationSchema).optional(),
	})
	.superRefine((result, ctx) => {
		const seen = new Set<number>();
		result.questionRecommendations?.forEach((item, i) => {
			if (
				item.questionIndex >= result.questions.length ||
				seen.has(item.questionIndex)
			)
				ctx.addIssue({
					code: "custom",
					path: ["questionRecommendations", i, "questionIndex"],
					message: "Use a unique index within this questions array",
				});
			seen.add(item.questionIndex);
		});
	});
/** Validate additive metadata without stripping custom role fields. */
export function normalizeQuestionResult(
	value: unknown,
): Record<string, unknown> {
	const fields = QuestionFieldsSchema.parse(value);
	return { ...(value as Record<string, unknown>), ...fields };
}
export function questionNotification(
	questions: string[],
	recommendations?: QuestionRecommendation[],
): string {
	return (
		questions
			.map((q, i) => {
				const suggestion = recommendations?.find(
					(item) => item.questionIndex === i,
				);
				return `${i + 1}. ${q}${suggestion ? `\n\nSuggested answer: ${suggestion.answer}\n\nWhy: ${suggestion.reason}` : ""}`;
			})
			.join("\n\n") +
		"\n\nSuggestions require your explicit reply or Send answers submission in Factory before work resumes."
	);
}

/** Applied at execution time, including custom roles and frozen in-flight recipes. */
export function questionInstructions(runId: string): string {
	return `When asking the human a question, assume they see only the question and answer box. They cannot see your files, tool results, reasoning, earlier messages or other artifacts. Each string in questions must stand on its own: briefly state the relevant facts, why their input is needed, then ask one concrete question. Name the feature, warning, rule or earlier decision instead of saying "these warnings", "that rule" or "as discussed". For a rule-based blocker, name/link the source and explain the rule in everyday words. Explain what each choice changes, any material risk, and your recommendation when supported by evidence. Distinguish existing problems from problems introduced by this task; do not invent facts or hide uncertainty. Use short sentences (usually 10–20 words) and familiar words; aim for 2–4 sentences plus short choices, usually under 100 words total. Do not cram the explanation into one long sentence or make the human interpret implementation details. Translate jargon: "security warning" instead of "advisory", "fix" instead of "remediation", "permission to proceed despite the rule" instead of "scoped policy exception". Put secondary technical references in links or a brief optional detail, while keeping the facts needed to decide in the question itself. Ask only for information or decisions you cannot obtain or resolve from the available context and existing authorization. A request to explain or rephrase is not an answer, approval or exception; preserve the blocker until the human actually decides.
Questions support Markdown. Put essential context directly in the question; links and visuals only supplement it. Optionally include a small text flow diagram in a fenced code block, or a real PNG/JPEG image when it makes the decision easier to understand. Do not use Mermaid (it is not rendered). Save images directly in the supplied evidence directory with unique filenames containing only letters, digits, dots, underscores or hyphens, then embed them as ![short descriptive caption](/api/runs/${runId}/question-images/FILENAME.png). Inspect images before including them, describe what the human should notice, and never claim evidence you have not verified. Keep visuals optional; a text-only question is usually enough. Keep questions as strings and preserve all other requested role fields. Add optional sibling questionRecommendations: [{"questionIndex":0,"answer":"recommended answer","reason":"short evidence-based explanation"}]. Indices are zero-based within this exact questions array, with at most one recommendation per question. Generate recommendations in the same response for decisions supported by the available evidence. Never invent an unknowable fact, credential or access; omit its recommendation and explain the needed input in the question. Recommendations are suggestions only, never accepted decisions or authorization; explicit human submission is required. Omit metadata or use an empty array when no recommendation is justified.`;
}
