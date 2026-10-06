import { expect, it } from "vitest";
import { resolveWorkflowSelector } from "../src/factory/WorkflowSelector.js";

it.each([
	"[workflow=factory]",
	"\\[workflow=factory\\]",
	"[WORKFLOW=factory]",
	"Bob's task [workflow=factory]",
	"[workflow=factory] again [workflow=factory]",
])("reads Cyrus bracket grammar in %s", (comment) => {
	expect(resolveWorkflowSelector({ comment })).toEqual({
		workflowId: "factory",
		selection: { source: "comment-selector", selector: "[workflow=factory]" },
	});
});
it.each([
	"> [workflow=takeover]",
	"```ts\n[workflow=takeover]\n```",
	"~~~\n[workflow=takeover]\n~~~",
	"    [workflow=takeover]",
	"\t[workflow=takeover]",
	"`[workflow=takeover]`",
	"``[workflow=takeover]``",
	'"[workflow=takeover]"',
	"'[workflow=takeover]'",
	"“[workflow=takeover]”",
	"‘[workflow=takeover]’",
])("ignores examples: %s", (example) => {
	expect(
		resolveWorkflowSelector({ comment: `${example}\n\n[workflow=factory]` })
			.workflowId,
	).toBe("factory");
});
it.each([
	"[workflow=]",
	"[workflow =factory]",
	"[workflow=factory",
	"[workflow=a b]",
	"[workflow]",
])("rejects malformed winning attempts: %s", (comment) => {
	expect(() =>
		resolveWorkflowSelector({ comment, description: "[workflow=simple]" }),
	).toThrow("Malformed");
});
it("honors source priority and only checks conflicts in the winning source", () => {
	const description = "[workflow=simple] [workflow=takeover]";
	expect(
		resolveWorkflowSelector({
			manual: "factory",
			comment: "[workflow=bad",
			description,
		}).workflowId,
	).toBe("factory");
	expect(
		resolveWorkflowSelector({ comment: "[workflow=factory]", description })
			.workflowId,
	).toBe("factory");
	expect(() =>
		resolveWorkflowSelector({
			comment: "[workflow=simple] [workflow=takeover]",
		}),
	).toThrow("Conflicting");
	expect(
		resolveWorkflowSelector({
			comment: "`[workflow=simple]`",
			description: "[workflow=factory]",
		}).selection?.source,
	).toBe("description-selector");
	expect(resolveWorkflowSelector({ description: "plain text" })).toEqual({});
});
