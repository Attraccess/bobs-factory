import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { repositoryReference } from "./GitProviderReference.js";
import { delay } from "./MergeReadiness.js";
import { runRepositories } from "./RepositoryScope.js";
import type { WorkflowStep } from "./Workflow.js";
import type { FactoryRun } from "./WorkflowRuntime.js";

/** Instance-owned coordination, persisted with the run rather than a process lease. */
export interface DeliveryCoordination {
	waitingSince?: string;
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
function scopes(run: FactoryRun): string[] {
	return runRepositories(run)
		.map((repository) => {
			const url =
				repository.providerSnapshot?.repositoryUrl ??
				repository.githubUrl ??
				repository.gitlabUrl ??
				(repository.gitProvider?.type === "custom"
					? repository.gitProvider.repositoryUrl
					: undefined);
			// IDs can alias the same forge, and grouped deliveries claim all targets atomically.
			const identity = url
				? repositoryReference(url).url
				: localRepository(repository.repositoryPath);
			return JSON.stringify([identity, repository.baseBranch]);
		})
		.sort();
}
function overlaps(left: FactoryRun, right: FactoryRun): boolean {
	return left.deliveryCoordination!.scopes.some((scope) =>
		right.deliveryCoordination!.scopes.includes(scope),
	);
}
export function deliveryStep(run: FactoryRun, step: WorkflowStep): boolean {
	if (run.deliveryCoordination) return true;
	const reachable: WorkflowStep[] = [];
	const collect = (
		steps: WorkflowStep[],
		collected: WorkflowStep[],
		visited = new Set<string>(),
	) => {
		for (const item of steps) {
			collected.push(item);
			for (const group of item.groups ?? []) collect(group, collected, visited);
			if (item.workflow && !visited.has(item.workflow)) {
				visited.add(item.workflow);
				const called = run.workflowDefinitions?.find(
					(definition) => definition.id === item.workflow,
				);
				if (called) collect(called.steps, collected, visited);
			}
		}
	};
	collect(run.workflow.steps, reachable);
	if (
		!reachable.some((item) => item.tool === "merge" || item.tool === "handoff")
	)
		return false;
	// Concrete provider boundaries establish delivery. Every following configured
	// role is coordinated, regardless of its name, including historical resumes.
	const stages = [
		"draft-pr",
		"ci",
		"merge-readiness",
		"merge",
		"handoff",
		"human-review",
		"review-after-fix",
	];
	// Parallel children execute under their parent's admission. Claim delivery
	// before launching a fanout that contains a provider boundary, including calls
	// to frozen workflow definitions; implementation-only fanouts remain parallel.
	const fanoutSteps: WorkflowStep[] = [];
	if (step.type === "fanout") collect([step], fanoutSteps);
	return (
		stages.includes(step.tool ?? "") ||
		fanoutSteps.some((item) => stages.includes(item.tool ?? "")) ||
		run.history.some((entry) =>
			reachable.some(
				(item) =>
					item.id === entry.step.split("/").at(-1) &&
					stages.includes(item.tool ?? ""),
			),
		)
	);
}

/** Queue admission is synchronous inside one Factory instance; no agent/capacity slot is held. */
export async function acquireDelivery(
	run: FactoryRun,
	runs: () => Iterable<FactoryRun>,
	signal: AbortSignal,
	save: () => void,
	log: (message: string) => void,
): Promise<void> {
	if (
		run.deliveryCoordination?.phase === "active" &&
		![...runs()].some(
			(other) =>
				other.id !== run.id &&
				!terminal(other) &&
				other.deliveryCoordination?.phase === "active" &&
				overlaps(run, other),
		)
	)
		return;
	run.deliveryCoordination = {
		...run.deliveryCoordination,
		scopes: scopes(run),
		queuedAt: run.deliveryCoordination?.queuedAt ?? new Date().toISOString(),
		phase: "queued",
	};
	save();
	let reported = false;
	for (;;) {
		signal.throwIfAborted();
		const contenders = [...runs()].filter(
			(other) =>
				other.deliveryCoordination &&
				!terminal(other) &&
				other.deliveryCoordination.phase !== "released",
		);
		const blockers = contenders.filter(
			(other) =>
				other.id !== run.id &&
				overlaps(run, other) &&
				(other.deliveryCoordination!.phase === "active" ||
					other.createdAt < run.createdAt ||
					(other.createdAt === run.createdAt &&
						(other.deliveryCoordination!.queuedAt <
							run.deliveryCoordination!.queuedAt ||
							(other.deliveryCoordination!.queuedAt ===
								run.deliveryCoordination!.queuedAt &&
								other.id < run.id)))),
		);
		if (!blockers.length) {
			run.deliveryCoordination.phase = "active";
			run.deliveryCoordination.admittedAt = new Date().toISOString();
			delete run.deliveryCoordination.waitingSince;
			delete run.deliveryCoordination.releasedAt;
			delete run.deliveryCoordination.reason;
			save();
			log(
				"Delivery admitted; finishing integration and review before the next overlapping delivery.",
			);
			return;
		}
		if (!reported) {
			log(
				`Waiting for overlapping delivery ${blockers.map((other) => other.id).join(", ")}; implementation and completed evidence are retained.`,
			);
			reported = true;
		}
		await delay(signal, 200);
	}
}
export function releaseDelivery(run: FactoryRun, reason: string): void {
	if (
		!run.deliveryCoordination ||
		run.deliveryCoordination.phase === "released"
	)
		return;
	run.deliveryCoordination.phase = "released";
	run.deliveryCoordination.releasedAt = new Date().toISOString();
	run.deliveryCoordination.reason = reason;
}
