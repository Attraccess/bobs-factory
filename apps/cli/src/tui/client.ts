// HTTP access to the running factory dashboard API for the TUI.
// Authenticates with a local terminal session (see requestFactoryTerminalSession).
import { type IncomingMessage, request } from "node:http";

export class FactoryRequestError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

export interface FactoryChange {
	ids: string[];
	config: boolean;
}

export interface FactoryClientOptions {
	port: number;
	requestTimeoutMs?: number;
	home: string;
	/** Writes a local terminal-session request and returns its token. */
	requestSession: (home: string) => string;
}

export class FactoryClient {
	readonly origin: string;
	private token?: string;

	constructor(private readonly options: FactoryClientOptions) {
		this.origin = `http://localhost:${options.port}`;
	}

	private headers(write: boolean): Record<string, string> {
		this.token ??= this.options.requestSession(this.options.home);
		return {
			// The dashboard binds to loopback IPv4 and accepts only its configured authority.
			Host: `localhost:${this.options.port}`,
			Accept: "application/json",
			Authorization: `Bearer ${this.token}`,
			...(write
				? {
						Origin: this.origin,
						"X-Factory-Request": "1",
						"Content-Type": "application/json",
					}
				: {}),
		};
	}

	private unreachable(error: NodeJS.ErrnoException) {
		return new FactoryRequestError(
			error.code === "ECONNREFUSED"
				? `Bob’s Factory is not running on port ${this.options.port}. Start it with \`bobs-factory\`, or pass --port.`
				: `Cannot reach Bob’s Factory: ${error.message}`,
			0,
		);
	}

	private notAccepted() {
		return new FactoryRequestError(
			`The factory on port ${this.options.port} did not accept this terminal. Make sure it uses the same home (${this.options.home}).`,
			401,
		);
	}

	private send(
		method: string,
		path: string,
		body?: unknown,
	): Promise<{ status: number; text: string }> {
		const write = !["GET", "HEAD"].includes(method);
		return new Promise((resolve, reject) => {
			const req = request(
				{
					host: "127.0.0.1",
					port: this.options.port,
					method,
					path,
					headers: this.headers(write),
				},
				(response) => {
					let text = "";
					response.setEncoding("utf8");
					response.on("data", (chunk: string) => {
						text += chunk;
					});
					response.on("end", () =>
						resolve({ status: response.statusCode ?? 0, text }),
					);
					response.on("error", reject);
				},
			);
			req.on("error", (error) => reject(this.unreachable(error)));
			req.setTimeout(this.options.requestTimeoutMs ?? 30000, () =>
				req.destroy(new Error("Request timed out")),
			);
			req.end(body === undefined ? undefined : JSON.stringify(body));
		});
	}

	async json<T = unknown>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		let response = await this.send(method, path, body);
		if (response.status === 401) {
			// The server forgets terminal sessions on restart; ask for a new one once.
			this.token = undefined;
			response = await this.send(method, path, body);
			if (response.status === 401) throw this.notAccepted();
		}
		let parsed: any;
		try {
			parsed = response.text ? JSON.parse(response.text) : undefined;
		} catch {
			parsed = undefined;
		}
		if (response.status < 200 || response.status >= 300)
			throw new FactoryRequestError(
				parsed?.error ?? `Request failed (HTTP ${response.status})`,
				response.status,
			);
		return parsed as T;
	}

	get<T = unknown>(path: string) {
		return this.json<T>("GET", path);
	}

	post<T = unknown>(path: string, body: unknown = {}) {
		return this.json<T>("POST", path, body);
	}

	put<T = unknown>(path: string, body: unknown) {
		return this.json<T>("PUT", path, body);
	}

	/**
	 * Follows the dashboard's change stream, reconnecting after failures.
	 * `onLive(true)` marks a fresh connection: callers should refetch everything.
	 */
	events(
		onChange: (change: FactoryChange) => void,
		onLive: (live: boolean, error?: string) => void,
	): () => void {
		let stopped = false;
		let current: ReturnType<typeof request> | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let rejected = 0;
		const retry = (error?: string) => {
			if (stopped) return;
			onLive(false, error);
			if (!stopped) timer = setTimeout(connect, 2000);
		};
		const connect = () => {
			if (stopped) return;
			let finished = false;
			// A connection can report both "error" and "end"; schedule one retry.
			const fail = (error?: string) => {
				if (finished) return;
				finished = true;
				retry(error);
			};
			let headers: Record<string, string>;
			try {
				headers = { ...this.headers(false), Accept: "text/event-stream" };
			} catch (error) {
				return fail((error as Error).message);
			}
			current = request(
				{
					host: "127.0.0.1",
					port: this.options.port,
					path: "/api/events",
					headers,
				},
				(response: IncomingMessage) => {
					if (response.statusCode === 401) {
						response.resume();
						this.token = undefined;
						rejected++;
						return fail(rejected > 1 ? this.notAccepted().message : undefined);
					}
					if (response.statusCode !== 200) {
						response.resume();
						return fail(
							`Live updates unavailable (HTTP ${response.statusCode})`,
						);
					}
					rejected = 0;
					let buffer = "";
					response.setEncoding("utf8");
					response.on("data", (chunk: string) => {
						buffer += chunk.replace(/\r\n/g, "\n");
						let end = buffer.indexOf("\n\n");
						while (end >= 0) {
							const frame = buffer.slice(0, end);
							buffer = buffer.slice(end + 2);
							end = buffer.indexOf("\n\n");
							const event = /^event: (.*)$/m.exec(frame)?.[1];
							const data = /^data: (.*)$/m.exec(frame)?.[1];
							if (event === "ready") onLive(true);
							else if (event === "change" && data)
								try {
									const change = JSON.parse(data);
									onChange({
										ids: Array.isArray(change.ids) ? change.ids : [],
										config: Boolean(change.config),
									});
								} catch {
									/* Ignore malformed frames; the next change refreshes. */
								}
						}
					});
					response.on("end", () => fail());
					response.on("error", () => fail());
				},
			);
			current.on("error", (error) =>
				fail(this.unreachable(error as NodeJS.ErrnoException).message),
			);
			current.end();
		};
		connect();
		return () => {
			stopped = true;
			if (timer) clearTimeout(timer);
			current?.destroy();
		};
	}
}
