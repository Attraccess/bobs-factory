import { stripVTControlCharacters } from "node:util";
/** Public prose is separate from provider records and accepted workflow outputs. */
export interface LinearPublication {
	purpose:
		| "progress"
		| "outcome"
		| "questions"
		| "decision"
		| "deliverable"
		| "error";
	eventId: string;
	owner: string;
	source: { runId?: string; sessionId?: string; stepKey?: string };
	content: unknown;
	detailUrl?: string;
}
export type PublicationPresentation =
	| { destination: "transcript" | "comment"; markdown: string; version: 1 }
	| { destination: "suppressed"; reason: string; version: 1 };

export function cleanPublicMarkdown(text: string): string {
	return stripVTControlCharacters(text).trim();
}

/** Recognize transport/role records, not Markdown containing intentional JSON examples. */
export function isInternalPublication(text: string, depth = 0): boolean {
	if (depth > 6) return true;
	if (/^## Factory decision records\s*\n\s*[[{]/.test(text.trim())) return true;
	const fenced = /^```/.test(text.trim());
	const value = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/, "$1");
	if (!/^[{["]/.test(value)) return false;
	try {
		const parsed = JSON.parse(value);
		if (typeof parsed === "string" && parsed !== value)
			return isInternalPublication(parsed, depth + 1);
		return (
			parsed !== null &&
			typeof parsed === "object" &&
			(!fenced ||
				[
					"status",
					"questions",
					"structuredContent",
					"factoryArtifact",
					"infrastructureFailure",
					"plan",
				].some((key) => key in parsed))
		);
	} catch {
		return /^\{\s*"(?:status|summary|plan|questions|content|structuredContent|factoryArtifact|infrastructureFailure|type)"\s*:/.test(
			value,
		);
	}
}

export function presentLinearPublication(
	event: LinearPublication,
): PublicationPresentation {
	const suppressed = (reason: string): PublicationPresentation => ({
		destination: "suppressed",
		reason,
		version: 1,
	});
	let markdown = "";
	if (event.purpose === "decision") {
		const decision = event.content as {
			question?: unknown;
			answer?: unknown;
			reason?: unknown;
		};
		if (
			![decision?.question, decision?.answer, decision?.reason].every(
				(value) =>
					typeof value === "string" &&
					value.trim() &&
					!isInternalPublication(value),
			)
		)
			return suppressed("No consequential decision with rationale");
		markdown = `**${decision.question}**\n\n${decision.answer}\n\nRationale: ${decision.reason}`;
	} else if (event.purpose === "outcome") {
		const result = event.content as {
			summary?: unknown;
			status?: unknown;
			text?: unknown;
			approved?: unknown;
			blockers?: unknown;
			feedback?: unknown;
		};
		// Questions have a separate workflow owner. Plans/findings remain local.
		markdown =
			typeof result?.summary === "string"
				? result.summary
				: typeof result?.text === "string"
					? result.text
					: typeof result?.approved === "boolean"
						? result.approved
							? "Review completed."
							: "Review requires changes. See the findings in Factory."
						: result?.status === "blocked" || result?.status === "failed"
							? "This role needs help. Full details are available in Factory."
							: "Role output recorded. Full details are available in Factory.";
		for (const [label, values] of [
			["Needs attention", result?.blockers],
			["Feedback", result?.feedback],
		] as const) {
			if (!Array.isArray(values)) continue;
			const items = values.filter(
				(value): value is string =>
					typeof value === "string" &&
					Boolean(value.trim()) &&
					!isInternalPublication(value),
			);
			if (items.length)
				markdown += `\n\n${label}:\n\n${items.map((item) => `- ${item}`).join("\n")}`;
		}
	} else if (typeof event.content === "string") {
		markdown = event.content;
	} else
		return suppressed("Unrecognized public content; original retained locally");
	markdown = cleanPublicMarkdown(markdown);
	if (!markdown || isInternalPublication(markdown))
		return suppressed("Internal record retained locally");
	if (event.detailUrl && /^https:\/\//.test(event.detailUrl))
		markdown += `\n\n[Details](${event.detailUrl})`;
	return {
		destination: ["decision", "deliverable"].includes(event.purpose)
			? "comment"
			: "transcript",
		markdown,
		version: 1,
	};
}

/** Last boundary guard, shared by direct activity hooks and queued delivery. */
export function presentLinearActivity<
	T extends {
		type: string;
		body?: string | null;
		action?: string | null;
		parameter?: string | null;
		result?: string | null;
	},
>(content: T): T | undefined {
	if (content.type === "action") {
		if (!/error|fail|❌/i.test(content.action ?? "")) return undefined;
		const detail = publicFailure(content.result ?? "");
		return {
			type: "error",
			body: `${cleanPublicMarkdown(content.action ?? "Tool failed")}\n\n${detail}`,
		} as T;
	}
	if (typeof content.body !== "string") return content;
	const body = cleanPublicMarkdown(content.body);
	if (!body) return undefined;
	if (isInternalPublication(body)) {
		if (content.type === "error")
			return { ...content, body: publicFailure(body) };
		return undefined;
	}
	return { ...content, body };
}

export function publicFailure(raw: string): string {
	const text = cleanPublicMarkdown(raw);
	if (!isInternalPublication(text))
		return text || "The tool failed. Full output is retained in Factory.";
	try {
		const value = JSON.parse(text);
		const collect = (item: unknown, depth = 0): string[] => {
			if (depth > 6 || !item || typeof item !== "object") return [];
			const record = item as Record<string, unknown>;
			const messages = [record.message, record.reason, record.error].filter(
				(v): v is string => typeof v === "string" && !isInternalPublication(v),
			);
			if (Array.isArray(record.errors))
				messages.push(
					...record.errors.filter(
						(v): v is string =>
							typeof v === "string" && !isInternalPublication(v),
					),
				);
			if (Array.isArray(record.content))
				for (const block of record.content) {
					if (typeof block?.text === "string")
						messages.push(publicFailure(block.text));
				}
			return [...messages, ...collect(record.structuredContent, depth + 1)];
		};
		return (
			[...new Set(collect(value))].join("\n\n") ||
			"The tool failed. Full output is retained in Factory."
		);
	} catch {
		return "The tool returned an incomplete error record. Full output is retained in Factory.";
	}
}

/** Known old milestone comments cannot be reclassified as documentation on recovery. */
export function isOperationalLinearComment(body: string): boolean {
	return /^(?:#{1,3}\s+)?(?:Factory (?:clarification|needs assistance|work started|ready for human review)|Draft PR created or continued:|Ready for human review:|Handoff requires corrections:|Workflow [^\n]+ completed\.)/i.test(
		cleanPublicMarkdown(body),
	);
}
