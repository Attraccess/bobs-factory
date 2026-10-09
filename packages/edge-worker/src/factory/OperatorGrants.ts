import {
	createHash,
	randomBytes,
	randomUUID,
	timingSafeEqual,
} from "node:crypto";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { operatorScopes, serveFactoryOperator } from "bobs-factory-mcp-tools";
import { z } from "zod";
import { atomicPrivateFile, privateFile } from "./FactoryAuthStore.js";

const grant = z.object({
	id: z.string(),
	label: z.string(),
	scopes: z.array(z.enum(operatorScopes)),
	hash: z.string().regex(/^[a-f0-9]{64}$/),
	createdAt: z.string(),
});
const stateSchema = z.object({
	version: z.literal(1),
	instance: z.string(),
	grants: z.array(grant),
});
const clientSchema = z.object({
	instance: z.string(),
	id: z.string(),
	token: z.string(),
});
const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");
export class OperatorGrants {
	readonly directory: string;
	readonly file: string;
	constructor(home: string) {
		this.directory = join(resolve(home), "factory", "operator");
		const factory = join(resolve(home), "factory");
		mkdirSync(factory, { recursive: true, mode: 0o700 });
		const parent = lstatSync(factory);
		if (
			!parent.isDirectory() ||
			parent.isSymbolicLink() ||
			(process.getuid && parent.uid !== process.getuid())
		)
			throw new Error("Factory directory must be owned by the local owner");
		mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		const stat = lstatSync(this.directory);
		if (
			!stat.isDirectory() ||
			stat.isSymbolicLink() ||
			(process.getuid && stat.uid !== process.getuid())
		)
			throw new Error("Operator directory must be owned by the local owner");
		chmodSync(this.directory, 0o700);
		this.file = join(this.directory, "grants.json");
	}
	private read() {
		return stateSchema.parse(JSON.parse(privateFile(this.file)));
	}
	private change<T>(fn: (state: z.infer<typeof stateSchema>) => T): T {
		const lock = `${this.file}.lock`;
		writeFileSync(lock, String(process.pid), { mode: 0o600, flag: "wx" });
		try {
			const state = existsSync(this.file)
				? this.read()
				: { version: 1 as const, instance: randomUUID(), grants: [] };
			const result = fn(state);
			atomicPrivateFile(this.file, JSON.stringify(state));
			return result;
		} finally {
			unlinkSync(lock);
		}
	}
	instance() {
		if (!existsSync(this.file)) this.change(() => {});
		return this.read().instance;
	}
	list() {
		this.instance();
		return this.read().grants.map(({ hash: _hash, ...meta }) => meta);
	}
	issue(label: string, scopes: string[]) {
		const validated = z.array(z.enum(operatorScopes)).min(1).parse(scopes);
		z.string().trim().min(1).max(100).parse(label);
		return this.change((state) => {
			const id = randomUUID(),
				token = randomBytes(32).toString("base64url");
			const clientFile = join(this.directory, `client-${id}.json`);
			atomicPrivateFile(
				clientFile,
				JSON.stringify({ instance: state.instance, id, token }),
			);
			state.grants.push({
				id,
				label,
				scopes: validated,
				hash: hash(token),
				createdAt: new Date().toISOString(),
			});
			return {
				id,
				instance: state.instance,
				scopes: validated,
				credentialFile: clientFile,
			};
		});
	}
	revoke(id: string) {
		this.change((state) => {
			if (!state.grants.some((g) => g.id === id))
				throw new Error("Operator grant not found");
			state.grants = state.grants.filter((g) => g.id !== id);
		});
	}
	authorize(instance: string, id: string, token: string) {
		const state = this.read(),
			found = state.grants.find((g) => g.id === id);
		if (
			state.instance !== instance ||
			!found ||
			!timingSafeEqual(Buffer.from(hash(token)), Buffer.from(found.hash))
		)
			throw new Error("unauthorized");
		return found.scopes;
	}
}
export async function serveOperatorClient(
	home: string,
	credentialFile: string,
) {
	const grants = new OperatorGrants(home);
	const client = clientSchema.parse(
		JSON.parse(privateFile(resolve(credentialFile))),
	);
	const request = async (path: "tools" | "call", body?: unknown) => {
		try {
			const endpoint = z
				.object({
					instance: z.string(),
					port: z.number().int().min(1).max(65535),
				})
				.parse(
					JSON.parse(privateFile(join(grants.directory, "listener.json"))),
				);
			if (endpoint.instance !== client.instance)
				throw new Error("wrong_instance");
			const response = await fetch(
				`http://127.0.0.1:${endpoint.port}/${path}`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${client.token}`,
						"X-Factory-Instance": client.instance,
						"X-Factory-Grant": client.id,
					},
					body: JSON.stringify(body ?? {}),
					signal: AbortSignal.timeout(70000),
					redirect: "error",
				},
			);
			if (!response.ok)
				throw new Error(
					response.status === 401 ? "unauthorized" : "instance_unavailable",
				);
			return await response.json();
		} catch (error) {
			// No provider body, credential path, or token enters protocol diagnostics.
			const code =
				error instanceof Error &&
				["wrong_instance", "unauthorized"].includes(error.message)
					? error.message
					: "instance_unavailable";
			throw new Error(
				`${code}: restore the running Factory instance or local operator grant`,
			);
		}
	};
	await serveFactoryOperator(request);
}
