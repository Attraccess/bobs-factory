import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
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
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: context.run.workspace,
			detached: process.platform !== "win32",
			env: {
				...process.env,
				FACTORY_INPUT: JSON.stringify(context.input),
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
				if (await command("git", ["status", "--porcelain"])) {
					await command("git", ["add", "-A"]);
					await command("git", ["commit", "-m", run.title]);
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
				let url = existing[0]?.url;
				if (url && !existing[0]?.isDraft)
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
			case "ci": {
				const url = String(readPath(run.outputs, "draft-pr.url") ?? "");
				if (!url) throw new Error("No draft PR to check");
				const headSha = await command("git", ["rev-parse", "HEAD"]);
				const remote = JSON.parse(
					await command("gh", [
						"pr",
						"view",
						url,
						"--json",
						"headRefOid,isDraft,state",
					]),
				);
				if (
					remote.headRefOid !== headSha ||
					!remote.isDraft ||
					remote.state !== "OPEN"
				)
					throw new Error(
						"Draft PR must match the current pushed worktree revision",
					);
				try {
					const receipt = await command(
						"gh",
						["pr", "checks", url, "--watch", "--interval", "10"],
						30 * 60 * 1000,
					);
					const checks = JSON.parse(
						await command("gh", [
							"pr",
							"checks",
							url,
							"--json",
							"name,state,bucket,link",
						]),
					);
					return {
						approved:
							checks.length > 0 &&
							checks.every(
								(check: { bucket: string }) =>
									check.bucket === "pass" || check.bucket === "skipping",
							),
						headSha,
						checks,
						receipt,
					};
				} catch (error) {
					context.signal.throwIfAborted();
					return {
						approved: false,
						headSha,
						error: error instanceof Error ? error.message : String(error),
					};
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
					readPath(run.outputs, "ci.approved") !== true ||
					!pr.isDraft ||
					pr.state !== "OPEN"
				)
					throw new Error(
						"PR revision or CI evidence changed; handoff blocked",
					);
				const checks: { bucket: string }[] = JSON.parse(
					await command("gh", ["pr", "checks", url, "--json", "bucket"]),
				);
				if (
					!checks.length ||
					checks.some((check) => !["pass", "skipping"].includes(check.bucket))
				)
					throw new Error("CI is no longer green");
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
	for (const shot of capture.screenshots) {
		if (!existsSync(shot.path))
			throw new Error(`Screenshot missing: ${shot.path}`);
		verifiedScreenshot(shot.path, context.evidenceDir);
	}
	return capture;
}
