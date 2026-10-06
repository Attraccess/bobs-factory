import type { LinearClient } from "@linear/sdk";
import { expect, it, vi } from "vitest";
import { LinearIssueTrackerService } from "../src/LinearIssueTrackerService.js";

it("fetches every attachment page and retains titles/URLs", async () => {
	const attachments = vi
		.fn()
		.mockResolvedValueOnce({
			nodes: [{ title: "First", url: "https://example.com/1" }],
			pageInfo: { hasNextPage: true, endCursor: "cursor1" },
		})
		.mockResolvedValueOnce({
			nodes: [{ title: "", url: "https://example.com/2" }],
			pageInfo: { hasNextPage: false },
		});
	const client = {
		issue: vi.fn(async () => ({ attachments })),
	} as unknown as LinearClient;
	const tracker = new LinearIssueTrackerService(client);
	expect(await tracker.fetchIssueAttachments("issue")).toEqual([
		{ title: "First", url: "https://example.com/1" },
		{ title: "Untitled attachment", url: "https://example.com/2" },
	]);
	expect(attachments.mock.calls).toEqual([
		[{ first: 100 }],
		[{ first: 100, after: "cursor1" }],
	]);
});
it.each([
	undefined,
	"same",
])("fails visibly when a cursor cannot advance: %s", async (endCursor) => {
	const attachments = vi.fn(async () => ({
		nodes: [],
		pageInfo: { hasNextPage: true, endCursor },
	}));
	const tracker = new LinearIssueTrackerService({
		issue: async () => ({ attachments }),
	} as unknown as LinearClient);
	await expect(tracker.fetchIssueAttachments("issue")).rejects.toThrow(
		"pagination did not advance",
	);
	expect(attachments.mock.calls.length).toBe(endCursor ? 2 : 1);
});
it("detects cursor cycles instead of looping or returning incomplete data", async () => {
	let call = 0;
	const attachments = vi.fn(async () => ({
		nodes: [],
		pageInfo: { hasNextPage: true, endCursor: ["a", "b", "a"][call++] },
	}));
	const tracker = new LinearIssueTrackerService({
		issue: async () => ({ attachments }),
	} as unknown as LinearClient);
	await expect(tracker.fetchIssueAttachments("issue")).rejects.toThrow(
		"pagination did not advance",
	);
	expect(attachments).toHaveBeenCalledTimes(3);
});

it("links PRs through native attachments and exposes provider failure", async () => {
	const createAttachment = vi
		.fn()
		.mockResolvedValueOnce({ success: true })
		.mockResolvedValueOnce({ success: false });
	const tracker = new LinearIssueTrackerService({
		createAttachment,
	} as unknown as LinearClient);
	await tracker.linkPullRequest(
		"issue",
		"https://github.com/org/repo/pull/1",
		"Factory pull request",
	);
	expect(createAttachment).toHaveBeenCalledWith({
		issueId: "issue",
		url: "https://github.com/org/repo/pull/1",
		title: "Factory pull request",
	});
	await expect(
		tracker.linkPullRequest(
			"issue",
			"https://github.com/org/repo/pull/1",
			"Factory pull request",
		),
	).rejects.toThrow("Failed to attach PR");
});
