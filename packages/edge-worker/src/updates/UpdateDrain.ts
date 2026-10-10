import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { WorkflowRuntime } from "../factory/WorkflowRuntime.js";
import type { CapacitySnapshot, MachineCapacity } from "../MachineCapacity.js";
import { UpdateManager } from "./UpdateManager.js";

/** Durable intake freeze is distinct from the final capacity admission barrier:
 * already accepted work may acquire its next role while draining. Only after
 * all work/leases are idle do we close capacity admission under its own lock.
 */
export class UpdateDrain {
	readonly file: string;
	private intake = new Set<object>();
	enter(request: object) {
		this.intake.add(request);
	}
	leave(request: object) {
		this.intake.delete(request);
	}
	constructor(
		readonly home: string,
		private readonly runtime: WorkflowRuntime,
		private readonly capacity: MachineCapacity,
		private readonly busy: () => boolean,
		private readonly resume: () => void,
		private readonly nativeSessions: () => unknown = () => [],
		private readonly freezeBackground: (active: boolean) => void = () => {},
	) {
		this.file = join(home, "updates", "maintenance.json");
		if (this.active()) this.freezeBackground(true);
	}
	active(): boolean {
		return existsSync(this.file);
	}
	private transaction() {
		const id = JSON.parse(readFileSync(this.file, "utf8")).transactionId;
		if (typeof id !== "string")
			throw new Error("Malformed update maintenance marker");
		return id;
	}
	private persistedTransaction(transactionId: string) {
		const fence = join(this.home, "runtime", "update-owner.json");
		if (existsSync(fence)) {
			const owner = JSON.parse(readFileSync(fence, "utf8"));
			if (
				owner.transactionId === transactionId &&
				owner.product === "bobs-factory-desktop"
			)
				return new UpdateManager(join(this.home, "desktop")).status()
					.transaction;
		}
		return new UpdateManager(this.home).status().transaction;
	}
	async begin(transactionId: string) {
		const transaction = this.persistedTransaction(transactionId);
		if (
			!transaction ||
			transaction.id !== transactionId ||
			["succeeded", "rolled-back", "cancelled"].includes(transaction.phase)
		)
			throw new Error(
				"Maintenance requires the exact persisted update transaction",
			);
		if (this.active()) {
			if (this.transaction() !== transactionId)
				throw new Error("Another transaction owns maintenance");
			return;
		}
		mkdirSync(join(this.home, "updates"), { recursive: true, mode: 0o700 });
		this.freezeBackground(true);
		writeFileSync(this.file, JSON.stringify({ transactionId }), {
			flag: "wx",
			mode: 0o600,
			flush: true,
		});
	}
	receipt() {
		const records = [...this.runtime.runs.values()]
			.map((run) => ({
				id: run.id,
				workspace: run.workspace,
				workflow: run.workflow,
				workflowDefinitions: run.workflowDefinitions,
				checkpoint: run.checkpoint,
				outputs: run.outputs,
				answers: run.answers,
				reviewGate: run.reviewGate,
				humanDecisions: run.humanDecisions,
				questionBatchId: run.questionBatchId,
				questions: run.questions,
				questionRecommendations: run.questionRecommendations,
				executionSnapshot: run.executionSnapshot,
				delivery: run.delivery,
				ticketSync: run.ticketSync,
			}))
			.sort((a, b) => a.id.localeCompare(b.id));
		return {
			preservedStateSha256: createHash("sha256")
				.update(
					JSON.stringify({
						records,
						nativeSessions: this.nativeSessions(),
						workflows: this.runtime.listWorkflows(),
						defaultWorkflow: this.runtime.getDefaultWorkflow(),
						titles: this.runtime.getTitleSettings(),
						executionProfiles: this.runtime.executionProfiles.read(),
						config: ["config.json", ".env"].map((file) =>
							existsSync(join(this.home, file))
								? createHash("sha256")
										.update(readFileSync(join(this.home, file)))
										.digest("hex")
								: null,
						),
					}),
				)
				.digest("hex"),
			runIds: records.map((record) => record.id),
		};
	}
	async inspect() {
		if (!this.active())
			throw new Error("Freeze intake before inspecting update drain");
		if (this.busy() || this.intake.size)
			return {
				idle: false,
				reason: "Accepted work is still executing",
				...this.receipt(),
			};
		let capacity: CapacitySnapshot;
		try {
			capacity = await this.capacity.pauseAdmissionsForUpdate(
				this.transaction(),
			);
		} catch (error) {
			return {
				idle: false,
				reason: (error as Error).message,
				...this.receipt(),
			};
		}
		// No more capacity leases can be admitted once this returns. In-process
		// webhook/workflow observations are checked again after the awaited barrier.
		return {
			idle:
				!this.busy() &&
				this.intake.size === 0 &&
				!capacity.error &&
				capacity.active === 0 &&
				capacity.stopping === 0,
			capacity: {
				active: capacity.active,
				stopping: capacity.stopping,
				queued: capacity.queued,
				error: capacity.error,
			},
			...this.receipt(),
		};
	}
	async end(transactionId: string) {
		if (!this.active()) return;
		if (this.transaction() !== transactionId)
			throw new Error("Maintenance transaction mismatch");
		const transaction = this.persistedTransaction(transactionId);
		const phase =
			transaction?.release?.status === "pending"
				? transaction.release.outcome
				: transaction?.phase;
		if (
			transaction?.id !== transactionId ||
			!phase ||
			!["succeeded", "rolled-back", "cancelled"].includes(phase)
		)
			throw new Error("Finish health/rollback before releasing maintenance");
		await this.capacity.resumeAdmissionsAfterUpdate(transactionId);
		unlinkSync(this.file);
		this.freezeBackground(false);
		this.resume();
	}
}
