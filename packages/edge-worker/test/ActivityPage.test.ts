import { expect, it } from "vitest";
import { activityMarkers, activityPage } from "../src/factory/ActivityPage.js";
import { VisualScopeSchema } from "../src/factory/FactoryResults.js";
import { mergePage } from "../src/factory/web/transcript.js";

const stamp = Date.parse("2026-10-05T00:00:00Z");
const entries = Array.from({ length: 1000 }, (_, index) => ({
	type: "assistant",
	content: `Message ${index}`,
	metadata: { timestamp: stamp + index },
}));
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
