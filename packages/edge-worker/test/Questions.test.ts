import { expect, it } from "vitest";
import { validateFactoryResult } from "../src/factory/FactoryResults.js";
import {
	isExplanationRequest,
	normalizeQuestionResult,
} from "../src/factory/Questions.js";
import {
	answerChoice,
	resolveAnswers,
	serializeAnswers,
} from "../src/factory/web/question-answers.js";

const recommendation = {
	questionIndex: 0,
	answer: "Use the existing approach.",
	reason: "It meets the requirement.",
};
it("retains structured suggestions and custom fields without requiring metadata from legacy roles", () => {
	expect(
		normalizeQuestionResult({
			questions: ["Approach?"],
			questionRecommendations: [recommendation],
			other: 1,
		}),
	).toEqual({
		questions: ["Approach?"],
		questionRecommendations: [recommendation],
		other: 1,
	});
	expect(normalizeQuestionResult({ questions: ["Access?"] })).toEqual({
		questions: ["Access?"],
	});
	expect(
		validateFactoryResult("clarify", {
			questions: ["Approach?"],
			questionRecommendations: [recommendation],
			decisions: [],
			requirements: ["Feature"],
		}),
	).toEqual({
		questions: ["Approach?"],
		questionRecommendations: [recommendation],
		decisions: [],
		requirements: ["Feature"],
	});
});
it.each([
	[{ ...recommendation, questionIndex: -1 }],
	[{ ...recommendation, questionIndex: 0.5 }],
	[{ ...recommendation, questionIndex: 1 }],
	[recommendation, recommendation],
	[{ ...recommendation, answer: " " }],
	[{ ...recommendation, reason: " " }],
	null,
])("rejects malformed supplied recommendations: %j", (questionRecommendations) => {
	expect(() =>
		normalizeQuestionResult({
			questions: ["Approach?"],
			questionRecommendations,
		}),
	).toThrow();
	expect(() =>
		validateFactoryResult("implement", {
			status: "blocked",
			summary: "Decision needed",
			checks: [],
			questions: ["Approach?"],
			questionRecommendations,
		}),
	).toThrow();
});
it("resolves default and mixed choices, keeping blank custom text blank and legacy drafts custom", () => {
	const questions = ["Approach?", "Access?"];
	expect(resolveAnswers(questions, [recommendation], {})).toEqual([
		recommendation.answer,
		"",
	]);
	expect(answerChoice("old draft", recommendation)).toEqual({
		mode: "custom",
		custom: "old draft",
	});
	expect(
		resolveAnswers(questions, [recommendation], {
			0: { mode: "custom", custom: " " },
			1: "granted",
		}),
	).toEqual([" ", "granted"]);
	const answers = resolveAnswers(questions, [recommendation], {
		0: { mode: "recommendation", custom: "saved custom" },
		1: { mode: "custom", custom: "granted" },
	});
	expect(serializeAnswers(questions, answers)).toBe(
		"1. Approach?\nUse the existing approach.\n\n2. Access?\ngranted",
	);
});

it("uses retained custom text when a reviewed batch no longer has a recommendation", () => {
	expect(
		resolveAnswers(["Access?"], [], {
			0: { mode: "recommendation", custom: "Account 1" },
		}),
	).toEqual(["Account 1"]);
});

it("recognizes explanation requests without treating leading explicit decisions as requests", () => {
	for (const text of [
		"Please explain this more simply. I have not chosen an option or authorized paid tests.",
		"I don't understand",
		"Could you rephrase this?",
		"What do you mean?",
	])
		expect(isExplanationRequest(text)).toBe(true);
	for (const text of [
		"Use mocks",
		"Proceed",
		"Use mocks. Please explain the limitation.",
	])
		expect(isExplanationRequest(text)).toBe(false);
});

it("recognizes explanation text inside complete dashboard question batches", () => {
	const questions = [
		"Which tests?\n- Use simulated agents\n- Use paid agents",
		"Which platform?",
	];
	expect(
		isExplanationRequest(
			serializeAnswers(questions, ["Please explain more simply", "Linux"]),
			questions,
		),
	).toBe(true);
	expect(
		isExplanationRequest(
			serializeAnswers(questions, ["Use simulated agents", "Linux"]),
			questions,
		),
	).toBe(false);
});
