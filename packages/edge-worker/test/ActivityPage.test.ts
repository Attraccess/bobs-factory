import { expect, it } from "vitest";
import { activityMarkers, activityPage } from "../src/factory/ActivityPage.js";
import { VisualScopeSchema } from "../src/factory/FactoryResults.js";
import { formatActivities } from "../src/factory/web/activity.js";
import { mergePage } from "../src/factory/web/transcript.js";

const stamp = Date.parse("2026-10-05T00:00:00Z");
const entries = Array.from({ length: 1000 }, (_, index) => ({
	type: "assistant",
	content: `Message ${index}`,
	metadata: { timestamp: stamp + index },
}));
it("keeps tail-truncated agent copies out of initial and live transcript pages", () => {
	const oversized = JSON.stringify({
		type: "user",
		message: { content: "escaped MCP result ".repeat(2000) },
	});
	const events = [
		{
			at: new Date(stamp).toISOString(),
			step: "review",
			message: oversized.slice(-20000),
		},
		{
			at: new Date(stamp).toISOString(),
			step: "review",
			message: "Starting review",
		},
	];
	const initial = activityPage([entries[0]], events, { limit: 120 });
	expect(initial.events.map((event) => event.message)).toEqual([
		"Starting review",
	]);
	const next = activityPage(
		[entries[0], entries[1]],
		[
			...events,
			{
				at: new Date(stamp + 1).toISOString(),
				step: "review",
				message: oversized.slice(-20000),
			},
			{
				at: new Date(stamp + 1).toISOString(),
				step: "review",
				message: "Finished review",
			},
		],
		{ limit: 120, after: initial.end },
	);
	const cached = mergePage(mergePage(undefined, initial), next);
	expect(
		formatActivities({
			...cached,
			createdAt: new Date(stamp).toISOString(),
		}).map((item: any) => item.body),
	).toEqual(["Message 0", "Starting review", "Message 1", "Finished review"]);
});
it("retains event-only agent messages and explicitly marked long workflow logs", () => {
	const at = new Date(stamp).toISOString();
	const agent = {
		at,
		step: "review",
		source: "agent" as const,
		message: JSON.stringify({
			type: "assistant",
			content: "Inspecting the revision.",
		}),
	};
	const complete = activityPage([], [agent], { limit: 120 });
	expect(formatActivities({ ...complete, createdAt: at })[0]).toMatchObject({
		type: "thought",
		body: "Inspecting the revision.",
	});
	const truncated = activityPage(
		[],
		[{ ...agent, message: "tool_result fragment ".repeat(1000) }],
		{ limit: 120 },
	);
	expect(formatActivities({ ...truncated, createdAt: at })[0]).toMatchObject({
		title: "Agent activity",
		body: "Recorded agent activity (details available in Raw data)",
	});
	const workflow = activityPage(
		[entries[0]],
		[
			{
				at,
				step: "review",
				source: "workflow",
				message: "Build output ".padEnd(20000, "."),
			},
		],
		{ limit: 120 },
	);
	expect(workflow.events).toHaveLength(1);
	expect(
		formatActivities({ ...workflow, createdAt: at }).find(
			(item: any) => item.type === "system",
		)?.body,
	).toMatch(/^Build output/);
});
it("can refetch an older SDK reading anchor after formatting event-only history", () => {
	const events = Array.from({ length: 400 }, (_, sequence) => ({
		at: new Date(stamp + sequence).toISOString(),
		step: "review",
		source: "agent" as const,
		sequence,
		message: JSON.stringify({
			type: "assistant",
			message: {
				content: [
					{ type: "text", text: `Message ${sequence}` },
					{ type: "thinking", thinking: `Thinking ${sequence}` },
					{
						type: "tool_use",
						id: `tool-${sequence}`,
						name: "Read",
						input: { file_path: "README.md" },
					},
				],
			},
		}),
	}));
	const latest = activityPage([], events, { limit: 120 });
	const older = activityPage([], events, { limit: 120, before: latest.before });
	const formatted = formatActivities({ ...older, createdAt: events[0].at });
	const anchor = formatted.find((row: any) => row.body === "Message 170");
	expect(anchor.cursor).toBe(
		older.events.find((event) => event.sequence === 170)?.activityCursor,
	);
	expect(anchor.cursor).toEqual(expect.any(String));
	expect(
		formatted
			.filter((row: any) => row.key.startsWith(anchor.key.slice(0, -1)))
			.map((row: any) => row.cursor),
	).toEqual([anchor.cursor, anchor.cursor, anchor.cursor]);
	const restored = activityPage([], events, {
		limit: 120,
		after: anchor.cursor,
	});
	expect(
		formatActivities({ ...restored, createdAt: events[0].at }).find(
			(row: any) => row.key === anchor.key,
		),
	).toMatchObject({ body: "Message 170", cursor: anchor.cursor });
	expect(latest.events.some((event) => event.sequence === 170)).toBe(false);
});
it("loads bounded step pages with stable indexes and advancing small cursors", () => {
	const markers = [
		{ at: new Date(stamp).toISOString(), step: "plan" },
		{ at: new Date(stamp + 500).toISOString(), step: "implement" },
	];
	const tail = activityPage(entries, [], { step: "plan", limit: 120 }, markers);
	expect(tail.entries).toHaveLength(120);
	expect(tail.entries[0]!.activityIndex).toBe(380);
	const older = activityPage(
		entries,
		[],
		{ step: "plan", limit: 120, before: tail.before },
		markers,
	);
	expect(older.entries[0]!.activityIndex).toBe(260);
	expect(older.entries.at(-1)!.activityIndex).toBe(379);
	const next = activityPage(
		entries,
		[],
		{ limit: 1, after: tail.end },
		markers,
	);
	expect(next.entries[0]!.activityIndex).toBe(500);
	const afterTrim = activityPage(
		entries,
		[
			{
				at: new Date(stamp + 990).toISOString(),
				step: "implement",
				message: "recent",
				sequence: 1499,
			},
		],
		{ after: tail.end, limit: 120 },
		markers,
	);
	expect(afterTrim.entries[0]!.activityStep).toBe("plan");
	expect(() =>
		activityPage(entries, [], { before: "bad", limit: 120 }),
	).toThrow("Invalid activity cursor");
});
it("preserves legacy history attribution when the event buffer was already trimmed", () => {
	const run = {
		createdAt: new Date(stamp).toISOString(),
		history: [
			{ step: "clarify", at: new Date(stamp + 100).toISOString() },
			{ step: "plan", at: new Date(stamp + 500).toISOString() },
		],
		events: [
			{
				step: "capture",
				at: new Date(stamp + 900).toISOString(),
				message: "Starting capture",
			},
		],
	};
	const markers = activityMarkers(run);
	const page = activityPage(
		entries,
		run.events,
		{ step: "clarify", limit: 120 },
		markers,
	);
	expect(page.entries.at(-1)!.activityIndex).toBe(99);
	expect(page.entries.every((entry) => entry.activityStep === "clarify")).toBe(
		true,
	);
});
it("bounds the live cache and keeps discarded history reloadable", () => {
	let cache: any;
	for (let index = 120; index <= 960; index += 120)
		cache = mergePage(
			cache,
			activityPage(entries, [], {
				before: Buffer.from(
					JSON.stringify({
						at: new Date(stamp + index).toISOString(),
						key: `entry/${index}`,
					}),
				).toString("base64url"),
				limit: 120,
			}),
		);
	expect(cache.entries).toHaveLength(600);
	expect(cache.entries[0].activityIndex).toBe(360);
	expect(cache.hasOlder).toBe(true);
	const older = activityPage(entries, [], { before: cache.before, limit: 120 });
	cache = mergePage(cache, older, true);
	expect(cache.entries).toHaveLength(600);
	expect(cache.entries[0].activityIndex).toBe(240);
	expect(cache.entries.at(-1).activityIndex).toBe(839);
	expect(cache.hasNewer).toBe(true);
});
it("previews oversized tool results without transferring their full bodies", () => {
	const page = activityPage(
		[
			{
				type: "user",
				content: "x".repeat(500000),
				metadata: { timestamp: stamp, toolUseId: "tool" },
			},
		],
		[],
		{ limit: 120 },
	);
	expect(page.entries[0]!.activityTruncated).toBe(true);
	expect(JSON.stringify(page).length).toBeLessThan(10000);
});
it("limits representative screenshot plans and requires justified exceptions", () => {
	const area = {
		name: "Drawer",
		url: "/example",
		instructions: "Open drawer",
		states: Array.from({ length: 25 }, (_, i) => `Concrete state ${i}`),
	};
	expect(() =>
		VisualScopeSchema.parse({ changed: true, areas: [area] }),
	).toThrow("representative");
	expect(() =>
		VisualScopeSchema.parse({
			changed: true,
			areas: [area],
			captureBudget: 30,
		}),
	).toThrow("budgetReason");
	expect(
		VisualScopeSchema.parse({
			changed: true,
			areas: [area],
			captureBudget: 30,
			budgetReason: "25 materially distinct changed layouts",
		}).captureBudget,
	).toBe(30);
});

it("orders mixed numeric entry timestamps and ISO workflow events chronologically", () => {
	const page = activityPage(
		[entries[100]],
		[
			{
				at: new Date(stamp + 50).toISOString(),
				step: "work",
				message: "Earlier workflow",
				sequence: 1,
			},
		],
		{ limit: 120 },
	);
	const cached = mergePage(undefined, page);
	expect(cached.before).toBe(page.before);
	expect(cached.end).toBe(page.end);
});
