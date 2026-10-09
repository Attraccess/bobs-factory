import { expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import { GITHUB_API_COMMAND } from "../src/factory/GithubApi.js";
import {
	inspectPullRequest,
	ticketIdentifier,
} from "../src/factory/Takeover.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";
import { githubRequest } from "./fixtures/github-api.js";

const pr = {
	url: "https://github.com/owner/repo/pull/3",
	number: 3,
	title: "Existing PR",
	body: "Work in progress",
	headRefName: "feature/existing",
	headRefOid: "sha",
	baseRefName: "main",
	state: "OPEN",
	isDraft: false,
	isCrossRepository: false,
};
const apiPr = {
	html_url: pr.url,
	number: pr.number,
	node_id: "PR_node",
	title: pr.title,
	body: pr.body,
	draft: false,
	state: "open",
	merged: false,
	head: {
		ref: pr.headRefName,
		sha: pr.headRefOid,
		repo: { full_name: "owner/repo" },
	},
	base: { ref: pr.baseRefName, repo: { full_name: "owner/repo" } },
};
it("captures all issue/review discussion pages and rejects another repository or fork PR", async () => {
	const command = vi.fn(async (exe: string, args: string[]) => {
		if (exe === "git") return "git@github.com:owner/repo.git";
		expect(exe).toBe(GITHUB_API_COMMAND);
		const request = githubRequest(args);
		if (request.path === "repos/owner/repo/pulls/3")
			return JSON.stringify(apiPr);
		return JSON.stringify(
			request.path.endsWith("page=1")
				? Array.from({ length: 100 }, (_, id) => ({ id, body: "first page" }))
				: [{ id: 100, body: "second page" }],
		);
	});
	const snapshot = await inspectPullRequest(command, pr.url);
	expect(snapshot.comments).toHaveLength(101);
	expect(snapshot.comments.at(-1)).toMatchObject({ body: "second page" });
	expect(snapshot.reviews).toHaveLength(101);
	expect(snapshot.reviewComments).toHaveLength(101);
	await expect(
		inspectPullRequest(command, "https://github.com/another/repo/pull/3"),
	).rejects.toThrow("selected repository");
	await expect(
		inspectPullRequest(
			async (exe) =>
				exe === "git"
					? "git@github.com:owner/repo.git"
					: JSON.stringify({
							...apiPr,
							head: { ...apiPr.head, repo: { full_name: "fork/repo" } },
						}),
			pr.url,
		),
	).rejects.toThrow();
	expect(command.mock.calls.some(([exe]) => exe === "gh")).toBe(false);
	expect(ticketIdentifier("TEAM-4")).toBe("TEAM-4");
	expect(
		ticketIdentifier("https://linear.app/workspace/issue/TEAM-4/existing"),
	).toBe("TEAM-4");
	expect(() => ticketIdentifier("https://example.com/TEAM-4")).toThrow();
});
function context(tool: string): ExecutionContext {
	return {
		run: {
			id: "run",
			title: "Continue work",
			repositoryId: "repo",
			workflow: defaultWorkflows[2]!,
			status: "running",
			workspace: "/tmp",
			input: "Continue",
			createdAt: "",
			updatedAt: "",
			outputs: {
				source: { ...pr, isDraft: true },
				repository: { baseBranch: "main" },
			},
			history: [],
			answers: [],
			questions: [],
			events: [],
		},
		step: {
			id: tool,
			name: tool,
			type: "tool",
			tool,
			branches: [],
			maxVisits: 8,
		},
		input: {},
		signal: new AbortController().signal,
		log: () => {},
		evidenceDir: "/tmp/evidence",
	};
}
it("takes over the same PR, converts it to draft and never creates a replacement PR", async () => {
	const ctx = context("inspect-existing");
	ctx.run.outputs.source = pr;
	const commands: string[][] = [];
	const tools = new FactoryTools({
		postComment: async () => {},
		command: async (_context, exe, args) => {
			commands.push([exe, ...args]);
			if (args[0] === "branch") return "feature/existing";
			if (args[0] === "rev-parse") return "sha";
			if (args[0] === "rev-list") return "1";
			if (args[0] === "diff" && args.includes("--name-only"))
				return "feature.ts";
			if (exe === GITHUB_API_COMMAND) {
				const request = githubRequest(args);
				if (request.path.includes("?state=open")) return "[]";
				if (request.path === "graphql")
					return JSON.stringify({
						data: {
							convertPullRequestToDraft: {
								pullRequest: { id: "PR_node", isDraft: true },
							},
						},
					});
				return JSON.stringify({ ...apiPr, draft: true });
			}
			return "";
		},
	});
	await tools.tool(ctx);
	expect(
		commands
			.filter(([exe]) => exe === GITHUB_API_COMMAND)
			.map(([, arg]) => githubRequest([arg!])),
	).toContainEqual(
		expect.objectContaining({
			path: "graphql",
			body: expect.objectContaining({
				query: expect.stringContaining("convertPullRequestToDraft"),
			}),
		}),
	);
	ctx.step = { ...ctx.step, tool: "draft-pr" };
	expect(await tools.tool(ctx)).toMatchObject({
		url: pr.url,
		branch: "feature/existing",
	});
	expect(
		commands.some(
			(args) =>
				args[0] === GITHUB_API_COMMAND &&
				githubRequest(args.slice(1)).method === "POST" &&
				githubRequest(args.slice(1)).path !== "graphql",
		),
	).toBe(false);
});
it("refuses a changed takeover branch before committing or pushing anything", async () => {
	const commands: string[][] = [];
	const tools = new FactoryTools({
		postComment: async () => {},
		command: async (_context, exe, args) => {
			commands.push([exe, ...args]);
			return "wrong-branch";
		},
	});
	await expect(tools.tool(context("draft-pr"))).rejects.toThrow(
		"original PR branch",
	);
	expect(commands).toEqual([["git", "branch", "--show-current"]]);
});
