import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { operatorCatalog } from "bobs-factory-mcp-tools";
import Fastify from "fastify";
import { atomicPrivateFile, privateFile } from "./FactoryAuthStore.js";
import type { OperatorGrants } from "./OperatorGrants.js";
import { OperatorError, type OperatorService } from "./OperatorService.js";
export class OperatorServer {
	private port?: number;
	readonly app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
	constructor(
		readonly grants: OperatorGrants,
		readonly service: OperatorService,
	) {
		const authorize = (headers: Record<string, unknown>) => {
			const bearer = headers.authorization;
			if (typeof bearer !== "string" || !bearer.startsWith("Bearer "))
				throw new Error("unauthorized");
			return grants.authorize(
				String(headers["x-factory-instance"] ?? ""),
				String(headers["x-factory-grant"] ?? ""),
				bearer.slice(7),
			);
		};
		this.app.addHook("preHandler", async (req, reply) => {
			try {
				authorize(req.headers);
			} catch {
				return reply
					.code(401)
					.send(
						service.error(
							new OperatorError(
								"unauthorized",
								"Invalid or revoked operator grant",
							),
						),
					);
			}
		});
		this.app.post("/tools", (req) => operatorCatalog(authorize(req.headers)));
		this.app.post("/call", async (req) => {
			const body = req.body as { name?: unknown; arguments?: unknown };
			try {
				if (typeof body?.name !== "string")
					throw new OperatorError("invalid_request", "Tool name is required");
				return {
					ok: true,
					result: await service.call(
						body.name,
						body.arguments ?? {},
						authorize(req.headers),
					),
				};
			} catch (error) {
				return service.error(error, body?.arguments);
			}
		});
		this.app.setErrorHandler((_error, _req, reply) =>
			reply
				.code(400)
				.send(
					service.error(
						new OperatorError("invalid_request", "Invalid operator request"),
					),
				),
		);
	}
	async start() {
		await this.app.listen({ host: "127.0.0.1", port: 0 });
		const address = this.app.server.address();
		if (!address || typeof address === "string")
			throw new Error("Operator listener unavailable");
		this.port = address.port;
		atomicPrivateFile(
			join(this.grants.directory, "listener.json"),
			JSON.stringify({ instance: this.grants.instance(), port: address.port }),
		);
	}
	async stop() {
		await this.app.close();
		const path = join(this.grants.directory, "listener.json");
		if (existsSync(path)) {
			const endpoint = JSON.parse(privateFile(path));
			if (
				endpoint.instance === this.grants.instance() &&
				endpoint.port === this.port
			)
				unlinkSync(path);
		}
	}
}
