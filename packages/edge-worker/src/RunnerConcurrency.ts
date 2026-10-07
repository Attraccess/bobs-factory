/**
 * Instance concurrency cap for agent runner sessions.
 *
 * Every runner created by the EdgeWorker resolves `start()` /
 * `startStreaming()` only when its session finishes, so holding a semaphore
 * slot for the duration of that promise bounds how many sessions execute at
 * once. Hosts running many webhook-driven sessions use this to keep total
 * runner memory/CPU inside what the machine can serve, instead of letting an
 * unbounded burst of sessions take the whole process down (e.g. via the
 * kernel OOM killer).
 */

import type { IAgentRunner } from "cyrus-core";
import type {
	CapacityLease,
	CapacityOptions,
	CapacityRequest,
	ExecutionCapacity,
} from "./MachineCapacity.js";

/**
 * Counting semaphore with FIFO waiters and a live-adjustable limit.
 *
 * `Number.POSITIVE_INFINITY` means uncapped — `acquire()` resolves
 * immediately. Lowering the limit never interrupts running sessions; it
 * simply stops admitting new ones until enough slots free up.
 */
export class SessionSemaphore implements ExecutionCapacity {
	private bypass = 0;
	async acquireLease(
		signal?: AbortSignal,
		options: CapacityOptions = {},
	): Promise<CapacityLease> {
		await this.acquire(signal, options.background);
		let released = false;
		return {
			token: "memory",
			run: (work) => work(),
			release: async () => {
				if (!released) {
					released = true;
					this.release();
				}
			},
		};
	}
	private activeCount = 0;
	private waiters: Array<{ resolve: () => void; background: boolean }> = [];

	constructor(
		private limit: number,
		private readonly onQueued?: (message: string) => void,
	) {
		if (Number.isNaN(limit) || limit < 1) {
			throw new Error(
				`SessionSemaphore limit must be >= 1 or Infinity, got ${limit}`,
			);
		}
	}

	get active(): number {
		return this.activeCount;
	}

	get waiting(): number {
		return this.waiters.length;
	}

	get currentLimit(): number {
		return this.limit;
	}

	acquire(signal?: AbortSignal, background = false): Promise<void> {
		signal?.throwIfAborted();
		if (this.activeCount < this.limit && !this.waiters.length) {
			this.activeCount++;
			return Promise.resolve();
		}
		return new Promise<void>((resolve, reject) => {
			const waiter = {
				background,
				resolve: () => {
					signal?.removeEventListener("abort", abort);
					resolve();
				},
			};
			const abort = () => {
				this.waiters = this.waiters.filter((entry) => entry !== waiter);
				reject(signal?.reason ?? new Error("Session start cancelled"));
			};
			this.waiters.push(waiter);
			signal?.addEventListener("abort", abort, { once: true });
			this.onQueued?.(
				`Session start queued: ${this.activeCount} running, ${this.waiters.length} waiting`,
			);
		});
	}

	release(): void {
		if (this.activeCount === 0) {
			// A release with nothing active is a bookkeeping bug in the caller;
			// clamp rather than let the count go negative and over-admit later.
			return;
		}
		this.activeCount--;
		this.admitWaiters();
	}

	/**
	 * Adjust the limit at runtime (config hot-reload). Raising it admits
	 * queued sessions immediately; lowering it applies as sessions finish.
	 */
	setLimit(limit: number): void {
		if (Number.isNaN(limit) || limit < 1) {
			throw new Error(
				`SessionSemaphore limit must be >= 1 or Infinity, got ${limit}`,
			);
		}
		this.limit = limit;
		this.admitWaiters();
	}

	private admitWaiters(): void {
		while (this.waiters.length > 0 && this.activeCount < this.limit) {
			this.activeCount++;
			const primary = this.waiters.findIndex((waiter) => !waiter.background);
			const background = this.waiters.findIndex((waiter) => waiter.background);
			const index =
				background >= 0 && this.bypass >= 8
					? background
					: primary < 0
						? 0
						: primary;
			const [next] = this.waiters.splice(index, 1);
			this.bypass = next?.background
				? 0
				: background >= 0
					? this.bypass + 1
					: 0;
			next?.resolve();
		}
	}
}

/**
 * Wrap a runner so `start()` and `startStreaming()` hold a semaphore slot for
 * their full duration. Both resolve when the session completes, so the slot
 * is held for the session's lifetime and released on success and failure
 * alike. Follow-up messages streamed into an already-started session
 * (`addStreamMessage`) are untouched — the session already holds its slot.
 *
 * The wrapper is a Proxy rather than an instance mutation: the underlying
 * runner is never modified, every other property forwards through unchanged,
 * and the original methods stay observable (e.g. as test spies).
 */
const capacityStates = new WeakMap<IAgentRunner, CapacityRequest>();
const capacityExecutions = new WeakMap<IAgentRunner, Promise<unknown>>();
export async function waitForRunnerCapacity(
	runner: IAgentRunner,
): Promise<void> {
	await capacityExecutions.get(runner);
}
export function runnerCapacityState(
	runner?: IAgentRunner,
): CapacityRequest | undefined {
	return runner ? capacityStates.get(runner) : undefined;
}
export function capRunnerStarts(
	runner: IAgentRunner,
	semaphore: ExecutionCapacity,
	signal?: AbortSignal,
	options: CapacityOptions = {},
): IAgentRunner {
	let controller: AbortController | undefined;
	let pending = false;
	let admitted = false;
	let stopped = false;
	let proxy: IAgentRunner;
	const track = <T>(work: Promise<T>): Promise<T> => {
		capacityExecutions.set(proxy, work);
		return work;
	};
	const gate = async <T>(run: () => Promise<T>): Promise<T> => {
		if (stopped) throw new Error("Session start cancelled");
		if (pending) throw new Error("Runner execution already pending");
		controller = new AbortController();
		const abort = () => {
			controller!.abort(signal?.reason);
			if (admitted) runner.stop();
		};
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
		pending = true;
		let lease: CapacityLease | undefined;
		try {
			lease = await semaphore.acquireLease(controller.signal, {
				...options,
				onChange: (request) => {
					if (request) capacityStates.set(proxy, request);
					else capacityStates.delete(proxy);
					options.onChange?.(request);
				},
			});
			controller.signal.throwIfAborted();
			admitted = true;
			return await lease.run(run);
		} finally {
			try {
				if (lease) await lease.release();
			} finally {
				admitted = false;
				pending = false;
				signal?.removeEventListener("abort", abort);
			}
		}
	};

	proxy = new Proxy(runner, {
		get(target, property, receiver) {
			if (property === "start")
				return (prompt: string) => track(gate(() => target.start(prompt)));
			if (property === "stop")
				return () => {
					stopped = true;
					controller?.abort(new Error("Session start cancelled"));
					if (admitted) target.stop();
				};
			if (property === "isRunning") return () => pending || target.isRunning();
			if (
				property === "startStreaming" &&
				typeof target.startStreaming === "function"
			)
				return (initialPrompt?: string) =>
					track(gate(() => target.startStreaming!(initialPrompt)));
			return Reflect.get(target, property, receiver);
		},
	});
	return proxy;
}
