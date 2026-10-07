import { randomUUID } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import webPush from "web-push";
import { z } from "zod";
import {
	digest,
	type PushEvent,
	type PushSession,
	runPushEvent,
	sessionPushEvent,
} from "./PushEvents.js";
import {
	type PushSender,
	SubscriptionSchema,
	sendPush,
} from "./PushTransport.js";
import type { WorkflowRuntime } from "./WorkflowRuntime.js";

const DeviceSchema = z.object({
	id: z.string().uuid(),
	label: z.string().min(1).max(80),
	subscription: SubscriptionSchema,
	enabled: z.boolean(),
	generation: z.number().int().nonnegative(),
	registeredAt: z.number(),
	health: z.enum([
		"untested",
		"accepted",
		"degraded",
		"authentication",
		"rate-limited",
	]),
	failures: z.number().int().nonnegative(),
	backoffUntil: z.number(),
	lastTestAt: z.number().optional(),
	lastAttemptAt: z.number().optional(),
});
const StoreSchema = z.object({
	version: z.literal(1),
	vapid: z.object({
		subject: z.string().refine(validSubject),
		publicKey: z.string(),
		privateKey: z.string(),
	}),
	devices: z.array(DeviceSchema).max(32),
	runs: z.record(
		z.string(),
		z.object({
			identity: z.string(),
			sequence: z.number().int().nonnegative(),
		}),
	),
	receipts: z
		.array(
			z.object({
				device: z.string(),
				event: z.string(),
				at: z.number(),
				outcome: z.enum(["claimed", "skipped", "accepted", "failed"]),
			}),
		)
		.max(2048),
});
function validSubject(value: string) {
	try {
		const u = new URL(value);
		return u.protocol === "mailto:"
			? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.pathname)
			: u.protocol === "https:" && !!u.hostname && !u.username && !u.password;
	} catch {
		return false;
	}
}
const categoryText = {
	question: "New questions need your answer.",
	review: "A new review needs your approval.",
	failure: "A run needs your help.",
	blocker: "A run needs a decision.",
	completion: "A run completed successfully.",
	test: "Test notification. Open Factory to check current state.",
};
interface Pending {
	runId: string;
	event: PushEvent;
	id: string;
	devices: { id: string; generation: number }[];
}
export interface PushSource {
	sessions(): PushSession[];
	subscribe(listener: (id: string) => void): () => void;
}
/** One worker-owned sender; persisted claims are never retried after a crash or recovery. */
export class FactoryPush {
	private store?: z.infer<typeof StoreSchema>;
	private diagnostic =
		"Push is not configured. Set CYRUS_FACTORY_PUSH_SUBJECT to a contact mailto: or HTTPS URL.";
	private readonly path: string;
	private readonly pending = new Map<string, Pending>();
	private timer?: ReturnType<typeof setTimeout>;
	private stopped = false;
	private active = new Set<Promise<void>>();
	private detach: (() => void)[] = [];
	constructor(
		home: string,
		private readonly sender: PushSender = sendPush,
		private readonly now = Date.now,
		subject = process.env.CYRUS_FACTORY_PUSH_SUBJECT,
	) {
		this.path = join(home, "factory", "push.json");
		try {
			if (existsSync(this.path)) {
				this.store = StoreSchema.parse(
					JSON.parse(readFileSync(this.path, "utf8")),
				);
				// Verify persisted keys rather than silently replacing subscriptions' identity.
				webPush.getVapidHeaders(
					"https://fcm.googleapis.com",
					this.store.vapid.subject,
					this.store.vapid.publicKey,
					this.store.vapid.privateKey,
					"aes128gcm",
				);
			} else if (subject && validSubject(subject)) {
				this.store = {
					version: 1,
					vapid: { subject, ...webPush.generateVAPIDKeys() },
					devices: [],
					runs: {},
					receipts: [],
				};
			}
			if (this.store) {
				this.persist();
				chmodSync(this.path, 0o600);
			}
		} catch {
			this.disableStore();
		}
	}
	private disableStore() {
		this.store = undefined;
		this.diagnostic =
			"Push storage is invalid or unavailable. Repair factory/push.json and restart; Factory remains usable.";
		this.pending.clear();
	}
	private persist() {
		if (!this.store) throw new Error(this.diagnostic);
		try {
			mkdirSync(join(this.path, ".."), { recursive: true });
			const temporary = `${this.path}.tmp`;
			writeFileSync(temporary, JSON.stringify(this.store), { mode: 0o600 });
			chmodSync(temporary, 0o600);
			renameSync(temporary, this.path);
		} catch {
			this.disableStore();
			throw new Error(this.diagnostic);
		}
	}
	status() {
		return {
			available: !!this.store && !this.stopped,
			publicKey: this.store?.vapid.publicKey,
			diagnostic: this.store ? undefined : this.diagnostic,
			devices: (this.store?.devices ?? []).map(
				({
					id,
					label,
					enabled,
					health,
					registeredAt,
					lastAttemptAt,
					backoffUntil,
				}) => ({
					id,
					label,
					enabled,
					health,
					registeredAt,
					lastAttemptAt,
					backoffUntil,
				}),
			),
		};
	}
	private requireStore() {
		if (!this.store || this.stopped) throw new Error(this.diagnostic);
		return this.store;
	}
	register(input: unknown) {
		const { label, subscription } = z
			.object({
				label: z.string().trim().min(1).max(80),
				subscription: SubscriptionSchema,
			})
			.parse(input);
		const store = this.requireStore();
		let device = store.devices.find(
			(d) => d.subscription.endpoint === subscription.endpoint,
		);
		if (device) {
			// Registration is an explicit opt-in. A foreground reconciliation never calls this API.
			if (
				!device.enabled ||
				digest(device.subscription) !== digest(subscription)
			)
				device.generation++;
			device.enabled = true;
			device.label = label;
			device.subscription = subscription;
		} else {
			if (store.devices.length >= 32)
				throw new Error(
					"Remove an old device before adding another (limit 32).",
				);
			device = {
				id: randomUUID(),
				label,
				subscription,
				enabled: true,
				generation: 1,
				registeredAt: this.now(),
				health: "untested",
				failures: 0,
				backoffUntil: 0,
			};
			store.devices.push(device);
		}
		this.persist();
		return { id: device.id };
	}
	update(id: string, input: unknown) {
		const update = z
			.object({
				label: z.string().trim().min(1).max(80).optional(),
				enabled: z.literal(false).optional(),
			})
			.strict()
			.parse(input);
		const device = this.requireStore().devices.find((d) => d.id === id);
		if (!device) throw new Error("Device not found");
		if (update.label) device.label = update.label;
		if (update.enabled === false) {
			device.enabled = false;
			device.generation++;
		}
		this.persist();
		return { ok: true };
	}
	remove(id: string) {
		const store = this.requireStore();
		store.devices = store.devices.filter((d) => d.id !== id);
		this.persist();
		return { ok: true };
	}
	attach(runtime: WorkflowRuntime, source: PushSource) {
		if (this.detach.length) throw new Error("Push observer already attached");
		const snapshot = () => {
			const events = new Map<string, PushEvent | undefined>();
			for (const run of runtime.runs.values())
				events.set(run.id, runPushEvent(run));
			for (const session of source.sessions())
				if (!runtime.runs.has(session.id))
					events.set(session.id, sessionPushEvent(session));
			return events;
		};
		// Even changed attention during downtime becomes a baseline, never a recovery backlog.
		this.observe(snapshot(), true);
		const observe = () => {
			if (!runtime.isShuttingDown()) this.observe(snapshot());
		};
		this.detach.push(runtime.subscribe(observe), source.subscribe(observe));
	}
	observe(events: Map<string, PushEvent | undefined>, baseline = false) {
		if (!this.store || this.stopped) return;
		try {
			let changed = false;
			for (const [runId, event] of events) {
				const identity = event ? `${event.category}:${event.identity}` : "";
				const previous = this.store.runs[runId];
				if (previous?.identity === identity) continue;
				const sequence = (previous?.sequence ?? 0) + 1;
				this.store.runs[runId] = { identity, sequence };
				changed = true;
				if (baseline || !event) {
					this.pending.delete(runId);
					continue;
				}
				const id = digest([runId, sequence]);
				const enabled = this.store.devices.filter((d) => d.enabled);
				const devices = enabled
					.filter((d) => d.backoffUntil <= this.now())
					.map((d) => ({ id: d.id, generation: d.generation }));
				// Coalescing replaces unsent work. It is already durably consumed and never replayed.
				const pending = { runId, event, id, devices };
				if (this.pending.size < 64 || this.pending.has(runId))
					this.pending.set(runId, pending);
				for (const device of enabled) this.receipt(device.id, id, "skipped");
			}
			if (changed) this.persist();
			if (this.pending.size && !this.timer)
				this.timer = setTimeout(() => {
					this.timer = undefined;
					this.pump();
				}, 750);
		} catch {
			/* Push persistence must not throw into run/session saves. */
		}
	}
	private receipt(
		device: string,
		event: string,
		outcome: "claimed" | "skipped" | "accepted" | "failed",
	) {
		const store = this.requireStore();
		store.receipts.push({ device, event, at: this.now(), outcome });
		store.receipts = store.receipts.slice(-2048);
	}
	private pump() {
		if (this.stopped || !this.store) return;
		while (this.active.size < 2 && this.pending.size) {
			const [key, next] = this.pending.entries().next().value!;
			this.pending.delete(key);
			const task = this.deliver(next)
				.catch(() => {})
				.finally(() => {
					this.active.delete(task);
					this.pump();
				});
			this.active.add(task);
		}
	}
	private async deliver(pending: Pending, test = false) {
		for (const target of pending.devices) {
			const store = this.store;
			const device = store?.devices.find((d) => d.id === target.id);
			if (
				!store ||
				this.stopped ||
				!device?.enabled ||
				device.generation !== target.generation ||
				(!test && device.backoffUntil > this.now())
			)
				continue;
			this.receipt(device.id, pending.id, "claimed");
			device.lastAttemptAt = this.now();
			this.persist();
			const payload = JSON.stringify({
				version: 1,
				category: pending.event.category,
				runId: pending.runId,
				eventId: pending.id,
				destination: pending.event.destination,
				title: "Bob’s Factory",
				body: categoryText[pending.event.category],
				tag: `factory-${digest(pending.runId).slice(0, 32)}`,
			});
			let timeout: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					this.sender(
						device.subscription,
						payload,
						store.vapid,
						digest(pending.runId).slice(0, 32),
					),
					new Promise<never>((_, reject) => {
						timeout = setTimeout(() => reject(new Error("Push timeout")), 6000);
					}),
				]);
				if (
					this.store !== store ||
					!store.devices.includes(device) ||
					device.generation !== target.generation
				)
					continue;
				device.health = "accepted";
				device.failures = 0;
				device.backoffUntil = 0;
				this.receipt(device.id, pending.id, "accepted");
			} catch (error) {
				if (
					this.store !== store ||
					!store.devices.includes(device) ||
					device.generation !== target.generation
				)
					continue;
				const status = (error as { statusCode?: number }).statusCode;
				if (status === 404 || status === 410)
					store.devices = store.devices.filter((d) => d !== device);
				else {
					device.failures++;
					device.health =
						status === 401 || status === 403
							? "authentication"
							: status === 429
								? "rate-limited"
								: "degraded";
					device.backoffUntil =
						this.now() +
						Math.min(3600000, 30000 * 2 ** Math.min(device.failures - 1, 7));
				}
				this.receipt(device.id, pending.id, "failed");
			} finally {
				if (timeout) clearTimeout(timeout);
			}
			if (this.store) this.persist();
		}
	}
	async test(id: string) {
		const device = this.requireStore().devices.find((d) => d.id === id);
		if (!device?.enabled)
			throw new Error("Enable this device before sending a test");
		if (
			device.lastTestAt !== undefined &&
			this.now() - device.lastTestAt < 30000
		)
			throw new Error("Wait 30 seconds between tests");
		if (this.active.size >= 2)
			throw new Error("Push sender is busy; try again shortly");
		device.lastTestAt = this.now();
		this.persist();
		const task = this.deliver(
			{
				runId: "test",
				id: randomUUID(),
				event: { category: "test", identity: "test", destination: "/#/" },
				devices: [{ id, generation: device.generation }],
			},
			true,
		);
		this.active.add(task);
		try {
			await task;
		} finally {
			this.active.delete(task);
			this.pump();
		}
		const current = this.store?.devices.find((d) => d.id === id);
		return {
			accepted: current?.health === "accepted",
			message:
				current?.health === "accepted"
					? "Push service accepted the test. Check your device for receipt; acceptance does not prove display."
					: "Test was not accepted. Check delivery health and browser settings.",
		};
	}
	async stop() {
		this.stopped = true;
		for (const detach of this.detach.splice(0)) detach();
		if (this.timer) clearTimeout(this.timer);
		this.pending.clear();
		await Promise.allSettled(this.active);
	}
}
