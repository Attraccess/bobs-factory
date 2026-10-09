import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GitProviderConfig, RepositoryConfig } from "bobs-factory-core";
import type { GitProviderSnapshot } from "./GitProvider.js";
import type { FactoryRun } from "./WorkflowRuntime.js";

/** Frozen repository identity and worktree, shared by every workflow in a run. */
export interface RunRepository {
	id: string;
	name: string;
	repositoryPath: string;
	workspace: string;
	baseBranch: string;
	githubUrl?: string;
	gitlabUrl?: string;
	gitProvider?: GitProviderConfig;
	providerSnapshot?: GitProviderSnapshot;
}
export interface RepositoryRevision {
	repositoryId: string;
	name: string;
	headSha: string;
	dirty: boolean;
}
export interface DeliveryResult {
	repositoryId: string;
	name: string;
	output: Record<string, unknown>;
}
export interface GroupedOutput extends Record<string, unknown> {
	scopeVersion: 1;
	deliveries: DeliveryResult[];
}
export interface ApprovedRepository {
	repositoryId: string;
	name: string;
	url: string;
	headSha: string;
}

/** Equal, nonempty routing-label sets define a scope without another config format. */
export function repositoryScopes(repositories: RepositoryConfig[]) {
	const scopes: {
		id: string;
		name: string;
		repositoryIds: string[];
		members: { id: string; name: string }[];
	}[] = [];
	const byLabels = new Map<string, (typeof scopes)[number]>();
	for (const repository of repositories.filter(
		(repo) => repo.isActive !== false,
	)) {
		const labels = [...new Set(repository.routingLabels ?? [])].sort();
		const key = labels.length
			? JSON.stringify([repository.linearWorkspaceId ?? null, labels])
			: undefined;
		const scope = key ? byLabels.get(key) : undefined;
		if (scope) {
			scope.repositoryIds.push(repository.id);
			scope.members.push({ id: repository.id, name: repository.name });
		} else {
			const added = {
				id: repository.id,
				name: repository.name,
				repositoryIds: [repository.id],
				members: [{ id: repository.id, name: repository.name }],
			};
			scopes.push(added);
			if (key) byLabels.set(key, added);
		}
	}
	return scopes;
}

export function snapshotRepositories(
	repositories: RepositoryConfig[],
	workspace: string,
	repoPaths?: Record<string, string>,
	baseBranches?: Record<string, string | undefined>,
): RunRepository[] {
	if (
		workspace &&
		repositories.length > 1 &&
		(repositories.some((repository) => !repoPaths?.[repository.id]) ||
			new Set(Object.values(repoPaths ?? {})).size !== repositories.length)
	)
		throw new Error(
			"Grouped workflows require a distinct worktree for every repository",
		);
	if (
		workspace &&
		repositories.length > 1 &&
		repositories.some((repo) => !existsSync(join(repoPaths![repo.id]!, ".git")))
	)
		throw new Error(
			"Grouped repository preparation failed; every repository needs a usable Git worktree",
		);
	return repositories.map((repository) => ({
		id: repository.id,
		name: repository.name,
		repositoryPath: repository.repositoryPath,
		workspace: repoPaths?.[repository.id] ?? workspace,
		baseBranch: baseBranches?.[repository.id] ?? repository.baseBranch,
		githubUrl: repository.githubUrl,
		gitlabUrl: repository.gitlabUrl,
		gitProvider: structuredClone(repository.gitProvider),
	}));
}

export function runRepositories(run: FactoryRun): RunRepository[] {
	if (run.repositories?.length) return run.repositories;
	const metadata = (run.outputs.repository ?? {}) as Partial<RunRepository>;
	return [
		{
			id: run.repositoryId,
			name: metadata.name ?? run.repositoryId,
			repositoryPath: run.workspace,
			workspace: run.workspace,
			baseBranch: metadata.baseBranch ?? "main",
			githubUrl: metadata.githubUrl,
			gitlabUrl: metadata.gitlabUrl,
			gitProvider: metadata.gitProvider,
			providerSnapshot: run.gitProvider,
		},
	];
}

/** A group revision is a fingerprint, never a Git commit in any one repository. */
export function scopeRevision(
	revisions: { repositoryId: string; headSha: string }[],
) {
	if (revisions.length === 1) return revisions[0]!.headSha;
	return createHash("sha256")
		.update(
			JSON.stringify(
				revisions.map((item) => [item.repositoryId, item.headSha]).sort(),
			),
		)
		.digest("hex");
}

export function groupedOutput(value: unknown): GroupedOutput | undefined {
	if (!value || typeof value !== "object") return;
	const output = value as Partial<GroupedOutput>;
	if (output.scopeVersion === 1 && Array.isArray(output.deliveries))
		return output as GroupedOutput;
	return undefined;
}

export function deliveryRevisions(value: unknown): ApprovedRepository[] {
	return (groupedOutput(value)?.deliveries ?? []).flatMap((delivery) => {
		const { url, headSha } = delivery.output;
		return typeof url === "string" && typeof headSha === "string"
			? [
					{
						repositoryId: delivery.repositoryId,
						name: delivery.name,
						url,
						headSha,
					},
				]
			: [];
	});
}

/** Project shared role evidence and exact delivery receipts into one Git repository. */
export function repositoryRun(
	run: FactoryRun,
	repository: RunRepository,
): FactoryRun {
	const project = (value: unknown): unknown => {
		const group = groupedOutput(value);
		if (group)
			return group.deliveries.find(
				(item) => item.repositoryId === repository.id,
			)?.output;
		if (!value || typeof value !== "object" || Array.isArray(value))
			return value;
		const record = value as Record<string, unknown>;
		const revision = (
			record.repositories as
				| (RepositoryRevision & { baseSha?: string })[]
				| undefined
		)?.find?.((item) => item.repositoryId === repository.id);
		const baseline = record.baseline
			? (project(record.baseline) as Record<string, unknown>)
			: undefined;
		return {
			...record,
			...(revision ? { headSha: revision.headSha, dirty: revision.dirty } : {}),
			...(revision?.baseSha ? { baseSha: revision.baseSha } : {}),
			...(baseline
				? {
						baseline,
						...(Array.isArray(record.reviewers)
							? {
									reviewers: record.reviewers.map((reviewer) => ({
										...reviewer,
										stamp: {
											...reviewer.stamp,
											headSha: baseline.headSha,
											baseSha: baseline.baseSha,
										},
									})),
								}
							: {}),
					}
				: {}),
			...Object.fromEntries(
				["addressedCommentIds", "addressedReviewIds"]
					.filter((key) => Array.isArray(record[key]))
					.map((key) => [
						key,
						(record[key] as string[])
							.filter((id) => id.startsWith(`${repository.id}:`))
							.map((id) => id.slice(repository.id.length + 1)),
					]),
			),
			...(Array.isArray(record.assessedComments)
				? {
						assessedComments: (record.assessedComments as { id: string }[])
							.filter((item) => item.id.startsWith(`${repository.id}:`))
							.map((item) => ({
								...item,
								id: item.id.slice(repository.id.length + 1),
							})),
					}
				: {}),
		};
	};
	const outputs = Object.fromEntries(
		Object.entries(run.outputs).map(([key, value]) => [key, project(value)]),
	);
	if (repository.id !== run.repositoryId) delete outputs.source;
	Object.assign(outputs, run.repositoryOutputs?.[repository.id]);
	outputs.repository = { ...repository };
	return {
		...run,
		repositoryId: repository.id,
		workspace: repository.workspace,
		repositories: undefined,
		gitProvider: repository.providerSnapshot,
		outputs,
		history: run.history.map((item) => ({
			...item,
			output: project(item.output),
		})),
		roleRevisions: Object.fromEntries(
			Object.entries(run.roleRevisions ?? {}).map(([key, value]) => [
				key,
				project(value),
			]),
		) as FactoryRun["roleRevisions"],
		reviewRounds: run.reviewRounds?.map(
			(round) =>
				project(round) as NonNullable<FactoryRun["reviewRounds"]>[number],
		),
		humanDecisions: run.humanDecisions?.map((decision) => {
			const approved = decision.repositories?.find(
				(item) => item.repositoryId === repository.id,
			);
			return { ...decision, headSha: approved?.headSha ?? decision.headSha };
		}),
	};
}

export function repositoryScopeInstructions(run: FactoryRun): string {
	if (run.delivery?.contract.mode === "external")
		return `Repository scope retained as context: ${JSON.stringify(runRepositories(run))}. The accepted task delivers external ticket changes. Do not make artificial repository changes, commit, push, publish a PR or merge. External completion requires independent verification, human acceptance of the current digest and a final state check.`;
	return `Repository scope (retained for every workflow step): ${JSON.stringify(runRepositories(run))}. Work inside each listed workspace. A grouped workspace is a parent directory, not a Git repository. Review and validate changes in every affected repository. Runtime publication creates one PR or merge request in each changed repository, using its own base branch, provider and exact revision. Unchanged repositories remain context. For repository delivery, human approval binds all delivered revisions and completion requires confirmed merge of every repository delivery. External delivery is selected only by a reviewed delivery contract. Mixed delivery additionally requires verified external state, explicit acceptance and a final check.`;
}

/** Keep the established branch/result fields while requiring all successful deliveries. */
export function aggregateDeliveries(
	deliveries: DeliveryResult[],
): GroupedOutput {
	if (!deliveries.length)
		throw new Error("No repository has implementation changes to publish");
	const result: GroupedOutput = {
		...deliveries[0]!.output,
		scopeVersion: 1,
		deliveries,
	};
	for (const field of ["approved", "reviewReady", "ready", "merged", "skipFix"])
		if (deliveries.some((item) => field in item.output))
			result[field] = deliveries.every((item) => item.output[field] === true);
	for (const field of [
		"fix",
		"rework",
		"reviewRequired",
		"qaBlocked",
		"qaRetry",
		"captureBlocked",
		"reviewBlocked",
	])
		if (deliveries.some((item) => field in item.output))
			result[field] = deliveries.some((item) => item.output[field] === true);
	for (const field of [
		"questions",
		"ciAssistance",
		"blockers",
		"checks",
		"threads",
		"comments",
		"reviews",
		"unassessedComments",
		"findings",
	])
		if (deliveries.some((item) => Array.isArray(item.output[field])))
			result[field] = deliveries.flatMap((item) =>
				(Array.isArray(item.output[field])
					? (item.output[field] as unknown[])
					: []
				).map((value) => {
					if (typeof value === "string") return `${item.name}: ${value}`;
					if (!value || typeof value !== "object") return value;
					const record = value as Record<string, unknown>;
					return {
						...record,
						repositoryId: item.repositoryId,
						...(record.id === undefined
							? {}
							: { id: `${item.repositoryId}:${record.id}` }),
						...(typeof record.message === "string"
							? { message: `${item.name}: ${record.message}` }
							: {}),
					};
				}),
			);
	for (const field of ["headSha", "baseSha", "correctionBaseSha"])
		if (deliveries.every((item) => typeof item.output[field] === "string"))
			result[field] = scopeRevision(
				deliveries.map((item) => ({
					repositoryId: item.repositoryId,
					headSha: item.output[field] as string,
				})),
			);
	return result;
}
