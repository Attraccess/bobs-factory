import { CLIIssueTrackerService } from "cyrus-core";
import { expect, it } from "vitest";
import { issueSnapshot } from "../src/factory/issueSnapshot.js";

it("snapshots every page of local ticket comments through the tracker API", async () => {
	const tracker = new CLIIssueTrackerService();
	tracker.seedDefaultData();
	tracker.fetchIssueAttachments = async () => [
		{ title: "Reference image", url: "https://example.com/reference.png" },
	];
	const issue = await tracker.createIssue({
		teamId: "team-default",
		title: "Existing work",
	});
	const bodies = Array.from(
		{ length: 103 },
		(_, index) => `Discussion ${index}`,
	);
	for (const body of bodies) await tracker.createComment(issue.id, { body });
	const result = (await issueSnapshot(issue, [], tracker)) as {
		comments: { body: string }[];
		attachments: { title: string; url: string }[];
	};
	expect(result.attachments).toEqual([
		{ title: "Reference image", url: "https://example.com/reference.png" },
	]);
	expect(result.comments.map((comment) => comment.body)).toEqual(bodies);
	await expect(
		tracker.fetchComments(issue.id, { after: "unknown", first: 100 }),
	).rejects.toThrow("Unknown comment cursor");
});
