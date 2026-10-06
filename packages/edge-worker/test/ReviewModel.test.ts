import { expect, it } from "vitest";
import type { ReviewFile } from "../src/factory/ReviewFiles.js";
import {
	fileArea,
	fileTotals,
	fileTree,
	groupReviewFiles,
	isTestFile,
	mapConnections,
	pageTokens,
	parsePatch,
	resolvePage,
	splitPatch,
	treeFiles,
} from "../src/factory/web/review-model.js";

const file = (path: string, extra: Partial<ReviewFile> = {}): ReviewFile => ({
	id: path,
	path,
	status: "M",
	gitStatus: "M",
	oldMode: "100644",
	newMode: "100644",
	submodule: false,
	additions: 2,
	deletions: 1,
	binary: false,
	...extra,
});
it("joins authoritative files to duplicate/shared/rename claims, exposes unassigned files and counts each area owner once", () => {
	const files = [
		file("packages/core/a.ts"),
		file("packages/core/b.ts"),
		file("packages/ui/new.ts", { oldPath: "packages/ui/old.ts", status: "R" }),
		file("root.spec.ts"),
		file("contest.ts"),
	];
	const chapters = [
		{
			files: [
				files[0]!.path,
				files[0]!.path,
				files[1]!.path,
				"packages/ui/old.ts",
				"fake.ts",
			],
		},
		{ files: [files[0]!.path] },
	];
	const grouped = groupReviewFiles(files, chapters);
	expect(grouped.groups.map((g) => g.length)).toEqual([3, 1]);
	expect(grouped.unassigned.map((f) => f.path)).toEqual([
		"root.spec.ts",
		"contest.ts",
	]);
	expect(grouped.areaOwners.get("packages/core")).toEqual(new Set([0, 1]));
	expect(grouped.areaOwners.get("packages/ui")).toEqual(new Set([0]));
	expect(fileTotals(files)).toEqual({
		files: 5,
		tests: 1,
		additions: 10,
		deletions: 5,
	});
	expect(fileArea("README.md")).toBe("Repository root");
	expect(isTestFile("contest.ts")).toBe(false);
	const tree = fileTree(files);
	expect(tree[0]!.name).toBe("packages");
	expect(treeFiles(tree).map((f) => f.path)).toEqual([
		"packages/core/a.ts",
		"packages/core/b.ts",
		"packages/ui/new.ts",
		"contest.ts",
		"root.spec.ts",
	]);
	expect(fileTree([file("a/b/c/d.ts")])[0]!.name).toBe("a/b/c");
});
it("preserves empty lines, hunk numbers and no-final-newline markers and pairs uneven replacement blocks", () => {
	const lines = parsePatch(
		"diff --git a/x b/x\n@@ -2,3 +2,4 @@\n context\n-old\n+new\n+\n+more\n\\ No newline at end of file\n",
	);
	expect(lines.slice(2)).toEqual([
		{ kind: "context", text: "context", old: 2, next: 2 },
		{ kind: "remove", text: "old", old: 3 },
		{ kind: "add", text: "new", next: 3 },
		{ kind: "add", text: "", next: 4 },
		{ kind: "add", text: "more", next: 5 },
		{ kind: "meta", text: "\\ No newline at end of file" },
	]);
	const rows = splitPatch(lines);
	expect(rows[3]).toMatchObject({
		left: { text: "old", old: 3 },
		right: { text: "new", next: 3 },
	});
	expect(rows[4]).toMatchObject({
		left: undefined,
		right: { text: "", next: 4 },
	});
});
it("resolves stable page tokens and compares connections by directed endpoints in all four modes", () => {
	const tokens = pageTokens([{ id: "stable" }]);
	expect(tokens).toEqual(["overview", "chapter:stable", "files", "decide"]);
	expect(resolvePage("files", tokens, 0)).toBe(2);
	expect(resolvePage(null, tokens, 1)).toBe(1);
	expect(resolvePage("chapter:gone", tokens, 2)).toBe(0);
	const system = {
		lanes: [],
		parts: [],
		before: [
			{ source: "a", target: "b", label: "old" },
			{ source: "b", target: "c", label: "removed" },
		],
		after: [
			{ source: "a", target: "b", label: "new" },
			{ source: "c", target: "a", label: "added" },
		],
	};
	expect(mapConnections(system, true, true).map((e) => e.kind)).toEqual([
		"changed",
		"removed",
		"added",
	]);
	expect(mapConnections(system, true, false).map((e) => e.label)).toEqual([
		"old",
		"removed",
	]);
	expect(mapConnections(system, false, true).map((e) => e.label)).toEqual([
		"new",
		"added",
	]);
	expect(mapConnections(system, false, false)).toEqual([]);
});

it("pairs a replacement across no-final-newline markers without losing either note", () => {
	const rows = splitPatch(
		parsePatch(
			"@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n",
		),
	);
	expect(rows).toEqual([
		{
			kind: "hunk",
			left: { kind: "hunk", text: "@@ -1 +1 @@" },
			right: { kind: "hunk", text: "@@ -1 +1 @@" },
		},
		{
			kind: "add",
			left: {
				kind: "remove",
				text: "old",
				old: 1,
				note: "\\ No newline at end of file",
			},
			right: {
				kind: "add",
				text: "new",
				next: 1,
				note: "\\ No newline at end of file",
			},
		},
	]);
});
