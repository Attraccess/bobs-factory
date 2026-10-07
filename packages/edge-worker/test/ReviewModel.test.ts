import { expect, it } from "vitest";
import type { ReviewFile } from "../src/factory/ReviewFiles.js";
import {
	areaColor,
	areaName,
	fileArea,
	fileTotals,
	fileTree,
	groupReviewFiles,
	isTestFile,
	mapConnections,
	pageTokens,
	parsePatch,
	resolvePage,
	screenshotDevice,
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
it.each([
	"A",
	"D",
] as const)("keeps the file and descendants when a directory is replaced (%s)", (status) => {
	const files = [
		file("config", { status }),
		file("config/nested/new.ts", { status: status === "A" ? "D" : "A" }),
		file("config/other.ts", { status: status === "A" ? "D" : "A" }),
	];
	for (const ordered of [files, files.toReversed()]) {
		const tree = fileTree(ordered);
		expect(tree[0]!.file).toEqual(files[0]);
		expect(treeFiles(tree)).toEqual(files);
	}
});
it("preserves empty lines, hunk numbers and no-final-newline markers and pairs uneven replacement blocks", () => {
	const lines = parsePatch(
		"diff --git a/x b/x\n@@ -2,3 +2,4 @@\n context\n-old\n+new\n+\n+more\n\\ No newline at end of file\n",
	);
	expect(lines.slice(1)).toEqual([
		{ kind: "context", text: "context", old: 2, next: 2 },
		{ kind: "remove", text: "old", old: 3 },
		{ kind: "add", text: "new", next: 3 },
		{ kind: "add", text: "", next: 4 },
		{ kind: "add", text: "more", next: 5 },
		{ kind: "meta", text: "\\ No newline at end of file" },
	]);
	const rows = splitPatch(lines);
	expect(rows[2]).toMatchObject({
		left: { text: "old", old: 3 },
		right: { text: "new", next: 3 },
	});
	expect(rows[3]).toMatchObject({
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

it("keeps nested plugins and individual libraries distinct with unique chapter ownership", () => {
	const files = [
		file("apps/plugins/wago/src/a.ts"),
		file("apps/plugins/shelly/src/b.ts"),
		file("libs/shared/a.ts"),
		file("libs/plugins-backend/a.ts"),
	];
	const grouped = groupReviewFiles(files, [
		{ files: [files[0]!.path, files[2]!.path, files[2]!.path] },
		{ files: [files[1]!.path, files[3]!.path, files[0]!.path] },
	]);
	expect(files.map((f) => fileArea(f.path))).toEqual([
		"apps/plugins/wago",
		"apps/plugins/shelly",
		"libs/shared",
		"libs/plugins-backend",
	]);
	expect(files.map((f) => areaName(fileArea(f.path)))).toEqual([
		"Plugin · wago",
		"Plugin · shelly",
		"Shared lib",
		"SDK · plugins-backend",
	]);
	expect(grouped.areaOwners.get("libs/shared")).toEqual(new Set([0]));
	expect(grouped.areaOwners.get("apps/plugins/wago")).toEqual(new Set([0, 1]));
	expect(areaColor("libs/shared")).toMatch(/^var\(--area-/);
	expect(areaColor("libs/shared")).toBe(areaColor(fileArea(files[2]!.path)));
});
it("filters patch preamble but preserves hunk numbers and in-hunk metadata", () => {
	expect(
		parsePatch(
			"diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -8 +9 @@\n-old\n+new\n\\ No newline at end of file\n",
		),
	).toEqual([
		{ kind: "hunk", text: "@@ -8 +9 @@" },
		{ kind: "remove", text: "old", old: 8 },
		{ kind: "add", text: "new", next: 9 },
		{ kind: "meta", text: "\\ No newline at end of file" },
	]);
	expect(parsePatch("old mode 100644\nnew mode 100755\n")).toEqual([]);
});
it("uses accepted screenshot context with an honest historical fallback", () => {
	expect(
		screenshotDevice({ device: "Email" }, { context: "390x844 mobile" }),
	).toBe("Email");
	expect(screenshotDevice({}, { context: "480×480 reader" })).toBe(
		"Reader · 480×480",
	);
	expect(screenshotDevice({}, { context: "desktop 1280x1000" })).toBe(
		"Desktop · 1280×1000",
	);
	expect(
		screenshotDevice(
			{},
			{ state: "success", caption: "Mobile 390x844 receipt" },
		),
	).toBe("Mobile · 390×844");
	expect(
		screenshotDevice(
			{},
			{ state: "desktop", caption: "Desktop and mobile evidence" },
		),
	).toBe("Desktop");
	expect(screenshotDevice({}, { caption: "Desktop and mobile evidence" })).toBe(
		"Device not recorded",
	);
	expect(screenshotDevice({})).toBe("Device not recorded");
});
