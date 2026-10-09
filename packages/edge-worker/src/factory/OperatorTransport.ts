import type {
	AgentRunnerConfig,
	McpServerConfig,
	RunnerType,
} from "bobs-factory-core";
import {
	OperatorError,
	operatorError,
	operatorText,
} from "./OperatorService.js";
import {
	taskbotAdapter,
	taskbotServer,
	taskbotSource,
} from "./TicketTracking.js";
import type { FactoryRun } from "./WorkflowRuntime.js";
export interface OperatorTransport {
	runnerType: RunnerType;
	built: { config: AgentRunnerConfig };
	servers: Record<string, McpServerConfig>;
	callTool(
		server: string,
		tool: string,
		args: Record<string, unknown>,
		signal: AbortSignal,
	): Promise<unknown>;
}
export function operatorPermission(
	name: string,
	allowed?: string[],
	denied?: string[],
) {
	const matches = (pattern: string) =>
		pattern === `mcp__${name.split("__")[1]}` ||
		new RegExp(
			"^" +
				pattern
					.split("*")
					.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
					.join(".*") +
				"$",
		).test(name);
	return !denied?.some(matches) && (!allowed?.length || allowed.some(matches));
}
export function operatorTaskbotSource(run: FactoryRun) {
	return run.ticketReference?.provider === "taskbot"
		? run.ticketReference
		: taskbotSource(
				run.source ??
					run.launchRequest?.source ??
					run.launchRequest?.prompt ??
					run.input,
			);
}
export function inspectOperatorTransport(
	run: FactoryRun,
	resolved: OperatorTransport,
) {
	const config = resolved.built.config;
	let selection:
		| { server?: string; error?: { code: string; message: string } }
		| undefined;
	const target = operatorTaskbotSource(run);
	if (target) {
		try {
			const server = taskbotServer(target.instance, resolved.servers);
			if ("server" in target && server !== target.server)
				throw new OperatorError(
					"missing_transport",
					"Restore the retained Taskbot server identity",
				);
			selection = { server };
		} catch (error) {
			selection = { error: operatorError(error).error };
		}
	}
	return {
		runId: run.id,
		runner: resolved.runnerType,
		selection,
		provenance: run.executionSnapshot?.sources ?? { tools: "legacy" },
		frozenProfile: run.executionSnapshot?.tools
			? {
					id: run.executionSnapshot.tools.id,
					revision: run.executionSnapshot.tools.revision,
				}
			: undefined,
		connections: Object.entries(resolved.servers).map(([name, server]) => ({
			server: name,
			transport: server.type ?? ("command" in server ? "stdio" : "http"),
			endpoint: "url" in server ? operatorText(server.url) : undefined,
			permissionForTicketRead: operatorPermission(
				`mcp__${name}__get_ticket`,
				config.allowedTools,
				config.disallowedTools,
			),
			authentication:
				resolved.runnerType === "codex" && "url" in server
					? "codex_native"
					: "configured_headers_or_environment",
			configuredHeaders:
				"headers" in server ? Object.keys(server.headers ?? {}) : [],
			credentialReferences:
				"headers" in server
					? Object.values(server.headers ?? {}).flatMap((value) =>
							[...value.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)].map((match) => ({
								environment: match[1],
								available: !!(config.childEnvironment
									? config.childEnvironment[match[1]!]
									: process.env[match[1]!]),
							})),
						)
					: [],
			credentialValidity: "unverified",
		})),
		permissions: {
			allowed: config.allowedTools,
			denied: config.disallowedTools,
		},
	};
}
export async function checkOperatorTransport(
	run: FactoryRun,
	resolved: OperatorTransport,
) {
	const target = operatorTaskbotSource(run);
	if (!target)
		throw new OperatorError(
			"unsupported_probe",
			"Read-only connection checks require a verified originating Taskbot ticket",
		);
	const server = taskbotServer(target.instance, resolved.servers);
	if ("server" in target && server !== target.server)
		throw new OperatorError(
			"missing_transport",
			"Restore the retained originating Taskbot server identity",
		);
	const signal = AbortSignal.timeout(15000);
	const ref = { ...target, server };
	await taskbotAdapter(ref, (tool, args) =>
		resolved.callTool(server, tool, args, signal),
	).read();
	return {
		runId: run.id,
		server,
		runner: resolved.runnerType,
		authentication:
			resolved.runnerType === "codex"
				? "codex_native"
				: "configured_headers_or_environment",
		connected: true,
		operation: "get_ticket",
		checkedAt: new Date().toISOString(),
	};
}
/** Known secrets are removed in all forms; arbitrary provider bodies never become errors. */
export function operatorSanitize(text: string, sources: unknown[]) {
	const secrets = new Set<string>();
	const visit = (value: unknown, sensitive = false) => {
		if (typeof value === "string") {
			if (sensitive && value.length) secrets.add(value);
			return;
		}
		if (Array.isArray(value)) for (const item of value) visit(item, sensitive);
		else if (value && typeof value === "object")
			for (const [key, entry] of Object.entries(value))
				visit(
					entry,
					sensitive ||
						/token|secret|password|authorization|api.?key|cookie|headers|env/i.test(
							key,
						),
				);
	};
	for (const source of sources) visit(source);
	for (const value of [...secrets].sort((a, b) => b.length - a.length))
		for (const form of [
			value,
			encodeURIComponent(value),
			JSON.stringify(value).slice(1, -1),
		])
			text = text.split(form).join("[redacted]");
	return operatorText(text);
}
