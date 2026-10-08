import { resolveGitProvider } from "./GitProvider.js";
import { confirmedMerge } from "./MergeRecovery.js";
import {
	aggregateDeliveries,
	type DeliveryResult,
	deliveryRevisions,
	groupedOutput,
	repositoryRun,
	runRepositories,
	scopeRevision,
} from "./RepositoryScope.js";
import { aggregateForContext, scopeContextDigest } from "./SpecialistReview.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

export type RepositoryCommand = (
	context: ExecutionContext,
	executable: string,
	args: string[],
	timeout?: number,
) => Promise<string>;

/** Read-only completion recovery after cleanup; never merge from source clones. */
export async function confirmedGroupedMerge(
	context: ExecutionContext,
	command: RepositoryCommand,
) {
	const { run } = context;
	const published = deliveryRevisions(run.outputs["draft-pr"]);
	const decision = run.humanDecisions?.at(-1);
	if (
		decision?.decision !== "approve" ||
		!published.length ||
		JSON.stringify(decision.repositories) !== JSON.stringify(published)
	)
		throw new Error(
			"Merge recovery must bind every published repository to its approved URL and revision",
		);
	const deliveries: DeliveryResult[] = [];
	for (const approved of published) {
		const repository = runRepositories(run).find(
			(repo) => repo.id === approved.repositoryId,
		);
		if (!repository)
			throw new Error("Approved repository is outside the saved run scope");
		const child = {
			...context,
			run: {
				...repositoryRun(run, repository),
				workspace: repository.repositoryPath,
			},
		};
		const execute = (exe: string, args: string[]) => command(child, exe, args);
		const provider = await resolveGitProvider(child, execute, approved.url);
		const pr = await provider.view(approved.url, "state,headRefOid");
		const receipt = confirmedMerge(child.run, {
			state: pr.state,
			headSha: pr.headRefOid,
		});
		if (!receipt)
			throw new Error(
				`${repository.name} has not confirmed merge; the saved worktree is unavailable`,
			);
		deliveries.push({
			repositoryId: repository.id,
			name: repository.name,
			output: receipt,
		});
	}
	return aggregateDeliveries(deliveries);
}
const deliveryTools = new Set([
	"inspect-existing",
	"draft-pr",
	"review-after-fix",
	"ci",
	"human-review",
	"handoff",
	"merge",
]);

/** Review/QA roles operate once over the complete scope, with a revision fingerprint. */
export async function scopeCommand(
	context: ExecutionContext,
	command: RepositoryCommand,
	executable: string,
	args: string[],
	timeout?: number,
): Promise<string> {
	const repositories = runRepositories(context.run);
	if (repositories.length > 1 && executable === "git") {
		if (args.join(" ") === "rev-parse HEAD") {
			const revisions = await Promise.all(
				repositories.map(async (repository) => ({
					repositoryId: repository.id,
					headSha: (
						await command(
							{ ...context, run: repositoryRun(context.run, repository) },
							executable,
							args,
							timeout,
						)
					).trim(),
				})),
			);
			return scopeRevision(revisions);
		}
		if (args.join(" ") === "status --porcelain") {
			const statuses = await Promise.all(
				repositories.map(async (repository) => {
					const status = await command(
						{ ...context, run: repositoryRun(context.run, repository) },
						executable,
						args,
						timeout,
					);
					return status.trim() ? `${repository.name}: ${status}` : "";
				}),
			);
			return statuses.filter(Boolean).join("\n");
		}
	}
	return command(context, executable, args, timeout);
}

/** Fan out only repository-owned Git/provider operations, retaining each side effect. */
export async function groupedTool(
	context: ExecutionContext,
	command: RepositoryCommand,
	tool: (context: ExecutionContext) => Promise<unknown>,
): Promise<unknown> {
	const { run } = context;
	if (!deliveryTools.has(context.step.tool ?? "")) return tool(context);
	const scope = runRepositories(run);
	let published = deliveryRevisions(run.outputs["draft-pr"]);
	if (["ci", "review-after-fix"].includes(context.step.tool ?? "")) {
		const deliveries = [
			...(groupedOutput(run.outputs["draft-pr"])?.deliveries ?? []),
		];
		for (const repository of scope.filter(
			(repo) =>
				!published.some((delivery) => delivery.repositoryId === repo.id),
		)) {
			const projected = repositoryRun(run, repository);
			const child = {
				...context,
				run: projected,
				step: { ...context.step, id: "draft-pr", tool: "draft-pr" },
				allowUnchangedRepository: true,
			};
			let output: Record<string, unknown>;
			try {
				output = (await tool(child)) as Record<string, unknown>;
			} catch (error) {
				throw new Error(
					`${repository.name}: ${error instanceof Error ? error.message : String(error)}`,
					{ cause: error },
				);
			} finally {
				repository.providerSnapshot = projected.gitProvider;
				context.save?.();
			}
			if (output.unchanged === true) continue;
			deliveries.push({
				repositoryId: repository.id,
				name: repository.name,
				output,
			});
			repository.providerSnapshot = projected.gitProvider;
			run.repositoryOutputs ??= {};
			run.repositoryOutputs[repository.id] ??= {};
			run.repositoryOutputs[repository.id]!["draft-pr"] = output;
			run.outputs["draft-pr"] = aggregateDeliveries(deliveries);
			context.save?.();
		}
		published = deliveryRevisions(run.outputs["draft-pr"]);
	}
	const repositories =
		context.step.tool === "draft-pr" || context.step.tool === "inspect-existing"
			? scope
			: scope.filter((repository) =>
					published.some((delivery) => delivery.repositoryId === repository.id),
				);
	if (!repositories.length)
		throw new Error("No published repositories to review or merge");
	// Check the complete approved delivery set before the first merge mutation.
	if (context.step.tool === "merge") {
		const decision = run.humanDecisions?.at(-1);
		if (
			decision?.decision !== "approve" ||
			!decision.repositories?.length ||
			JSON.stringify(decision.repositories) !== JSON.stringify(published)
		)
			throw new Error(
				"Explicit human approval must bind every current repository PR and revision",
			);
		const aggregate = aggregateForContext(context);
		const scopeUnchanged =
			!aggregate ||
			scopeContextDigest(aggregate.baseline.context) ===
				scopeContextDigest(
					context.currentScope?.() ?? {
						...(context.input as Record<string, unknown>),
						answers: run.answers,
						humanDecisions: run.humanDecisions ?? [],
					},
				);
		for (const repository of scope) {
			const projected = repositoryRun(run, repository);
			const child = { ...context, run: projected };
			const execute = (exe: string, args: string[]) =>
				command(child, exe, args);
			const approved = decision.repositories.find(
				(item) => item.repositoryId === repository.id,
			);
			const head = (await execute("git", ["rev-parse", "HEAD"])).trim();
			const dirty = (await execute("git", ["status", "--porcelain"])).trim();
			if (!approved) {
				const base = `refs/remotes/origin/${repository.baseBranch}`;
				if (
					scopeUnchanged &&
					!dirty &&
					!(
						await execute("git", ["diff", "--name-only", `${base}...HEAD`])
					).trim()
				)
					continue;
			} else {
				const provider = await resolveGitProvider(child, execute, approved.url);
				const remote = await provider.view(approved.url, "state,headRefOid");
				const reviewed = aggregateForContext(child);
				const baseUnchanged =
					!reviewed ||
					remote.state === "MERGED" ||
					(await provider.readiness(approved.url)).baseSha ===
						reviewed.baseline.baseSha;
				if (
					scopeUnchanged &&
					baseUnchanged &&
					!dirty &&
					head === approved.headSha &&
					remote.headRefOid === approved.headSha &&
					["OPEN", "MERGED"].includes(remote.state)
				)
					continue;
			}
			delete run.reviewGate;
			const output = aggregateDeliveries(
				published.map((delivery) => ({
					repositoryId: delivery.repositoryId,
					name: delivery.name,
					output: {
						...(run.repositoryOutputs?.[delivery.repositoryId]?.ci as object),
						...delivery,
						fix: true,
						approved: false,
						reviewReady: false,
						merged: false,
						reason: `${repository.name} changed after approval; republish and repeat review for the complete scope`,
					},
				})),
			);
			run.outputs.ci = output;
			context.save?.();
			return output;
		}
	}
	const deliveries: DeliveryResult[] = [];
	for (const repository of repositories) {
		const projected = repositoryRun(run, repository);
		const child: ExecutionContext = {
			...context,
			run: projected,
			outputs: projected.outputs,
			allowUnchangedRepository: true,
			log: (message, source) =>
				context.log(`${repository.name}: ${message}`, source),
		};
		try {
			// A confirmed partial merge survives later publication/review retries.
			const receipt = projected.outputs.merge as
				| { merged?: boolean }
				| undefined;
			let output =
				receipt?.merged && context.step.tool !== "inspect-existing"
					? {
							...(projected.outputs.ci as object),
							...(projected.outputs[context.step.id] as object),
							...(projected.outputs["draft-pr"] as object),
							...receipt,
							approved: true,
							reviewReady: true,
							ready: true,
						}
					: await tool(child);
			if (!output || typeof output !== "object")
				throw new Error("Repository tool must return a structured result");
			if (context.step.tool === "ci") {
				const receipt = output as Record<string, unknown>;
				const draft = projected.outputs["draft-pr"] as Record<string, unknown>;
				if (typeof receipt.headSha === "string")
					projected.outputs["draft-pr"] = {
						...draft,
						headSha: receipt.headSha,
					};
				const prefix = (run.step ?? context.step.id).replace(/[^/]+$/, "");
				const reviewed = projected.roleRevisions?.[`${prefix}code-review`];
				if (
					reviewed &&
					(reviewed.dirty || reviewed.headSha !== receipt.headSha)
				) {
					if (
						!context.step.branches.some(
							(branch) =>
								branch.when.path === "fix" && branch.when.equals === true,
						)
					)
						throw new Error(
							`${repository.name} changed after code review; review the published revision before continuing`,
						);
					output = {
						...receipt,
						approved: false,
						reviewReady: false,
						fix: true,
						blockers: [
							...(Array.isArray(receipt.blockers) ? receipt.blockers : []),
							{
								kind: "revision",
								action: "fix",
								message: `${repository.name} needs code review on the current published revision`,
							},
						],
					};
				}
			}
			projected.outputs[context.step.id] = output;
			if ((output as { unchanged?: boolean }).unchanged !== true)
				deliveries.push({
					repositoryId: repository.id,
					name: repository.name,
					output: output as Record<string, unknown>,
				});
		} catch (error) {
			throw new Error(
				`${repository.name}: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			);
		} finally {
			repository.providerSnapshot = projected.gitProvider;
			const source = projected.outputs.source as
				| { baseRefName?: string }
				| undefined;
			if (context.step.tool === "inspect-existing" && source?.baseRefName)
				repository.baseBranch = source.baseRefName;
			run.repositoryOutputs ??= {};
			run.repositoryOutputs[repository.id] ??= {};
			const retained = run.repositoryOutputs[repository.id]!;
			for (const [key, value] of Object.entries(projected.outputs)) {
				if (
					value !== run.outputs[key] &&
					(deliveryTools.has(key) ||
						key === context.step.id ||
						key === "source" ||
						groupedOutput(run.outputs[key]))
				)
					retained[key] = value;
			}
			context.save?.();
		}
	}
	if (context.step.tool === "ci") {
		const draft = groupedOutput(run.outputs["draft-pr"]);
		if (draft)
			run.outputs["draft-pr"] = aggregateDeliveries(
				draft.deliveries.map((delivery) => ({
					...delivery,
					output:
						(run.repositoryOutputs?.[delivery.repositoryId]?.["draft-pr"] as
							| Record<string, unknown>
							| undefined) ?? delivery.output,
				})),
			);
		context.save?.();
	}
	return aggregateDeliveries(deliveries);
}
