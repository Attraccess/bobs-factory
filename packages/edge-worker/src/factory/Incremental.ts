import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { ExecutionContext } from "./WorkflowRuntime.js";

const exec = promisify(execFile);
export interface RoleRevision {
	headSha: string;
	dirty: boolean;
	historyLength: number;
	at: string;
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
}
export async function roleProgress(
	context: ExecutionContext,
): Promise<RoleProgress> {
	const { run } = context,
		key = run.step ?? context.step.id;
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
			: run.history.slice(previousRevision?.historyLength ?? 0),
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
): Record<string, string> {
	if (!paths.length)
		throw new Error("An unchanged area needs explicit file dependencies");
	const root = realpathSync(workspace);
	return Object.fromEntries(
		paths.map((path) => {
			const full = realpathSync(resolve(root, path));
			const inside = relative(root, full);
			if (!inside || inside.startsWith("..") || isAbsolute(inside))
				throw new Error("Visual dependencies must be repository files");
			return [
				path,
				createHash("sha256").update(readFileSync(full)).digest("hex"),
			];
		}),
	);
}
export const incrementalInstructions = `On repeated visits, start with /progress through factory-context: previous role result, revision, changed files/diff and new history. Reuse established decisions and supported findings; inspect only changed requirements/files and affected dependencies, while retaining all unresolved findings and disputes. Do not reread the entire ticket/plan/repository by default. Fetch unchanged context only when needed to assess a new change. An uncertain or dirty revision requires full relevant inspection. Never skip required checks or assume human approval. If code is unchanged, validate new feedback/results rather than redoing the same repository exploration. Planning/clarification should update prior results for new answers/feedback, not start over; reviewers assess the delta, regressions and all unresolved findings, preserving stable issue IDs and past dispositions.`;

export const incrementalRoleInstructions: Record<string, string> = {
	"visual-scope": `For a repeat, compare /progress/previousOutput with the revision delta. Return the COMPLETE cumulative visual area/state inventory, updating only affected areas, not merely the newest delta. Include per-area dependencies (all repo files whose content can affect the area, including shared components/styles/assets), changed=true for affected/new/uncertain areas and changed=false only for proven unaffected areas. Include nonVisualFiles for changed files demonstrated to have no visual effect. An unexplained/global dependency change invalidates every possibly affected area. If the original PR had visual changes, changed remains true even when the newest correction is nonvisual; unchanged areas can reuse prior capture evidence.`,
	capture: `For a repeat, read /progress/previousOutput and current visual-scope. Reuse a previous verified screenshot path only if its area/state still exists, the previous visual gate approved it OR visual-review.acceptedScreenshots explicitly accepted its exact area/state/imageSha256, and code is unchanged or the area is explicitly unchanged with identical dependency hashes and no unexplained changed files. Preserve its metadata; include reused=true. Capture ONLY new/affected/uncertain areas/states with fresh filenames and assemble the COMPLETE screenshot inventory from reused plus fresh images. Missing dependencies, dirty revisions, unavailable evidence or evidence without an explicit prior acceptance requires fresh captures. Do not start the dev server for wholly reusable evidence; otherwise set it up once and delegate independent changed areas where possible.`,
	"visual-review": `For a repeat with previously approved visual evidence, inspect only new/changed screenshots and new requirements, retain earlier verified results for identical reused images, and reassess every unresolved finding/dispute. Do not reopen unchanged accepted findings without new evidence. If the prior gate was not approved, preserve explicitly acceptedScreenshots with identical reused hashes and inspect only the unresolved/new evidence. Without per-image acceptance, inspect all relevant evidence again. Your result still covers the complete current inventory, never just the delta.`,
	guide: `For a repeat, update the previous recap using /progress/newHistory, the delta and fresh readiness/capture receipts. Keep unchanged supported requirements and evidence. Explain what changed since the previous guide; use a concise revision summary for verified minor/typo/documentation-only corrections, but still return the full required JSON shape and require fresh human approval. Substantive requirements/visual/behavior changes need the full recap. Do not rebuild unchanged narrative or evidence.`,
	"ci-fix": `Use the latest merge-readiness receipt, assess all newly unassessed PR comments/review requests exactly once and return addressedCommentIds and addressedReviewIds. On revision mismatch synchronize local and remote branch without discarding existing work, commit/push pending changes, then the pipeline redoes all reviews. Never dismiss reviews, bypass rules, assume approval or resolve a review thread without addressing it or supplying evidence. Waiting for an external human approval is not a code fix.`,
};
