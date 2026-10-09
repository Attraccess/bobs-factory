import { expect, it } from "vitest";
import {
	isInternalPublication,
	presentLinearActivity,
	presentLinearPublication,
	publicFailure,
} from "../src/LinearPublication.js";

it("keeps intentional Markdown and removes terminal escapes", () => {
	const body = 'Example:\n\n```json\n{"status":"completed"}\n```';
	expect(
		presentLinearActivity({
			type: "thought",
			body: `\u001b[32m${body}\u001b[0m`,
		}),
	).toEqual({ type: "thought", body });
	expect(isInternalPublication('```json\n{"color":"blue"}\n```')).toBe(false);
});
it("suppresses complete and truncated internal records without serializing them", () => {
	for (const body of [
		'{"status":"completed","summary":"done"}',
		'{"structuredContent":{"content":[]}}',
		'{"status":"completed",',
		'## Factory decision records\n\n{"decisions":[]}',
	])
		expect(presentLinearActivity({ type: "response", body })).toBeUndefined();
});
it("publishes only a decision with rationale, without requirements or answer history", () => {
	const event = {
		purpose: "decision" as const,
		eventId: "D1",
		owner: "decisions",
		source: { runId: "run" },
		content: {
			question: "Which default?",
			answer: "English",
			reason: "Shared readers",
		},
	};
	expect(presentLinearPublication(event)).toEqual({
		destination: "comment",
		markdown: "**Which default?**\n\nEnglish\n\nRationale: Shared readers",
		version: 1,
	});
	expect(presentLinearPublication({ ...event, content: {} }).destination).toBe(
		"suppressed",
	);
});
it("preserves complete questions and surfaces tool failures without envelopes", () => {
	const body =
		"1. Which provider?\n\n- A: first\n- B: second\n\nRecommended: A, because it supports recovery.";
	expect(presentLinearActivity({ type: "elicitation", body })).toEqual({
		type: "thought",
		body,
	});
	expect(
		presentLinearActivity({
			type: "action",
			action: "Read",
			result: "bulk source",
		}),
	).toBeUndefined();
	expect(
		publicFailure(
			'{"content":[{"type":"text","text":"{\\"error\\":\\"Access denied. Restore the repository token.\\"}"}]}',
		),
	).toBe("Access denied. Restore the repository token.");
});

it("includes actionable blockers and review feedback without raw records", () => {
	expect(
		presentLinearPublication({
			purpose: "outcome",
			eventId: "review",
			owner: "review",
			source: {},
			content: {
				status: "blocked",
				summary: "Rendering could not be checked.",
				blockers: ["Supply an authenticated test session."],
				feedback: ['{"status":"failed"}', "Retain the recovery evidence."],
			},
		}),
	).toEqual({
		destination: "transcript",
		markdown:
			"Rendering could not be checked.\n\nNeeds attention:\n\n- Supply an authenticated test session.\n\nFeedback:\n\n- Retain the recovery evidence.",
		version: 1,
	});
});

it("keeps operational prose in thoughts so Linear cannot create implicit comments", () => {
	for (const type of ["response", "elicitation", "error"]) {
		expect(
			presentLinearActivity({ type, body: "Waiting for your answer." }),
		).toEqual({
			type: "thought",
			body: "Waiting for your answer.",
		});
	}
	expect(
		presentLinearActivity({
			type: "action",
			action: "Build failed",
			result: "Access denied",
		}),
	).toEqual({
		type: "thought",
		body: "Build failed\n\nAccess denied",
	});
});

it("extracts actionable diagnostics from bulk text and structured errors", () => {
	const raw = `${"Building module successfully\n".repeat(2000)}src/app.ts:42 error TS2345: Invalid argument\nExpected a string.\n${"Build details\n".repeat(1000)}`;
	const expected =
		"Building module successfully\nsrc/app.ts:42 error TS2345: Invalid argument\nExpected a string.\nBuild details…\n\nFull output is retained in Factory.";
	expect(publicFailure(raw)).toBe(expected);
	expect(publicFailure(JSON.stringify({ error: raw }))).toBe(expected);
	expect(presentLinearActivity({ type: "error", body: raw })).toEqual({
		type: "thought",
		body: expected,
	});
	expect(
		publicFailure(`error: ${"x".repeat(10000)}`).length,
	).toBeLessThanOrEqual(2400);
});

it("suppresses legacy fenced review contracts while retaining intentional examples", () => {
	const record = '```json\n{"findings":[],"summary":"Review completed"}\n```';
	expect(
		presentLinearActivity({ type: "response", body: record }),
	).toBeUndefined();
	const example = `Example review contract:\n\n${record}`;
	expect(presentLinearActivity({ type: "thought", body: example })).toEqual({
		type: "thought",
		body: example,
	});
});
