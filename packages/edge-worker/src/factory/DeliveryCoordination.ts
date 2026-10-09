import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { repositoryReference } from "./GitProviderReference.js";
import { delay } from "./MergeReadiness.js";
import {
	groupedOutput,
	repositoryRun,
	runRepositories,
} from "./RepositoryScope.js";
import { deliveryTargetLabel } from "./RunAttention.js";
import type { WorkflowStep } from "./Workflow.js";
import type { ExecutionContext, FactoryRun } from "./WorkflowRuntime.js";

/** Instance-owned coordination, persisted with the run rather than a process lease. */
export interface DeliveryCoordination {
	waitingSince?: string;
	operation?: string;
	blockers?: { runId: string; operation: string; targets: string[] }[];
	scopes: string[];
	queuedAt: string;
	phase: "queued" | "active" | "released";
	admittedAt?: string;
	releasedAt?: string;
	reason?: string;
}
const terminal = (run: FactoryRun) =>
	!["running", "waiting"].includes(run.status);
const repositoryIdentities = new Map<string, string>();
function localRepository(path: string): string {
	const normalized = existsSync(path) ? realpathSync(path) : resolve(path);
	const cached = repositoryIdentities.get(normalized);
	if (cached) return cached;
	let identity = `local:${normalized}`;
	if (existsSync(path)) {
		try {
			const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
				cwd: path,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 5000,
			}).trim();
			identity = `local:${realpathSync(resolve(path, common))}`;
		} catch {
			/* A fixture or unpublished repository may not yet be a Git checkout. */
		}
	}
	repositoryIdentities.set(normalized, identity);
	if (repositoryIdentities.size > 200)
		repositoryIdentities.delete(repositoryIdentities.keys().next().value!);
	return identity;
}
/** Publication receipts and native worktree changes define targets, never selection alone. */
export function deliveryScopes(run: FactoryRun): string[] {
	return [
		...new Set(
			runRepositories(run)
				.filter((repository) => {
					const projected = repositoryRun(run, repository);
					if (
						["source", "draft-pr", "merge"].some(
							(key) =>
								typeof (projected.outputs[key] as { url?: unknown } | undefined)
									?.url === "string",
						)
					)
						return true;
					if (
						groupedOutput(run.outputs["draft-pr"])?.deliveries.some(
							(d) => d.repositoryId === repository.id,
						)
					)
						return true;
					const git = (...args: string[]) =>
						execFileSync("git", args, {
							cwd: repository.workspace,
							encoding: "utf8",
							timeout: 5000,
							stdio: ["ignore", "pipe", "ignore"],
						}).trim();
					try {
						if (git("status", "--porcelain")) return true;
						const base =
							(projected.outputs.source as { baseRefName?: string } | undefined)
								?.baseRefName ?? repository.baseBranch;
						let ref = `refs/remotes/origin/${base}`;
						try {
							git("rev-parse", "--verify", ref);
						} catch {
							ref = `refs/heads/${base}`;
						}
						return Boolean(git("diff", "--name-only", `${ref}...HEAD`));
					} catch {
						// An unreadable/missing base is uncertainty, not proof of unchanged context.
						return true;
					}
				})
				.map((repository) => {
					const url =
						repository.providerSnapshot?.repositoryUrl ??
						repository.githubUrl ??
						repository.gitlabUrl ??
						(repository.gitProvider?.type === "custom"
							? repository.gitProvider.repositoryUrl
							: undefined);
					const identity = url
						? repositoryReference(url).url
						: localRepository(repository.repositoryPath);
					const base =
						(
							repositoryRun(run, repository).outputs.source as
								| { baseRefName?: string }
								| undefined
						)?.baseRefName ?? repository.baseBranch;
					return JSON.stringify([identity, base]);
				}),
		),
	].sort();
}

/** Concrete mutations, including renamed correction branches in frozen definitions. */
export function deliveryStep(run: FactoryRun, step: WorkflowStep): boolean {
	if (step.delivery === "exclusive") return true;
	if (step.tool === "draft-pr") return true;
	// Merge owns short inspect/mutation reservations internally, releasing between provider polls.
	if (step.tool === "merge") return false;
	if (["fanout", "workflow"].includes(step.type)) return false;
	if (["ci-fix", "code-fix", "visual-fix", "human-fix"].includes(step.id))
		return true;
	const definitions = [run.workflow, ...(run.workflowDefinitions ?? [])];
	const correction = (steps: WorkflowStep[]): boolean =>
		steps.some(
			(item) =>
				([
					"ci",
					"merge",
					"handoff",
					"review-gate",
					"visual-gate",
					"human-review",
				].includes(item.tool ?? "") &&
					item.branches.some(
						(branch) =>
							branch.next === step.id &&
							((branch.when.path === "fix" && branch.when.equals === true) ||
								(branch.when.path === "approved" &&
									branch.when.equals === false) ||
								(branch.when.path === "decision" &&
									branch.when.equals === "reject")),
					)) ||
				(item.groups ?? []).some(correction),
		);
	return definitions.some((definition) => correction(definition.steps));
}

/** Shared QA is distinct from repository integration; legacy plans remain conservative. */
export function resourceScopes(context: ExecutionContext): string[] {
	if (context.step.resources?.length)
		return context.step.resources
			.map((resource) => JSON.stringify(["resource", resource]))
			.sort();
	if (context.step.id !== "capture") return [];
	const environment = (
		context.outputs?.["visual-scope"] as
			| {
					environment?: { isolation: string; resources?: string[] };
			  }
			| undefined
	)?.environment;
	if (environment?.isolation === "worktree") return [];
	if (environment?.isolation === "shared") {
		if (!environment.resources?.length)
			throw new Error(
				"Shared QA requires explicit resource identities before execution",
			);
		return environment.resources
			.map((resource) => JSON.stringify(["resource", resource]))
			.sort();
	}
	return runRepositories(context.run)
		.map((repository) => {
			const url =
				repository.providerSnapshot?.repositoryUrl ??
				repository.githubUrl ??
				repository.gitlabUrl;
			return JSON.stringify([
				"qa",
				url
					? repositoryReference(url).url
					: localRepository(repository.repositoryPath),
			]);
		})
		.sort();
}

function claims(run: FactoryRun): [string, DeliveryCoordination][] {
	return Object.entries(run.deliveryReservations ?? {}).filter(
		([, claim]) => claim.phase !== "released",
	);
}
function updateSummary(run: FactoryRun, last: DeliveryCoordination): void {
	const pending = claims(run).map(([, claim]) => claim);
	const active = pending.find((claim) => claim.phase === "active");
	run.deliveryCoordination = pending.length
		? {
				...(active ?? pending[0]!),
				scopes: [...new Set(pending.flatMap((claim) => claim.scopes))].sort(),
			}
		: { ...last };
}

/** Retain queue priority only for actual unfinished leaves, never passive parent frames. */
export function restoreDelivery(run: FactoryRun): void {
	const executing = new Set<string>();
	const visit = (
		frame: FactoryRun["checkpoint"],
		steps: WorkflowStep[],
		prefix: string,
	) => {
		if (!frame || frame.active?.phase !== "executing") return;
		const step = steps.find((candidate) => candidate.id === frame.current);
		if (!step) return;
		const key = `${prefix}${step.id}`;
		if (step.type === "workflow") {
			const definition = run.workflowDefinitions?.find(
				(candidate) => candidate.id === step.workflow,
			);
			if (definition)
				visit(frame.active.children?.[0], definition.steps, `${key}/`);
		} else if (step.type === "fanout") {
			step.groups?.forEach((group, index) => {
				visit(frame.active?.children?.[index], group, `${key}/${index}/`);
			});
		} else {
			executing.add(`${key}:mutation`);
			executing.add(`${key}:resources`);
		}
	};
	visit(run.checkpoint, run.workflow.steps, "");
	const pending = Object.entries(run.deliveryReservations ?? {});
	releaseDelivery(run, "Restart requires operation admission");
	for (const [key, claim] of pending) {
		if (!executing.has(key)) continue;
		claim.phase = "queued";
		claim.reason = "Restart requires operation admission";
		delete claim.admittedAt;
		delete claim.releasedAt;
		updateSummary(run, claim);
	}
}

/** Atomic grouped admission in one Factory instance, without an agent/capacity slot. */
export async function acquireDelivery(
	run: FactoryRun,
	runs: () => Iterable<FactoryRun>,
	signal: AbortSignal,
	save: () => void,
	log: (message: string) => void,
	options: {
		key?: string;
		scopes?: string[] | (() => string[]);
		reason?: string;
	} = {},
): Promise<void> {
	const key = options.key ?? "delivery";
	run.deliveryReservations ??= {};
	const previous = run.deliveryReservations[key];
	const claim: DeliveryCoordination = {
		scopes:
			typeof options.scopes === "function"
				? options.scopes()
				: (options.scopes ?? deliveryScopes(run)),
		queuedAt: previous?.queuedAt ?? new Date().toISOString(),
		phase: "queued",
		operation: key,
		reason: options.reason ?? "Repository integration/publication",
	};
	// Reconcile the entire target set synchronously before admitting any mutation.
	run.deliveryReservations[key] = claim;
	updateSummary(run, claim);
	save();
	let reported = "";
	try {
		for (;;) {
			signal.throwIfAborted();
			const blockers = [...runs()]
				.filter((other) => !terminal(other))
				.flatMap((other) =>
					claims(other).flatMap(([operation, candidate]) => {
						if (other.id === run.id && operation === key) return [];
						const targets = candidate.scopes.filter((scope) =>
							claim.scopes.includes(scope),
						);
						const earlier =
							other.createdAt < run.createdAt ||
							(other.createdAt === run.createdAt &&
								(candidate.queuedAt < claim.queuedAt ||
									(candidate.queuedAt === claim.queuedAt &&
										JSON.stringify([other.id, operation]) <
											JSON.stringify([run.id, key]))));
						return targets.length && (candidate.phase === "active" || earlier)
							? [{ runId: other.id, operation, targets }]
							: [];
					}),
				);
			if (!blockers.length) {
				// Refresh native targets only when eligible, keeping queued polling cheap.
				const current =
					typeof options.scopes === "function"
						? options.scopes()
						: (options.scopes ?? deliveryScopes(run));
				if (JSON.stringify(current) !== JSON.stringify(claim.scopes)) {
					claim.scopes = current;
					updateSummary(run, claim);
					save();
					continue;
				}
				claim.phase = "active";
				claim.admittedAt = new Date().toISOString();
				delete claim.blockers;
				updateSummary(run, claim);
				save();
				if (claim.scopes.length)
					log(
						`${claim.reason} admitted for ${claim.scopes.map(deliveryTargetLabel).join(", ")}.`,
					);
				return;
			}
			const fingerprint = JSON.stringify(blockers);
			if (reported !== fingerprint) {
				claim.blockers = blockers;
				updateSummary(run, claim);
				save();
				log(
					`Waiting for ${claim.reason}: ${blockers.map((blocker) => `run ${blocker.runId}, operation ${blocker.operation.replace(/:(mutation|resources)$/, "")}, target ${blocker.targets.map(deliveryTargetLabel).join(", ")}`).join("; ")}.`,
				);
				reported = fingerprint;
			}
			await delay(signal, 200);
		}
	} catch (error) {
		releaseDelivery(run, "Admission cancelled", key);
		save();
		throw error;
	}
}
export function releaseDelivery(
	run: FactoryRun,
	reason: string,
	key?: string,
): void {
	const reservations = key
		? [run.deliveryReservations?.[key]].filter(Boolean)
		: Object.values(run.deliveryReservations ?? {});
	// Explicit compatibility: a legacy broad reservation is never an operation lease.
	if (!key && run.deliveryCoordination)
		reservations.push(run.deliveryCoordination);
	for (const reservation of reservations) {
		reservation!.phase = "released";
		reservation!.releasedAt = new Date().toISOString();
		reservation!.reason = reason;
		delete reservation!.blockers;
	}
	const last = reservations.at(-1);
	if (last) updateSummary(run, last!);
}
