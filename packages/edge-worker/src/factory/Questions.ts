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
	return `If your role permits or requires a human question, apply these rules; they do not enable questions or pauses beyond your role's contract. Assume the human sees only the question and answer box, without your files, tool results, reasoning or earlier messages.
Each string in questions asks for ONE decision and stands on its own. Lead with a short, direct question. Follow it with 1–3 short sentences explaining the relevant facts and why you need an answer. For a choice, use 2–3 short Markdown bullets describing what each option does and its practical consequence. A shared decision affecting several checks can be one question, but explain the checks in everyday words; never substitute a list of internal test/finding IDs for that explanation. Split unrelated decisions into separate questions. Aim for fewer than 80 words per question when possible, without omitting facts needed to decide.
Name the feature, warning, rule or earlier decision instead of saying "these checks", "that rule" or "as discussed". For a rule-based blocker, name/link its source and explain the rule in everyday words. State any material risk or untested behavior and distinguish existing problems from problems introduced by this task. If an option uses paid services, say so; give an estimated cost only when known. Do not invent facts, costs or certainty. Include a recommendation when supported by evidence, with a short reason; use questionRecommendations to keep the suggested answer separately selectable.
For example, when simulated-agent checks passed but real-agent checks remain required, ask: "Should I run the remaining tests with real agents? Tests with simulated agents passed. They do not confirm that real agents generate suitable suggestions and resume after your reply.\n\n- Run real-agent tests: uses provider credits; the cost is not yet known.\n- Continue with mock results: leave real-agent behavior unverified." This is a writing example, not evidence or permission to skip required checks. Explain the actual missing behavior in your own question and offer only options allowed by the applicable rules.
Use familiar words: "security warning" instead of "advisory", "fix" instead of "remediation", "allow skipping this test" instead of "waive its live-only facets". Keep secondary references in a clearly labeled technical detail or link. The main question must be understandable without them. Ask only for information or decisions you cannot obtain or resolve from the available context and existing authorization. A request to explain or rephrase is not an answer, approval or exception; preserve the blocker until the human actually decides.
Questions support Markdown. Put essential context directly in the question; links and visuals only supplement it. Optionally include a small text flow diagram in a fenced code block, or a real PNG/JPEG image when it makes the decision easier to understand. Do not use Mermaid (it is not rendered). Save images directly in the supplied evidence directory with unique filenames containing only letters, digits, dots, underscores or hyphens, then embed them as ![short descriptive caption](/api/runs/${runId}/question-images/FILENAME.png). Inspect images before including them, describe what the human should notice, and never claim evidence you have not verified. Keep visuals optional; a text-only question is usually enough. Keep questions as strings and preserve all other requested role fields. Add optional sibling questionRecommendations: [{"questionIndex":0,"answer":"recommended answer","reason":"short evidence-based explanation"}]. Indices are zero-based within this exact questions array, with at most one recommendation per question. Generate recommendations in the same response for decisions supported by the available evidence. Never invent an unknowable fact, credential or access; omit its recommendation and explain the needed input in the question. Recommendations are suggestions only, never accepted decisions or authorization; explicit human submission is required. Omit metadata or use an empty array when no recommendation is justified.`;
}

/** Obvious explanation requests from existing free-text/ticket reply clients.
 * New clients can specify the reply kind explicitly, including other languages. */
export function isExplanationRequest(
	text: string,
	questions: string[] = [],
): boolean {
	// Existing dashboard submissions prefix each reply with its complete question.
	// Inspect the reply text, not the question wording or its choices.
	if (questions.length && text.startsWith(`1. ${questions[0]}\n`)) {
		let remaining = text;
		const replies: string[] = [];
		for (let i = 0; i < questions.length; i++) {
			const prefix = `${i + 1}. ${questions[i]}\n`;
			if (!remaining.startsWith(prefix)) return false;
			remaining = remaining.slice(prefix.length);
			const next =
				i + 1 < questions.length
					? remaining.indexOf(`\n\n${i + 2}. ${questions[i + 1]}\n`)
					: -1;
			if (i + 1 < questions.length && next < 0) return false;
			replies.push(next < 0 ? remaining : remaining.slice(0, next));
			remaining = next < 0 ? "" : remaining.slice(next + 2);
		}
		return replies.some((reply) => isExplanationRequest(reply));
	}
	return /^(?:(?:please|can you|could you|would you)\s+)?(?:explain|rephrase|clarify|simplify)\b|^(?:i (?:do not|don't) understand|what do you mean|can you (?:make|say) (?:this|that) (?:simpler|more simply))\b/i.test(
		text.trim(),
	);
}
