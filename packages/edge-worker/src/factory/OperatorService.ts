import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { operatorTools } from "bobs-factory-mcp-tools";
import type { ChatState } from "./SessionChat.js";
import type { FactoryRun, WorkflowRuntime } from "./WorkflowRuntime.js";

export class OperatorError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}
export function operatorError(
	error: unknown,
	context?: { instance: string; runId?: string },
) {
	const text = String(error);
	const code =
		error instanceof OperatorError
			? error.code
			: /unauthorized|401|403|authentication|oauth|credential/i.test(text)
				? "missing_authentication"
				: /found 0|not configured|missing.*transport/i.test(text)
					? "missing_transport"
					: /found [2-9]|ambiguous/i.test(text)
						? "ambiguous_transport"
						: /denied|not allowed|disallowed|restricted/i.test(text)
							? "denied_tool"
							: /changed|stale/i.test(text)
								? "stale_state"
								: /Only .*|not waiting|disabled|unavailable/i.test(text)
									? "invalid_state"
									: "connectivity_failure";
	return {
		ok: false,
		...context,
		error: {
			code,
			message:
				error instanceof OperatorError
					? error.message
					: "Operation failed. Inspect the run and its connection configuration before retrying.",
			nextStep:
				operatorRecovery[code] ??
				"Call inspect_run and inspect_mcp_connections to check the run and its configuration before retrying.",
		},
	};
}
const operatorRecovery: Record<string, string> = {
	not_found:
		"Use MCP tools/list to discover available operations and list_runs to find a run ID on this instance.",
	invalid_request:
		"Use MCP tools/list to read the operation's input schema, correct the arguments and call it again.",
	unauthorized:
		"Select the correct Factory home and obtain a valid operator grant there before reconnecting.",
	insufficient_scope:
		"Ask the operator to issue a grant with the capability required by this tool, then reconnect.",
	stale_configuration:
		"Wait for the current operation to finish, then call inspect_mcp_connections and use its fresh configRevision before editing again.",
	stale_state:
		"Wait for the current operation to finish, then call inspect_run and use its fresh revision before acting again.",
	invalid_state:
		"Call inspect_run and check which recovery actions are available in the current state.",
	workflow_restriction:
		"Call inspect_run to check the workflow's available actions and restrictions.",
	frozen_configuration:
		"Update a saved tool profile for a new launch; the current run's accepted profile cannot be changed.",
	missing_authentication:
		"Call inspect_mcp_connections to identify the run's runner and authentication path, restore authentication for that path, then call check_mcp_connection.",
};
export function operatorDigest(value: unknown) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
/** Apply to allowlisted data only. Never serialize provider responses or raw configuration. */
export function operatorText(value: string) {
	return value
		.replace(/https?:\/\/[^\s<>"']+/g, (match) => {
			try {
				const u = new URL(match);
				return `${u.origin}${u.pathname}`;
			} catch {
				return "[endpoint]";
			}
		})
		.replace(/\b(?:Bearer|Basic)\s+\S+/gi, "[credential]")
		.replace(/\b(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]+/g, "[credential]")
		.replace(
			/((?:token|secret|password|authorization|api[_-]?key|cookie)\s*[=:]\s*)[^\s,;]+/gi,
			"$1[redacted]",
		)
		.slice(0, 4000);
}
export interface OperatorHooks {
	chat?(id: string): ChatState;
	message?(id: string, text: string, messageId?: string): void | Promise<void>;
	stop(id: string): void;
	mcp?(run: FactoryRun): Promise<unknown>;
	check?(run: FactoryRun, server?: string): Promise<unknown>;
	update?(run: FactoryRun, input: any): Promise<unknown>;
	sanitize?(text: string): string;
}
export class OperatorService {
	private busy = new Set<string>();
	private epochs = new Map<string, number>();
	constructor(
		readonly runtime: WorkflowRuntime,
		readonly hooks: OperatorHooks,
		readonly instance: string,
	) {}
	private run(id: string) {
		const run = this.runtime.runs.get(id);
		if (!run)
			throw new OperatorError("not_found", "Factory workflow run not found");
		return run;
	}
	revision(run: FactoryRun) {
		return operatorDigest([run, this.epochs.get(run.id) ?? 0]);
	}
	private text(value: string) {
		return operatorText(this.hooks.sanitize?.(value) ?? value);
	}
	error(error: unknown, input?: unknown) {
		const runId =
			input && typeof input === "object" && "runId" in input
				? input.runId
				: undefined;
		const response = operatorError(error, {
			instance: this.instance,
			...(typeof runId === "string"
				? { runId: this.text(runId).slice(0, 200) }
				: {}),
		});
		response.error.message = this.text(response.error.message);
		return response;
	}
	inspect(id: string) {
		const run = this.run(id),
			pendingReview = run.reviewGate?.status === "pending";
		const action = (available: boolean, reason: string) => ({
			available,
			reason: available ? undefined : reason,
		});
		const chat = this.hooks.chat?.(id);
		return {
			instance: this.instance,
			revision: this.revision(run),
			runId: id,
			title: this.text(run.title),
			status: run.status,
			createdAt: run.createdAt,
			updatedAt: run.updatedAt,
			repositories: (run.repositories ?? [{ id: run.repositoryId }]).map(
				(r) => ({ id: r.id }),
			),
			workflow: { id: run.workflow.id },
			step: run.step,
			setupComplete: !!run.setupComplete,
			error: run.error
				? {
						category: operatorError(new Error(run.error)).error.code,
						message: this.text(run.error),
					}
				: undefined,
			execution: {
				runner: run.executionDiagnostics?.runner ?? run.runner,
				model: run.model,
				selection: run.executionSnapshot?.sources,
				toolProfile: run.executionSnapshot?.tools
					? {
							id: run.executionSnapshot.tools.id,
							revision: run.executionSnapshot.tools.revision,
						}
					: undefined,
			},
			questionContext: {
				step: run.step,
				questionBatchId: run.questionBatchId,
				questions: run.questions.map((q) => this.text(q)),
			},
			// Bind submissions to the displayed sanitized contents and the underlying run revision.
			ticket: run.ticketReference
				? { provider: run.ticketReference.provider }
				: undefined,
			ticketSync: run.ticketSync
				? {
						lastStatus: run.ticketSync.lastStatus,
						error: run.ticketSync.error
							? this.text(run.ticketSync.error)
							: undefined,
						receipts: run.ticketSync.receipts.slice(-25).map((receipt) => ({
							key: receipt.key,
							stage: receipt.stage,
							delivered: receipt.delivered,
							merged: receipt.merged,
							conflict: receipt.conflict,
							error: receipt.error ? this.text(receipt.error) : undefined,
							limitation: receipt.limitation
								? this.text(receipt.limitation)
								: undefined,
						})),
					}
				: undefined,
			savedProgress: {
				checkpoint: !!run.checkpoint,
				simpleExecution: !!run.simpleExecution,
				completedSteps: Object.keys(run.outputs),
				historyEntries: run.history.length,
				deliveryRepositories: Object.keys(run.repositoryOutputs ?? {}),
			},
			actions: {
				retry_run: action(
					run.status === "failed" && !pendingReview,
					"Only failed runs outside human review can retry",
				),
				resume_run: action(
					run.status === "interrupted" &&
						!!(run.checkpoint || run.simpleExecution) &&
						!pendingReview,
					"Only interrupted runs with saved progress outside human review can resume",
				),
				stop_run: action(
					["running", "waiting", "interrupted"].includes(run.status),
					"Run is already finished",
				),
				answer_run: action(
					run.status === "waiting" && !!run.questions.length && !pendingReview,
					"Run must be waiting for workflow questions, outside human review",
				),
				steer_run: action(
					!!chat?.enabled && !!chat.available && !pendingReview,
					chat?.reason ?? "Workflow chat is unavailable",
				),
				retry_ticket_sync: action(
					!!run.ticketReference,
					"No originating ticket",
				),
			},
			next: "inspect_run",
		};
	}
	async call(name: string, input: unknown, scopes: readonly string[]) {
		const tool = operatorTools.find((t) => t.name === name);
		if (!tool) throw new OperatorError("not_found", "Operator tool not found");
		if (!scopes.includes(tool.scope))
			throw new OperatorError(
				"insufficient_scope",
				`This tool requires the ${tool.scope} capability`,
			);
		const parsed = tool.schema.safeParse(input);
		if (!parsed.success)
			throw new OperatorError(
				"invalid_request",
				"Arguments do not match the discoverable tool schema",
			);
		const args = parsed.data as any;
		if (name === "list_runs") {
			const runs = [...this.runtime.runs.values()]
				.filter(
					(r) =>
						(!args.status || r.status === args.status) &&
						(!args.repositoryId ||
							r.repositoryId === args.repositoryId ||
							r.repositories?.some((repo) => repo.id === args.repositoryId)),
				)
				.sort(
					(a, b) =>
						b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
				);
			return {
				instance: this.instance,
				runs: runs.slice(args.offset, args.offset + args.limit).map((r) => ({
					runId: r.id,
					title: this.text(r.title),
					status: r.status,
					step: r.step,
					updatedAt: r.updatedAt,
				})),
				offset: args.offset,
				limit: args.limit,
				nextOffset:
					args.offset + args.limit < runs.length
						? args.offset + args.limit
						: null,
			};
		}
		const run = this.run(args.runId);
		if (name === "inspect_run") {
			let mcp: any;
			if (this.hooks.mcp) {
				try {
					mcp = await this.hooks.mcp(run);
				} catch (error) {
					mcp = this.error(error, { runId: run.id });
				}
			}
			const state = this.inspect(run.id);
			return {
				...state,
				execution: {
					...state.execution,
					runner: mcp?.runner ?? state.execution.runner,
				},
				mcp,
			};
		}
		if (name === "read_run_activity") {
			const events = run.events.filter(
				(e) => e.source !== "agent" && !/^[\s]*[[{]/.test(e.message),
			);
			return {
				instance: this.instance,
				runId: run.id,
				offset: args.offset,
				limit: args.limit,
				activity: events
					.slice(args.offset, args.offset + args.limit)
					.map((e) => ({
						at: e.at,
						step: e.step,
						message: this.text(e.message),
					})),
				nextOffset:
					args.offset + args.limit < events.length
						? args.offset + args.limit
						: null,
			};
		}
		if (name === "inspect_mcp_connections") return this.hooks.mcp!(run);
		if (name === "check_mcp_connection")
			return this.hooks.check!(run, args.server);
		if (this.busy.has(run.id))
			throw new OperatorError(
				name === "update_mcp_connection"
					? "stale_configuration"
					: "stale_state",
				"Another operation is in progress. Wait for it to finish before inspecting again.",
			);
		this.busy.add(run.id);
		try {
			if (name === "update_mcp_connection")
				return {
					instance: this.instance,
					acceptedAction: name,
					...((await this.hooks.update!(run, args)) as object),
				};
			if (args.expectedRevision !== this.revision(run))
				throw new OperatorError(
					"stale_state",
					"Run changed. Inspect again before acting.",
				);
			const actions = this.inspect(run.id).actions as Record<
				string,
				{ available: boolean; reason?: string }
			>;
			if (!actions[name]?.available)
				throw new OperatorError(
					"invalid_state",
					actions[name]?.reason ?? "Action is unavailable",
				);
			if (name === "retry_run" || name === "resume_run") {
				// Detect a transport/authentication blocker before queueing another setup attempt.
				if (
					!run.setupComplete &&
					(run.ticketReference?.provider === "taskbot" ||
						/^https:\/\/[^/]+\/p\/[a-z0-9-]+\/t\/[1-9]\d*\/?$/.test(
							run.source ??
								run.launchRequest?.source ??
								run.launchRequest?.prompt ??
								run.input,
						))
				)
					await this.hooks.check!(run);
				// The asynchronous probe must not allow a stale mutation.
				if (args.expectedRevision !== this.revision(run))
					throw new OperatorError(
						"stale_state",
						"Run changed during connectivity check. Inspect again.",
					);
				this.retry(run.id);
			} else if (name === "retry_ticket_sync") await this.retryTracking(run.id);
			else if (name === "stop_run") this.stop(run.id);
			else if (name === "answer_run") {
				const displayed = this.inspect(run.id).questionContext;
				if (
					args.context.step !== displayed.step ||
					args.context.questionBatchId !== displayed.questionBatchId ||
					!isDeepStrictEqual(args.context.questions, displayed.questions)
				)
					throw new OperatorError(
						"stale_state",
						"The question batch changed. Inspect again before answering.",
					);
				this.answer(run.id, args.answer, args.kind, {
					step: run.step,
					questionBatchId: run.questionBatchId,
					questions: run.questions,
				});
			} else if (name === "steer_run") await this.steer(run.id, args.text);
			this.epochs.set(run.id, (this.epochs.get(run.id) ?? 0) + 1);
			return {
				instance: this.instance,
				acceptedAction: name,
				accepted: true,
				recoveryComplete: false,
				state: this.inspect(run.id),
				next: "inspect_run",
			};
		} finally {
			this.busy.delete(run.id);
		}
	}
	retry(id: string) {
		return this.runtime.retry(id);
	}
	stop(id: string) {
		return this.hooks.stop(id);
	}
	retryTracking(id: string) {
		return this.runtime.retryTracking(id);
	}
	answer(
		id: string,
		answer: string,
		kind?: "answer" | "explanation",
		context?: { step?: string; questionBatchId?: string; questions: string[] },
	) {
		const run = this.run(id);
		if (
			context &&
			(context.step !== run.step ||
				(context.questionBatchId !== undefined &&
					context.questionBatchId !== run.questionBatchId) ||
				!isDeepStrictEqual(context.questions, run.questions))
		)
			throw new OperatorError(
				"stale_state",
				"The question or step changed. Refresh before answering.",
			);
		this.runtime.answer(id, answer, kind);
	}
	async steer(id: string, text: string) {
		const state = this.hooks.chat?.(id);
		if (!state?.enabled || !state.available || !this.hooks.message)
			throw new OperatorError(
				"workflow_restriction",
				state?.reason ?? "Chat is disabled for this workflow",
			);
		const messageId = randomUUID();
		await this.hooks.message(id, text, messageId);
		return {
			message: this.runtime.recordChatMessage(
				id,
				text,
				state.step ?? "simple",
				messageId,
			),
			mode: state.mode,
		};
	}
}
