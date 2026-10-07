import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useState,
} from "react";
import { onAccessLost } from "./auth-state";

const snapshotKey = "bobs-factory-view-update-v2";
const maxBytes = 512000,
	ttl = 30 * 60 * 1000;
type ViewState = { value: any; revision?: string };
type Snapshot = {
	schema: 2;
	expires: number;
	target: string;
	route: string;
	views: Record<string, ViewState>;
	details: string[];
};
const allowed = /^(today|panels|inspector|reading|review\/progress|position)\//;
function validView(key: string, value: any): boolean {
	const record = (v: any) =>
		v !== null && typeof v === "object" && !Array.isArray(v);
	const strings = (v: any) =>
		Array.isArray(v) && v.every((item) => typeof item === "string");
	const values = (v: any, type: string) =>
		record(v) && Object.values(v).every((item) => typeof item === type);
	if (key.startsWith("position/"))
		return typeof value === "number" && Number.isFinite(value) && value >= 0;
	if (["today/selected", "today/expanded"].includes(key))
		return typeof value === "string";
	if (key.startsWith("inspector/raw/") || key === "today/all-attention")
		return typeof value === "boolean";
	if (key === "today/skipped") return strings(value);
	if (key.startsWith("panels/")) return values(value, "boolean");
	if (key === "inspector/selection")
		return (
			record(value) &&
			typeof value.runId === "string" &&
			typeof value.name === "string" &&
			(value.image === undefined ||
				(Number.isInteger(value.image) && value.image >= 0))
		);
	if (key.startsWith("review/progress/"))
		return (
			record(value) &&
			Number.isInteger(value.page) &&
			value.page >= 0 &&
			values(value.reviewed, "boolean") &&
			(value.disclosures === undefined ||
				values(value.disclosures, "boolean")) &&
			(value.checked === undefined || values(value.checked, "boolean")) &&
			(value.visited === undefined || values(value.visited, "boolean"))
		);
	if (key.startsWith("reading/"))
		return (
			record(value) &&
			typeof value.following === "boolean" &&
			(value.expanded === undefined || strings(value.expanded)) &&
			(value.groups === undefined ||
				(Array.isArray(value.groups) &&
					value.groups.every(
						(pair: any) => strings(pair) && pair.length === 2,
					))) &&
			(value.anchor === undefined ||
				(record(value.anchor) &&
					typeof value.anchor.key === "string" &&
					Number.isFinite(value.anchor.offset) &&
					(value.anchor.cursor === undefined ||
						typeof value.anchor.cursor === "string")))
		);
	return false;
}
export function revisionOf(value: unknown): string {
	const text = JSON.stringify(value) ?? "undefined";
	let result = 2166136261;
	for (let i = 0; i < text.length; i++)
		result = Math.imul(result ^ text.charCodeAt(i), 16777619);
	return (result >>> 0).toString(16);
}
export function decodeSnapshot(
	text: string,
	now = Date.now(),
): Snapshot | undefined {
	if (text.length > maxBytes) return;
	try {
		const data = JSON.parse(text);
		if (
			data.schema !== 2 ||
			!Number.isFinite(data.expires) ||
			data.expires < now ||
			data.expires > now + ttl ||
			typeof data.target !== "string" ||
			!/^[a-f0-9]{24}$/.test(data.target) ||
			typeof data.route !== "string" ||
			data.route.length > 2048 ||
			!/^#\/(?:$|recipes$|settings$|runs\/[^/?#]+(?:\/review(?:\?[^#\s]*)?)?$)/.test(
				data.route,
			) ||
			!data.views ||
			Array.isArray(data.views) ||
			typeof data.views !== "object" ||
			Object.keys(data.views).length > 300 ||
			!Array.isArray(data.details) ||
			data.details.length > 100 ||
			!data.details.every(
				(s: unknown) => typeof s === "string" && s.length <= 256,
			)
		)
			return;
		for (const [key, draft] of Object.entries(data.views)) {
			if (
				!allowed.test(key) ||
				key.length > 512 ||
				!draft ||
				typeof draft !== "object" ||
				!("value" in draft) ||
				!validView(key, draft.value) ||
				("revision" in draft && typeof draft.revision !== "string")
			)
				return;
		}
		return data;
	} catch {
		return;
	}
}
const views = new Map<string, ViewState>();
let restored: Snapshot | undefined;
let storageIssue = "";
const collectors = new Set<() => void>();
export function collectRestoration(collect: () => void) {
	collectors.add(collect);
	return () => {
		collectors.delete(collect);
	};
}
export function loadRestoration(
	build: string,
	storage?: Pick<Storage, "getItem" | "removeItem">,
) {
	try {
		storage ??= sessionStorage;
		storage.removeItem("bobs-factory-update-v1");
		const text = storage.getItem(snapshotKey);
		if (!text) return;
		const data = decodeSnapshot(text);
		if (!data || data.target !== build) {
			storage.removeItem(snapshotKey);
			storageIssue =
				"An update snapshot expired or did not match this build. The update was not restored.";
			return;
		}
		restored = data;
		for (const [key, draft] of Object.entries(data.views))
			rememberView(key, draft.value, draft.revision);
		if (location.hash !== data.route) location.hash = data.route;
	} catch {
		storageIssue =
			"Browser storage is unavailable. Reading position may not be restored.";
	}
}
export function restorationNotice() {
	return storageIssue;
}
export function restoredView<T>(key: string): T | undefined {
	return views.get(key)?.value;
}
function pristineView(key: string, value: any): boolean {
	if (value === undefined) return true;
	if (key.startsWith("inspector/raw/") || key === "today/all-attention")
		return value === false;
	if (key === "today/skipped")
		return Array.isArray(value) && value.length === 0;
	if (key.startsWith("panels/")) return Object.keys(value ?? {}).length === 0;
	// False entries and visited pages still describe this tab's choices; shared
	// storage may contain different progress written by another tab.
	if (key.startsWith("review/progress/"))
		return (
			value?.page === 0 &&
			Object.keys(value.reviewed ?? {}).length === 0 &&
			Object.keys(value.disclosures ?? {}).length === 0 &&
			Object.keys(value.checked ?? {}).length === 0 &&
			Object.keys(value.visited ?? {}).length === 0
		);
	if (key.startsWith("reading/"))
		return (
			value?.following === true &&
			!value.expanded?.length &&
			!value.groups?.length
		);
	return false;
}
export function rememberView(key: string, value: any, revision?: string) {
	if (!allowed.test(key)) return;
	if (value === undefined) {
		views.delete(key);
		return;
	}
	if (!validView(key, value)) return;
	if (pristineView(key, value)) views.delete(key);
	else views.set(key, { value, revision });
}
export function forgetView(key: string) {
	views.delete(key);
}
/** Reading/layout state only. Editable forms use useFormState instead. */
export function useRestorableState<T>(
	key: string,
	initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
	const [value, setValue] = useState<T>(
		() =>
			views.get(key)?.value ??
			(typeof initial === "function" ? (initial as () => T)() : initial),
	);
	const set: Dispatch<SetStateAction<T>> = useCallback(
		(next) => {
			setValue((current) => {
				const result =
					typeof next === "function" ? (next as (v: T) => T)(current) : next;
				rememberView(key, result);
				return result;
			});
		},
		[key],
	);
	useEffect(() => {
		rememberView(key, value);
	}, [key, value]);
	return [value, set];
}
export function preserveForUpdate(
	target: string,
	storage?: Pick<Storage, "setItem" | "getItem">,
) {
	// View restoration is optional; storage failures must not postpone an update.
	try {
		for (const collect of collectors) collect();
		const details = [
			...document.querySelectorAll<HTMLDetailsElement>(
				"details[open][data-restore]",
			),
		]
			.filter(
				(el) =>
					!el.dataset.restore?.startsWith("recipe-") &&
					el.dataset.restore !== "composer-details",
			)
			.map((el) => el.dataset.restore!);
		const snapshot: Snapshot = {
			schema: 2,
			expires: Date.now() + ttl,
			target,
			route: location.hash || "#/",
			views: Object.fromEntries(views),
			details,
		};
		const text = JSON.stringify(snapshot);
		if (!decodeSnapshot(text)) return;
		storage ??= sessionStorage;
		storage.setItem(snapshotKey, text);
	} catch {
		/* Reading position is best effort. */
	}
}

export function completeRestoration() {
	if (!restored) return;
	for (const id of restored.details)
		document
			.querySelector<HTMLDetailsElement>(
				`details[data-restore="${CSS.escape(id)}"]`,
			)
			?.setAttribute("open", "");
	try {
		sessionStorage.removeItem(snapshotKey);
	} catch {
		/* TTL prevents abandoned snapshots being reused indefinitely. */
	}
	restored = undefined;
}

onAccessLost(() => {
	views.clear();
	collectors.clear();
	restored = undefined;
});
