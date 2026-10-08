import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
	reviewContext,
	reviewDeliveries,
	reviewDiffUrl,
	reviewFileTarget,
	reviewFileUrl,
	shellQuote,
} from "../src/factory/web/review-context.js";

const url = "https://github.com/owner/repo/pull/42";
it("links grouped files to their own PR using the repository-relative filename", () => {
	const run = {
		outputs: {
			"draft-pr": {
				deliveries: [
					{
						repositoryId: "app",
						name: "app",
						output: { url, headSha: "app-head" },
					},
					{
						repositoryId: "api",
						name: "api",
						output: {
							url: "https://gitlab.com/team/api/-/merge_requests/2",
							headSha: "api-head",
						},
					},
				],
			},
		},
	};
	expect(reviewDeliveries(run)).toHaveLength(2);
	expect(reviewFileTarget(run, "api/shared.ts")).toEqual({
		url: "https://gitlab.com/team/api/-/merge_requests/2",
		path: "shared.ts",
	});
});
it("offers GitLab subgroup and enterprise GitHub review links and checkout commands", () => {
	const gitlab = reviewContext({
		outputs: {
			"draft-pr": {
				url: "https://gitlab.example/group/subgroup/repo/-/merge_requests/17",
				branch: "feature/change",
			},
		},
	});
	expect(gitlab.pr).toEqual({
		url: "https://gitlab.example/group/subgroup/repo/-/merge_requests/17",
		label: "MR !17",
	});
	expect(gitlab.branchUrl).toBe(
		"https://gitlab.example/group/subgroup/repo/-/tree/feature%2Fchange",
	);
	expect(gitlab.commands[0]?.command).toBe(
		"glab mr checkout 17 --repo 'https://gitlab.example/group/subgroup/repo'",
	);
	const enterprise = reviewContext({
		reviewGate: { url: "https://github.example/team/repo/pull/4" },
	});
	expect(enterprise.commands[0]?.command).toBe(
		"gh pr checkout 4 --repo 'https://github.example/team/repo'",
	);
});
const ticketReference = {
	provider: "native",
	platform: "linear",
	workspaceId: "workspace",
	id: "uuid",
	url: "https://linear.app/team/issue/TEAM-12/review",
};

it("prefers review PR and published branch, retaining the verified ticket", () => {
	const context = reviewContext({
		reviewGate: { url, headSha: "reviewed" },
		outputs: {
			"draft-pr": {
				url: "https://github.com/owner/repo/pull/43",
				branch: "feature/one",
				headSha: "other",
			},
			source: {
				url: "https://github.com/owner/repo/pull/44",
				headRefName: "older",
			},
			"existing-work": { branch: "oldest" },
		},
		ticketReference,
	});
	expect(context).toEqual({
		pr: { url, label: "PR #42" },
		branch: "feature/one",
		branchUrl: "https://github.com/owner/repo/tree/feature%2Fone",
		ticket: { url: ticketReference.url, label: "TEAM-12" },
		commands: [
			{
				label: "GitHub CLI",
				command: "gh pr checkout 42",
				help: "Run in a local clone with GitHub CLI installed.",
			},
			{
				label: "Git only",
				command: "git checkout feature/one",
				help: "Run in a local clone where the branch is available.",
			},
		],
	});
});

it("falls back through malformed metadata without guessing links", () => {
	const context = reviewContext({
		reviewGate: { url: "javascript:alert(1)" },
		outputs: {
			"draft-pr": {
				url: "https://github.com/owner/repo",
				branch: "bad branch",
			},
			source: { url, headRefName: "takeover" },
			"existing-work": { branch: "older" },
		},
	});
	expect(context.pr).toEqual({ url, label: "PR #42" });
	expect(context.branch).toBe("takeover");
	expect(
		reviewContext({ outputs: { "existing-work": { branch: "legacy" } } }),
	).toMatchObject({ branch: "legacy", branchUrl: undefined, pr: undefined });
	for (const value of [
		null,
		{},
		{ outputs: [] },
		{ outputs: { source: "not metadata" } },
		{
			title: url,
			workspace: "/tmp/branch",
			inputs: { ticket: ticketReference.url },
		},
	])
		expect(reviewContext(value)).toEqual({
			pr: undefined,
			branch: undefined,
			branchUrl: undefined,
			ticket: undefined,
			commands: [],
		});
});

it("offers only commands supported by PR-only and branch-only metadata", () => {
	expect(
		reviewContext({ reviewGate: { url } }).commands.map((c) => c.label),
	).toEqual(["GitHub CLI"]);
	expect(
		reviewContext({
			outputs: { "draft-pr": { branch: "feature" } },
		}).commands.map((c) => c.label),
	).toEqual(["Git only"]);
	expect(
		reviewContext({
			reviewGate: { url: "https://git.example/team/repo/pulls/5" },
		}).commands,
	).toEqual([]);
	for (const bad of [
		"https://github.com/owner/repo/pull/0",
		"https://github.com/owner/repo/pull/42?query",
		"https://user:pass@github.com/owner/repo/pull/42",
		"https://github.com/owner/repo/pull/42\nfragment",
		"not a URL",
	])
		expect(reviewContext({ reviewGate: { url: bad } }).pr).toBeUndefined();
});

it("uses the exact Taskbot instance and project and ignores unverified content", () => {
	const ref = {
		provider: "taskbot",
		server: "taskbot",
		instance: "https://taskbot.example",
		project: "other-project",
		id: 59,
		url: "https://taskbot.example/p/other-project/t/59",
	};
	expect(reviewContext({ ticketReference: ref }).ticket).toEqual({
		url: ref.url,
		label: "other-project #59",
	});
	expect(
		reviewContext({
			ticketReference: { ...ref, url: "https://taskbot.example/p/wrong/t/59" },
		}).ticket,
	).toBeUndefined();
	expect(
		reviewContext({
			ticketReference: { ...ticketReference, url: "javascript:bad" },
		}).ticket,
	).toBeUndefined();
	expect(
		reviewContext({ outputs: { guide: { summary: ref.url } } }).ticket,
	).toBeUndefined();
});

it("omits misleading branch links for explicitly cross-repository PRs", () => {
	for (const field of ["source", "draft-pr"])
		expect(
			reviewContext({
				reviewGate: { url },
				outputs: {
					[field]: {
						isCrossRepository: true,
						branch: "fork",
						headRefName: "fork",
					},
				},
			}).branchUrl,
		).toBeUndefined();
});

it("encodes unusual valid branch names and quotes them as exactly one shell argument", () => {
	const branch = "feature/it's-$HOME-`whoami`-$(id);&";
	const context = reviewContext({
		reviewGate: { url },
		outputs: { "draft-pr": { branch } },
	});
	expect(context.branchUrl).toBe(
		`https://github.com/owner/repo/tree/${encodeURIComponent(branch)}`,
	);
	expect(context.commands[1]?.command).toBe(
		`git checkout ${shellQuote(branch)}`,
	);
	expect(
		execFileSync("sh", ["-c", `printf '%s' ${shellQuote(branch)}`], {
			encoding: "utf8",
		}),
	).toBe(branch);
	for (const malformed of [
		"",
		"-option",
		"bad branch",
		"a..b",
		".hidden",
		"a/.hidden",
		"a.lock",
		"a/",
		"a//b",
		"a\\b",
		"a\nb",
		"a@{b",
		"a~b",
		"a.",
		"@",
	])
		expect(
			reviewContext({ outputs: { "draft-pr": { branch: malformed } } })
				.commands,
		).toEqual([]);
});

it("uses supported GitLab and GitHub diff and file destinations, including grouped filenames", async () => {
	const mr = "https://gitlab.example/group/subgroup/api/-/merge_requests/17";
	const run = {
		reviewGate: {
			repositories: [
				{ repositoryId: "app", name: "app", url, headSha: "app-head" },
				{ repositoryId: "api", name: "api", url: mr, headSha: "api-head" },
			],
		},
	};
	const sha1 = createHash("sha1").update("shared.txt").digest("hex");
	const sha256 = createHash("sha256").update("shared.txt").digest("hex");
	expect(reviewDiffUrl(mr)).toBe(`${mr}/diffs`);
	expect(reviewDiffUrl(`${url}/`)).toBe(`${url}/files`);
	const api = reviewFileTarget(run, "api/shared.txt"),
		app = reviewFileTarget(run, "app/shared.txt");
	expect(await reviewFileUrl(api.url, api.path)).toBe(
		`${mr}/diffs?file=${sha1}#diff-content-${sha1}`,
	);
	expect(await reviewFileUrl(app.url, app.path)).toBe(
		`${url}/files#diff-${sha256}`,
	);
	expect(await reviewFileUrl(url, "shared.txt")).toBe(
		`${url}/files#diff-${sha256}`,
	);
	for (const malformed of [
		undefined,
		"javascript:alert(1)",
		"https://user:secret@gitlab.example/a/-/merge_requests/17",
	])
		expect(await reviewFileUrl(malformed, "shared.txt")).toBeUndefined();
	// Custom forges keep their published destination; unsupported routes are never invented.
	expect(
		await reviewFileUrl("https://forge.example/reviews/17", "shared.txt"),
	).toBe("https://forge.example/reviews/17");
});
