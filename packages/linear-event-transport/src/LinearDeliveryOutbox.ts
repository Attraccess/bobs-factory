import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ILogger } from "bobs-factory-core";
import { isLinearRateLimit, linearRetryAt } from "./LinearRequestBudget.js";

type Delivery<Input> = {
	id: string;
	input?: Input;
	status: "pending" | "delivered" | "superseded";
	attempts: number;
	nextAt: number;
	fingerprint?: string;
	createdAt?: number;
	ambiguous?: boolean;
	error?: string;
	activityId?: string;
};

export class LinearDeliveryPendingError extends Error {
	constructor(
		public readonly deliveryId: string,
		message: string,
	) {
		super(`Linear delivery ${deliveryId} pending: ${message}`);
	}
}

/** Durable activity delivery, separate from session/agent execution and ticket milestone ownership. */
export class LinearDeliveryOutbox<Input extends { id?: string | null }> {
	private static stores = new Map<string, unknown>();
	private owners = new Set<object>();
	private activeOwners = new Set<object>();
	private records: Delivery<Input>[];
	private flushing?: Promise<void>;
	private timer?: ReturnType<typeof setTimeout>;
	private readonly file: string;

	static open<Input extends { id?: string | null }>(
		home: string,
		workspaceId: string,
		owner: object,
		send: (input: Input) => Promise<{ success: boolean; id?: string }>,
		logger: ILogger,
		reconcile: (input: Input) => Promise<boolean>,
		retryAt: () => number,
		kind: "activity" | "comment",
		priority: (input: Input) => number,
		routine: (input: Input) => boolean,
	): LinearDeliveryOutbox<Input> {
		const key = `${resolve(home)}\0${workspaceId}\0${kind}`;
		let store = LinearDeliveryOutbox.stores.get(key) as
			| LinearDeliveryOutbox<Input>
			| undefined;
		if (!store) {
			store = new LinearDeliveryOutbox(
				home,
				workspaceId,
				send,
				logger,
				reconcile,
				retryAt,
				kind,
				priority,
				routine,
			);
			LinearDeliveryOutbox.stores.set(key, store);
		}
		store.send = send;
		store.reconcile = reconcile;
		store.retryAt = retryAt;
		store.owners.add(owner);
		return store;
	}

	private constructor(
		home: string,
		workspaceId: string,
		private send: (input: Input) => Promise<{ success: boolean; id?: string }>,
		private logger: ILogger,
		private reconcile: (input: Input) => Promise<boolean>,
		private retryAt: () => number,
		kind: "activity" | "comment",
		private priority: (input: Input) => number,
		private routine: (input: Input) => boolean,
	) {
		const directory = join(home, "state", `linear-${kind}-delivery`);
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		this.file = join(
			directory,
			`${createHash("sha256").update(workspaceId).digest("hex")}.json`,
		);
		try {
			const saved = JSON.parse(readFileSync(this.file, "utf8"));
			if (
				saved.version !== 1 ||
				!Array.isArray(saved.records) ||
				saved.records.some(
					(r: Delivery<Input>) =>
						!r.id ||
						!["pending", "delivered", "superseded"].includes(r.status) ||
						(r.status === "pending"
							? !r.input || typeof r.input !== "object"
							: !r.input && !r.fingerprint),
				)
			)
				throw new Error(
					"Invalid Linear delivery outbox; preserve and repair the saved file",
				);
			this.records = saved.records;
			for (const record of this.records) {
				if (record.input) record.fingerprint ??= this.fingerprint(record.input);
				if (record.status !== "pending") delete record.input;
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			this.records = [];
		}
	}

	async post(input: Input): Promise<{ success: boolean; id?: string }> {
		const fingerprint = this.fingerprint(input);
		let record = input.id
			? this.records.find((entry) => entry.id === input.id)
			: undefined;
		if (!input.id && this.routine(input)) {
			record = [...this.records]
				.reverse()
				.find(
					(entry) =>
						entry.fingerprint === fingerprint &&
						(entry.status === "pending" ||
							(entry.createdAt ?? 0) > Date.now() - 60_000),
				);
		}
		if (record && record.fingerprint !== fingerprint)
			throw new Error(
				"Linear delivery identity is already bound to different session/content",
			);
		if (!record) {
			const id = input.id ?? randomUUID();
			record = {
				id,
				input: { ...input, id },
				status: "pending",
				fingerprint,
				createdAt: Date.now(),
				attempts: 0,
				nextAt: Math.max(0, this.retryAt()),
			};
			this.records.push(record);
			this.save(); // The identity exists before any mutation is sent.
		}
		await this.flush();
		if (record.status !== "delivered")
			throw new LinearDeliveryPendingError(
				record.id,
				record.error ?? "queued for retry",
			);
		// Return a receipt without the SDK's lazy relationship getter.
		return { success: true, id: record.activityId };
	}

	status(): {
		pending: number;
		delivered: number;
		superseded: number;
		error?: string;
		nextAttemptAt?: number;
	} {
		const pending = this.records.filter((r) => r.status === "pending");
		return {
			pending: pending.length,
			delivered: this.records.filter((r) => r.status === "delivered").length,
			superseded: this.records.filter((r) => r.status === "superseded").length,
			...(pending[0]?.error ? { error: pending[0].error } : {}),
			...(pending.length
				? { nextAttemptAt: Math.min(...pending.map((r) => r.nextAt)) }
				: {}),
		};
	}

	start(owner: object): void {
		this.activeOwners.add(owner);
		void this.flush().catch((error) =>
			this.logger.error("Linear outbox recovery failed", error),
		);
	}
	stop(owner: object): void {
		this.activeOwners.delete(owner);
		this.owners.delete(owner);
		if (!this.activeOwners.size) {
			if (this.timer) clearTimeout(this.timer);
			this.timer = undefined;
		}
		if (!this.owners.size && !this.flushing)
			for (const [key, store] of LinearDeliveryOutbox.stores)
				if (store === this) LinearDeliveryOutbox.stores.delete(key);
	}

	flush(): Promise<void> {
		if (this.flushing) return this.flushing;
		this.flushing = this.drain().finally(() => {
			this.flushing = undefined;
			this.schedule();
			if (!this.owners.size)
				for (const [key, store] of LinearDeliveryOutbox.stores)
					if (store === this) LinearDeliveryOutbox.stores.delete(key);
		});
		return this.flushing;
	}

	private async drain(): Promise<void> {
		while (true) {
			const pending = this.records.filter((r) => r.status === "pending");
			const cooldown = this.retryAt();
			if (cooldown > Date.now()) {
				let changed = false;
				for (const record of pending) {
					if (record.nextAt >= cooldown) continue;
					record.nextAt = cooldown;
					changed = true;
				}
				if (changed) this.save();
				break;
			}
			const record = pending
				.filter((r) => r.nextAt <= Date.now())
				.sort((a, b) => this.priority(b.input!) - this.priority(a.input!))[0];
			if (!record) break;
			try {
				if (record.ambiguous && (await this.reconcile(record.input!))) {
					record.activityId = record.id;
					record.status = "delivered";
					delete record.input;
					delete record.error;
					this.save();
					continue;
				}
				record.attempts++;
				record.ambiguous = true; // A crash after send must reconcile before resending.
				this.save();
				const result = await this.send(record.input!);
				if (!result.success)
					throw new Error("Linear activity mutation returned success=false");
				record.activityId = result.id ?? record.id;
				record.status = "delivered";
				delete record.input;
				delete record.error;
				this.save();
			} catch (error) {
				if (isLinearRateLimit(error)) record.ambiguous = false; // Provider rejected the request before executing it.
				record.error =
					error instanceof Error ? error.message : "Linear request failed";
				record.nextAt = isLinearRateLimit(error)
					? linearRetryAt(error)
					: Date.now() +
						Math.min(300_000, 30_000 * 2 ** Math.min(record.attempts - 1, 4));
				this.save();
				this.logger.warn(
					`Linear activity delivery retained (${record.id}); next attempt ${new Date(record.nextAt).toISOString()}`,
				);
				if (isLinearRateLimit(error)) break;
			}
		}
	}

	private schedule(): void {
		if (!this.activeOwners.size || this.timer) return;
		const next = this.status().nextAttemptAt;
		if (next === undefined) return;
		this.timer = setTimeout(
			() => {
				this.timer = undefined;
				void this.flush().catch((error) =>
					this.logger.error("Linear outbox recovery failed", error),
				);
			},
			Math.max(1000, next - Date.now()),
		);
		this.timer.unref?.();
	}

	private save(): void {
		const temporary = `${this.file}.${randomUUID()}.tmp`;
		writeFileSync(
			temporary,
			JSON.stringify({ version: 1, records: this.records }),
			{ mode: 0o600 },
		);
		renameSync(temporary, this.file);
	}

	private fingerprint(input: Input): string {
		return createHash("sha256")
			.update(stableJson({ ...input, id: undefined }))
			.digest("hex");
	}
}

function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, child) =>
		child && typeof child === "object" && !Array.isArray(child)
			? Object.fromEntries(
					Object.entries(child).sort(([a], [b]) => a.localeCompare(b)),
				)
			: child,
	);
}
