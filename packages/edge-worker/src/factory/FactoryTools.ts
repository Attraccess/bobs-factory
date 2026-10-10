import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawnExecution as spawn } from "bobs-factory-core";
import { z } from "zod";
import {
	DeliveryContractSchema,
	digest,
	freezeDelivery,
	repositoryCompletionProven,
	type TicketDelivery,
} from "./Delivery.js";
import { externalGuideEvidence } from "./ExternalGuide.js";
import { feedbackInstructionFingerprint } from "./FeedbackPolicy.js";
import {
	executeGithubApi,
	GITHUB_API_COMMAND,
	githubGitEnvironment,
} from "./GithubApi.js";
import { type GitProvider, resolveGitProvider } from "./GitProvider.js";
import { groupedTool, scopeCommand } from "./GroupedTools.js";
import { guideGapRecovery } from "./GuideRecovery.js";
import { dependencyCovers, dependencyHashes } from "./Incremental.js";
import {
	assessFeedback,
	delay,
	feedbackWorkFingerprint,
	inspectReadinessWithRetry,
	type MergeReadiness,
	reportReadiness,
} from "./MergeReadiness.js";
import { confirmedMerge } from "./MergeRecovery.js";
import { OutputValidationError } from "./OutputValidation.js";
import {
	QA_CONTRACT,
	QaExecutionFields,
	qaCoverage,
	qaDigest,
	qaRequirementIssues,
} from "./Qa.js";
import { runRepositories } from "./RepositoryScope.js";
import { reviewRecoveryQuestions } from "./ReviewRecovery.js";
import {
	aggregateForContext,
	assertAggregateRevision,
	scopeContextDigest,
} from "./SpecialistReview.js";
import { inspectPullRequest } from "./Takeover.js";
import {
	VideoCaptureFields,
	VideoReceiptSchema,
	videoGateIssues,
} from "./Video.js";
import { readPath } from "./Workflow.js";

export function toolArguments(
	context: ExecutionContext,
	value: unknown,
): unknown {
	const data = {
		outputs: context.outputs ?? context.run.outputs,
		input: context.input,
		run: { id: context.run.id, title: context.run.title },
		workspace: context.run.workspace,
		repositories: runRepositories(context.run),
		evidenceDir: context.evidenceDir,
	};
	if (typeof value === "string") {
		const exact = value.match(/^\{\{([\w.-]+)\}\}$/);
		if (exact) {
			const resolved = readPath(data, exact[1]!);
			if (resolved === undefined)
				throw new Error(`Missing tool input: ${exact[1]}`);
			return resolved;
		}
		return value.replace(/\{\{([\w.-]+)\}\}/g, (_match, path) => {
			const resolved = readPath(data, path);
			if (resolved === undefined)
				throw new Error(`Missing tool input: ${path}`);
			return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
		});
	}
	if (Array.isArray(value))
		return value.map((item) => toolArguments(context, item));
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				toolArguments(context, item),
			]),
		);
	return value;
}

import type { GuideSchema } from "./FactoryResults.js";
import { briefMarkdown, guideReady, isReviewBrief } from "./ReviewBrief.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

function blockRevisionMismatch(
	snapshot: MergeReadiness,
	headSha: string,
): void {
	snapshot.worktreeHeadSha = headSha;
	snapshot.fix = true;
	snapshot.approved = false;
	snapshot.reviewReady = false;
	snapshot.blockers.push({
		kind: "revision",
		action: "fix",
		message: `PR points to ${snapshot.headSha}, but the worktree is at ${headSha}. Synchronize the PR and branch without discarding work, then confirm the PR head and repeat review and CI. Checks for the old revision cannot validate this worktree.`,
	});
}

export function reviewGuideMarkdown(value: unknown, headSha: string): string {
	const guide = value as z.infer<typeof GuideSchema>;
	const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
	const coverage = guide.requirementCoverage
		? `\n\n<details><summary>Complete requirement coverage and specialist evidence</summary>\n\n${guide.requirementCoverage.assessments.map((a) => `- **${a.requirementId}: ${a.criterion}** (${a.status}): ${a.reason}; ${a.evidence.join("; ")}${a.decision ? `; Accepted by ${a.decision.acceptedBy}: ${a.decision.rationale} (${a.decision.source.reference})` : ""}`).join("\n")}\n\n${guide.requirementCoverage.reviewers.map((r) => `**${r.reviewer}:** ${r.summary}\n${r.findings.map((f) => `- ${r.reviewer}:${f.id} · ${f.rating} · ${f.status}: ${f.summary}; ${f.evidence}; ${f.reason ?? ""}`).join("\n")}\n${r.disagreements.join("\n")}\n${(r.disputeResolutions ?? []).map((d) => `- Resolved disagreement: ${d.disagreement}; Reason: ${d.reason}; Evidence: ${d.evidence}`).join("\n")}`).join("\n\n")}\n\n</details>`
		: "";

	if (guide.chapters?.length) {
		const chapters = guide.chapters
			.map(
				(chapter) =>
					`### ${chapter.title}\n${chapter.summary}\n\n**Before:** ${chapter.before}\n\n**After:** ${chapter.after}\n\n${chapter.diagrams.map((diagram) => `**${diagram.title}:** ${diagram.steps.map((step) => step.label).join(" → ")}`).join("\n")}\n\n${list(chapter.reviewChecks)}\n\n<details><summary>Code and evidence</summary>\n\n${list(chapter.files.map((file) => `\`${file}\``))}\n\n${list(chapter.evidence)}\n\n</details>`,
			)
			.join("\n\n");
		return `## ${guide.goal}\n${guide.summary}\n\n${guide.decision.status}: ${guide.decision.summary}\n\n${chapters}${coverage}\n\n## Know before approving\n${list(guide.risks)}\n\n<details><summary>Verification evidence</summary>\n\n${list(guide.checks)}\n\n</details>\n\n## Human decision\n${list(guide.reviewInstructions)}\n\nRevision: ${headSha}\nOpen the factory review guide for the step-by-step walkthrough, diagrams and screenshots.\n\n<!-- generated-by-bobs-factory -->`;
	}
	return `## Goal\n${guide.goal}\n\n${guide.summary}\n\n## Decision\n${guide.decision.status}: ${guide.decision.summary}\n\n## Before and after\n${guide.behavior.map((item) => `### ${item.scenario}\nBefore: ${item.before}\n\nAfter: ${item.after}`).join("\n\n")}\n\n## Requirements\n${guide.requirements.map((item) => `- **${item.criterion}** (${item.status}): ${item.evidence.join("; ")}`).join("\n")}\n\n${coverage}\n\n## Checks\n${list(guide.checks)}\n\n## Risks\n${list(guide.risks)}\n\n## Human review\n${list(guide.reviewInstructions)}\n\nRevision: ${headSha}\nScreenshots and complete decision/review history are available in the local factory dashboard.\n\n<!-- generated-by-bobs-factory -->`;
}

export function executeCommand(
	context: ExecutionContext,
	command: string,
	args: string[],
	timeoutMs = 20 * 60 * 1000,
): Promise<string> {
	context.signal.throwIfAborted();
	if (command === GITHUB_API_COMMAND) return executeGithubApi(context, args);
	if (
		command === "git" &&
		["fetch", "push", "ls-remote", "clone"].includes(args[0] ?? "")
	)
		return githubGitEnvironment(context).then((environment) =>
			executeProcessCommand(context, command, args, timeoutMs, environment),
		);
	return executeProcessCommand(context, command, args, timeoutMs);
}

function executeProcessCommand(
	context: ExecutionContext,
	command: string,
	args: string[],
	timeoutMs: number,
	gitEnvironment?: NodeJS.ProcessEnv,
): Promise<string> {
	const input = JSON.stringify(context.input) ?? "null";
	const directory = mkdtempSync(join(tmpdir(), "cyrus-factory-command-"));
	const inputPath = join(directory, "input.json");
	try {
		writeFileSync(inputPath, input, { mode: 0o600 });
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: context.run.workspace,
			detached: process.platform !== "win32",
			env: {
				...(context.execution?.environment ?? process.env),
				...gitEnvironment,
				// Large contexts cannot fit in the OS process argument/environment limit.
				FACTORY_INPUT: Buffer.byteLength(input) <= 16000 ? input : undefined,
				FACTORY_INPUT_FILE: inputPath,
				FACTORY_EVIDENCE_DIR: context.evidenceDir,
				FACTORY_REPOSITORIES: JSON.stringify(runRepositories(context.run)),
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		let timedOut = false;
		const terminate = () => {
			try {
				if (process.platform !== "win32" && child.pid)
					process.kill(-child.pid, "SIGTERM");
				else child.kill("SIGTERM");
			} catch {
				/* Already exited. */
			}
			const kill = setTimeout(() => {
				try {
					if (process.platform !== "win32" && child.pid)
						process.kill(-child.pid, "SIGKILL");
					else child.kill("SIGKILL");
				} catch {
					/* Already exited. */
				}
			}, 2000);
			kill.unref();
		};
		context.signal.addEventListener("abort", terminate, { once: true });
		const timer = setTimeout(() => {
			timedOut = true;
			terminate();
		}, timeoutMs);
		const record = (chunk: Buffer) => {
			const text = chunk.toString();
			output = (output + text).slice(-1000000);
			// Wait until close to redact across arbitrary stdout chunk boundaries.
			if (!context.execution) context.log(text);
		};
		child.stdout.on("data", record);
		child.stderr.on("data", record);
		const cleanup = () => {
			clearTimeout(timer);
			context.signal.removeEventListener("abort", terminate);
			rmSync(directory, { recursive: true, force: true });
		};
		child.on("error", (error) => {
			cleanup();
			reject(error);
		});
		child.on("close", (code) => {
			cleanup();
			if (context.execution) {
				output = context.execution.redact(output);
				context.log(output);
			}
			if (context.signal.aborted) reject(new Error("Run terminated"));
			else if (timedOut) reject(new Error(`Command timed out: ${command}`));
			else if (code !== 0)
				reject(new Error(`${command} exited ${code}: ${output.slice(-12000)}`));
			else resolve(output.trim());
		});
	});
}

export const ReviewResultSchema = z.object({
	/** Older accepted artifacts remain readable; an unlabelled new gate fails closed. */
	status: z.enum(["completed", "blocked", "failed"]).optional(),
	blockers: z.array(z.string().min(1)).default([]),
	acceptedVideos: z.array(VideoReceiptSchema).max(3).optional(),
	qaContract: z.literal(QA_CONTRACT).optional(),
	qaReviewStamp: z
		.object({
			headSha: z.string(),
			dirty: z.boolean(),
			captureHash: z.string(),
			scopeHash: z.string(),
		})
		.optional(),
	acceptedScreenshots: z
		.array(
			z.object({
				area: z.string().min(1),
				state: z.string().min(1),
				imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
			}),
		)
		.optional(),
	findings: z.array(
		z.object({
			id: z.string().min(1),
			rating: z.number().int().min(1).max(3),
			summary: z.string().min(1),
			evidence: z.string().min(1),
			status: z
				.enum(["open", "resolved", "accepted-rejection"])
				.default("open"),
		}),
	),
	summary: z.string(),
});
export function filterReview(
	value: unknown,
): z.infer<typeof ReviewResultSchema> {
	const result = ReviewResultSchema.parse(value);
	result.findings = result.findings.filter((finding) => finding.rating > 1);
	return result;
}

const screenshotSchema = z.object({
	context: z.string().max(600).optional(),
	path: z.string(),
	caption: z.string(),
	revision: z.string().optional(),
	imageSha256: z.string().optional(),
	dependencyHashes: z.record(z.string(), z.string()).optional(),
	fingerprintVersion: z.number().int().optional(),
	dependencyManifest: z.string().optional(),
	reused: z.boolean().optional(),
	area: z.string(),
	state: z.string().optional(),
});
const CaptureFields = {
	...VideoCaptureFields,
	screenshots: z.array(screenshotSchema),
	dependencyManifests: z
		.record(z.string(), z.record(z.string(), z.string()))
		.optional(),
	unavailable: z
		.array(
			z.object({
				area: z.string(),
				reason: z.string(),
				cause: z.enum(["access", "product"]).optional(),
			}),
		)
		.default([]),
};
export const CaptureSchema = z.object(CaptureFields);
export const QaCaptureSchema = z.object({
	...CaptureFields,
	...QaExecutionFields,
});
function captureGaps(capture: z.infer<typeof CaptureSchema>, areas: unknown) {
	const gaps = [...capture.unavailable];
	if (Array.isArray(areas)) {
		for (const area of areas) {
			const missing = (area.states ?? []).filter(
				(state: string) =>
					!capture.screenshots.some(
						(shot) => shot.area === area.name && shot.state === state,
					),
			);
			if (missing.length && !gaps.some((gap) => gap.area === area.name))
				gaps.push({
					area: area.name,
					reason: `No screenshot supplied for states: ${missing.join("; ")}`,
				});
		}
	}
	return gaps;
}
export function verifiedScreenshot(path: string, directory: string): string {
	const resolved = realpathSync(resolve(directory, path));
	const inside = relative(realpathSync(directory), resolved);
	if (!inside || inside.startsWith("..") || isAbsolute(inside))
		throw new Error("Screenshot must be inside this run's evidence directory");
	const bytes = readFileSync(resolved);
	const png = bytes
		.subarray(0, 8)
		.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
	const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
	if (!png && !jpeg) throw new Error("Screenshot is not a PNG or JPEG");
	return resolved;
}

export interface FactoryToolHooks {
	ticketDelivery?: TicketDelivery;
	postComment(runId: string, body: string): Promise<void>;
	command?(
		context: ExecutionContext,
		executable: string,
		args: string[],
		timeout?: number,
	): Promise<string>;
	mcp?(
		context: ExecutionContext,
		server: string,
		tool: string,
	): Promise<unknown>;
}
export class FactoryTools {
	constructor(private hooks: FactoryToolHooks) {}
	private scopeChanged(context: ExecutionContext, frozen: unknown): boolean {
		return (
			scopeContextDigest(frozen) !==
			scopeContextDigest(
				context.currentScope?.() ?? {
					...(context.input as Record<string, unknown>),
					answers: context.run.answers,
					humanDecisions: context.run.humanDecisions ?? [],
				},
			)
		);
	}
	private async qaGate(
		context: ExecutionContext,
		command: (exe: string, args: string[]) => Promise<string>,
	) {
		const { run } = context;
		// Import at execution time to share the scope safeguards without a schema initialization cycle.
		const { QaScopeSchema } = await import("./FactoryResults.js");
		const scope = QaScopeSchema.parse(run.outputs["visual-scope"]);
		const capture = QaCaptureSchema.parse(run.outputs.capture);
		const review = filterReview(run.outputs["visual-review"]);
		const headSha = (await command("git", ["rev-parse", "HEAD"])).trim();
		const dirty = Boolean(
			(await command("git", ["status", "--porcelain"])).trim(),
		);
		const scopeHash = qaDigest(scope),
			captureHash = qaDigest(capture),
			reviewHash = qaDigest(review);
		const stamp = capture.testedRevision,
			reviewed = review.qaReviewStamp;
		const prefix = (context.stepKey ?? run.step ?? context.step.id).replace(
			/[^/]+$/,
			"",
		);
		const provenance = ["capture", "visual-review"].every((id) => {
			const revision = run.roleRevisions?.[`${prefix}${id}`];
			return revision && !revision.dirty && revision.headSha === headSha;
		});
		const coverage = qaCoverage(scope, capture);
		coverage.errors.push(
			...qaRequirementIssues(
				scope,
				context.outputs ?? run.outputs,
				run.answers,
				aggregateForContext(context)?.baseline.inventory,
			),
		);
		if (
			dirty ||
			!provenance ||
			!stamp ||
			stamp.dirty ||
			stamp.headSha !== headSha ||
			stamp.scopeHash !== scopeHash ||
			!reviewed ||
			reviewed.dirty ||
			review.qaContract !== QA_CONTRACT ||
			reviewed.headSha !== headSha ||
			reviewed.scopeHash !== scopeHash ||
			reviewed.captureHash !== captureHash
		)
			coverage.errors.push(
				"QA execution or review has missing, dirty or stale revision/scope provenance. Retry QA and review on the current clean revision.",
			);
		const gaps = captureGaps(capture, scope.areas);
		const assistanceGaps = gaps.filter(
			(g) =>
				!(
					g.cause === "product" &&
					scope.stories.some(
						(s) =>
							s.screenshotTasks.some((t) => t.area === g.area) &&
							capture.results.some(
								(r) =>
									r.storyId === s.id &&
									r.criteria.some((c) => c.outcome === "failed"),
							),
					)
				),
		);
		coverage.blocked.push(
			...assistanceGaps.map((g) => `${g.area}: ${g.reason}`),
		);
		for (const shot of capture.screenshots) {
			if (
				!scope.areas.some(
					(a) => a.name === shot.area && a.states.includes(shot.state ?? ""),
				)
			)
				coverage.errors.push(
					`Unknown screenshot task ${shot.area}/${shot.state}`,
				);
			const bytes = readFileSync(
				verifiedScreenshot(shot.path, context.evidenceDir),
			);
			if (createHash("sha256").update(bytes).digest("hex") !== shot.imageSha256)
				coverage.errors.push(
					`${shot.area}/${shot.state}: screenshot bytes changed after capture`,
				);
		}
		const videoIssues = await videoGateIssues(context, headSha);
		coverage.blocked.push(...videoIssues.blocked);
		const findings = [
			...review.findings.filter((f) => f.status === "open"),
			...videoIssues.failures,
		];
		for (const finding of capture.findings.filter((f) => f.status === "open"))
			if (!findings.some((f) => f.id === finding.id)) findings.push(finding);
		for (const failure of coverage.failed) {
			const reported = capture.findings.some(
				(f) =>
					f.status === "open" &&
					f.storyId === failure.storyId &&
					f.criterionId === failure.criterionId,
			);
			if (!reported && !findings.some((f) => f.id === failure.id))
				findings.push(failure);
		}

		const receipts = review.acceptedScreenshots ?? [];
		for (const shot of capture.screenshots)
			if (
				!receipts.some(
					(r) =>
						r.area === shot.area &&
						r.state === shot.state &&
						r.imageSha256 === shot.imageSha256,
				) &&
				!findings.length
			)
				coverage.errors.push(
					`${shot.area}/${shot.state}: no exact inspected-image acceptance receipt`,
				);
		return {
			qaContract: QA_CONTRACT,
			approved:
				!findings.length && !coverage.blocked.length && !coverage.errors.length,
			...(coverage.errors.length && !coverage.blocked.length
				? { qaRetry: true, evidenceIssues: coverage.errors }
				: {}),
			findings,
			observations: capture.observations,
			headSha,
			scopeHash,
			captureHash,
			reviewHash,
			...(!findings.length && coverage.blocked.length
				? {
						qaBlocked: true,
						captureBlocked: assistanceGaps.length > 0,
						questions: [
							`QA evidence is incomplete. ${coverage.blocked.join("\n\n")}\n\nResolve the missing access, fixtures, tooling or evidence above and explain how to run the blocked checks. Your answer retries QA and screenshot review in this run. It does not approve the PR or waive required testing.`,
						],
					}
				: {}),
		};
	}

	async script(context: ExecutionContext): Promise<unknown> {
		const stdout = await executeCommand(context, "/bin/sh", [
			"-c",
			context.step.script!,
		]);
		try {
			return JSON.parse(stdout);
		} catch {
			return { stdout };
		}
	}
	async tool(context: ExecutionContext): Promise<unknown> {
		// Projected grouped runs share retry identities and immutable check receipts.
		context.run.ciSupervision ??= { retries: [] };
		if (
			runRepositories(context.run).length > 1 &&
			context.run.delivery?.contract.mode !== "external" &&
			context.step.id !== "external-human-review"
		) {
			if (context.step.tool === "handoff" && context.step.qaContract) {
				const gate = await this.qaGate(context, (exe, args) =>
					scopeCommand(context, this.command.bind(this), exe, args),
				);
				const accepted = context.run.outputs["visual-gate"];
				if (
					!gate.approved ||
					["headSha", "captureHash", "scopeHash", "reviewHash"].some(
						(key) => readPath(accepted, key) !== readPath(gate, key),
					)
				)
					throw new Error(
						"Grouped QA evidence changed or is incomplete; handoff blocked",
					);
			}
			const output = await groupedTool(
				context,
				this.command.bind(this),
				(child) => {
					const execute = () =>
						this.repositoryTool(
							child.run === context.run
								? child
								: { ...child, step: { ...child.step, qaContract: undefined } },
						);
					return child.step.tool === "draft-pr" && child.coordinateDelivery
						? child.coordinateDelivery(execute)
						: execute();
				},
			);
			if (context.step.tool === "ci-fix-readiness") {
				context.run.outputs.ci = output;
				context.save?.();
			}
			return output;
		}
		return context.step.tool === "draft-pr" && context.coordinateDelivery
			? context.coordinateDelivery(() => this.repositoryTool(context))
			: this.repositoryTool(context);
	}
	private command(
		context: ExecutionContext,
		executable: string,
		args: string[],
		timeout?: number,
	): Promise<string> {
		return this.hooks.command
			? this.hooks.command(context, executable, args, timeout)
			: executeCommand(context, executable, args, timeout);
	}
	private async repositoryTool(context: ExecutionContext): Promise<unknown> {
		const { run } = context;
		// Built-in commands return machine data retained in artifacts. Their raw
		// stdout (especially repeated provider polling) is not conversation text.
		const commandContext =
			context.step.tool === "exec" ? context : { ...context, log: () => {} };
		const command = (exe: string, args: string[], timeout?: number) => {
			// Merge provider calls specify the PR explicitly. Keep their cwd outside
			// the worktree: issue cleanup can remove it while the provider completes a merge.
			const ctx =
				exe !== "git" && context.step.tool === "merge" && context.evidenceDir
					? {
							...commandContext,
							run: { ...run, workspace: context.evidenceDir },
						}
					: commandContext;
			return scopeCommand(ctx, this.command.bind(this), exe, args, timeout);
		};
		let selected: Promise<GitProvider> | undefined;
		const provider = (url?: string) =>
			(selected ??= resolveGitProvider(context, command, url));

		switch (context.step.tool) {
			case "inspect-existing": {
				const branch = await command("git", ["branch", "--show-current"]);
				let pr = run.outputs.source as
					| Awaited<ReturnType<typeof inspectPullRequest>>
					| undefined;
				if (!pr?.url) {
					const candidates = await (await provider()).list(branch);
					if (candidates.length > 1)
						throw new Error(
							"Multiple PRs for this branch; start Takeover with an explicit PR URL",
						);
					if (candidates[0])
						pr = await inspectPullRequest(
							command,
							candidates[0].url,
							await provider(),
						);
				}
				if (pr) {
					if (branch !== pr.headRefName)
						throw new Error(
							"Takeover worktree does not match the existing PR branch",
						);
					if (!pr.isDraft) await (await provider(pr.url)).draft(pr.url, true);
					run.outputs.source = { ...pr, isDraft: true };
					run.outputs.repository = {
						...(run.outputs.repository as Record<string, unknown>),
						baseBranch: pr.baseRefName,
					};
				}
				return {
					branch,
					pr: run.outputs.source,
					ticket: run.outputs.ticket,
					status: await command("git", ["status", "--porcelain"]),
					diff: await command("git", ["diff", "HEAD"]),
					commits: await command("git", [
						"log",
						"--oneline",
						`${pr?.baseRefName ?? readPath(run.outputs, "repository.baseBranch")}..HEAD`,
					]),
					diffSummary: await command("git", [
						"diff",
						"--stat",
						`${pr?.baseRefName ?? readPath(run.outputs, "repository.baseBranch")}...HEAD`,
					]),
				};
			}
			case "delivery-mode":
				return {
					mode: run.delivery?.contract.mode ?? "repository",
					repositoryComplete:
						run.delivery?.contract.mode === "mixed" &&
						(run.humanDecisions ?? []).some(
							(decision) =>
								decision.decision === "approve" &&
								repositoryCompletionProven({
									...run,
									humanDecisions: [decision],
								}),
						),
				};
			case "delivery-route": {
				const contract = DeliveryContractSchema.parse(
					readPath(run.outputs, "plan.deliveryContract"),
				);
				if (
					readPath(run.outputs, "plan-review.approved") !== true ||
					readPath(run.outputs, "plan-review.deliveryContractDigest") !==
						digest(contract)
				)
					throw new Error(
						"Plan review must confirm the exact delivery contract digest",
					);
				if (
					readPath(run.outputs, "clarify.deliveryMode") !==
						readPath(contract, "mode") &&
					!(run.deliveryRecovery && contract.mode === "external")
				)
					throw new Error(
						"Clarified delivery mode must match the reviewed contract",
					);
				if (readPath(contract, "authorization.status") === "deferred")
					return { deferred: true };
				const delivery = freezeDelivery(run, contract);
				context.save?.();
				return { mode: delivery.contract.mode };
			}
			case "external-apply": {
				if (!this.hooks.ticketDelivery)
					throw new Error("Ticket delivery integration unavailable");
				await this.hooks.ticketDelivery.apply(run);
				return { applied: true, receipts: run.delivery!.receipts };
			}
			case "external-verify": {
				if (!this.hooks.ticketDelivery)
					throw new Error("Ticket delivery integration unavailable");
				return this.hooks.ticketDelivery.verify(run);
			}
			case "external-guide": {
				const delivery = run.delivery,
					snapshot = delivery?.verification;
				if (!snapshot || snapshot.criteria.some((c) => !c.passed))
					throw new Error(
						"Independent verification required before external guide",
					);
				const externalEvidence = externalGuideEvidence(run);
				const guide = {
					...externalEvidence,
					deliveryMode: "external",
					externalDigest: snapshot.digest,
					goal: run.title,
					summary:
						"Authorized ticket changes applied and independently verified.",
					decision: {
						status: "ready",
						summary:
							"Accept the verified state or request changes. Applied changes remain after rejection.",
					},
					requirements: delivery.contract.targets.flatMap((t) =>
						t.criteria.map((c) => ({
							requirementId: c.id,
							criterion: c.description,
							status: "supported",
							evidence: [
								JSON.stringify(snapshot.criteria.find((x) => x.id === c.id)),
							],
						})),
					),
					behavior: delivery.receipts.map((r) => ({
						scenario: r.intent.id,
						before: JSON.stringify(r.before),
						after: JSON.stringify(r.after),
					})),
					checks: [
						"Complete ticket content and relationships fetched twice independently; every accepted criterion passed.",
					],
					risks: [...new Set(delivery.receipts.map((r) => r.limitation))],
					reviewInstructions: [
						"Open each linked ticket and inspect the applied changes. Accept completed work or request changes.",
					],
					resources: delivery.contract.targets.map((t) => ({
						key: t.key,
						url: t.resource.url,
					})),
					receipts: delivery.receipts,
					verification: snapshot,
				};
				run.outputs.guide =
					delivery.contract.mode === "mixed"
						? {
								...(run.outputs.guide as Record<string, unknown>),
								...externalEvidence,
							}
						: guide;
				context.save?.();
				return run.outputs.guide;
			}
			case "external-final": {
				if (!this.hooks.ticketDelivery)
					throw new Error("Ticket delivery integration unavailable");
				const valid = await this.hooks.ticketDelivery.finalCheck(run);
				return { drift: !valid, complete: valid };
			}
			case "record-decisions": {
				const decisions = run.outputs.clarify;
				await this.hooks.postComment(
					run.id,
					`## Factory decision records\n\n${JSON.stringify(decisions, null, 2)}\n\n### Questions and answers\n${run.answers.map((answer) => `${answer.questions.map((question) => `- ${question}`).join("\n")}\n\n${answer.answer}`).join("\n\n")}`,
				);
				return decisions;
			}
			case "draft-pr": {
				if (readPath(run.outputs, "implement.status") === "blocked")
					throw new Error(
						`Implementation is blocked: ${String(readPath(run.outputs, "implement.summary"))}. Answer the implementation questions before publishing.`,
					);
				const branch = await command("git", ["branch", "--show-current"]);
				if (!branch) throw new Error("Draft PR requires a branch");
				// Keep provider validation ahead of mutations for a delivery candidate.
				// A grouped context-only repository needs no publication provider.
				if (!context.allowUnchangedRepository) await provider();
				if (readPath(run.outputs, "source.url")) {
					if (readPath(run.outputs, "source.headRefName") !== branch)
						throw new Error("Takeover must publish to the original PR branch");
					const url = String(readPath(run.outputs, "source.url"));
					const pr = await (await provider(url)).view(url, "state,isDraft");
					if (pr.state !== "OPEN" || !pr.isDraft)
						throw new Error("Takeover PR must remain open and draft");
				}
				if (await command("git", ["status", "--porcelain"])) {
					await provider();
					await command("git", ["add", "-A"]);
					// Ticket titles are not commit messages; conventional-commit hooks
					// require a type and subject. Keep the header short and single-line.
					const subject = run.title
						.replace(/\s+/g, " ")
						.trim()
						.toLowerCase()
						.slice(0, 72)
						.trim()
						.replace(/\.+$/, "");
					// Repository commit hooks can run unbounded full-suite checks that a
					// mechanical step can neither finish nor repair, failing delivery on
					// every retry. Implementation checks, review and CI with its fixer
					// own verification. Push hooks still run (for example Git LFS).
					await command("git", [
						"commit",
						"--no-verify",
						"-m",
						`chore: ${subject || "factory changes"}`,
					]);
				}
				const baseBranch = String(
					readPath(run.outputs, "source.baseRefName") ??
						readPath(run.outputs, "repository.baseBranch") ??
						"main",
				);
				await command("git", ["fetch", "origin", baseBranch]);
				const baseRef = `refs/remotes/origin/${baseBranch}`;
				const commits = await command("git", [
					"rev-list",
					"--count",
					`${baseRef}..HEAD`,
				]);
				const changes = await command("git", [
					"diff",
					"--name-only",
					`${baseRef}...HEAD`,
				]);
				if (commits.trim() === "0" || !changes.trim())
					if (context.allowUnchangedRepository) return { unchanged: true };
				if (commits.trim() === "0" || !changes.trim())
					throw new Error(
						`No implementation changes to publish against ${baseBranch}. ${String(readPath(run.outputs, "implement.summary") ?? "The worktree has no deliverable changes.")} Resolve the implementation blocker before delivery; retrying PR creation cannot fix an empty branch.`,
					);
				const forge = await provider();
				await command("git", ["push", "-u", "origin", "HEAD"]);
				const existing = await forge.list(branch);
				if (existing.length > 1)
					throw new Error(
						"Multiple pull/merge requests for this branch; supply an explicit takeover source",
					);
				let url =
					String(readPath(run.outputs, "source.url") ?? "") || existing[0]?.url;

				if (
					url &&
					!readPath(run.outputs, "source.url") &&
					!existing[0]?.isDraft
				)
					throw new Error(
						"Existing PR is not draft; refusing to change its state automatically",
					);
				if (!url) {
					url = await forge.create({
						branch,
						baseBranch,
						title: run.title,
						body: `Software factory run ${run.id}. Review and validation in progress.\n\n<!-- generated-by-bobs-factory -->`,
					});
				}
				return {
					url,
					branch,
					headSha: await command("git", ["rev-parse", "HEAD"]),
					baseSha: await command("git", ["rev-parse", baseRef]),
				};
			}
			case "review-gate":
			case "visual-gate": {
				const recovery = async (gate: Record<string, unknown>) => {
					if (gate.approved || gate.questions) return gate;
					const prefix = (run.step ?? context.step.id).replace(/[^/]+$/, "");
					const fixer =
						context.step.tool === "visual-gate" ? "visual-fix" : "code-fix";
					if (
						!run.history.some(
							(item) =>
								item.step === `${prefix}${fixer}` &&
								readPath(item.output, "reviewAssessment.unchangedCode") ===
									true,
						)
					)
						return gate;
					const headSha = (await command("git", ["rev-parse", "HEAD"])).trim();
					const dirty = Boolean(
						(await command("git", ["status", "--porcelain"])).trim(),
					);
					const questions = reviewRecoveryQuestions(context, gate, {
						headSha,
						dirty,
					});
					return questions.length
						? { ...gate, reviewBlocked: true, questions }
						: gate;
				};
				const source =
					context.step.tool === "review-gate" ? "code-review" : "visual-review";
				const review = filterReview(run.outputs[source]);
				if (review.status !== "completed" || review.blockers.length) {
					if (source === "visual-review" && context.step.qaContract) {
						const capture = QaCaptureSchema.safeParse(run.outputs.capture);
						// An incomplete reviewer cannot approve, but recorded product failures
						// still need correction before fresh QA and a complete review.
						if (
							capture.success &&
							(capture.data.results.some((result) =>
								result.criteria.some(
									(criterion) => criterion.outcome === "failed",
								),
							) ||
								capture.data.findings.some(
									(finding) => finding.status === "open",
								))
						) {
							const gate = await this.qaGate(context, command);
							if (gate.findings.length) return recovery(gate);
						}
					}
					return {
						approved: false,
						findings: review.findings.filter(
							(finding) => finding.status === "open",
						),
						reviewIncomplete: true,
						questions: [
							`${source} did not complete (${review.status ?? "legacy outcome missing"}). ${review.blockers.join("; ") || review.summary} Restore the required input/tools, then answer to retry only this reviewer. Missing findings do not approve or waive the review.`,
						],
					};
				}
				const open = review.findings.filter(
					(finding) => finding.status === "open",
				);
				if (source === "visual-review" && context.step.qaContract) {
					return recovery(await this.qaGate(context, command));
				}
				if (source === "visual-review") {
					const capture = CaptureSchema.parse(run.outputs.capture);
					const gaps = captureGaps(
						capture,
						readPath(run.outputs, "visual-scope.areas"),
					);
					if (!capture.screenshots.length || gaps.length)
						return {
							approved: false,
							findings: open,
							captureBlocked: true,
							questions: [
								`Visual evidence is incomplete. ${gaps.length ? gaps.map((gap) => `${gap.area}: ${gap.reason}`).join("\n\n") : "No screenshots were supplied."}\n\nResolve the capture access, tooling or application setup above, then explain how to capture the missing states. Your answer retries capture and visual review in this run, preserving verified accepted screenshots where possible. An answer does not approve or waive missing evidence.`,
							],
						};
					for (const shot of capture.screenshots)
						verifiedScreenshot(shot.path, context.evidenceDir);
				}
				return recovery({ approved: open.length === 0, findings: open });
			}
			case "review-after-fix": {
				const prefix = (context.stepKey ?? run.step ?? context.step.id).replace(
					/[^/]+$/,
					"",
				);
				const aggregate = aggregateForContext(context);
				const reviewed = aggregate
					? { headSha: aggregate.baseline.headSha, dirty: false }
					: run.roleRevisions?.[`${prefix}code-review`];
				const headSha = await command("git", ["rev-parse", "HEAD"]);
				const dirty = Boolean(await command("git", ["status", "--porcelain"]));
				const url = String(readPath(run.outputs, "draft-pr.url") ?? "");
				const readiness = await inspectReadinessWithRetry(
					context,
					command,
					url,
				);
				if (readiness.headSha !== headSha)
					blockRevisionMismatch(readiness, headSha);
				const previousBase =
					aggregate?.baseline.baseSha ??
					readPath(run.outputs, "ci.correctionBaseSha") ??
					readPath(run.outputs, "ci.baseSha");
				assessFeedback(context, readiness);
				const feedback = readPath(run.outputs, "ci.blockers") as
					| { kind: string; action?: string }[]
					| undefined;
				const substantiveFeedback =
					feedback?.some(
						(item) =>
							["threads", "reviews", "revision"].includes(item.kind) &&
							(item.action === undefined || item.action === "fix") &&
							(readPath(run.outputs, "ci-fix.reviewRequired") !== false ||
								readiness.blockers.some(
									(current) =>
										current.kind === item.kind && current.action === "fix",
								)),
					) ||
					(feedback?.some((item) => item.kind === "comments") &&
						readPath(run.outputs, "ci-fix.reviewRequired") !== false);
				const reviewRequired =
					substantiveFeedback ||
					readPath(run.outputs, "ci-fix.reviewRequired") === true ||
					!reviewed ||
					reviewed.dirty ||
					dirty ||
					reviewed.headSha !== headSha ||
					readiness.headSha !== headSha ||
					!previousBase ||
					previousBase !== readiness.baseSha ||
					(aggregate?.approved ??
						readPath(run.outputs, "review-gate.approved")) !== true ||
					Boolean(
						aggregate &&
							(!aggregate.approved ||
								(aggregate.baseline.context &&
									this.scopeChanged(context, aggregate.baseline.context))),
					);
				context.log(
					reviewRequired
						? previousBase && previousBase !== readiness.baseSha
							? `Base changed from ${String(previousBase)} to ${readiness.baseSha}; integration context requires review and relevant validation.`
							: "Changed source revision, substantive feedback or missing review provenance requires code review."
						: "Accepted code and base are unchanged; returning directly to merge readiness.",
				);
				const previousChecks = readPath(run.outputs, "ci.checks");
				const failures = (checks: unknown) =>
					Array.isArray(checks)
						? checks
								.filter((check) => check.bucket === "fail")
								.map((check) => [check.name, check.state, check.link])
								.sort()
						: [];
				const unchangedFailures =
					!reviewRequired &&
					readPath(run.outputs, "ci.headSha") === headSha &&
					failures(readiness.checks).length > 0 &&
					JSON.stringify(failures(previousChecks)) ===
						JSON.stringify(failures(readiness.checks));
				const previous = run.outputs.ci as MergeReadiness | undefined;
				const unchangedRevision =
					!dirty &&
					readiness.headSha !== headSha &&
					previous?.worktreeHeadSha === headSha &&
					previous.headSha === readiness.headSha &&
					previous.baseSha === readiness.baseSha;
				const fingerprint = feedbackWorkFingerprint(readiness);
				const repeated = (run.history ?? [])
					.slice(0, -1)
					.some(
						(item) =>
							item.step === `${prefix}ci-fix` &&
							readPath(item.output, "feedbackAssessment.fingerprint") ===
								fingerprint &&
							readPath(item.output, "feedbackAssessment.instructionsSha256") ===
								feedbackInstructionFingerprint(context),
					);
				const unchangedWork =
					!dirty &&
					previous?.headSha === headSha &&
					previous.baseSha === readiness.baseSha &&
					fingerprint !== undefined &&
					fingerprint === feedbackWorkFingerprint(previous) &&
					(!reviewRequired || repeated);
				return {
					reviewRequired,
					invalidation: {
						kind:
							previousBase && previousBase !== readiness.baseSha
								? "base-change"
								: reviewed?.headSha !== headSha ||
										dirty ||
										readiness.headSha !== headSha
									? "source-change"
									: substantiveFeedback
										? "new-feedback"
										: reviewRequired
											? "missing-provenance"
											: "none",
						previousBaseSha: previousBase,
						baseSha: readiness.baseSha,
						previousHeadSha: reviewed?.headSha,
						headSha,
					},
					headSha,
					baseSha: readiness.baseSha,
					...(unchangedRevision || unchangedFailures || unchangedWork
						? {
								questions: [
									unchangedRevision
										? `The same revision mismatch remains after the CI fixer's synchronization attempt: The provider reports ${readiness.headSha}, while the worktree is at ${headSha}. Restore synchronization between this PR and its branch, then reply to resume. Checks for the older revision remain insufficient; your answer does not approve or waive review and CI.`
										: unchangedFailures
											? `The CI fixer made no revision change and these same checks still fail: ${readiness.checks
													.filter((check) => check.bucket === "fail")
													.map(
														(check) =>
															`${check.name}: ${check.link ?? check.state}`,
													)
													.join(
														"; ",
													)}. Resolve the external blocker or provide a corrective direction before retrying. The failures remain blocking.`
											: `The CI fixer made no progress on the same actionable blockers: ${readiness.blockers
													.filter((blocker) => blocker.action === "fix")
													.map((blocker) => blocker.message)
													.join(
														"; ",
													)}. Resolve the blocker or provide a corrective direction before retrying. Review and merge safeguards remain enforced.`,
								],
							}
						: {}),
				};
			}
			case "ci": {
				const url = String(readPath(run.outputs, "draft-pr.url") ?? "");
				if (!url) throw new Error("No PR to check");
				for (;;) {
					const snapshot = await inspectReadinessWithRetry(
						context,
						command,
						url,
					);
					assessFeedback(context, snapshot);
					const headSha = await command("git", ["rev-parse", "HEAD"]);
					if (snapshot.headSha !== headSha) {
						if (
							snapshot.state !== "OPEN" ||
							!context.step.branches.some(
								(branch) =>
									branch.when.path === "fix" && branch.when.equals === true,
							)
						)
							throw new Error(
								`PR must match the current pushed worktree revision (PR ${snapshot.headSha}, worktree ${headSha}); this step has no open PR synchronization recovery path`,
							);
						blockRevisionMismatch(snapshot, headSha);
					}
					reportReadiness(context, snapshot);
					if (
						snapshot.ciAssistance?.length ||
						snapshot.fix ||
						snapshot.reviewReady ||
						snapshot.approved
					)
						return snapshot;
					await delay(context.signal);
				}
			}
			case "ci-fix-readiness": {
				const previous = run.outputs.ci as MergeReadiness | undefined;
				const url = String(readPath(run.outputs, "draft-pr.url") ?? "");
				const snapshot = await inspectReadinessWithRetry(context, command, url);
				assessFeedback(context, snapshot);
				const head = (await command("git", ["rev-parse", "HEAD"])).trim();
				const dirty = Boolean(
					(await command("git", ["status", "--porcelain"])).trim(),
				);
				if (snapshot.headSha !== head) blockRevisionMismatch(snapshot, head);
				const digest = scopeContextDigest(
					context.currentScope?.() ?? context.input,
				);
				const aggregate = aggregateForContext(context);
				const scopeUnchanged =
					previous?.scopeDigest === digest ||
					Boolean(
						aggregate?.baseline.context &&
							scopeContextDigest(aggregate.baseline.context) === digest,
					);
				const skipFix =
					snapshot.state === "OPEN" &&
					!snapshot.fix &&
					!dirty &&
					scopeUnchanged &&
					!readPath(run.outputs, "handoff.guideRecovery") &&
					readPath(run.outputs, "visual-gate.approved") !== false &&
					readPath(run.outputs, "review-gate.approved") !== false;
				const refreshed = {
					...snapshot,
					scopeDigest: digest,
					correctionBaseSha: previous?.correctionBaseSha ?? previous?.baseSha,
				};
				run.outputs.ci = refreshed;
				reportReadiness(context, snapshot);
				context.save?.();
				return { ...refreshed, skipFix };
			}
			case "human-review": {
				if (
					run.delivery?.contract.mode === "external" ||
					context.step.id === "external-human-review"
				) {
					const delivery = run.delivery;
					if (!delivery)
						throw new Error("Accepted external delivery contract required");
					const snapshot = delivery.verification;
					if (
						!snapshot ||
						readPath(run.outputs, "guide.externalDigest") !== snapshot.digest
					)
						throw new Error(
							"External guide must bind current independent verification",
						);
					if (delivery.contract.mode === "mixed") {
						if (readPath(run.outputs, "merge.merged") !== true)
							throw new Error(
								"Mixed external reacceptance requires retained confirmed repository merge proof",
							);
						return {
							...(run.outputs["draft-pr"] as Record<string, unknown>),
							mode: "mixed",
							externalDigest: snapshot.digest,
						};
					}
					return {
						headSha: "",
						url: "",
						mode: "external",
						externalDigest: snapshot.digest,
					};
				}
				const headSha = await command("git", ["rev-parse", "HEAD"]);
				const url = String(readPath(run.outputs, "draft-pr.url") ?? "");
				const snapshot = await inspectReadinessWithRetry(context, command, url);
				assessFeedback(context, snapshot);
				const aggregate = aggregateForContext(context);
				if (aggregate) {
					if (
						aggregate.baseline.headSha !== headSha ||
						aggregate.baseline.baseSha !== snapshot.baseSha ||
						this.scopeChanged(context, aggregate.baseline.context)
					) {
						if (
							context.step.branches.some(
								(b) => b.when.path === "rework" && b.when.equals === true,
							)
						)
							return {
								rework: true,
								headSha,
								url,
								reason:
									"Revision or accepted scope changed after review; extract and review again before human approval",
							};
						throw new Error(
							"Revision or accepted scope changed after review; configure a correction route through requirement extraction",
						);
					}
					assertAggregateRevision(aggregate, headSha, snapshot.baseSha);
				}
				if (
					snapshot.headSha !== headSha ||
					readPath(run.outputs, "handoff.headSha") !== headSha
				)
					throw new Error(
						"Review guide revision changed; retry review before approving",
					);
				if (run.delivery?.contract.mode === "mixed") {
					if (!this.hooks.ticketDelivery)
						throw new Error("Ticket delivery integration unavailable");
					const snapshot = await this.hooks.ticketDelivery.verify(run);
					if (readPath(run.outputs, "guide.externalDigest") !== snapshot.digest)
						return {
							rework: true,
							reason: "External evidence changed after guide; review it again",
						};
					return {
						headSha,
						url,
						mode: "mixed",
						externalDigest: snapshot.digest,
					};
				}
				return { headSha, url };
			}
			case "merge": {
				const approved = run.humanDecisions?.at(-1);
				if (approved?.decision !== "approve")
					throw new Error("Explicit human approval required before merge");
				const url = String(readPath(run.outputs, "draft-pr.url") ?? "");
				let submitted = false;
				for (;;) {
					let immediate = false;
					const inspectAndMerge = async () => {
						const invalid = await context.validateDelivery?.();
						if (invalid) return invalid;
						const snapshot = await inspectReadinessWithRetry(
							context,
							command,
							url,
						);
						const merged = confirmedMerge(run, snapshot);
						if (merged) {
							reportReadiness(context, snapshot);
							return merged;
						}
						assessFeedback(context, snapshot);
						reportReadiness(context, snapshot);
						if (snapshot.ciAssistance?.length) return snapshot;
						const aggregate = aggregateForContext(context);
						if (
							aggregate &&
							(aggregate.baseline.baseSha !== snapshot.baseSha ||
								this.scopeChanged(context, aggregate.baseline.context))
						) {
							delete run.reviewGate;
							return {
								...snapshot,
								rework: true,
								reason:
									"Base or accepted scope changed after specialist review",
							};
						}
						if (aggregate)
							assertAggregateRevision(
								aggregate,
								approved.headSha,
								snapshot.baseSha,
							);
						if (
							snapshot.headSha !== approved.headSha ||
							(await command("git", ["rev-parse", "HEAD"])) !==
								approved.headSha ||
							(await command("git", ["status", "--porcelain"]))
						) {
							delete run.reviewGate;
							return {
								...snapshot,
								fix: true,
								rework: false,
								reason:
									"Revision changed after human approval; synchronize the local and remote branch without discarding work, commit/push pending changes, then repeat all review gates",
							};
						}
						if (snapshot.state !== "OPEN")
							throw new Error("PR closed without merging");
						if (snapshot.isDraft) {
							await (await provider(url)).draft(url, false);
							immediate = true;
							return undefined;
						}
						if (snapshot.fix) return { ...snapshot, fix: true };
						if (snapshot.approved && !snapshot.queued && !submitted) {
							await (await provider(url)).merge(
								url,
								approved.headSha,
								snapshot.mergeMethod,
							);
							submitted = true;
							context.log(
								"Merge requested; waiting for the provider to confirm merge or queue completion.",
							);
						}
						return undefined;
					};
					const result = await (context.coordinateDelivery
						? context.coordinateDelivery(inspectAndMerge)
						: inspectAndMerge());
					if (result) return result;
					if (!immediate) await delay(context.signal);
				}
			}
			case "handoff": {
				const headSha = await command("git", ["rev-parse", "HEAD"]);
				const url = String(readPath(run.outputs, "draft-pr.url"));
				const pr = await (await provider(url)).view(
					url,
					"headRefOid,isDraft,state",
				);
				if (await command("git", ["status", "--porcelain"]))
					throw new Error("Worktree changed after review; handoff blocked");
				if (pr.state !== "OPEN")
					throw new Error("PR is no longer open; handoff blocked");
				if (
					pr.headRefOid !== headSha ||
					readPath(run.outputs, "ci.headSha") !== headSha
				) {
					if (
						!context.step.branches.some(
							(branch) =>
								branch.when.path === "fix" && branch.when.equals === true,
						)
					) {
						throw new Error(
							"PR revision or CI evidence changed; handoff blocked",
						);
					}
					const readiness = await inspectReadinessWithRetry(
						context,
						command,
						url,
					);
					assessFeedback(context, readiness);
					readiness.fix = true;
					readiness.approved = false;
					readiness.reviewReady = false;
					readiness.blockers.push({
						kind: "revision",
						action: "fix",
						message:
							"PR/worktree revision changed after CI; synchronize the branch and repeat review and validation before handoff",
					});
					run.outputs.ci = readiness;
					return readiness;
				}
				let readiness: MergeReadiness;
				for (;;) {
					readiness = await inspectReadinessWithRetry(context, command, url);
					assessFeedback(context, readiness);
					reportReadiness(context, readiness);
					if (readiness.ciAssistance?.length) return readiness;
					if (readiness.headSha !== headSha || readiness.state !== "OPEN")
						throw new Error(
							`Merge readiness changed; handoff blocked: ${readiness.blockers.map((blocker) => blocker.message).join("; ") || "PR state or revision changed"}`,
						);
					if (
						(await command("git", ["rev-parse", "HEAD"])) !== headSha ||
						(await command("git", ["status", "--porcelain"]))
					)
						throw new Error("Worktree changed after review; handoff blocked");
					if (readiness.fix) {
						if (
							context.step.branches.some(
								(branch) =>
									branch.when.path === "fix" && branch.when.equals === true,
							)
						) {
							// The existing fixer and its review gate consume the latest
							// CI receipt, including feedback arriving after the guide.
							run.outputs.ci = readiness;
							return readiness;
						}
						throw new Error(
							`Merge readiness changed; handoff blocked: ${readiness.blockers.map((blocker) => blocker.message).join("; ")}`,
						);
					}
					const aggregate = aggregateForContext(context);
					if (aggregate) {
						if (
							aggregate.baseline.headSha !== headSha ||
							aggregate.baseline.baseSha !== readiness.baseSha ||
							this.scopeChanged(context, aggregate.baseline.context)
						) {
							if (
								context.step.branches.some(
									(b) => b.when.path === "fix" && b.when.equals === true,
								)
							)
								return {
									...readiness,
									fix: true,
									scopeReviewRequired: true,
									reason:
										"Accepted context changed after review; extract a new requirement baseline",
								};
							throw new Error(
								"Accepted scope changed after specialist review; configure a correction route through requirement extraction",
							);
						}
						assertAggregateRevision(aggregate, headSha, readiness.baseSha);
					}
					if (readiness.reviewReady) break;
					// The provider may recalculate mergeability or start checks while the
					// guide is being written. Wait as CI does, without replaying roles.
					await delay(context.signal);
				}
				const recovery = guideGapRecovery(context, readiness);
				if (recovery) {
					run.outputs.ci = recovery;
					return recovery;
				}
				if (!guideReady(run.outputs.guide))
					throw new Error(
						"Review guide reports unresolved gaps; handoff blocked",
					);
				if (context.step.qaContract) {
					const gate = await this.qaGate(context, command);
					const accepted = run.outputs["visual-gate"];
					if (
						!gate.approved ||
						readPath(accepted, "headSha") !== headSha ||
						readPath(accepted, "captureHash") !== gate.captureHash ||
						readPath(accepted, "scopeHash") !== gate.scopeHash ||
						readPath(accepted, "reviewHash") !== gate.reviewHash
					)
						throw new Error(
							"QA evidence changed or is incomplete; handoff blocked",
						);
				}
				const guide = isReviewBrief(run.outputs.guide)
					? briefMarkdown(run.outputs.guide, headSha)
					: reviewGuideMarkdown(run.outputs.guide, headSha);
				await (await provider(url)).description(url, guide);
				if (!run.ticketReference)
					await this.hooks.postComment(
						run.id,
						`## Factory ready for human review\n\nDraft PR: ${url}\n\n${guide}`,
					);
				return { url, headSha, ready: true };
			}
			case "exec": {
				const [exe, ...args] = (context.step.args ?? []).map((arg) =>
					String(toolArguments(context, arg)),
				);
				if (!exe)
					throw new Error("exec tool needs an executable and arguments");
				const stdout = await command(exe, args);
				try {
					return JSON.parse(stdout);
				} catch {
					return { stdout };
				}
			}
			default: {
				const match = context.step.tool?.match(/^mcp__(.+?)__(.+)$/);
				if (match && this.hooks.mcp)
					return this.hooks.mcp(context, match[1]!, match[2]!);
				throw new Error(
					`Unknown workflow tool: ${context.step.tool}. Use exec for CLI tools or mcp__server__tool for configured MCP tools.`,
				);
			}
		}
	}
}

export function parseAgentOutput(text: string): unknown {
	const cleaned = text
		.trim()
		.replace(/^```(?:json)?\s*/, "")
		.replace(/\s*```$/, "");
	try {
		return JSON.parse(cleaned);
	} catch {
		throw new Error(
			`Agent did not return the required JSON result: ${cleaned.slice(-2000)}`,
		);
	}
}

/** A completed capture needs agent correction, rather than another finalization retry. */
export class CaptureReuseError extends Error {
	constructor(
		readonly screenshots: { path: string; area: string; state?: string }[],
	) {
		super(
			`Screenshot reuse is not verified for ${screenshots.map((shot) => `${shot.area}/${shot.state}`).join(", ")}; capture a fresh image for each rejected state`,
		);
		this.name = "CaptureReuseError";
	}
}

export function captureEvidence(
	context: ExecutionContext,
	output: unknown,
): unknown {
	const capture: z.infer<typeof CaptureSchema> &
		Partial<z.infer<typeof QaCaptureSchema>> = context.step.qaContract
		? QaCaptureSchema.parse(output)
		: CaptureSchema.parse(output);
	const areas = readPath(context.run.outputs, "visual-scope.areas");
	if (context.step.qaContract) {
		const scope = context.run.outputs["visual-scope"] as {
			stories: { id: string; goal: string; criteria: unknown[] }[];
			notApplicableReason?: string;
		};
		capture.coverage = {
			plannedStories: scope.stories.length,
			plannedCriteria: scope.stories.reduce((n, s) => n + s.criteria.length, 0),
			reportedStories: capture.results!.length,
			reportedCriteria: capture.results!.reduce(
				(n, s) => n + s.criteria.length,
				0,
			),
		};
		for (const result of capture.results!)
			result.goal = scope.stories.find((s) => s.id === result.storyId)?.goal;
		if (scope.notApplicableReason)
			capture.notApplicableReason = scope.notApplicableReason;
		else delete capture.notApplicableReason;
		const current = context.progress?.currentRevision;
		if (!current) throw new Error("QA requires runtime revision provenance");
		capture.testedRevision = {
			headSha: current.headSha,
			dirty: current.dirty,
			scopeHash: qaDigest(scope),
		};
		for (const shot of capture.screenshots)
			if (
				!Array.isArray(areas) ||
				!areas.some(
					(a) => a.name === shot.area && a.states.includes(shot.state),
				)
			)
				throw new Error(`Unknown screenshot task ${shot.area}/${shot.state}`);
	}
	const budget = readPath(context.run.outputs, "visual-scope.captureBudget");
	// Old persisted inventories remain readable/resumable; new evidence plans are bounded.
	if (typeof budget === "number") {
		if (capture.screenshots.length > budget)
			throw new OutputValidationError(output, [
				{
					path: "/screenshots",
					message: `Capture exceeds the representative evidence budget of ${budget}`,
					expected: budget,
					actual: capture.screenshots.length,
				},
			]);
		const identities = capture.screenshots.map(
			(shot) => `${shot.area}\0${shot.state}`,
		);
		const hashes = capture.screenshots.map((shot) =>
			createHash("sha256")
				.update(
					readFileSync(verifiedScreenshot(shot.path, context.evidenceDir)),
				)
				.digest("hex"),
		);
		if (
			new Set(identities).size !== identities.length ||
			new Set(hashes).size !== hashes.length
		)
			throw new OutputValidationError(output, [
				{
					path: "/screenshots",
					message:
						"Capture contains duplicate states or identical images; keep one representative image",
					expected: "unique states and image hashes",
					actual: { identities, hashes },
				},
			]);
	}
	capture.unavailable = captureGaps(capture, areas);
	const scope = context.run.outputs["visual-scope"] as
		| {
				areas?: { name: string; dependencies?: string[]; changed?: boolean }[];
				nonVisualFiles?: string[];
		  }
		| undefined;
	const previous = context.progress?.previousOutput as
		| {
				screenshots?: z.infer<typeof screenshotSchema>[];
				dependencyManifests?: Record<string, Record<string, string>>;
		  }
		| undefined;
	const dependencies = (scope?.areas ?? []).flatMap(
		(area) => area.dependencies ?? [],
	);
	const nonVisual = new Set(scope?.nonVisualFiles ?? []);
	const unexplained =
		context.progress?.changedFiles.some(
			(file) =>
				!nonVisual.has(file) &&
				!dependencies.some((dependency) => dependencyCovers(file, dependency)),
		) ?? true;
	// Only runtime-computed manifests may survive finalization.
	delete capture.dependencyManifests;
	const rejected: CaptureReuseError["screenshots"] = [];
	const manifests = new Map<string, Record<string, string>>();
	for (const shot of capture.screenshots) {
		if (!existsSync(shot.path))
			throw new Error(`Screenshot missing: ${shot.path}`);
		verifiedScreenshot(shot.path, context.evidenceDir);
		const imageSha256 = createHash("sha256")
			.update(readFileSync(shot.path))
			.digest("hex");
		const area = scope?.areas?.find((area) => area.name === shot.area);
		let hashes: Record<string, string> | undefined;
		if (area?.dependencies?.length) {
			const key = JSON.stringify([...area.dependencies].sort());
			hashes = manifests.get(key);
			if (!hashes) {
				hashes = dependencyHashes(
					context.run.workspace,
					area.dependencies,
					runRepositories(context.run),
				);
				manifests.set(key, hashes);
			}
		}
		const old = previous?.screenshots?.find((old) => old.path === shot.path);
		if (old) {
			const oldHashes =
				old.dependencyHashes ??
				(old.dependencyManifest
					? previous?.dependencyManifests?.[old.dependencyManifest]
					: undefined);
			const sameSources =
				hashes &&
				oldHashes &&
				JSON.stringify(hashes) === JSON.stringify(oldHashes);
			// Exact revision alone cannot prove explicit ignored runtime inputs unchanged.
			// Legacy maps migrate only when their complete source fingerprint agrees.
			const unchanged =
				!context.progress?.uncertain &&
				sameSources &&
				(context.progress?.unchangedCode ||
					(!unexplained &&
						area?.changed === false &&
						old.fingerprintVersion === 2));

			if (
				!unchanged ||
				old.area !== shot.area ||
				old.state !== shot.state ||
				old.imageSha256 !== imageSha256 ||
				(readPath(context.run.outputs, "visual-gate.approved") !== true &&
					!(
						readPath(
							context.run.outputs,
							"visual-review.acceptedScreenshots",
						) as
							| { area: string; state: string; imageSha256: string }[]
							| undefined
					)?.some(
						(item) =>
							item.area === shot.area &&
							item.state === shot.state &&
							item.imageSha256 === imageSha256,
					))
			) {
				rejected.push({ path: shot.path, area: shot.area, state: shot.state });
				continue;
			}
			shot.reused = true;
		} else shot.reused = false;
		shot.revision = context.progress?.currentRevision?.headSha;
		shot.imageSha256 = imageSha256;
		delete shot.dependencyManifest;
		if (hashes) {
			const digest = createHash("sha256")
				.update(JSON.stringify(hashes))
				.digest("hex");
			capture.dependencyManifests ??= {};
			capture.dependencyManifests[digest] = hashes;
			shot.dependencyManifest = digest;
		}
		delete shot.dependencyHashes;
		shot.fingerprintVersion = 2;
	}
	if (rejected.length) throw new CaptureReuseError(rejected);
	return capture;
}
