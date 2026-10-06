import type { WorkflowTriggerOrigin } from "cyrus-core";

export class WorkflowSelectionError extends Error {}

/** Keep character positions while excluding examples. Quotes must close on the
 * same line and start outside a word; ordinary apostrophes are never delimiters. */
function selectorText(text: string): string {
	let fence: { character: string; length: number } | undefined;
	let quoteParagraph = false;
	const visible = text
		.split("\n")
		.map((line) => {
			if (!line.trim()) quoteParagraph = false;
			if (/^ {0,3}>/.test(line)) quoteParagraph = true;
			if (quoteParagraph) return " ".repeat(line.length);
			const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
			if (fence) {
				if (
					marker &&
					marker[1]![0] === fence.character &&
					marker[1]!.length >= fence.length &&
					/^\s*$/.test(line.slice(marker[0].length))
				)
					fence = undefined;
				return " ".repeat(line.length);
			}
			if (marker) {
				fence = { character: marker[1]![0]!, length: marker[1]!.length };
				return " ".repeat(line.length);
			}
			if (/^ {0,3}>|^( {4}|\t)/.test(line)) return " ".repeat(line.length);
			return line;
		})
		.join("\n");
	// Inline code can cross a newline. Quoted prose must close on one line.
	return visible.replace(
		/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)|(?<![\w\\])"(?:\\[^\n]|[^"\\\n])*"|(?<![\w\\])'(?:\\[^\n]|[^'\\\n])*'(?!\w)|“[^”\n]*”|‘[^’\n]*’/g,
		(match) => match.replace(/[^\n]/g, " "),
	);
}

function parse(text: string, source: string): string | undefined {
	const visible = selectorText(text);
	const ids = new Set<string>();
	for (const attempt of visible.matchAll(/\\?\[\s*workflow\b/gi)) {
		const match = visible
			.slice(attempt.index)
			.match(/^\\?\[workflow=([a-zA-Z0-9_.:/-]+)\\?\]/i);
		if (!match)
			throw new WorkflowSelectionError(
				`Malformed workflow selector in ${source}. Use [workflow=<id>] with an ID from Recipes; no fallback was launched.`,
			);
		ids.add(match[1]!);
	}
	if (ids.size > 1)
		throw new WorkflowSelectionError(
			`Conflicting workflow selectors in ${source}: ${[...ids].join(", ")}. Keep one workflow ID; no fallback was launched.`,
		);
	return [...ids][0];
}

/** Only the winning source is parsed. Historical comments are context, not selectors. */
export function resolveWorkflowSelector(input: {
	manual?: string;
	comment?: string | null;
	description?: string | null;
}): { workflowId?: string; selection?: WorkflowTriggerOrigin["selection"] } {
	if (input.manual)
		return { workflowId: input.manual, selection: { source: "manual" } };
	for (const source of ["comment", "description"] as const) {
		const workflowId = parse(input[source] ?? "", source);
		if (workflowId)
			return {
				workflowId,
				selection: {
					source: `${source}-selector`,
					selector: `[workflow=${workflowId}]`,
				},
			};
	}
	return {};
}
