import { createHash } from "node:crypto";
import type { LinearClient } from "@linear/sdk";

type Job = {
	priority: number;
	run: () => Promise<unknown>;
	resolve: (value: unknown) => void;
	reject: (error: unknown) => void;
};

/** One scheduler per authenticated credential/workspace, including lazy SDK requests. */
export class LinearRequestBudget {
	private static budgets = new Map<string, LinearRequestBudget>();
	private jobs: Job[] = [];
	private running = false;
	private nextAt = 0;
	private throttleCount = 0;
	private constructor(private intervalMs: number) {}

	static forClient(
		client: LinearClient,
		workspaceId: string,
		intervalMs = 2000,
	): LinearRequestBudget {
		const headers = client.options?.headers;
		let credential = "";
		if (headers instanceof Headers)
			credential = headers.get("Authorization") ?? "";
		else if (Array.isArray(headers))
			credential = String(
				headers.find(([key]) => key?.toLowerCase() === "authorization")?.[1] ??
					"",
			);
		else if (headers)
			credential = String(
				Object.entries(headers).find(
					([key]) => key.toLowerCase() === "authorization",
				)?.[1] ?? "",
			);
		const key = createHash("sha256")
			.update(
				`${client.options?.apiUrl ?? "linear"}\0${workspaceId}\0${credential}`,
			)
			.digest("hex");
		let budget = LinearRequestBudget.budgets.get(key);
		if (!budget) {
			budget = new LinearRequestBudget(Math.max(0, intervalMs));
			LinearRequestBudget.budgets.set(key, budget);
		}
		return budget;
	}

	run<T>(operation: () => Promise<T>, priority = 0): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.jobs.push({
				priority,
				run: operation,
				resolve: resolve as (value: unknown) => void,
				reject,
			});
			if (!this.running) {
				this.running = true;
				void this.drain();
			}
		});
	}

	get retryAt(): number {
		return this.nextAt;
	}

	private async drain(): Promise<void> {
		while (this.jobs.length) {
			const wait = this.nextAt - Date.now();
			if (wait > 0)
				await new Promise<void>((resolve) => setTimeout(resolve, wait));
			const index = this.jobs.reduce(
				(best, job, i) => (job.priority > this.jobs[best]!.priority ? i : best),
				0,
			);
			const job = this.jobs.splice(index, 1)[0]!;
			this.nextAt = Date.now() + this.intervalMs;
			try {
				const value = await job.run();
				this.throttleCount = 0;
				job.resolve(value);
			} catch (error) {
				if (isLinearRateLimit(error)) {
					this.throttleCount++;
					this.nextAt = Math.max(
						this.nextAt,
						linearRetryAt(
							error,
							Math.min(
								300_000,
								30_000 * 2 ** Math.min(this.throttleCount - 1, 4),
							),
						),
					);
				}
				job.reject(error);
			}
		}
		this.running = false;
	}
}

export function isLinearRateLimit(error: unknown): boolean {
	const e = error as {
		status?: number;
		type?: string;
		response?: {
			status?: number;
			errors?: { extensions?: { code?: string } }[];
		};
		raw?: unknown;
		cause?: unknown;
	};
	return Boolean(
		e &&
			(e.status === 429 ||
				e.type === "Ratelimited" ||
				e.response?.status === 429 ||
				e.response?.errors?.some(
					(item) => item.extensions?.code === "RATELIMITED",
				) ||
				(e.raw && isLinearRateLimit(e.raw)) ||
				(e.cause && isLinearRateLimit(e.cause))),
	);
}

export function linearRetryAt(error: unknown, fallbackMs = 30_000): number {
	const e = error as {
		retryAfter?: number;
		requestsResetAt?: number;
		complexityResetAt?: number;
		response?: { headers?: Headers };
		raw?: { response?: { headers?: Headers } };
	};
	const headers = e?.response?.headers ?? e?.raw?.response?.headers;
	const retryAfter = Number(e?.retryAfter ?? headers?.get?.("retry-after"));
	const resets = [
		e?.requestsResetAt,
		e?.complexityResetAt,
		...[
			"x-ratelimit-requests-reset",
			"x-ratelimit-endpoint-requests-reset",
			"x-ratelimit-complexity-reset",
		].map((key) => Number(headers?.get?.(key))),
	];
	const reset = Math.max(
		0,
		...resets.filter(
			(value): value is number =>
				typeof value === "number" && Number.isFinite(value),
		),
	);
	return Math.max(
		Date.now() + fallbackMs,
		Number.isFinite(retryAfter) ? Date.now() + retryAfter * 1000 : 0,
		reset,
	);
}
