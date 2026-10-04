import { expect, it, vi } from "vitest";
import { defaultWorkflows } from "../src/factory/defaultWorkflows.js";
import { FactoryTools } from "../src/factory/FactoryTools.js";
import {
	inspectPullRequest,
	ticketIdentifier,
} from "../src/factory/Takeover.js";
import type { ExecutionContext } from "../src/factory/WorkflowRuntime.js";

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
it("captures all issue/review discussion pages and rejects another repository or fork PR", async () => {
	const command = vi.fn(async (_exe: string, args: string[]) =>
		args[0] === "repo"
			? JSON.stringify({ nameWithOwner: "owner/repo" })
			: args[0] === "pr"
				? JSON.stringify(pr)
				: JSON.stringify([[{ body: "first page" }], [{ body: "second page" }]]),
	);
	const snapshot = await inspectPullRequest(command, pr.url);
	expect(snapshot.comments).toEqual([
		{ body: "first page" },
		{ body: "second page" },
	]);
	expect(snapshot.reviews).toHaveLength(2);
	expect(snapshot.reviewComments).toHaveLength(2);
	expect(
		command.mock.calls
			.filter(([, args]) => args[0] === "api")
			.every(
				([, args]) => args.includes("--paginate") && args.includes("--slurp"),
			),
	).toBe(true);
	await expect(
		inspectPullRequest(command, "https://github.com/another/repo/pull/3"),
	).rejects.toThrow("selected repository");
	await expect(
		inspectPullRequest(
			async (_exe, args) =>
				args[0] === "repo"
					? JSON.stringify({ nameWithOwner: "owner/repo" })
					: JSON.stringify({ ...pr, isCrossRepository: true }),
			pr.url,
		),
	).rejects.toThrow();
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
			if (args[0] === "pr" && args[1] === "view")
				return JSON.stringify({ state: "OPEN", isDraft: true });
			if (args[0] === "pr" && args[1] === "list") return "[]";
			return "";
		},
	});
	await tools.tool(ctx);
	expect(commands).toContainEqual(["gh", "pr", "ready", pr.url, "--undo"]);
	ctx.step = { ...ctx.step, tool: "draft-pr" };
	expect(await tools.tool(ctx)).toMatchObject({
		url: pr.url,
		branch: "feature/existing",
	});
	expect(
		commands.some(
			(args) => args[0] === "gh" && args[1] === "pr" && args[2] === "create",
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
