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

// Mixed visual + API example: manual-cffae79b… ("named meters").
const namedMeters: Enriched = {
	tldr: "Resources get any number of named meters — tracked, billed per meter, shown everywhere.",
	system: {
		lanes: ["Inputs", "Metering", "Sessions", "Billing", "Outputs"],
		nodes: [
			{
				id: "flowNodes",
				label: "Flow meter nodes",
				lane: 0,
				status: "changed",
			},
			{ id: "migration", label: "Upgrade migration", lane: 0, status: "new" },
			{ id: "energy", label: "Energy-only meter", lane: 1, status: "legacy" },
			{ id: "meters", label: "Named meters", lane: 1, status: "new" },
			{ id: "sessions", label: "Session terms", lane: 2, status: "changed" },
			{ id: "recovery", label: "Recovery & waivers", lane: 2, status: "new" },
			{ id: "billing", label: "Meter bill items", lane: 3, status: "changed" },
			{ id: "web", label: "Web cards & bills", lane: 4, status: "changed" },
			{ id: "receipts", label: "Receipt emails", lane: 4, status: "changed" },
			{ id: "reader", label: "Attractap reader", lane: 4, status: "changed" },
		],
		before: [
			{ from: "flowNodes", to: "energy", label: "kWh only" },
			{ from: "energy", to: "sessions" },
			{ from: "sessions", to: "billing", label: "1 energy item" },
			{ from: "billing", to: "web" },
			{ from: "billing", to: "receipts" },
			{ from: "sessions", to: "reader" },
		],
		after: [
			{ from: "flowNodes", to: "meters", label: "any meter" },
			{ from: "migration", to: "meters", label: "energy → meter" },
			{ from: "meters", to: "sessions", label: "capture price" },
			{ from: "meters", to: "recovery", label: "unavailable" },
			{ from: "sessions", to: "billing", label: "item / meter" },
			{ from: "recovery", to: "billing", label: "pending · waive" },
			{ from: "billing", to: "web" },
			{ from: "billing", to: "receipts" },
			{ from: "sessions", to: "reader", label: "names + rates" },
		],
	},
	sequence: {
		actors: [
			{ id: "flow", label: "Flow node" },
			{ id: "meter", label: "Meter" },
			{ id: "session", label: "Session" },
			{ id: "billing", label: "Billing" },
			{ id: "out", label: "Bill · email · reader" },
		],
		steps: [
			{
				from: "flow",
				to: "meter",
				label: "report total 1532.4",
				chapter: "reporting-consumption",
				note: "idle → lifetime only",
			},
			{
				from: "session",
				to: "meter",
				label: "start: capture name, price, mode",
				chapter: "session-billing",
			},
			{
				from: "flow",
				to: "meter",
				label: "increment +0.8",
				chapter: "reporting-consumption",
			},
			{
				from: "flow",
				to: "meter",
				label: "reading unavailable",
				chapter: "meter-recovery",
				note: "usage continues",
			},
			{
				from: "session",
				to: "meter",
				label: "end: final reading?",
				chapter: "session-billing",
			},
			{
				from: "meter",
				to: "session",
				label: "pending — no evidence",
				chapter: "meter-recovery",
			},
			{
				from: "flow",
				to: "meter",
				label: "retry → correction",
				chapter: "meter-recovery",
			},
			{
				from: "session",
				to: "billing",
				label: "1 item per meter, exact qty",
				chapter: "session-billing",
			},
			{
				from: "billing",
				to: "out",
				label: "bill + receipt email",
				chapter: "bills-and-receipts",
			},
			{
				from: "session",
				to: "out",
				label: "reader: names, rates",
				chapter: "reader-meters",
			},
		],
	},
	chapters: {
		"named-meters": {
			tldr: "A resource can have many meters, created with just a name.",
			beforeShort: "One built-in energy meter",
			afterShort: "Any number of named meters",
			nodes: ["meters", "web"],
			risk: {
				level: "low",
				text: "Delete/rename follow per-action permissions",
			},
			keyChecks: [
				{ do: "Create a meter by name", expect: "Appears with idle total 0" },
				{
					do: "View as an ordinary user",
					expect: "Values visible, no manage controls",
				},
				{
					do: "Rename to a very long name (mobile)",
					expect: "Wraps, nothing clipped",
				},
			],
		},
		"reporting-consumption": {
			tldr: "Flows report totals or increments into any meter.",
			beforeShort: "Energy-specific flow nodes",
			afterShort: "Generic nodes, pick or create a meter",
			nodes: ["flowNodes", "meters"],
			risk: {
				level: "medium",
				text: "Cumulative session math needs fresh boundaries",
			},
			keyChecks: [
				{
					do: "Report a total while idle",
					expect: "Lifetime grows, no session change",
				},
				{ do: "Increment during a session", expect: "Session + lifetime grow" },
				{
					do: "Create a meter inline from a node",
					expect: "Selectable immediately",
				},
			],
		},
		"session-billing": {
			tldr: "Sessions freeze each meter's price; bills get one line per meter.",
			beforeShort: "One energy line, live price",
			afterShort: "Captured terms, item per meter",
			nodes: ["sessions", "billing"],
			risk: {
				level: "high",
				text: "Money math: check rounding on exact quantities",
			},
			keyChecks: [
				{ do: "Change price mid-session", expect: "Bill uses captured price" },
				{ do: "Two paid meters in one session", expect: "Two separate items" },
				{ do: "Paid evidence missing", expect: "Live estimate waits" },
			],
		},
		"meter-recovery": {
			tldr: "Missing readings stay pending, get corrected, or are waived.",
			beforeShort: "Missing reading = broken bill",
			afterShort: "Pending → correction or waiver",
			nodes: ["recovery", "billing"],
			risk: {
				level: "medium",
				text: "Unrecoverable meters need a manual waiver",
			},
			keyChecks: [
				{ do: "Free meter fails", expect: "Usage continues" },
				{ do: "Paid final reading missing", expect: "Shown as pending" },
				{ do: "Waive a charge", expect: "Audit row with details" },
			],
		},
		"bills-and-receipts": {
			tldr: "Bills and receipt emails list every meter separately.",
			beforeShort: "Single energy line",
			afterShort: "Named lines: paid, free, unavailable",
			nodes: ["billing", "web", "receipts"],
			risk: {
				level: "low",
				text: "Admin-edited receipt templates are not refreshed",
			},
			keyChecks: [
				{
					do: "Open a multi-meter transaction",
					expect: "Separate paid + free lines",
				},
				{ do: "Unavailable value on mobile", expect: "Distinct from zero" },
				{ do: "Render receipt email", expect: "Matches the modal" },
			],
		},
		"energy-upgrade": {
			tldr: "Existing energy setups migrate to meters without losing history.",
			beforeShort: "Energy tables + conversions",
			afterShort: "Generic meters + flow expressions",
			nodes: ["migration", "meters", "energy"],
			risk: { level: "high", text: "One-way migration on production data" },
			keyChecks: [
				{
					do: "Migrate a DB with active sessions",
					expect: "Baselines preserved",
				},
				{
					do: "Migrate a custom conversion",
					expect: "Rewritten as expression",
				},
				{ do: "Edited receipt template", expect: "Left untouched" },
			],
		},
		"reader-meters": {
			tldr: "The Attractap reader shows named meters; firmware 1.6.0.",
			beforeShort: "Reader shows energy only",
			afterShort: "Names, rates, exact quantities",
			nodes: ["sessions", "reader"],
			risk: {
				level: "medium",
				text: "Firmware checked in the desktop simulator only",
			},
			keyChecks: [
				{
					do: "Active session on the reader",
					expect: "Named meters with rates",
				},
				{ do: "Zero vs missing value", expect: "Shown differently" },
				{ do: "Firmware screen", expect: "Shows 1.6.0" },
			],
		},
		"meter-documentation": {
			tldr: "Docs explain meters in English and German.",
			beforeShort: "Energy-metering guide",
			afterShort: "Generic meter guide, EN + DE",
			nodes: [],
			risk: { level: "low", text: "No risks listed" },
			keyChecks: [
				{ do: "Open the meter guide", expect: "Sidebar entry present" },
				{ do: "Long inline example on mobile", expect: "Wraps fully" },
			],
		},
		"focused-flow-modules": {
			tldr: "Large flow files split into focused modules; no behaviour change.",
			beforeShort: "Few very large files",
			afterShort: "Focused modules, same entry points",
			nodes: ["flowNodes"],
			risk: { level: "low", text: "Pure refactor — skim, don't deep-review" },
			keyChecks: [
				{ do: "Check public imports", expect: "Unchanged entry points" },
				{ do: "Run flow tests", expect: "Green" },
			],
		},
	},
};

export function enrichedFor(guide: any): Enriched | undefined {
	if (guide?.goal?.startsWith("Reduce browser HTTP connections by bundling"))
		return bundledLiveUpdates;
	if (guide?.goal?.startsWith("Replace energy-only metering"))
		return namedMeters;
	return undefined;
}
