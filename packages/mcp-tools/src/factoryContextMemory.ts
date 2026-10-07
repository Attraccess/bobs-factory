type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue =>
	value !== null && typeof value === "object" && !Array.isArray(value);

interface Claim {
	value: unknown;
	firstPath: string;
	latestPath: string;
	firstRound: number;
	latestRound: number;
	occurrences: number;
}
interface ReviewRecord {
	scope: string;
	id: string | null;
	findings: Claim[];
	dispositions: Claim[];
	observations: Claim[];
}
const claimKinds = ["findings", "dispositions", "observations"] as const;

interface HistoryEntry {
	fullPath: string;
	step?: string;
	at?: string;
	call?: unknown;
	outputPath?: string;
	outputCharacters?: number;
}

function historyIndex(history: unknown[], path: string): HistoryEntry[] {
	return history.map((item, index) => {
		const fullPath = `${path}/${index}`;
		if (!isRecord(item)) return { fullPath };
		return {
			fullPath,
			...(typeof item.step === "string" ? { step: item.step } : {}),
			...(typeof item.at === "string" ? { at: item.at } : {}),
			...(Object.hasOwn(item, "call") ? { call: item.call } : {}),
			...(Object.hasOwn(item, "output")
				? {
						outputPath: `${fullPath}/output`,
						outputCharacters: (JSON.stringify(item.output) ?? "null").length,
					}
				: {}),
		};
	});
}

/** Exact review claims, deduplicated without interpreting acceptance or status. */
function reviewLedger(history: unknown[]): ReviewRecord[] {
	const records = new Map<string, ReviewRecord>();
	for (const [round, item] of history.entries()) {
		if (!isRecord(item) || !isRecord(item.output)) continue;
		const scope =
			typeof item.step === "string"
				? item.step.slice(0, Math.max(0, item.step.lastIndexOf("/")))
				: "";
		for (const kind of claimKinds) {
			const values = item.output[kind];
			if (!Array.isArray(values)) continue;
			for (const [index, value] of values.entries()) {
				const path = `/history/${round}/output/${kind}/${index}`;
				const id =
					isRecord(value) && typeof value.id === "string" ? value.id : null;
				// Unlabelled legacy claims remain visible; never merge unrelated claims.
				const key = JSON.stringify([scope, id ?? path]);
				let record = records.get(key);
				if (!record) {
					record = {
						scope,
						id,
						findings: [],
						dispositions: [],
						observations: [],
					};
					records.set(key, record);
				}
				const serialized = JSON.stringify(value);
				const previous = record[kind].find(
					(claim) => JSON.stringify(claim.value) === serialized,
				);
				if (previous) {
					previous.latestPath = path;
					previous.latestRound = round;
					previous.occurrences++;
				} else
					record[kind].push({
						value,
						firstPath: path,
						latestPath: path,
						firstRound: round,
						latestRound: round,
						occurrences: 1,
					});
			}
		}
	}
	return [...records.values()];
}

/** Preserve review reasoning and gate outcomes without repeating claim bodies. */
function reviewRounds(history: unknown[]) {
	return history.flatMap((item, index) => {
		if (!isRecord(item) || !isRecord(item.output)) return [];
		const output = item.output;
		if (!claimKinds.some((kind) => Array.isArray(output[kind]))) return [];
		return [
			{
				round: index,
				step: item.step,
				at: item.at,
				outputPath: `/history/${index}/output`,
				...Object.fromEntries(
					[
						"summary",
						"approved",
						"feedback",
						"questions",
						"reviewAssessment",
					].flatMap((key) =>
						Object.hasOwn(output, key) ? [[key, output[key]]] : [],
					),
				),
			},
		];
	});
}

/**
 * Compact the default browsing view, not the immutable source snapshot. Current
 * requirements, decisions, answers and outputs stay exact. Older role outputs
 * are indexed and remain available through their original paths or view=full.
 */
export function factoryContextView(input: unknown): unknown {
	if (
		!isRecord(input) ||
		!Array.isArray(input.history) ||
		Object.hasOwn(input, "contextMemory")
	)
		return input;
	const history = historyIndex(input.history, "/history");
	const latest = new Map<string, (typeof history)[number]>();
	for (const item of history) if (item.step) latest.set(item.step, item);
	const progress = input.progress;
	return {
		...input,
		history,
		...(isRecord(progress) && Array.isArray(progress.newHistory)
			? {
					progress: {
						...progress,
						newHistory: historyIndex(
							progress.newHistory,
							"/progress/newHistory",
						),
					},
				}
			: {}),
		contextMemory: {
			format: "factory-context-memory-v1",
			historyCount: history.length,
			latestSteps: [...latest.values()],
			reviewLedger: reviewLedger(input.history),
			reviewRounds: reviewRounds(input.history),
		},
	};
}
