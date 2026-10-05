import { spawn } from "node:child_process";
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
import { z } from "zod";
import { dependencyHashes } from "./Incremental.js";
import {
	assessFeedback,
	delay,
	inspectReadinessWithRetry,
	reportReadiness,
} from "./MergeReadiness.js";
import { inspectPullRequest } from "./Takeover.js";
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

import type { ExecutionContext } from "./WorkflowRuntime.js";

export function reviewGuideMarkdown(value: unknown, headSha: string): string {
	const guide = value as {
		goal: string;
		summary: string;
		decision: { status: string; summary: string };
		behavior: { scenario: string; before: string; after: string }[];
		requirements: { criterion: string; status: string; evidence: string[] }[];
		checks: string[];
		risks: string[];
		reviewInstructions: string[];
	};
	const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
	return `## Goal\n${guide.goal}\n\n${guide.summary}\n\n## Decision\n${guide.decision.status}: ${guide.decision.summary}\n\n## Before and after\n${guide.behavior.map((item) => `### ${item.scenario}\nBefore: ${item.before}\n\nAfter: ${item.after}`).join("\n\n")}\n\n## Requirements\n${guide.requirements.map((item) => `- **${item.criterion}** (${item.status}): ${item.evidence.join("; ")}`).join("\n")}\n\n## Checks\n${list(guide.checks)}\n\n## Risks\n${list(guide.risks)}\n\n## Human review\n${list(guide.reviewInstructions)}\n\nRevision: ${headSha}\nScreenshots and complete decision/review history are available in the local factory dashboard.\n\n<!-- generated-by-cyrus -->`;
}

export function executeCommand(
	context: ExecutionContext,
	command: string,
	args: string[],
	timeoutMs = 20 * 60 * 1000,
): Promise<string> {
	context.signal.throwIfAborted();
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
				...process.env,
				// Large contexts cannot fit in the OS process argument/environment limit.
				FACTORY_INPUT: Buffer.byteLength(input) <= 16000 ? input : undefined,
				FACTORY_INPUT_FILE: inputPath,
				FACTORY_EVIDENCE_DIR: context.evidenceDir,
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
			context.log(text);
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
			if (context.signal.aborted) reject(new Error("Run terminated"));
			else if (timedOut) reject(new Error(`Command timed out: ${command}`));
			else if (code !== 0)
				reject(new Error(`${command} exited ${code}: ${output.slice(-12000)}`));
			else resolve(output.trim());
		});
	});
}

export const ReviewResultSchema = z.object({
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
	path: z.string(),
	caption: z.string(),
	revision: z.string().optional(),
	imageSha256: z.string().optional(),
	dependencyHashes: z.record(z.string(), z.string()).optional(),
	reused: z.boolean().optional(),
	area: z.string(),
	state: z.string().optional(),
});
export const CaptureSchema = z.object({
	screenshots: z.array(screenshotSchema),
	unavailable: z
		.array(z.object({ area: z.string(), reason: z.string() }))
		.default([]),
});
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
		const { run } = context;
		const command = (exe: string, args: string[], timeout?: number) =>
			this.hooks.command
				? this.hooks.command(context, exe, args, timeout)
				: executeCommand(context, exe, args, timeout);
		switch (context.step.tool) {
			case "inspect-existing": {
				const branch = await command("git", ["branch", "--show-current"]);
				let pr = run.outputs.source as
					| Awaited<ReturnType<typeof inspectPullRequest>>
					| undefined;
				if (!pr?.url) {
					const candidates: { url: string }[] = JSON.parse(
						await command("gh", [
							"pr",
							"list",
							"--head",
							branch,
							"--state",
							"open",
							"--json",
							"url",
						]),
					);
					if (candidates.length > 1)
						throw new Error(
							"Multiple PRs for this branch; start Takeover with an explicit PR URL",
						);
					if (candidates[0])
						pr = await inspectPullRequest(command, candidates[0].url);
				}
				if (pr) {
					if (branch !== pr.headRefName)
						throw new Error(
							"Takeover worktree does not match the existing PR branch",
						);
					if (!pr.isDraft)
						await command("gh", ["pr", "ready", pr.url, "--undo"]);
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
			case "record-decisions": {
				const decisions = run.outputs.clarify;
				await this.hooks.postComment(
					run.id,
					`## Factory decision records\n\n${JSON.stringify(decisions, null, 2)}\n\n### Questions and answers\n${run.answers.map((answer) => `${answer.questions.map((question) => `- ${question}`).join("\n")}\n\n${answer.answer}`).join("\n\n")}`,
				);
				return decisions;
			}
			case "draft-pr": {
				const branch = await command("git", ["branch", "--show-current"]);
				if (!branch) throw new Error("Draft PR requires a branch");
				if (readPath(run.outputs, "source.url")) {
					if (readPath(run.outputs, "source.headRefName") !== branch)
						throw new Error("Takeover must publish to the original PR branch");
					const pr = JSON.parse(
						await command("gh", [
							"pr",
							"view",
							String(readPath(run.outputs, "source.url")),
							"--json",
							"state,isDraft",
						]),
					);
					if (pr.state !== "OPEN" || !pr.isDraft)
						throw new Error("Takeover PR must remain open and draft");
				}
				if (await command("git", ["status", "--porcelain"])) {
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
					await command("git", [
						"commit",
						"-m",
						`chore: ${subject || "factory changes"}`,
					]);
				}
				await command("git", ["push", "-u", "origin", "HEAD"]);
				const existing: { url: string; isDraft: boolean }[] = JSON.parse(
					await command("gh", [
						"pr",
						"list",
						"--head",
						branch,
						"--state",
						"open",
						"--json",
						"url,isDraft",
					]),
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
					const baseBranch = String(
						readPath(run.outputs, "repository.baseBranch") ?? "main",
					);
					url = await command("gh", [
						"pr",
						"create",
						"--draft",
						"--base",
						baseBranch,
						"--head",
						branch,
						"--title",
						run.title,
						"--body",
						`Software factory run ${run.id}. Review and validation in progress.\n\n<!-- generated-by-cyrus -->`,
					]);
				}
				return {
					url,
					branch,
					headSha: await command("git", ["rev-parse", "HEAD"]),
				};
			}
			case "review-gate":
			case "visual-gate": {
				const source =
					context.step.tool === "review-gate" ? "code-review" : "visual-review";
				const review = filterReview(run.outputs[source]);
				const open = review.findings.filter(
					(finding) => finding.status === "open",
				);
				if (source === "visual-review") {
					const capture = CaptureSchema.parse(run.outputs.capture);
					if (!capture.screenshots.length || capture.unavailable.length)
						throw new Error(
							"Visual evidence is incomplete. Supply capture tools/access and start a new run; screenshots cannot be approved without evidence.",
						);
					for (const shot of capture.screenshots)
						verifiedScreenshot(shot.path, context.evidenceDir);
				}
				return { approved: open.length === 0, findings: open };
			}
			case "review-after-fix": {
				const prefix = (run.step ?? context.step.id).replace(/[^/]+$/, "");
				const reviewed = run.roleRevisions?.[`${prefix}code-review`];
				const headSha = await command("git", ["rev-parse", "HEAD"]);
				const dirty = Boolean(await command("git", ["status", "--porcelain"]));
				const url = String(readPath(run.outputs, "draft-pr.url") ?? "");
				const readiness = await inspectReadinessWithRetry(
					context,
					command,
					url,
				);
				const previousBase = readPath(run.outputs, "ci.baseSha");
				const feedback = readPath(run.outputs, "ci.blockers") as
					| { kind: string }[]
					| undefined;
				const substantiveFeedback =
					feedback?.some((item) =>
						["threads", "reviews"].includes(item.kind),
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
					readPath(run.outputs, "review-gate.approved") !== true;
				context.log(
					reviewRequired
						? "Changed revision, substantive feedback or missing review provenance requires code review."
						: "Accepted code and base are unchanged; returning directly to merge readiness.",
				);
				return { reviewRequired, headSha, baseSha: readiness.baseSha };
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
					if (snapshot.headSha !== headSha)
						throw new Error(
							"PR must match the current pushed worktree revision",
						);
					reportReadiness(context, snapshot);
					if (snapshot.fix || snapshot.reviewReady || snapshot.approved)
						return snapshot;
					await delay(context.signal);
				}
			}
			case "human-review": {
				const headSha = await command("git", ["rev-parse", "HEAD"]);
				const url = String(readPath(run.outputs, "draft-pr.url") ?? "");
				const snapshot = await inspectReadinessWithRetry(context, command, url);
				assessFeedback(context, snapshot);
				if (
					snapshot.headSha !== headSha ||
					readPath(run.outputs, "handoff.headSha") !== headSha
				)
					throw new Error(
						"Review guide revision changed; retry review before approving",
					);
				return { headSha, url };
			}
			case "merge": {
				const approved = run.humanDecisions?.at(-1);
				if (approved?.decision !== "approve")
					throw new Error("Explicit human approval required before merge");
				const url = String(readPath(run.outputs, "draft-pr.url") ?? "");
				let submitted = false;
				for (;;) {
					const snapshot = await inspectReadinessWithRetry(
						context,
						command,
						url,
					);
					assessFeedback(context, snapshot);
					reportReadiness(context, snapshot);
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
					if (snapshot.state === "MERGED")
						return { merged: true, url, headSha: snapshot.headSha };
					if (snapshot.state !== "OPEN")
						throw new Error("PR closed without merging");
					if (snapshot.isDraft) {
						await command("gh", ["pr", "ready", url]);
						continue;
					}
					if (snapshot.fix) return { ...snapshot, fix: true };
					if (snapshot.approved && !snapshot.queued && !submitted) {
						// GitHub CLI enters a required merge queue automatically. Never use --admin.
						await command("gh", [
							"pr",
							"merge",
							url,
							`--${snapshot.mergeMethod}`,
							"--match-head-commit",
							approved.headSha,
						]);
						submitted = true;
						context.log(
							"Merge requested; waiting for GitHub to confirm merge or queue completion.",
						);
					}
					await delay(context.signal);
				}
			}
			case "handoff": {
				const headSha = await command("git", ["rev-parse", "HEAD"]);
				const url = String(readPath(run.outputs, "draft-pr.url"));
				const pr = JSON.parse(
					await command("gh", [
						"pr",
						"view",
						url,
						"--json",
						"headRefOid,isDraft,state",
					]),
				);
				if (await command("git", ["status", "--porcelain"]))
					throw new Error("Worktree changed after review; handoff blocked");
				if (
					pr.headRefOid !== headSha ||
					readPath(run.outputs, "ci.headSha") !== headSha ||
					(readPath(run.outputs, "ci.reviewReady") !== true &&
						readPath(run.outputs, "ci.approved") !== true) ||
					pr.state !== "OPEN"
				)
					throw new Error(
						"PR revision or CI evidence changed; handoff blocked",
					);
				const readiness = await inspectReadinessWithRetry(
					context,
					command,
					url,
				);
				assessFeedback(context, readiness);
				if (!readiness.reviewReady || readiness.headSha !== headSha)
					throw new Error("Merge readiness changed; handoff blocked");
				if (readPath(run.outputs, "guide.decision.status") !== "ready")
					throw new Error(
						"Review guide reports unresolved gaps; handoff blocked",
					);
				const guide = reviewGuideMarkdown(run.outputs.guide, headSha);
				await command("gh", ["pr", "edit", url, "--body", guide]);
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

export function captureEvidence(
	context: ExecutionContext,
	output: unknown,
): unknown {
	const capture = CaptureSchema.parse(output);
	const areas = readPath(context.run.outputs, "visual-scope.areas");
	const budget = readPath(context.run.outputs, "visual-scope.captureBudget");
	// Old persisted inventories remain readable/resumable; new evidence plans are bounded.
	if (typeof budget === "number") {
		if (capture.screenshots.length > budget)
			throw new Error(
				`Capture exceeds the representative evidence budget of ${budget}`,
			);
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
			throw new Error(
				"Capture contains duplicate states or identical images; keep one representative image",
			);
	}
	if (Array.isArray(areas)) {
		for (const area of areas) {
			for (const state of area.states ?? []) {
				if (
					!capture.screenshots.some(
						(shot) => shot.area === area.name && shot.state === state,
					) &&
					!capture.unavailable.some((item) => item.area === area.name)
				) {
					capture.unavailable.push({
						area: area.name,
						reason: `No screenshot supplied for state: ${state}`,
					});
				}
			}
		}
	}
	const scope = context.run.outputs["visual-scope"] as
		| {
				areas?: { name: string; dependencies?: string[]; changed?: boolean }[];
				nonVisualFiles?: string[];
		  }
		| undefined;
	const previous = context.progress?.previousOutput as
		| { screenshots?: z.infer<typeof screenshotSchema>[] }
		| undefined;
	const covered = new Set([
		...(scope?.areas ?? []).flatMap((area) => area.dependencies ?? []),
		...(scope?.nonVisualFiles ?? []),
	]);
	const unexplained =
		context.progress?.changedFiles.some((file) => !covered.has(file)) ?? true;
	for (const shot of capture.screenshots) {
		if (!existsSync(shot.path))
			throw new Error(`Screenshot missing: ${shot.path}`);
		verifiedScreenshot(shot.path, context.evidenceDir);
		const imageSha256 = createHash("sha256")
			.update(readFileSync(shot.path))
			.digest("hex");
		const area = scope?.areas?.find((area) => area.name === shot.area);
		let hashes: Record<string, string> | undefined;
		if (area?.dependencies?.length)
			hashes = dependencyHashes(context.run.workspace, area.dependencies);
		const old = previous?.screenshots?.find((old) => old.path === shot.path);
		if (old) {
			const unchanged =
				context.progress?.unchangedCode ||
				(!context.progress?.uncertain &&
					!unexplained &&
					area?.changed === false &&
					hashes &&
					old.dependencyHashes &&
					JSON.stringify(hashes) === JSON.stringify(old.dependencyHashes));
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
			)
				throw new Error(
					`Screenshot reuse is not verified for ${shot.area}/${shot.state}; capture a fresh image`,
				);
			shot.reused = true;
		} else shot.reused = false;
		shot.revision = context.progress?.currentRevision?.headSha;
		shot.imageSha256 = imageSha256;
		shot.dependencyHashes = hashes;
	}
	return capture;
}
