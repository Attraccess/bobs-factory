import { createHash } from "node:crypto";
import { FactoryServer as ProtectedFactoryServer } from "../../src/factory/FactoryServer.js";
import type { WorkflowRuntime } from "../../src/factory/WorkflowRuntime.js";
// Existing route tests exercise handlers with a fixture server-side session.
// Authentication/bypass/real ceremonies are exercised separately, with the real server.
export class FactoryServer extends ProtectedFactoryServer {
	constructor(
		runtime: WorkflowRuntime,
		hooks: ConstructorParameters<typeof ProtectedFactoryServer>[1],
	) {
		super(runtime, hooks, {
			origins: ["http://localhost", "http://127.0.0.1:3457"],
		});
		this.auth.store.update((state) => {
			// A restart fixture may create another server against the same auth store.
			state.credentials = state.credentials.filter(
				(c) => c.id !== "route-fixture",
			);
			state.sessions = state.sessions.filter(
				(s) => s.credential !== "route-fixture",
			);
			state.credentials.push({
				id: "route-fixture",
				origin: "http://localhost",
				publicKey: "fixture",
				counter: 0,
				label: "Fixture",
				deviceType: "singleDevice",
				backedUp: false,
				createdAt: Date.now(),
				lastUsedAt: Date.now(),
			});
			state.sessions.push({
				hash: createHash("sha256")
					.update("route-fixture-session")
					.digest("hex"),
				credential: "route-fixture",
				origin: "http://localhost",
				expires: Date.now() + 3600000,
				verifiedAt: Date.now(),
			});
		});
		const inject = this.app.inject.bind(this.app);
		this.app.inject = ((options: any) =>
			inject({
				...options,
				headers: {
					host: "localhost",
					cookie: "factory-local-session=route-fixture-session",
					origin: "http://localhost",
					...options.headers,
				},
			})) as typeof this.app.inject;
	}
}
