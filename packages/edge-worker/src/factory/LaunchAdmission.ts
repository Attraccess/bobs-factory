import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
	AgentSessionCreatedWebhook,
	WorkflowTriggerOrigin,
} from "bobs-factory-core";
import type { Workflow } from "./Workflow.js";

export interface TicketLaunchReceipt {
	key: string;
	issueKey: string;
	sessionId: string;
	phase: "pending" | "starting" | "started" | "recovery" | "settled";
	webhook: AgentSessionCreatedWebhook;
	origin: WorkflowTriggerOrigin;
	commentBody?: string | null;
	launch?: {
		nativePreferences?: import("./AgentSettings.js").AgentSettings;
		workflow: Workflow;
		workflowDefinitions: Workflow[];
		selectionMethod: NonNullable<WorkflowTriggerOrigin["selectionMethod"]>;
	};
}

/** A local atomic receipt journal, deliberately independent of repository aliases.
 * Reservation is synchronous and durable before any async setup starts. #36 can
 * replace the single-owner policy without changing receipts or launch intent. */
export class LaunchAdmission {
	private path: string;
	private state: {
		launches: Record<string, TicketLaunchReceipt>;
		prompts: Record<string, "pending" | "delivered">;
	};
	constructor(home: string) {
		const directory = join(home, "factory");
		mkdirSync(directory, { recursive: true });
		this.path = join(directory, "ticket-deliveries.json");
		this.state = existsSync(this.path)
			? JSON.parse(readFileSync(this.path, "utf8"))
			: { launches: {}, prompts: {} };
	}
	static issueKey(provider: string, workspace: string, issue: string): string {
		return JSON.stringify([provider, workspace, issue]);
	}
	private key(workspace: string, session: string): string {
		return JSON.stringify([workspace, session]);
	}
	get(workspace: string, session: string): TicketLaunchReceipt | undefined {
		return this.state.launches[this.key(workspace, session)];
	}
	values(): TicketLaunchReceipt[] {
		return Object.values(this.state.launches);
	}
	reserve(
		input: Omit<TicketLaunchReceipt, "key" | "phase">,
		active: (receipt: TicketLaunchReceipt) => boolean,
	):
		| { type: "accepted"; receipt: TicketLaunchReceipt }
		| { type: "duplicate"; receipt: TicketLaunchReceipt }
		| { type: "busy"; sessionId: string } {
		const key = this.key(input.origin.ticket!.workspaceId, input.sessionId);
		const previous = this.state.launches[key];
		if (previous) return { type: "duplicate", receipt: previous };
		const owner = this.values().find(
			(item) =>
				item.issueKey === input.issueKey &&
				item.phase !== "settled" &&
				active(item),
		);
		const receipt: TicketLaunchReceipt = {
			...structuredClone(input),
			key,
			phase: owner ? "settled" : "pending",
		};
		this.state.launches[key] = receipt;
		this.save();
		if (owner) return { type: "busy", sessionId: owner.sessionId };
		return { type: "accepted", receipt };
	}
	update(
		receipt: TicketLaunchReceipt,
		patch: Partial<TicketLaunchReceipt>,
	): void {
		Object.assign(receipt, patch);
		this.save();
	}
	beginPrompt(
		workspace: string,
		session: string,
		activity: string,
	): "new" | "pending" | "delivered" {
		const key = JSON.stringify([workspace, session, activity]);
		const previous = this.state.prompts[key];
		if (previous) return previous;
		this.state.prompts[key] = "pending";
		this.save();
		return "new";
	}
	finishPrompt(workspace: string, session: string, activity: string): void {
		this.state.prompts[JSON.stringify([workspace, session, activity])] =
			"delivered";
		this.save();
	}
	private save(): void {
		const temp = `${this.path}.tmp`;
		writeFileSync(temp, JSON.stringify(this.state, null, 2));
		renameSync(temp, this.path);
	}
}
