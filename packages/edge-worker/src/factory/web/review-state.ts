export function signature(value: unknown) {
	let hash = 2166136261;
	for (const c of JSON.stringify(value))
		hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
	return (hash >>> 0).toString(36);
}

export function guideRevision(run: any) {
	return (
		run.roleRevisions?.["pipeline/guide"] ??
		Object.entries<any>(run.roleRevisions ?? {}).find(
			([key]) => key === "guide" || key.endsWith("/guide"),
		)?.[1]
	);
}
export function reviewRevision(run: any) {
	return run.reviewGate?.headSha ?? guideRevision(run)?.headSha ?? "";
}

/** Preserve the progress identity used by both the preview and artifact reader. */
export function reviewKey(run: any, guide: unknown) {
	return `factory-review/${run.id}/${reviewRevision(run)}/${signature(guide)}`;
}

export function guideMatchesGate(run: any) {
	const revision = guideRevision(run);
	return !revision || revision.headSha === run.reviewGate?.headSha;
}

export type ReviewProgress = {
	page: number;
	reviewed: Record<string, boolean>;
	disclosures?: Record<string, boolean>;
	checked?: Record<string, boolean>;
	visited?: Record<string, boolean>;
};

export function readProgress(saved: unknown, pages: number): ReviewProgress {
	const value = saved as ReviewProgress | null;
	if (
		!value ||
		!Number.isInteger(value.page) ||
		value.page < 0 ||
		value.page >= pages ||
		!value.reviewed ||
		typeof value.reviewed !== "object" ||
		Array.isArray(value.reviewed)
	)
		return { page: 0, reviewed: {} };
	const booleans = (record: unknown) => {
		const result: Record<string, boolean> = {};
		if (record && typeof record === "object" && !Array.isArray(record))
			for (const [key, value] of Object.entries(record))
				if (typeof value === "boolean") result[key] = value;
		return result;
	};
	return {
		page: value.page,
		reviewed: booleans(value.reviewed),
		disclosures: booleans(value.disclosures),
		...(value.checked ? { checked: booleans(value.checked) } : {}),
		...(value.visited ? { visited: booleans(value.visited) } : {}),
	};
}

export function readTextStored(key: string, fallback: string, session = false) {
	try {
		return (session ? sessionStorage : localStorage).getItem(key) ?? fallback;
	} catch {
		return fallback;
	}
}
export function writeTextStored(key: string, value: string, session = false) {
	try {
		(session ? sessionStorage : localStorage).setItem(key, value);
	} catch {
		/* Navigation, reading and actions remain available without storage. */
	}
}
export function readStored<T>(key: string, fallback: T, session = false): T {
	try {
		return JSON.parse(readTextStored(key, "null", session)) ?? fallback;
	} catch {
		return fallback;
	}
}
export function writeStored(key: string, value: unknown, session = false) {
	writeTextStored(key, JSON.stringify(value), session);
}

export function todayContext(pathname: string, state: any) {
	const review = pathname.match(/^\/runs\/([^/]+)\/review$/);
	let id = review?.[1];
	try {
		if (id) id = decodeURIComponent(id);
	} catch {
		/* malformed direct URL */
	}
	return { focusRunId: id ?? state?.focusRunId };
}
