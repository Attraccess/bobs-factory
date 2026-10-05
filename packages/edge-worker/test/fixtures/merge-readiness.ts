export function providerReceipt(extra: Record<string, unknown> = {}) {
	return {
		data: {
			repository: {
				squashMergeAllowed: true,
				mergeCommitAllowed: true,
				rebaseMergeAllowed: true,
				pullRequest: {
					url: "https://github.com/test/repo/pull/1",
					headRefOid: "head",
					baseRefOid: "base",
					state: "OPEN",
					isDraft: true,
					mergeable: "MERGEABLE",
					mergeStateStatus: "BLOCKED",
					reviewDecision: "REVIEW_REQUIRED",
					reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
					comments: { nodes: [], pageInfo: {} },
					reviews: { nodes: [], pageInfo: {} },
					statusCheckRollup: {
						contexts: {
							nodes: [
								{ name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
							],
							pageInfo: { hasNextPage: false },
						},
					},
					...extra,
				},
			},
		},
	};
}
