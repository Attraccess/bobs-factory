import { createHash } from "node:crypto";

type Event = {
	at: string;
	step: string;
	message: string;
	sequence?: number;
	source?: "agent" | "workflow";
};
type Cursor = { at: string; key: string };
function sourceOf(event: Event): "agent" | "workflow" {
	if (event.source) return event.source;
	// Legacy agent copies retain only a 20,000-character tail, often invalid JSON.
	// Classify before the page preview removes this only remaining size marker.
	if (event.message.length === 20000) return "agent";
	try {
		if (
			["assistant", "user", "result"].includes(JSON.parse(event.message)?.type)
		)
			return "agent";
	} catch {
		/* Plain workflow log. */
	}
	return "workflow";
}
function decode(cursor?: string): Cursor | undefined {
	if (!cursor) return undefined;
	try {
		const value = JSON.parse(Buffer.from(cursor, "base64url").toString());
		if (
			typeof value.at === "string" &&
			Number.isFinite(Date.parse(value.at)) &&
			typeof value.key === "string"
		)
			return value;
	} catch {
		/* Return a useful client error rather than silently losing history. */
	}
	throw new Error("Invalid activity cursor");
}
/** Stable cursors survive the runtime's capped event buffer and overlapping pages. */
export function activityPage(
	entries: unknown[],
	events: Event[],
	query: { step?: string; before?: string; after?: string; limit: number },
	stepMarkers?: { at: string; step: string }[],
) {
	const markers =
		stepMarkers ??
		events.filter(
			(event, index) =>
				!["run", "prepare"].includes(event.step) &&
				(!index || event.step !== events[index - 1]?.step),
		);
	const stepAt = (at: string) => {
		let low = 0,
			high = markers.length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (Date.parse(markers[mid]!.at) <= Date.parse(at)) low = mid + 1;
			else high = mid;
		}
		return markers[Math.max(0, low - 1)]?.step ?? "Bob’s Factory";
	};
	const rows = [
		...entries.map((value, index) => {
			const entry = value as Record<string, any>;
			const at = new Date(
				entry.metadata?.timestamp ?? entry.timestamp ?? entry.createdAt ?? 0,
			).toISOString();
			return {
				kind: "entry",
				key: `entry/${index}`,
				index,
				at,
				step: stepAt(at),
				value,
			};
		}),
		...events
			.filter((event) => !entries.length || sourceOf(event) !== "agent")
			.map((event) => {
				const identity =
					event.sequence ??
					`${event.at}/${createHash("sha1").update(event.message).digest("hex").slice(0, 12)}`;
				return {
					kind: "event",
					key: `event/${identity}`,
					index: identity,
					at: event.at,
					step: event.step,
					value: { ...event, source: sourceOf(event) },
				};
			}),
	]
		.filter((row) => !query.step || row.step === query.step)
		.sort(
			(a, b) =>
				Date.parse(a.at) - Date.parse(b.at) ||
				a.key.localeCompare(b.key, undefined, { numeric: true }),
		);
	const before = decode(query.before),
		after = decode(query.after);
	const compare = (row: { at: string; key: string }, cursor: Cursor) =>
		Date.parse(row.at) - Date.parse(cursor.at) ||
		row.key.localeCompare(cursor.key, undefined, { numeric: true });
	const boundary = before
		? rows.findIndex((row) => compare(row, before) >= 0)
		: -1;
	const afterIndex = after
		? rows.findIndex((row) => compare(row, after) > 0)
		: -1;
	const overlap = Math.min(16, Math.max(0, query.limit - 1));
	const start = after
		? Math.max(0, (afterIndex < 0 ? rows.length : afterIndex) - overlap)
		: Math.max(0, (boundary < 0 ? rows.length : boundary) - query.limit);
	const end = after
		? Math.min(rows.length, start + query.limit)
		: boundary < 0
			? rows.length
			: boundary;
	const page = rows.slice(start, end);
	const cursor = (row: (typeof rows)[number] | undefined) =>
		row
			? Buffer.from(JSON.stringify({ at: row.at, key: row.key })).toString(
					"base64url",
				)
			: undefined;
	return {
		entries: page
			.filter((row) => row.kind === "entry")
			.map((row) => ({
				...activityPreview(row.value),
				activityCursor: cursor(row),
				activityIndex: row.index,
				activityStep: row.step,
			})),
		events: page
			.filter((row) => row.kind === "event")
			.map((row) => ({
				...activityPreview(row.value),
				activityCursor: cursor(row),
				activityIndex: row.index,
			})),
		stepEvents: markers.map(({ at, step }) => ({ at, step })),
		before: cursor(page[0]),
		end: cursor(page.at(-1)) ?? query.after,
		total: rows.length,
		hasOlder: start > 0,
		hasNewer: end < rows.length,
	};
}

export function activityMarkers(run: {
	activitySteps?: { at: string; step: string }[];
	createdAt: string;
	history: { step: string; at: string }[];
	events: Event[];
}) {
	if (run.activitySteps) return run.activitySteps;
	return [
		...run.history.map((item, index) => ({
			step: item.step,
			at: index ? run.history[index - 1]!.at : run.createdAt,
		})),
		...run.events
			.filter(
				(event, index) =>
					!["run", "prepare"].includes(event.step) &&
					(!index || event.step !== run.events[index - 1]?.step),
			)
			.map(({ at, step }) => ({ at, step })),
	]
		.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
		.filter(
			(item, index, array) => !index || item.step !== array[index - 1]?.step,
		);
}
// Full raw details are fetched on demand; one large MCP result cannot swamp a page.
function activityPreview(value: unknown): Record<string, any> {
	if (JSON.stringify(value).length <= 16000)
		return value as Record<string, any>;
	const trim = (part: any, depth = 0): any => {
		if (typeof part === "string") return part.slice(0, 3000);
		if (!part || typeof part !== "object") return part;
		if (depth >= 5) return "Open Raw data for complete details";
		if (Array.isArray(part))
			return part.slice(0, 12).map((item) => trim(item, depth + 1));
		return Object.fromEntries(
			Object.entries(part)
				.slice(0, 24)
				.map(([key, item]) => [key, trim(item, depth + 1)]),
		);
	};
	return { ...trim(value), activityTruncated: true };
}
