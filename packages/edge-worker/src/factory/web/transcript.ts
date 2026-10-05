const encoder = new TextEncoder();
/** Bound active caches as well as DOM: older/newer history is always reloadable. */
export function mergePage(previous: any, page: any, older = false) {
	const rows = [
		...new Map(
			[
				...(previous?.entries ?? []).map((value: any) => ({
					kind: "entry",
					value,
				})),
				...(previous?.events ?? []).map((value: any) => ({
					kind: "event",
					value,
				})),
				...page.entries.map((value: any) => ({ kind: "entry", value })),
				...page.events.map((value: any) => ({ kind: "event", value })),
			].map((row) => [`${row.kind}/${row.value.activityIndex}`, row]),
		).values(),
	].sort(
		(a, b) =>
			new Date(
				a.value.metadata?.timestamp ??
					a.value.timestamp ??
					a.value.createdAt ??
					a.value.at ??
					0,
			).getTime() -
				new Date(
					b.value.metadata?.timestamp ??
						b.value.timestamp ??
						b.value.createdAt ??
						b.value.at ??
						0,
				).getTime() ||
			`${a.kind}/${a.value.activityIndex}`.localeCompare(
				`${b.kind}/${b.value.activityIndex}`,
				undefined,
				{ numeric: true },
			),
	);
	const kept: typeof rows = [];
	let bytes = 0;
	for (const row of older ? rows : [...rows].reverse()) {
		const size = encoder.encode(JSON.stringify(row.value)).byteLength;
		if (kept.length >= 600 || (kept.length && bytes + size > 2 * 1024 * 1024))
			break;
		kept.push(row);
		bytes += size;
	}
	if (!older) kept.reverse();
	const trimmed = kept.length < rows.length;
	return {
		...page,
		entries: kept.filter((row) => row.kind === "entry").map((row) => row.value),
		events: kept.filter((row) => row.kind === "event").map((row) => row.value),
		before:
			kept[0]?.value.activityCursor ??
			(older ? page.before : (previous?.before ?? page.before)),
		end:
			kept.at(-1)?.value.activityCursor ??
			(older ? (previous?.end ?? page.end) : page.end),
		hasOlder: older
			? page.hasOlder
			: trimmed || previous?.hasOlder || page.hasOlder,
		hasNewer: older ? trimmed || previous?.hasNewer : page.hasNewer,
	};
}
