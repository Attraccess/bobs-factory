import { createHash } from "node:crypto";
import type { IIssueTrackerService, McpServerConfig } from "cyrus-core";
import { z } from "zod";
import { issueSnapshot } from "./issueSnapshot.js";
import type { FactoryRun } from "./WorkflowRuntime.js";

export const TicketReferenceSchema = z
	.discriminatedUnion("provider", [
		z.object({
			provider: z.literal("native"),
			platform: z.string().min(1),
			workspaceId: z.string().min(1),
			id: z.string().min(1),
			url: z.string().url(),
		}),
		z.object({
			provider: z.literal("taskbot"),
			server: z.string().min(1),
			instance: z.string().url(),
			project: z.string().regex(/^[a-z0-9-]+$/),
			id: z.number().int().positive(),
			url: z.string().url(),
		}),
	])
	.superRefine((ref, context) => {
		if (
			ref.provider === "taskbot" &&
			ref.url !== `${ref.instance}/p/${ref.project}/t/${ref.id}`
		)
			context.addIssue({
				code: "custom",
				message:
					"Taskbot reference URL must match its verified instance, project and ID",
			});
	});
export type TicketReference = z.infer<typeof TicketReferenceSchema>;
export type TicketStage = "in_progress" | "in_review" | "done";
export interface TicketMilestone {
	key: string;
	body: string;
	stage?: TicketStage;
	pr?: string;
	merged?: boolean;
	delivered?: boolean;
	superseded?: boolean;
	error?: string;
	conflict?: boolean;
	limitation?: string;
}
export interface TicketSync {
	receipts: TicketMilestone[];
	lastStatus?: string;
	error?: string;
}
export interface TicketSnapshot {
	comments: { body: string }[];
	attachments: { url: string }[];
	[key: string]: unknown;
}
export interface TicketAdapter {
	read(): Promise<TicketSnapshot>;
	stage(
		stage: TicketStage,
		snapshot: TicketSnapshot,
	): Promise<string | undefined>;
	comment(body: string): Promise<void>;
	link(url: string): Promise<void>;
}

export function taskbotSource(
	source: string,
):
	| Omit<Extract<TicketReference, { provider: "taskbot" }>, "server">
	| undefined {
	let url: URL;
	try {
		url = new URL(source);
	} catch {
		return;
	}
	const match = url.pathname.match(/^\/p\/([a-z0-9-]+)\/t\/([1-9]\d*)\/?$/);
	if (
		!match ||
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		return;
	const id = Number(match[2]);
	if (!Number.isSafeInteger(id)) return;
	return {
		provider: "taskbot",
		instance: url.origin,
		project: match[1]!,
		id,
		url: `${url.origin}/p/${match[1]}/t/${id}`,
	};
}

/** Only launch instructions designate origins; never scan a fetched ticket or history. */
export function originatingTicket(
	prompt: string,
	source?: string,
): string | undefined {
	if (source && !source.startsWith("https://github.com/")) return source;
	let fenced = false;
	const candidates = new Set<string>();
	for (const line of prompt.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (fenced || /^\s*>/.test(line)) continue;
		const match = line
			.trim()
			.match(
				/^(?:(task(?: source)?|ticket|source(?: of truth)?)\s*:\s*)?(https?:\/\/\S+)\s*$/i,
			);
		const value = match?.[2];
		if (
			value &&
			!value.startsWith("https://github.com/") &&
			(match?.[1] ||
				taskbotSource(value) ||
				/\/p\/[^/]+\/t\//.test(value) ||
				/^https:\/\/linear\.app\/[^/]+\/issue\//.test(value))
		)
			candidates.add(value);
	}
	if (candidates.size > 1)
		throw new Error(
			"Multiple originating tickets in launch instructions. Supply one explicit ticket source before starting work.",
		);
	return [...candidates][0];
}

/** Bind HTTP Taskbot to the URL's actual instance, not a same-numbered ticket. */
export function taskbotServer(
	instance: string,
	servers: Record<string, McpServerConfig>,
): string {
	const matches = Object.entries(servers).filter(([, config]) => {
		if (!("url" in config) || !config.url) return false;
		try {
			return new URL(config.url).origin === instance;
		} catch {
			return false;
		}
	});
	if (matches.length !== 1)
		throw new Error(
			`Ticket tracking needs exactly one configured MCP HTTP/SSE transport for ${instance}; found ${matches.length}. Configure its instance URL and allowed Taskbot tools.`,
		);
	return matches[0]![0];
}

export function mcpValue(value: unknown): unknown {
	if (!value || typeof value !== "object") return value;
	const result = value as {
		isError?: boolean;
		structuredContent?: unknown;
		content?: { type: string; text?: string }[];
	};
	if (result.isError)
		throw new Error(
			`Ticket MCP operation failed: ${JSON.stringify(result.content)}`,
		);
	if (result.structuredContent !== undefined)
		return mcpValue(result.structuredContent);
	if (result.content) {
		const text = result.content
			.filter((item) => item.type === "text")
			.map((item) => item.text ?? "")
			.join("\n");
		try {
			return JSON.parse(text);
		} catch {
			throw new Error(
				`Ticket MCP returned invalid JSON: ${text.slice(0, 300)}`,
			);
		}
	}
	return value;
}
class StatusConflict extends Error {}
export function taskbotAdapter(
	ref: Extract<TicketReference, { provider: "taskbot" }>,
	call: (tool: string, args: Record<string, unknown>) => Promise<unknown>,
): TicketAdapter {
	const args = { project: ref.project, id: ref.id };
	const invoke = async (tool: string, extra: Record<string, unknown> = {}) => {
		const result = await call(tool, { ...args, ...extra });
		if (tool === "get_ticket") return mcpValue(result);
		if (
			result &&
			typeof result === "object" &&
			((result as { isError?: boolean }).isError ||
				(result as { error?: unknown }).error)
		)
			throw new Error(`Taskbot ${tool} failed: ${JSON.stringify(result)}`);
		return result;
	};
	const read = async (): Promise<TicketSnapshot> => {
		const raw = await invoke("get_ticket");
		const ticket = z
			.object({
				id: z.literal(ref.id),
				status: z.enum([
					"backlog",
					"todo",
					"in_progress",
					"in_review",
					"done",
					"cancelled",
				]),
				comments: z.array(z.object({ body: z.string() }).passthrough()),
				attachments: z.array(z.object({ url: z.string() }).passthrough()),
			})
			.passthrough()
			.parse(raw);
		// Taskbot's get_ticket is an unpaginated full-ticket contract. Reject a
		// partial implementation rather than silently losing provider records.
		if (
			ticket.nextOffset != null ||
			ticket.has_more === true ||
			ticket.next_cursor != null
		)
			throw new Error(
				"Taskbot get_ticket returned partial context; full-ticket transport required",
			);
		if (ticket.project != null && ticket.project !== ref.project)
			throw new Error("Taskbot returned another project");
		return { ...ticket, url: ref.url };
	};
	return {
		read,
		async stage(to, snapshot) {
			if (["done", "cancelled"].includes(String(snapshot.status)))
				return snapshot.status === to
					? undefined
					: "Terminal ticket retained; verify ownership before changing it.";
			if (snapshot.status === to) return undefined;
			try {
				await invoke("set_status", {
					from: snapshot.status,
					to,
					author: "bobs-factory",
				});
			} catch (error) {
				const current = await read();
				if (current.status === to) return undefined;
				if (
					current.status === snapshot.status &&
					!/conflict|compare.and.swap/i.test(String(error))
				)
					throw error;
				throw new StatusConflict(
					`Taskbot status update uncertain or conflicted (${snapshot.status} → ${current.status}); expected ${to}. Reassess current ticket, then retry ticket synchronization. ${String(error)}`,
				);
			}
			return undefined;
		},
		async comment(body) {
			await invoke("comment", { author: "bobs-factory", body });
		},
		async link(url) {
			await invoke("add_attachment", {
				kind: "pr",
				url,
				// Taskbot add_attachment has no author field. The accompanying
				// milestone comment records bobs-factory attribution.
				title: "Factory pull request",
			});
		},
	};
}

export function nativeAdapter(
	ref: Extract<TicketReference, { provider: "native" }>,
	tracker: IIssueTrackerService,
): TicketAdapter {
	return {
		async read() {
			const issue = await tracker.fetchIssue(ref.id);
			return (await issueSnapshot(
				issue,
				await tracker.getIssueLabels(issue.id),
				tracker,
			)) as TicketSnapshot;
		},
		async stage(stage, snapshot) {
			const state = snapshot.state as
				| { name?: string; type?: string }
				| undefined;
			if (["completed", "canceled"].includes(state?.type ?? ""))
				return stage === "done" && state?.type === "completed"
					? undefined
					: "Terminal ticket retained; verify ownership before changing it.";
			const team = snapshot.team as { id?: string } | undefined;
			if (!team?.id)
				throw new Error("Originating ticket has no team for status resolution");
			const states = [];
			let after: string | undefined;
			const seen = new Set<string>();
			do {
				const page = await tracker.fetchWorkflowStates(team.id, {
					first: 100,
					...(after ? { after } : {}),
				});
				states.push(...page.nodes);
				if (!page.pageInfo?.hasNextPage) break;
				after = page.pageInfo.endCursor ?? undefined;
				if (!after || seen.has(after))
					throw new Error("Ticket state pagination did not advance");
				seen.add(after);
			} while (after);
			const selected = states.find((s) =>
				stage === "done"
					? s.type === "completed"
					: s.type === "started" &&
						(stage === "in_review"
							? /review/i.test(s.name)
							: !/review/i.test(s.name)),
			);
			if (!selected)
				return `Tracker has no ${stage} state; retained nonterminal status. Lifecycle stage is recorded in this comment.`;
			if (state?.name !== selected.name)
				await tracker.updateIssue(ref.id, { stateId: selected.id });
			return undefined;
		},
		async comment(body) {
			await tracker.createComment(ref.id, { body });
		},
		async link(url) {
			if (!tracker.linkPullRequest)
				throw new Error(
					"Tracker does not support PR links; restore a supported tracker adapter",
				);
			await tracker.linkPullRequest(ref.id, url, "Factory pull request");
		},
	};
}

/** Durable outbox. Errors are visible but do not replay development or merge. */
export class TicketTracking {
	private queues = new Map<string, Promise<void>>();
	private stopped = false;
	private retries = new Map<string, ReturnType<typeof setTimeout>>();
	stop(): void {
		this.stopped = true;
		for (const timer of this.retries.values()) clearTimeout(timer);
		this.retries.clear();
	}
	constructor(
		private adapter: (run: FactoryRun) => Promise<TicketAdapter>,
		private save: (run: FactoryRun) => void,
		private log: (run: FactoryRun, message: string) => void,
	) {}
	async record(run: FactoryRun, milestone: TicketMilestone): Promise<void> {
		if (!run.ticketReference || run.workflow.id === "simple") return;
		if (milestone.stage === "done" && !milestone.merged)
			throw new Error("Done requires a confirmed merge receipt");
		run.ticketSync ??= { receipts: [] };
		const sync = run.ticketSync;
		if (!sync.receipts.some((r) => r.key === milestone.key)) {
			if (milestone.stage)
				for (const r of sync.receipts)
					if (!r.delivered && r.stage) r.superseded = true;
			sync.receipts.push({ ...milestone });
			this.save(run);
		}
		await this.flush(run);
	}
	async flush(run: FactoryRun, reassess = false): Promise<void> {
		if (!run.ticketReference || !run.ticketSync) return;
		const ref = TicketReferenceSchema.parse(run.ticketReference);
		const ticketKey =
			ref.provider === "taskbot"
				? `${ref.instance}/${ref.project}/${ref.id}`
				: `${ref.workspaceId}/${ref.id}`;
		const previous = this.queues.get(ticketKey) ?? Promise.resolve();
		const work = previous
			.catch(() => {})
			.then(async () => {
				const sync = run.ticketSync!;
				for (const receipt of sync.receipts) {
					if (
						receipt.delivered ||
						receipt.superseded ||
						(receipt.conflict && !reassess)
					)
						continue;
					try {
						const adapter = await this.adapter(run);
						let snapshot = await adapter.read();
						const statusOf = (snapshot: TicketSnapshot) =>
							String(
								snapshot.status ??
									(snapshot.state as { name?: string } | undefined)?.name ??
									"",
							);
						const terminal =
							["done", "cancelled"].includes(String(snapshot.status)) ||
							["completed", "canceled"].includes(
								String((snapshot.state as { type?: string } | undefined)?.type),
							);
						if (
							receipt.stage &&
							!reassess &&
							sync.lastStatus &&
							sync.lastStatus !== statusOf(snapshot) &&
							!terminal &&
							snapshot.status !== receipt.stage
						)
							throw new StatusConflict(
								`Ticket status changed outside this run (${sync.lastStatus} → ${statusOf(snapshot)}). Reassess ownership and intent before retrying ticket synchronization.`,
							);
						if (
							receipt.pr &&
							!snapshot.attachments.some(
								(a) => canonicalPr(a.url) === canonicalPr(receipt.pr!),
							)
						) {
							await adapter.link(receipt.pr);
							snapshot = await adapter.read();
						}
						const marker = `<!-- factory:${run.id}:${createHash("sha256").update(receipt.key).digest("hex").slice(0, 20)} -->`;
						if (!snapshot.comments.some((c) => c.body.includes(marker))) {
							// A merge supersedes earlier stages even when an older request resumes.
							const merged = sync.receipts.some(
								(r) => r.merged && !r.superseded,
							);
							receipt.limitation =
								receipt.stage && (!merged || receipt.merged)
									? await adapter.stage(receipt.stage, snapshot)
									: undefined;
							sync.lastStatus = statusOf(await adapter.read());
							this.save(run);
							await adapter.comment(
								`${receipt.body}${receipt.limitation ? `\n\nTracking limitation: ${receipt.limitation}` : ""}\n\n${marker}`,
							);
						}
						receipt.delivered = true;
						delete receipt.error;
						delete receipt.conflict;
					} catch (error) {
						receipt.error =
							error instanceof Error ? error.message : String(error);
						receipt.conflict = error instanceof StatusConflict;
						if (sync.error !== receipt.error)
							this.log(
								run,
								`Ticket synchronization pending (${receipt.key}): ${receipt.error}. Retry ticket synchronization after restoring access or reassessing the conflict; completed work is retained.`,
							);
						break;
					} finally {
						sync.error = sync.receipts.find(
							(r) => !r.delivered && !r.superseded && r.error,
						)?.error;
						this.save(run);
					}
				}
			});
		this.queues.set(ticketKey, work);
		await work;
		const pending = run.ticketSync.receipts.find(
			(r) => !r.delivered && !r.superseded && r.error,
		);
		if (
			pending &&
			!this.stopped &&
			!pending.conflict &&
			!this.retries.has(run.id)
		) {
			const timer = setTimeout(() => {
				this.retries.delete(run.id);
				void this.flush(run);
			}, 30000);
			timer.unref();
			this.retries.set(run.id, timer);
		}
		if (this.queues.get(ticketKey) === work) this.queues.delete(ticketKey);
	}
}
export function canonicalPr(url: string): string {
	return url.replace(/\/$/, "").toLowerCase();
}

/** Reconciliation needs provider evidence and a proven association, never status alone. */
export function classifyTicketRepair(input: {
	associated: boolean;
	deferred?: boolean;
	runStatus?: FactoryRun["status"];
	step?: string;
	pr?: { state: string; mergedAt?: string | null };
}): { stage?: TicketStage; reason: string } {
	if (!input.associated)
		return {
			reason: "No proven run/PR association; retain current ticket status.",
		};
	if (input.pr?.state === "MERGED" && input.pr.mergedAt)
		return {
			stage: "done",
			reason: "GitHub confirms the associated coding PR merged.",
		};
	if (input.pr?.state === "CLOSED")
		return {
			reason:
				"Associated PR closed without merge; remaining work requires reassessment.",
		};
	if (input.deferred)
		return {
			reason:
				"Work is explicitly deferred and has no confirmed merge; retain backlog.",
		};
	if (
		input.pr?.state === "OPEN" &&
		/(?:human-review|merge)$/.test(input.step ?? "")
	)
		return {
			stage: "in_review",
			reason: "Waiting for human/provider action; merge is not confirmed.",
		};
	if (
		["running", "waiting", "failed", "interrupted"].includes(
			input.runStatus ?? "",
		)
	)
		return {
			stage: "in_progress",
			reason: "Active, corrective or blocked work is nonterminal.",
		};
	return {
		reason: "No verified coding completion or active work; retain open status.",
	};
}
