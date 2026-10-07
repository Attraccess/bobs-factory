import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { onAccessLost } from "./auth-state";

const snapshotKey = "bobs-factory-update-v1";
const maxBytes = 512000,
	ttl = 30 * 60 * 1000;
type Draft = { value: any; revision?: string };
type Snapshot = {
	schema: 1;
	expires: number;
	target: string;
	route: string;
	drafts: Record<string, Draft>;
	details: string[];
};
const allowed =
	/^(composer|today|recipe|answers|feedback|chat|panels|inspector|reading|review|position)\//;
function validDraft(key: string, value: any): boolean {
	const record = (v: any) =>
		v !== null && typeof v === "object" && !Array.isArray(v);
	const strings = (v: any) =>
		Array.isArray(v) && v.every((item) => typeof item === "string");
	const values = (v: any, type: string) =>
		record(v) && Object.values(v).every((item) => typeof item === type);
	if (key.startsWith("feedback/draft/"))
		return (
			record(value) &&
			typeof value.feedback === "string" &&
			typeof value.open === "boolean" &&
			(value.collectedOpen === undefined ||
				typeof value.collectedOpen === "boolean") &&
			(value.editing === undefined || typeof value.editing === "string") &&
			Array.isArray(value.items) &&
			value.items.every((item: any) => {
				const target = item?.target;
				return (
					record(item) &&
					typeof item.text === "string" &&
					record(target) &&
					["path", "pageTitle", "kind", "label", "context"].every(
						(k) => typeof target[k] === "string",
					) &&
					target.path.startsWith("/") &&
					Number.isInteger(target.page) &&
					target.page >= 0 &&
					Array.isArray(target.order) &&
					target.order.length > 0 &&
					target.order.every((n: any) => Number.isInteger(n) && n >= 0)
				);
			})
		);
	if (key.startsWith("position/"))
		return typeof value === "number" && Number.isFinite(value) && value >= 0;
	if (
		/^(chat\/|feedback\/text\/|recipe\/(json\/|modal-json$))/.test(key) ||
		[
			"composer/workflow",
			"composer/repository",
			"today/selected",
			"today/expanded",
		].includes(key)
	)
		return typeof value === "string";
	if (
		/^(feedback\/open\/|inspector\/raw\/|review\/decision\/)/.test(key) ||
		["composer/agent-panel", "today/all-attention"].includes(key)
	)
		return typeof value === "boolean";
	if (key === "today/skipped") return strings(value);
	if (key.startsWith("answers/"))
		return (
			record(value) &&
			Object.entries(value).every(
				([index, item]) =>
					/^\d+$/.test(index) &&
					(typeof item === "string" ||
						(record(item) &&
							["custom", "recommendation"].includes((item as any).mode) &&
							typeof (item as any).custom === "string")),
			)
		);
	if (/^composer\/(inputs|settings)$/.test(key)) return values(value, "string");
	if (key.startsWith("panels/")) return values(value, "boolean");
	if (key === "recipe/title-settings")
		return record(value) && values(value.value, "string");
	if (key === "recipe/machine-capacity")
		return record(value) && typeof value.limit === "string";
	if (key === "recipe/editing")
		return (
			record(value) &&
			typeof value.id === "string" &&
			typeof value.name === "string"
		);
	if (key === "recipe/role")
		return (
			record(value) &&
			typeof value.workflowId === "string" &&
			typeof value.stepId === "string" &&
			record(value.value) &&
			typeof value.value.name === "string"
		);
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
			data.schema !== 1 ||
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
			!data.drafts ||
			Array.isArray(data.drafts) ||
			typeof data.drafts !== "object" ||
			Object.keys(data.drafts).length > 300 ||
			!Array.isArray(data.details) ||
			data.details.length > 100 ||
			!data.details.every(
				(s: unknown) => typeof s === "string" && s.length <= 256,
			)
		)
			return;
		for (const [key, draft] of Object.entries(data.drafts)) {
			if (
				!allowed.test(key) ||
				key.length > 512 ||
				!draft ||
				typeof draft !== "object" ||
				!("value" in draft) ||
				!validDraft(key, draft.value) ||
				("revision" in draft && typeof draft.revision !== "string")
			)
				return;
		}
		return data;
	} catch {
		return;
	}
}
const drafts = new Map<string, Draft>();
let restored: Snapshot | undefined;
let storageIssue = "";
const collectors = new Set<() => void>();
export function collectRestoration(collect: () => void) {
	collectors.add(collect);
	return () => {
		collectors.delete(collect);
	};
}
export function recoveredDrafts() {
	return restored?.drafts ?? {};
}
// Nothing is written during ordinary editing. Only an explicit Update creates this tab-local snapshot.
export function loadRestoration(
	build: string,
	storage?: Pick<Storage, "getItem" | "removeItem">,
) {
	try {
		storage ??= sessionStorage;
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
		for (const [key, draft] of Object.entries(data.drafts))
			rememberDraft(key, draft.value, draft.revision);
		if (location.hash !== data.route) location.hash = data.route;
	} catch {
		storageIssue =
			"Browser storage is unavailable. Draft preservation will be checked before an update.";
	}
}
export function restorationNotice() {
	return storageIssue;
}
export function restoredDraft<T>(key: string): T | undefined {
	return drafts.get(key)?.value;
}
export function draftRevision(key: string): string | undefined {
	return drafts.get(key)?.revision;
}
/** Move this tab's latest draft to a replacement identity, retaining its old context. */
export function recoverDraft<T>(
	key: string,
	previousPrefix?: string,
): T | undefined {
	if (drafts.has(key)) return restoredDraft<T>(key);
	if (!previousPrefix) return;
	const previous = [...drafts.entries()]
		.reverse()
		.find(([candidate]) => candidate.startsWith(previousPrefix));
	if (!previous) return;
	const [source, draft] = previous;
	rememberDraft(key, draft.value, draft.revision ?? source);
	forgetDraft(source);
	return draft.value;
}
function pristineDraft(key: string, value: any): boolean {
	if (value === undefined) return true;
	if (key.startsWith("feedback/draft/"))
		return (
			!value.feedback &&
			!value.open &&
			!value.collectedOpen &&
			!value.editing &&
			!value.items?.length
		);
	// Only discard known defaults. A blank recipe editor or an explicit panel
	// collapse is still an edit and must survive an update.
	if (/^(chat\/|feedback\/text\/|recipe\/modal-json$)/.test(key))
		return value === "";
	if (
		/^(feedback\/open\/|inspector\/raw\/|review\/decision\/)/.test(key) ||
		["composer/agent-panel", "today/all-attention"].includes(key)
	)
		return value === false;
	if (key === "today/skipped")
		return Array.isArray(value) && value.length === 0;
	if (/^(answers\/|panels\/|composer\/(inputs|settings)$)/.test(key))
		return (
			value !== null &&
			typeof value === "object" &&
			Object.keys(value).length === 0
		);
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
export function rememberDraft(key: string, value: any, revision?: string) {
	if (!allowed.test(key)) throw new Error("Unknown update draft surface");
	if (pristineDraft(key, value)) drafts.delete(key);
	else drafts.set(key, { value, revision });
}
export function forgetDraft(key: string) {
	drafts.delete(key);
}
export function useRestorableState<T>(
	key: string,
	initial: T | (() => T),
	revision?: string,
): [T, Dispatch<SetStateAction<T>>, boolean] {
	const [value, setValue] = useState<T>(
		() =>
			drafts.get(key)?.value ??
			(typeof initial === "function" ? (initial as () => T)() : initial),
	);
	const originalRevision = useRef(drafts.get(key)?.revision ?? revision);
	if (
		revision !== undefined &&
		(originalRevision.current === undefined ||
			!drafts.has(key) ||
			value === undefined ||
			value === "" ||
			JSON.stringify(value) === "{}")
	)
		originalRevision.current = revision;
	const current = useRef(value);
	const [acknowledged, setAcknowledged] = useState(0);
	void acknowledged;
	const conflict =
		drafts.has(key) &&
		value !== undefined &&
		value !== "" &&
		JSON.stringify(value) !== "{}" &&
		originalRevision.current !== undefined &&
		revision !== undefined &&
		originalRevision.current !== revision;
	const set: Dispatch<SetStateAction<T>> = useCallback(
		(next) => {
			const result =
				typeof next === "function"
					? (next as (v: T) => T)(current.current)
					: next;
			if (Object.is(result, current.current)) return;
			current.current = result;
			setValue(result);
			rememberDraft(key, result, originalRevision.current);
		},
		[key],
	);
	useEffect(() => {
		if (key.startsWith("recipe/json/")) return;
		rememberDraft(key, current.current, originalRevision.current);
	}, [key]);
	// Deliberate acknowledgement is separate from editing: a changed gate must never silently accept an old draft.
	useEffect(() => {
		const handler = (event: Event) => {
			if ((event as CustomEvent).detail !== key) return;
			originalRevision.current = revision;
			rememberDraft(key, current.current, revision);
			setAcknowledged((n) => n + 1);
		};
		window.addEventListener("factory-draft-reviewed", handler);
		return () => window.removeEventListener("factory-draft-reviewed", handler);
	}, [key, revision]);
	return [value, set, conflict];
}
export function acknowledgeDraft(key: string) {
	window.dispatchEvent(
		new CustomEvent("factory-draft-reviewed", { detail: key }),
	);
}
export function preserveForUpdate(
	target: string,
	storage?: Pick<Storage, "setItem" | "getItem">,
) {
	for (const collect of collectors) collect();
	const details = [
		...document.querySelectorAll<HTMLDetailsElement>(
			"details[open][data-restore]",
		),
	].map((el) => el.dataset.restore!);
	const snapshot: Snapshot = {
		schema: 1,
		expires: Date.now() + ttl,
		target,
		route: location.hash || "#/",
		drafts: Object.fromEntries(drafts),
		details,
	};
	const text = JSON.stringify(snapshot);
	if (text.length > maxBytes || !decodeSnapshot(text))
		throw new Error(
			"Your drafts are too large to preserve safely. Copy them somewhere safe or shorten them before updating.",
		);
	try {
		storage ??= sessionStorage;
		storage.setItem(snapshotKey, text);
		if (storage.getItem(snapshotKey) !== text)
			throw new Error("Storage did not retain drafts");
	} catch {
		throw new Error(
			"Your browser could not save the update snapshot. Update postponed; your edits are still here. Allow session storage or copy your drafts before reloading.",
		);
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
	drafts.clear();
	collectors.clear();
	restored = undefined;
});
