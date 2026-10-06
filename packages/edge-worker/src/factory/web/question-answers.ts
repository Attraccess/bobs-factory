export type AnswerChoice = {
	mode: "recommendation" | "custom";
	custom: string;
};
export type AnswerDraft = Record<number, AnswerChoice | string>;
export type Recommendation = {
	questionIndex: number;
	answer: string;
	reason: string;
};
/** Historical text drafts are always deliberate custom answers. */
export function answerChoice(
	value: AnswerChoice | string | undefined,
	recommendation?: Recommendation,
): AnswerChoice {
	if (typeof value === "string") return { mode: "custom", custom: value };
	if (value && !recommendation) return { ...value, mode: "custom" };
	return (
		value ?? { mode: recommendation ? "recommendation" : "custom", custom: "" }
	);
}
export function resolveAnswers(
	questions: string[],
	recommendations: Recommendation[],
	draft: AnswerDraft,
): string[] {
	return questions.map((_, i) => {
		const recommendation = recommendations.find(
			(item) => item.questionIndex === i,
		);
		const choice = answerChoice(draft[i], recommendation);
		return choice.mode === "recommendation"
			? (recommendation?.answer ?? "")
			: choice.custom;
	});
}
export function serializeAnswers(
	questions: string[],
	answers: string[],
): string {
	return questions.map((q, i) => `${i + 1}. ${q}\n${answers[i]}`).join("\n\n");
}
