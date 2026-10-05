import type { IIssueTrackerService, Issue } from "cyrus-core";

/** Snapshot every comment page so later roles don't depend on a live ticket read. */
export async function issueSnapshot(
	issue: Issue,
	labels: string[],
	tracker?: IIssueTrackerService,
): Promise<unknown> {
	const comments: unknown[] = [];
	let after: string | undefined;
	do {
		const options = {
			first: 100,
			...(after ? { after } : {}),
		};
		const page = tracker
			? await tracker.fetchComments(issue.id, options)
			: await issue.comments(options);
		for (const comment of page.nodes) {
			const user = await comment.user;
			comments.push({
				id: comment.id,
				body: comment.body,
				createdAt: comment.createdAt,
				updatedAt: comment.updatedAt,
				author: user ? { id: user.id, name: user.name } : undefined,
			});
		}
		if (!page.pageInfo?.hasNextPage) break;
		const cursor = page.pageInfo.endCursor;
		if (!cursor || cursor === after)
			throw new Error("Ticket comment pagination did not advance");
		after = cursor;
	} while (after);
	const [state, assignee, team, project, parent] = await Promise.all([
		issue.state,
		issue.assignee,
		issue.team,
		issue.project,
		issue.parent,
	]);
	const attachments = tracker
		? await tracker.fetchIssueAttachments(issue.id)
		: (await issue.attachments()).nodes.map((item) => ({
				title: item.title,
				url: item.url,
			}));
	return {
		attachments,
		id: issue.id,
		identifier: issue.identifier,
		title: issue.title,
		description: issue.description,
		url: issue.url,
		priority: issue.priority,
		createdAt: issue.createdAt,
		updatedAt: issue.updatedAt,
		labels,
		state: state ? { name: state.name, type: state.type } : undefined,
		assignee: assignee ? { id: assignee.id, name: assignee.name } : undefined,
		team: team ? { id: team.id, name: team.name, key: team.key } : undefined,
		project: project ? { id: project.id, name: project.name } : undefined,
		parent: parent
			? { id: parent.id, identifier: parent.identifier, title: parent.title }
			: undefined,
		comments,
	};
}
