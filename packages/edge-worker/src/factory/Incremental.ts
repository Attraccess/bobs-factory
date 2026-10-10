import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { feedbackPolicyInstructions } from "./FeedbackPolicy.js";
import {
	guideArtifactInstructions,
	guideMapInstructions,
} from "./GuideAuthoring.js";
import { guideGapFixInstructions } from "./GuideRecovery.js";
import {
	type RepositoryRevision,
	type RunRepository,
	repositoryRun,
	runRepositories,
	scopeRevision,
} from "./RepositoryScope.js";
import { reviewFixInstructions } from "./ReviewRecovery.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

const exec = promisify(execFile);
export interface RoleRevision {
	headSha: string;
	dirty: boolean;
	historyLength: number;
	at: string;
	repositories?: RepositoryRevision[];
}
export interface RoleProgress {
	visit: number;
	previousOutput?: unknown;
	previousRevision?: RoleRevision;
	currentRevision?: RoleRevision;
	changedFiles: string[];
	diff?: string;
	unchangedCode: boolean;
	uncertain: boolean;
	newHistory: unknown[];
	approvalDelta?: { headSha: string; files: string[] };
	reviewScope?: {
		baseSha: string;
		headSha: string;
		files: string[];
		diffStat: string;
		source: "whole-pr";
		repositories?: (NonNullable<RoleProgress["reviewScope"]> & {
			repositoryId: string;
			name: string;
			workspace: string;
		})[];
	};
}
export async function roleProgress(
	context: ExecutionContext,
): Promise<RoleProgress> {
	const repositories = runRepositories(context.run);
	if (repositories.length > 1) {
		const parts = await Promise.all(
			repositories.map(async (repository) => ({
				repository,
				progress: await roleProgress({
					...context,
					run: repositoryRun(context.run, repository),
				}),
			})),
		);
		const first = parts[0]!.progress;
		const key = context.stepKey ?? context.run.step ?? context.step.id;
		const previousRevision = context.run.roleRevisions?.[key];
		const revisions = parts.flatMap(({ repository, progress }) =>
			progress.currentRevision
				? [
						{
							repositoryId: repository.id,
							name: repository.name,
							headSha: progress.currentRevision.headSha,
							dirty: progress.currentRevision.dirty,
						},
					]
				: [],
		);
		const scopes = parts.flatMap(({ repository, progress }) =>
			progress.reviewScope
				? [
						{
							...progress.reviewScope,
							repositoryId: repository.id,
							name: repository.name,
							workspace: repository.workspace,
						},
					]
				: [],
		);
		return {
			...first,
			previousRevision,
			previousOutput: [...context.run.history]
				.reverse()
				.find((item) => item.step === key)?.output,
			newHistory: context.step.inputs
				? []
				: (context.reviewBaseline
						? context.run.history.slice(0, context.reviewBaseline.historyLength)
						: context.run.history
					).slice(previousRevision?.historyLength ?? 0),
			currentRevision:
				revisions.length === repositories.length
					? {
							...first.currentRevision!,
							headSha: scopeRevision(revisions),
							dirty: revisions.some((item) => item.dirty),
							repositories: revisions,
						}
					: undefined,
			changedFiles: parts.flatMap(({ repository, progress }) =>
				progress.changedFiles.map((file) => `${repository.name}/${file}`),
			),
			diff: parts
				.map(
					({ repository, progress }) =>
						`${repository.name}:\n${progress.diff ?? ""}`,
				)
				.join("\n"),
			uncertain: parts.some(({ progress }) => progress.uncertain),
			unchangedCode: parts.every(({ progress }) => progress.unchangedCode),
			approvalDelta: parts.some(({ progress }) => progress.approvalDelta)
				? {
						headSha:
							context.run.humanDecisions
								?.filter((item) => item.decision === "approve")
								.at(-1)?.headSha ?? "",
						files: parts.flatMap(({ repository, progress }) =>
							(progress.approvalDelta?.files ?? []).map(
								(file) => `${repository.name}/${file}`,
							),
						),
					}
				: undefined,
			reviewScope:
				scopes.length && revisions.length === repositories.length
					? {
							baseSha: scopeRevision(
								scopes.map((scope) => ({
									repositoryId: scope.repositoryId,
									headSha: scope.baseSha,
								})),
							),
							headSha: scopeRevision(revisions),
							source: "whole-pr",
							repositories: scopes,
							files: scopes.flatMap((scope) =>
								scope.files.map((file) => `${scope.name}/${file}`),
							),
							diffStat: scopes
								.map((scope) => `${scope.name}:\n${scope.diffStat}`)
								.join("\n"),
						}
					: undefined,
		};
	}
	const { run } = context,
		key = context.stepKey ?? run.step ?? context.step.id;
	const previousRevision = run.roleRevisions?.[key];
	const previousOutput = [...run.history]
		.reverse()
		.find((item) => item.step === key)?.output;
	const result: RoleProgress = {
		visit: run.history.filter((item) => item.step === key).length + 1,
		previousRevision,
		previousOutput,
		changedFiles: [],
		unchangedCode: false,
		uncertain: true,
		newHistory: context.step.inputs
			? []
			: (context.reviewBaseline
					? run.history.slice(0, context.reviewBaseline.historyLength)
					: run.history
				).slice(previousRevision?.historyLength ?? 0),
	};
	const git = async (args: string[]) =>
		(
			await exec("git", args, {
				cwd: run.workspace,
				timeout: 10000,
				maxBuffer: 2 * 1024 * 1024,
			})
		).stdout;
	try {
		const headSha = (await git(["rev-parse", "HEAD"])).trim();
		const dirty = Boolean((await git(["status", "--porcelain"])).trim());
		result.currentRevision = {
			headSha,
			dirty,
			historyLength: run.history.length,
			at: new Date().toISOString(),
		};
		// Guide snapshots need runtime-owned revision scope even when the agent's
		// upstream outputs are restricted by a customized recipe.
		if (
			context.step.id === "guide" ||
			(context.step.id === "visual-scope" && !context.step.inputs)
		) {
			const receipt = (run.outputs["merge-readiness"] ?? run.outputs.ci) as
				| { baseSha?: string }
				| undefined;
			if (receipt?.baseSha) {
				const baseSha = (
					await git(["merge-base", receipt.baseSha, headSha])
				).trim();
				result.reviewScope = {
					baseSha,
					headSha,
					source: "whole-pr",
					files: (
						await git(["diff", "--name-only", "-z", `${baseSha}...${headSha}`])
					)
						.split("\0")
						.filter(Boolean),
					diffStat: await git(["diff", "--stat", `${baseSha}...${headSha}`]),
				};
			}
		}
		if (context.step.id === "guide") {
			const approval = [...(run.humanDecisions ?? [])]
				.reverse()
				.find((d) => d.decision === "approve");
			if (approval)
				result.approvalDelta = {
					headSha: approval.headSha,
					files: (
						await git(["diff", "--name-only", "-z", approval.headSha, headSha])
					)
						.split("\0")
						.filter(Boolean),
				};
		}
		if (previousRevision) {
			result.changedFiles = (
				await git(["diff", "--name-only", "-z", previousRevision.headSha])
			)
				.split("\0")
				.filter(Boolean);
			result.diff = await git([
				"diff",
				"--no-ext-diff",
				"--unified=3",
				previousRevision.headSha,
			]);
			result.uncertain = dirty || previousRevision.dirty;
			result.unchangedCode =
				!result.uncertain && previousRevision.headSha === headSha;
		}
	} catch {
		/* Missing/huge revision data requires a full inspection, never evidence reuse. */
	}
	return result;
}
export function dependencyHashes(
	workspace: string,
	paths: string[],
	repositories: RunRepository[] = [],
): Record<string, string> {
	if (!paths.length)
		throw new Error("An unchanged area needs explicit file dependencies");
	const root = realpathSync(workspace);
	const hashes: Record<string, string> = {};
	// Git supplies source membership, including deleted tracked files. Explicit file
	// dependencies still include ignored runtime assets when requested by the scope.
	const sourceFiles = new Set(
		(repositories.length > 1 ? repositories : [{ workspace: root }]).flatMap(
			(repository) =>
				execFileSync(
					"git",
					["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
					{
						cwd: repository.workspace,
						encoding: "utf8",
						maxBuffer: 32 * 1024 * 1024,
					},
				)
					.split("\0")
					.filter(Boolean)
					.map((file) =>
						relative(root, resolve(realpathSync(repository.workspace), file)),
					),
		),
	);
	const membership = new Set(sourceFiles);
	for (const file of sourceFiles) {
		const parts = file.split("/");
		for (let i = 1; i < parts.length; i++)
			membership.add(parts.slice(0, i).join("/"));
	}
	const included = (path: string) => membership.has(path);

	const inside = (path: string) => {
		const name = relative(root, path);
		if (
			!name ||
			name === ".." ||
			name.split(/[\\/]/)[0] === ".." ||
			isAbsolute(name)
		)
			throw new Error("Visual dependencies must be repository files");
	};
	const visit = (path: string, ancestors = new Set<string>()) => {
		const full = resolve(root, path);
		inside(full);
		if (!existsSync(full)) {
			hashes[path] = "missing";
			return;
		}
		const real = realpathSync(full);
		inside(real);
		const stat = statSync(full);
		if (stat.isDirectory()) {
			if (ancestors.has(real))
				throw new Error(`Cyclic visual dependency directory: ${path}`);
			const next = new Set([...ancestors, real]);
			hashes[`${path}/`] = createHash("sha256")
				.update("directory")
				.digest("hex");
			for (const entry of readdirSync(full).sort()) {
				if ([".git", "node_modules"].includes(entry)) continue;
				const child = `${path}/${entry}`;
				// A tracked internal symlink may target a directory: apply ignore rules
				// against the real target as well, while retaining cycle/escape checks.
				if (!included(child)) {
					if (real === full) continue;
					const realChild = relative(root, realpathSync(resolve(root, child)));
					if (!included(realChild)) continue;
				}
				visit(child, next);
			}
		} else
			hashes[path] = createHash("sha256")
				.update(readFileSync(full))
				.digest("hex");
	};
	for (const path of [...new Set(paths)].sort()) {
		const prefix = path.replace(/\/\*\*\/?$/, "");
		if (/[*?[\]{}]/.test(prefix))
			throw new Error(
				"Visual dependencies support exact files or directory/** paths",
			);
		visit(prefix);
		for (const file of [...sourceFiles].sort()) {
			if (file.startsWith(`${prefix}/`) && !existsSync(resolve(root, file)))
				hashes[file] = "missing";
		}
	}
	return Object.fromEntries(
		Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)),
	);
}

export function dependencyCovers(file: string, dependency: string): boolean {
	const prefix = dependency.replace(/\/\*\*\/?$/, "");
	return file === prefix || file.startsWith(`${prefix}/`);
}

/** Revalidate saved output after a post-processing failure without launching another agent. */
export async function completedAgentResult(
	context: ExecutionContext,
): Promise<{ output: unknown } | undefined> {
	const saved = context.resumeAgent?.result;
	if (!saved) return;
	context.progress = await roleProgress(context);
	const current = context.progress.currentRevision;
	if (
		!current ||
		current.dirty ||
		saved.revision.dirty ||
		current.headSha !== saved.revision.headSha
	)
		return;
	context.log(
		"Revalidating completed agent output; existing work is preserved.",
	);
	return { output: structuredClone(saved.output) };
}
export const incrementalInstructions = `On repeated visits, start with /progress through factory-context: previous role result, revision, changed files/diff and new history. When compact memory is present, /progress/newHistory is an index: follow outputPath only for relevant new evidence, and use /contextMemory/reviewLedger and /contextMemory/reviewRounds for past findings, dispositions and review reasoning. Reuse established decisions and supported findings; inspect only changed requirements/files and affected dependencies, while retaining all unresolved findings and disputes. Do not reread the entire ticket/plan/repository by default. Fetch unchanged context only when needed to assess a new change. An uncertain or dirty revision requires full relevant inspection. Automated F1 validation uses deterministic mocked agents or recorded transcript replays. Set F1_AGENT_MODE=mock and inject mocked runners in embedded harnesses; older worktree harnesses may require explicit mocking. Live agent CLI/API validation requires explicit user authorization for provider credits. Report mocked evidence accurately. Never skip required checks or assume human approval. If code is unchanged, validate new feedback/results rather than redoing the same repository exploration. Planning/clarification should update prior results for new answers/feedback, not start over; reviewers assess the delta, regressions and all unresolved findings, preserving stable issue IDs and past dispositions.`;

export const incrementalRoleInstructions: Record<string, string> = {
	"code-fix": reviewFixInstructions,
	"visual-fix": reviewFixInstructions,
	"visual-scope": `For a repeat, compare /progress/previousOutput with the revision delta. For qa-v1, retain the COMPLETE cumulative story/criterion inventory traced to accepted requirements, including inherited work. Reassess affected criteria, exclusions and unresolved disputes against the full PR. Return the COMPLETE cumulative visual area/state inventory, updating only affected areas, not merely the newest delta. If previousOutput has no captureBudget or contains combined/matrix state labels, first replace the legacy evidence plan with at most 24 concrete representative states covering the cumulative changed feature. This compaction applies even to unchanged areas: preserve requirements and risk coverage, not every historical screenshot combination. Group co-visible regions, choose 1–2 exact states per area, and document omitted redundant combinations in rationale; use existing tests for nonvisual behavior. Do not copy the old matrix into the new plan. Reuse existing images only when they exactly demonstrate a selected state and meet the usual provenance/acceptance rules. Set captureBudget=24, with a justified exception up to 48 only when essential distinct visual coverage requires it. Include per-area dependencies as exact relative repository files or directory/** groups (including all shared components/styles/assets that affect the area); do not use other glob syntax, changed=true for affected/new/uncertain areas and changed=false only for proven unaffected areas. Include nonVisualFiles for changed files demonstrated to have no visual effect. An unexplained/global dependency change invalidates every possibly affected area. If the original PR had visual changes, changed remains true even when the newest correction is nonvisual; unchanged areas can reuse prior capture evidence.`,
	capture: `For a repeat, read /progress/previousOutput and current visual-scope. In qa-v1 copy finding requirementRefs only from the referenced planned story; criterion IDs and visual-scope paths are not requirement references. Execute every criterion freshly, including earlier failed/blocked criteria; conservative fresh execution prevents reuse after code, criteria, fixtures or environment changes. Preserve findings, disputes and nonblocking observations across rounds unless new evidence resolves them. Screenshot reuse alone is never a behavioral pass. Read /answers for QA/capture assistance, including resolved access, test fixtures or tooling setup. Retry unavailable selected states using that guidance; if still blocked, return their concrete reasons in unavailable again so the visual gate waits for further assistance. An answer never waives required evidence. Reuse a previous verified screenshot path only if its area/state still exists, the previous visual gate approved it OR visual-review.acceptedScreenshots explicitly accepted its exact area/state/imageSha256, and code is unchanged or the area is explicitly unchanged with identical dependency hashes and no unexplained changed files. Preserve its metadata; include reused=true. Source provenance is verified by the runtime; compact manifest references are sufficient for this role. Directory dependencies exclude ignored build/cache output; required ignored runtime assets must be explicit file dependencies. Capture ONLY new/affected/uncertain areas/states with fresh filenames and assemble the COMPLETE screenshot inventory from reused plus fresh images. Missing dependencies, dirty revisions, unavailable evidence or evidence without an explicit prior acceptance requires fresh captures. Do not start the dev server for wholly reusable evidence; otherwise set it up once and delegate independent changed areas where possible.`,
	"visual-review": `For qa-v1 review the complete story coverage and fresh executed receipts, changed requirements and all unresolved findings/dispositions, retaining optional observations. Do not approve a failed criterion because a complaint was rejected. For a repeat with previously approved visual evidence, inspect only new/changed screenshots and new requirements, retain earlier verified results for identical reused images, and reassess every unresolved finding/dispute. Do not reopen unchanged accepted findings without new evidence. If the prior gate was not approved, preserve explicitly acceptedScreenshots with identical reused hashes and inspect only the unresolved/new evidence. Without per-image acceptance, inspect all relevant evidence again. Your result still covers the complete current inventory, never just the delta.`,
	guide: `${guideArtifactInstructions}\n${guideMapInstructions}\nAll new guides require purpose-written tldr, decision.summaryShort and per-chapter tldr, beforeShort, afterShort, risk:{level,text}, keyChecks:[{do,expect}] (1-3). Limits: overview 90, decision 160, chapter/risk 70, before/after 50, each check 60 characters. Never truncate full prose. Optional flow and required system references must be valid; preserve accepted screenshot metadata. Missing compact fields require guide-only correction, never incomplete publication. The review guide describes the COMPLETE cumulative PR, including inherited takeover work. On the first guide inspect /progress/reviewScope and the accepted requirements/plan, not just the latest role result. On repeats keep unchanged chapters and feature coverage, update affected evidence and add a separate short delta note if appropriate. Full feature scope is separate from /progress/diff. chapter.files MUST contain only files from /progress/reviewScope/files. Changes since prior human approval are separately available in /progress/approvalDelta; describe base integration and reapproval in chapter evidence/risks or revisionNote, never put base-only files in chapter.files. Empty files is allowed for an integration-context chapter. A revision summary requires an actual prior human-reviewed guide; previous agent iterations alone never qualify. Never lead the first guide with the last repair or drop unchanged features.`,
	"ci-fix": `If CI is blocked by owner/security adjudication, unavailable infrastructure or access that you cannot repair, return questions:["the specific assistance needed"] alongside your summary and checks. Do not repeat unchanged fixes or claim the check passed. Return questions:[] when corrective work is complete. Read /answers before retrying after assistance. Use the latest merge-readiness receipt, assess all newly unassessed PR comments/review requests exactly once and return addressedCommentIds and addressedReviewIds. On revision mismatch synchronize local and remote branch without discarding existing work, commit/push pending changes, and verify that the Git provider reports the same PR head. An up-to-date branch or successful Git-ref API update alone does not establish PR synchronization. If the Git provider remains out of sync after a bounded repair attempt, return specific assistance questions instead of repeating unchanged pushes or claiming completion. The pipeline redoes all reviews after changes. Never dismiss reviews, bypass rules, assume approval or resolve a review thread without addressing it or supplying evidence. Waiting for an external human approval is not a code fix.\n${feedbackPolicyInstructions}\n${guideGapFixInstructions}`,
};
