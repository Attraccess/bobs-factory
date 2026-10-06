// PROTOTYPE (throwaway) — taskbot bobs-factory#71.
// Hand-written stand-in for fields the guide agent does NOT produce today. It sketches
// a proposed GuideSchema extension so the variants can show what richer, diagram-first
// guides would look like. Keyed by the guide goal so it only applies to the example run
// (manual-b38ca592…, "bundled live updates"). Toggle off with `&enriched=0`.
//
// Proposed additions (all short, low-density, agent-authorable — no coordinates):
//   guide.tldr                       ≤ 90 chars
//   guide.system  { lanes, nodes[{id,label,lane,status}], before[edge], after[edge] }
//   guide.sequence { actors[{id,label}], steps[{from,to,label,chapter,note?}] }
//   chapter.tldr                     ≤ 70 chars
//   chapter.beforeShort/afterShort   ≤ 50 chars each
//   chapter.nodes                    system node ids this chapter touches
//   chapter.risk { level: low|medium|high, text ≤ 70 }
//   chapter.keyChecks[{ do ≤ 60, expect ≤ 60 }] max 3

export type Edge = { from: string; to: string; label?: string; weak?: boolean };
export type Enriched = {
	tldr: string;
	system: {
		lanes: string[];
		nodes: {
			id: string;
			label: string;
			lane: number;
			status: "new" | "changed" | "same" | "legacy";
		}[];
		before: Edge[];
		after: Edge[];
	};
	sequence: {
		actors: { id: string; label: string }[];
		steps: {
			from: string;
			to: string;
			label: string;
			chapter: string;
			note?: string;
		}[];
	};
	chapters: Record<
		string,
		{
			tldr: string;
			beforeShort: string;
			afterShort: string;
			nodes: string[];
			risk: { level: "low" | "medium" | "high"; text: string };
			keyChecks: { do: string; expect: string }[];
		}
	>;
};

const bundledLiveUpdates: Enriched = {
	tldr: "All live updates in a tab now share one authenticated stream — plugins included.",
	system: {
		lanes: [
			"Browser tab",
			"Frontend",
			"API edge",
			"Routing",
			"Sources",
			"Devices",
		],
		nodes: [
			{ id: "features", label: "Core views", lane: 0, status: "changed" },
			{ id: "pluginUi", label: "Plugin UIs", lane: 0, status: "changed" },
			{ id: "client", label: "Live client", lane: 1, status: "new" },
			{ id: "legacy", label: "Legacy SSE", lane: 2, status: "legacy" },
			{ id: "stream", label: "/live-updates", lane: 2, status: "new" },
			{ id: "rest", label: "Status REST", lane: 2, status: "legacy" },
			{ id: "registry", label: "Topic registry", lane: 3, status: "new" },
			{
				id: "providers",
				label: "Feature providers",
				lane: 4,
				status: "changed",
			},
			{ id: "sampler", label: "Plugin sampler", lane: 4, status: "new" },
			{ id: "devices", label: "WAGO / Shelly", lane: 5, status: "same" },
		],
		before: [
			{ from: "features", to: "legacy", label: "1 per feature" },
			{ from: "legacy", to: "providers" },
			{ from: "pluginUi", to: "rest", label: "poll 2–10s" },
			{ from: "rest", to: "devices", label: "read per tab" },
		],
		after: [
			{ from: "features", to: "client" },
			{ from: "pluginUi", to: "client" },
			{ from: "client", to: "stream", label: "1 / tab" },
			{ from: "stream", to: "registry" },
			{ from: "registry", to: "providers" },
			{ from: "registry", to: "sampler" },
			{ from: "sampler", to: "devices", label: "shared" },
			{ from: "pluginUi", to: "rest", label: "mutations", weak: true },
		],
	},
	sequence: {
		actors: [
			{ id: "tab", label: "Tab" },
			{ id: "client", label: "Live client" },
			{ id: "stream", label: "Stream" },
			{ id: "registry", label: "Registry" },
			{ id: "provider", label: "Provider" },
			{ id: "sampler", label: "Sampler" },
			{ id: "device", label: "Device" },
		],
		steps: [
			{
				from: "tab",
				to: "client",
				label: "watch resource 42",
				chapter: "shared-live-delivery",
			},
			{
				from: "tab",
				to: "client",
				label: "watch resource 42 (2nd view)",
				chapter: "shared-live-delivery",
				note: "deduped — no new stream",
			},
			{
				from: "client",
				to: "stream",
				label: "open ONE stream",
				chapter: "session-and-navigation-continuity",
			},
			{
				from: "client",
				to: "stream",
				label: "subscribe [topics]",
				chapter: "shared-live-delivery",
			},
			{
				from: "stream",
				to: "registry",
				label: "validate + authorize each",
				chapter: "authorized-topic-registry",
			},
			{
				from: "registry",
				to: "client",
				label: "✗ flow-logs:9 forbidden",
				chapter: "authorized-topic-registry",
				note: "others keep flowing",
			},
			{
				from: "registry",
				to: "provider",
				label: "attach source",
				chapter: "authorized-topic-registry",
			},
			{
				from: "provider",
				to: "client",
				label: "in-use = true",
				chapter: "resource-current-state",
			},
			{
				from: "client",
				to: "tab",
				label: "late view gets snapshot",
				chapter: "resource-current-state",
			},
			{
				from: "tab",
				to: "stream",
				label: "visibility: hidden",
				chapter: "presence-and-source-cleanup",
				note: "any visible tab = present",
			},
			{
				from: "tab",
				to: "client",
				label: "WAGO panel subscribes",
				chapter: "plugin-live-updates",
			},
			{
				from: "registry",
				to: "sampler",
				label: "plugin topic → sampler",
				chapter: "plugin-live-updates",
			},
			{
				from: "sampler",
				to: "device",
				label: "1 read / 2–10s, shared",
				chapter: "wago-streamed-status",
			},
			{
				from: "device",
				to: "sampler",
				label: "unavailable",
				chapter: "wago-streamed-status",
			},
			{
				from: "sampler",
				to: "client",
				label: "unavailable packet",
				chapter: "wago-streamed-status",
				note: "cached rows kept",
			},
			{
				from: "sampler",
				to: "client",
				label: "firmware 1.4.4 → 1.5.1",
				chapter: "shelly-firmware-progress",
			},
			{
				from: "client",
				to: "stream",
				label: "cookie rotated → reopen",
				chapter: "session-and-navigation-continuity",
				note: "topics restored, cache kept",
			},
			{
				from: "client",
				to: "registry",
				label: "renew (10s) → re-authorize",
				chapter: "authorized-topic-registry",
			},
			{
				from: "stream",
				to: "stream",
				label: "metrics: 1 conn, N topics",
				chapter: "compatibility-and-operations",
			},
		],
	},
	chapters: {
		"shared-live-delivery": {
			tldr: "Every live feature shares one connection per tab.",
			beforeShort: "1 stream per feature × resource",
			afterShort: "1 stream per tab",
			nodes: ["features", "client", "stream", "registry"],
			risk: {
				level: "medium",
				text: "One hiccup pauses every live topic in the tab",
			},
			keyChecks: [
				{ do: "Open 10 resources", expect: "Network tab shows 1 stream" },
				{
					do: "Close one of two duplicate views",
					expect: "Other view still updates",
				},
				{ do: "Abort a consumer", expect: "Its callbacks stop" },
			],
		},
		"resource-current-state": {
			tldr: "Late-joining views see current in-use state at once.",
			beforeShort: "Late view could miss state",
			afterShort: "Snapshot replayed to joiners",
			nodes: ["client", "providers"],
			risk: { level: "low", text: "Replay covers in-use state only" },
			keyChecks: [
				{
					do: "Open 2nd view of a busy resource",
					expect: "Shows in-use immediately",
				},
				{ do: "Receive a health ping", expect: "In-use state survives" },
				{ do: "Switch user", expect: "No stale state" },
			],
		},
		"session-and-navigation-continuity": {
			tldr: "Stream survives navigation and recovers on re-auth.",
			beforeShort: "Streams owned by URLs",
			afterShort: "Auth-aware, coordinated recovery",
			nodes: ["client", "stream"],
			risk: { level: "medium", text: "Recovery refetches all active queries" },
			keyChecks: [
				{ do: "Swap a topic in one render", expect: "Same connection id" },
				{ do: "Log out", expect: "No transport, timers or retries left" },
				{ do: "Rotate cookie", expect: "Reconnects, cache kept" },
			],
		},
		"authorized-topic-registry": {
			tldr: "Each topic is authorized alone; failures stay isolated.",
			beforeShort: "Auth per feature endpoint",
			afterShort: "Auth per topic, every renewal",
			nodes: ["stream", "registry", "providers"],
			risk: { level: "low", text: "Provider reason strings are public" },
			keyChecks: [
				{
					do: "Mix valid + forbidden topics",
					expect: "Valid ones keep flowing",
				},
				{ do: "Revoke a permission", expect: "Next renewal drops it" },
				{ do: "Throw inside a provider", expect: "No internal text leaks" },
			],
		},
		"presence-and-source-cleanup": {
			tldr: "Presence is per connection: any visible tab counts.",
			beforeShort: "One user-wide visible flag",
			afterShort: "Any visible tab = present",
			nodes: ["providers"],
			risk: { level: "low", text: "Slow disconnects wait for the 30s lease" },
			keyChecks: [
				{ do: "1 visible + 1 hidden tab", expect: "Toasts still arrive" },
				{ do: "Close one visible tab", expect: "Other keeps presence" },
			],
		},
		"plugin-live-updates": {
			tldr: "Plugins get an SDK to ride the same stream.",
			beforeShort: "No SDK, plugins poll REST",
			afterShort: "Namespaced topics + shared sampler",
			nodes: ["pluginUi", "client", "sampler"],
			risk: {
				level: "medium",
				text: "A hung device read delays the next sampler",
			},
			keyChecks: [
				{ do: "Subscribe plugin topics", expect: "They use the core stream" },
				{ do: "Unregister a plugin", expect: "Only its sources stop" },
				{ do: "Unsub mid-read, resub", expect: "No overlapping read" },
			],
		},
		"wago-streamed-status": {
			tldr: "WAGO status is pushed, not polled (9 queries).",
			beforeShort: "Every tab polls REST",
			afterShort: "Shared snapshots, per-query errors",
			nodes: ["pluginUi", "sampler", "devices"],
			risk: {
				level: "medium",
				text: "Cached rows may be stale while unavailable",
			},
			keyChecks: [
				{ do: "Push a snapshot", expect: "Status changes, no polling GET" },
				{
					do: "Mark one query unavailable",
					expect: "Rows kept, neighbours fine",
				},
				{ do: "Send next snapshot", expect: "Error clears" },
			],
		},
		"shelly-firmware-progress": {
			tldr: "Shelly firmware progress streams; timeout unchanged.",
			beforeShort: "Poll every 5s per tab",
			afterShort: "Streamed while installing",
			nodes: ["pluginUi", "sampler", "devices"],
			risk: { level: "low", text: "Simulator only, no real hardware" },
			keyChecks: [
				{ do: "Install firmware", expect: "Progress without polling GETs" },
				{ do: "Stall the device", expect: "5-minute timeout fires" },
				{ do: "Inspect payloads", expect: "No credentials" },
			],
		},
		"compatibility-and-operations": {
			tldr: "Old endpoints stay; metrics and docs updated.",
			beforeShort: "Metrics = SSE connections",
			afterShort: "Connections vs topics split",
			nodes: ["stream", "legacy"],
			risk: {
				level: "high",
				text: "Multi-worker sticky routing is unverified",
			},
			keyChecks: [
				{ do: "Run over plain HTTP", expect: "Works without randomUUID" },
				{ do: "Call legacy SSE routes", expect: "Still respond" },
				{
					do: "Multi-worker deploy",
					expect: "Stream + control hit same worker",
				},
			],
		},
	},
};

export function enrichedFor(guide: any): Enriched | undefined {
	return guide?.goal?.startsWith("Reduce browser HTTP connections by bundling")
		? bundledLiveUpdates
		: undefined;
}
