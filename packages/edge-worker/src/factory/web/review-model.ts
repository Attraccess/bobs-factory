import type { Guide, GuideChapter, GuideSystem } from "../FactoryResults";
import type { ReviewFile } from "../ReviewFiles";
export function chapterColor(index: number) {
	return `var(--step-${index % 20})`;
}
export function chaptersFor(guide: Guide): GuideChapter[] {
	return guide.chapters?.length
		? guide.chapters
		: guide.behavior.map((b, i) => ({
				id: `legacy-${i}`,
				title: b.scenario,
				summary: b.after,
				before: b.before,
				after: b.after,
				requirementIndexes: [],
				files: [],
				screenshots: [],
				diagrams: [],
				reviewChecks: [],
				risks: [],
				evidence: [],
			}));
}
export function pageTokens(chapters: { id: string }[]) {
	return [
		"overview",
		...chapters.map((c) => `chapter:${c.id}`),
		"files",
		"decide",
	];
}
export function resolvePage(
	token: string | null,
	tokens: string[],
	saved: number,
) {
	return token === null
		? Math.max(0, Math.min(tokens.length - 1, saved))
		: Math.max(0, tokens.indexOf(token));
}
export function isTestFile(path: string) {
	return /(^|\/)(__tests__|tests?|test-fixtures|fixtures)(\/|$)|\.(test|spec)\.[^/]+$|(^|\/)(test_[^/]+|[^/]+_test\.[^/]+)$/.test(
		path,
	);
}
/** Stable repository identity, separate from the human-facing name. */
export function fileArea(path: string) {
	const parts = path.split("/");
	const plugin = parts.indexOf("plugins");
	if (plugin >= 0 && parts.length > plugin + 2)
		return parts.slice(0, plugin + 2).join("/");
	if (
		parts.length > 2 &&
		["apps", "packages", "libs", "libraries"].includes(parts[0]!)
	)
		return parts.slice(0, 2).join("/");
	return parts.length > 1 ? parts[0]! : "Repository root";
}
export function areaName(area: string) {
	const parts = area.split("/"),
		name = parts.at(-1)!;
	const readable = name.replace(/[-_]/g, " ");
	if (parts.includes("plugins")) return `Plugin · ${name}`;
	if (parts[0] === "apps" && ["api", "backend"].includes(name)) return "API";
	if (parts[0] === "apps" && ["web", "frontend"].includes(name))
		return "Web app";
	if (/^sdk[-_]|[-_]sdk$|plugins-backend/.test(name)) return `SDK · ${name}`;
	if (name === "shared") return "Shared lib";
	if (name === "docs") return "Docs";
	if (["libs", "libraries"].includes(parts[0]!)) return `Library · ${readable}`;
	if (parts[0] === "packages") return `Package · ${readable}`;
	if (parts[0] === "apps") return `App · ${readable}`;
	return readable.charAt(0).toUpperCase() + readable.slice(1);
}
export function areaColor(area: string) {
	let hash = 0;
	for (const c of area) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
	return `var(--area-${(hash >>> 0) % 8})`;
}
export function screenshotDevice(
	ref: { device?: string },
	shot?: { context?: string; state?: string; caption?: string },
) {
	if (ref.device) return ref.device;
	// Prefer precise accepted context/state; captions may describe several devices.
	const context = [shot?.context, shot?.state, shot?.caption].find(
		(value) =>
			value &&
			/\b(desktop|mobile|email|reader)\b|\b\d{2,5}\s*[×x]\s*\d{2,5}\b/i.test(
				value,
			),
	);
	if (!context) return "Device not recorded";
	const dimensions = context.match(/\b(\d{2,5})\s*[×x]\s*(\d{2,5})\b/i);
	const kinds = [
		...new Set(
			[...context.matchAll(/\b(desktop|mobile|email|reader)\b/gi)].map((m) =>
				m[1]!.toLowerCase(),
			),
		),
	];
	const kind = kinds.length === 1 ? kinds[0] : undefined;
	if (kind)
		return `${kind.charAt(0).toUpperCase()}${kind.slice(1).toLowerCase()}${dimensions ? ` · ${dimensions[1]}×${dimensions[2]}` : ""}`;
	return dimensions
		? `${dimensions[1]}×${dimensions[2]} · Device not recorded`
		: "Device not recorded";
}
export function fileTotals(files: ReviewFile[]) {
	return {
		files: files.length,
		tests: files.filter((f) => isTestFile(f.path)).length,
		additions: files.some((f) => f.additions === null)
			? null
			: files.reduce((n, f) => n + f.additions!, 0),
		deletions: files.some((f) => f.deletions === null)
			? null
			: files.reduce((n, f) => n + f.deletions!, 0),
	};
}
export function groupReviewFiles(
	files: ReviewFile[],
	chapters: { files: string[] }[],
) {
	const owners = new Map<string, number[]>();
	for (const file of files)
		owners.set(
			file.id,
			chapters.flatMap((c, i) =>
				c.files.includes(file.path) ||
				(file.oldPath && c.files.includes(file.oldPath))
					? [i]
					: [],
			),
		);
	const groups = chapters.map((_, i) =>
		files.filter((f) => owners.get(f.id)!.includes(i)),
	);
	const areaOwners = new Map<string, Set<number>>();
	for (const file of files) {
		const area = fileArea(file.path),
			set = areaOwners.get(area) ?? new Set<number>();
		for (const owner of owners.get(file.id)!) set.add(owner);
		areaOwners.set(area, set);
	}
	return {
		groups,
		owners,
		areaOwners,
		unassigned: files.filter((f) => !owners.get(f.id)!.length),
	};
}
export interface FileTree {
	name: string;
	files: ReviewFile[];
	file?: ReviewFile;
	children: FileTree[];
}
export function fileTree(files: ReviewFile[]): FileTree[] {
	const root: FileTree = { name: "", files: [], children: [] };
	for (const file of files) {
		let node = root;
		const parts = file.path.split("/");
		for (let i = 0; i < parts.length; i++) {
			const name = parts[i]!;
			let child = node.children.find((c) => c.name === name);
			if (!child) {
				child = { name, files: [], children: [] };
				node.children.push(child);
			}
			child.files.push(file);
			node = child;
			if (i === parts.length - 1) node.file = file;
		}
	}
	const compress = (nodes: FileTree[]): FileTree[] =>
		nodes
			.map((node) => {
				while (
					!node.file &&
					node.children.length === 1 &&
					!node.children[0]!.file
				) {
					const child = node.children[0]!;
					node = { ...child, name: `${node.name}/${child.name}` };
				}
				node.children = compress(node.children);
				return node;
			})
			.sort(
				(a, b) =>
					Number(Boolean(a.file)) - Number(Boolean(b.file)) ||
					a.name.localeCompare(b.name),
			);
	return compress(root.children);
}
export function treeFiles(nodes: FileTree[]): ReviewFile[] {
	return nodes.flatMap((n) => [
		...(n.file ? [n.file] : []),
		...treeFiles(n.children),
	]);
}
export type DiffLine = {
	kind: "hunk" | "context" | "add" | "remove" | "meta";
	text: string;
	old?: number;
	next?: number;
	note?: string;
};
export function parsePatch(patch: string): DiffLine[] {
	let old = 0,
		next = 0,
		inHunk = false;
	const lines: DiffLine[] = [];
	const raw = patch.split("\n");
	if (raw.at(-1) === "") raw.pop();
	for (const line of raw) {
		const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
		if (match) {
			old = Number(match[1]);
			next = Number(match[2]);
			inHunk = true;
			lines.push({ kind: "hunk", text: line });
		} else if (inHunk && line.startsWith("+"))
			lines.push({ kind: "add", text: line.slice(1), next: next++ });
		else if (inHunk && line.startsWith("-"))
			lines.push({ kind: "remove", text: line.slice(1), old: old++ });
		else if (inHunk && line.startsWith(" "))
			lines.push({
				kind: "context",
				text: line.slice(1),
				old: old++,
				next: next++,
			});
		else if (inHunk) {
			lines.push({ kind: "meta", text: line });
		}
	}
	return lines;
}
export type SplitRow = {
	kind: DiffLine["kind"];
	left?: DiffLine;
	right?: DiffLine;
};
export function splitPatch(lines: DiffLine[]): SplitRow[] {
	const rows: SplitRow[] = [];
	for (let i = 0; i < lines.length; ) {
		const line = lines[i]!;
		if (line.kind === "add" || line.kind === "remove") {
			const left: DiffLine[] = [],
				right: DiffLine[] = [];
			let last: DiffLine | undefined;
			while (i < lines.length) {
				const item = lines[i]!;
				if (item.kind === "add" || item.kind === "remove") {
					i++;
					last = { ...item };
					(item.kind === "remove" ? left : right).push(last);
				} else if (
					item.kind === "meta" &&
					item.text.startsWith("\\ No newline") &&
					last
				) {
					last.note = item.text;
					i++;
				} else break;
			}
			for (let j = 0; j < Math.max(left.length, right.length); j++)
				rows.push({ kind: "add", left: left[j], right: right[j] });
		} else {
			i++;
			rows.push({ kind: line.kind, left: line, right: line });
		}
	}
	return rows;
}
export function mapConnections(
	system: GuideSystem,
	before: boolean,
	after: boolean,
) {
	const key = (edge: GuideSystem["before"][number]) =>
		JSON.stringify([edge.source, edge.target]);
	const previous = new Map(system.before.map((e) => [key(e), e])),
		current = new Map(system.after.map((e) => [key(e), e]));
	const keys = new Set([
		...(before ? previous.keys() : []),
		...(after ? current.keys() : []),
	]);
	return [...keys].map((k) => {
		const old = previous.get(k),
			next = current.get(k),
			edge = (after ? (next ?? old) : old)!;
		return {
			...edge,
			kind:
				before && after
					? !old
						? "added"
						: !next
							? "removed"
							: old.label !== next.label
								? "changed"
								: "kept"
					: "kept",
			oldLabel: old?.label,
			newLabel: next?.label,
		};
	});
}
