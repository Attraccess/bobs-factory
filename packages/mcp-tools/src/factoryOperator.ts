import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const operatorScopes = ["inspect", "operate", "configure"] as const;
const id = z.string().min(1).max(200);
const page = {
	offset: z.number().int().nonnegative().default(0),
	limit: z.number().int().min(1).max(50).default(25),
};
const run = { runId: id };
const mutation = { ...run, expectedRevision: id };
const context = z
	.object({
		step: z.string().optional(),
		questionBatchId: z.string().optional(),
		questions: z.array(z.string()),
	})
	.strict();
export const operatorConnectionSchema = z
	.object({
		type: z.enum(["http", "sse"]),
		url: z
			.string()
			.url()
			.refine((value) => {
				const u = new URL(value);
				return (
					["http:", "https:"].includes(u.protocol) &&
					!u.username &&
					!u.password &&
					!u.search &&
					!u.hash
				);
			}, "Use an HTTP endpoint without credentials or query parameters"),
		headers: z
			.record(
				z.string(),
				z.object({ env: z.string().regex(/^[A-Z][A-Z0-9_]*$/) }).strict(),
			)
			.default({}),
	})
	.strict();
export const operatorTools = [
	{
		name: "list_runs",
		scope: "inspect",
		description: "List Factory workflow runs with bounded pagination.",
		schema: z
			.object({ ...page, status: id.optional(), repositoryId: id.optional() })
			.strict(),
		readOnly: true,
	},
	{
		name: "inspect_run",
		scope: "inspect",
		description:
			"Inspect failure, pending questions, retained execution and eligible recovery actions. Returns a revision required for mutations.",
		schema: z.object(run).strict(),
		readOnly: true,
	},
	{
		name: "read_run_activity",
		scope: "inspect",
		description:
			"Read a bounded page of sanitized workflow activity (agent tool payloads are excluded).",
		schema: z.object({ ...run, ...page }).strict(),
		readOnly: true,
	},
	{
		name: "retry_run",
		scope: "operate",
		description:
			"Retry a failed run using saved progress. Does not approve review or merge. Requires a fresh inspection revision.",
		schema: z.object(mutation).strict(),
	},
	{
		name: "resume_run",
		scope: "operate",
		description:
			"Resume an interrupted run with saved progress. Requires a fresh inspection revision.",
		schema: z.object(mutation).strict(),
	},
	{
		name: "retry_ticket_sync",
		scope: "operate",
		description:
			"Retry only originating ticket synchronization; never replay implementation.",
		schema: z.object(mutation).strict(),
	},
	{
		name: "stop_run",
		scope: "operate",
		description: "Stop a running or waiting workflow run, retaining its work.",
		schema: z.object(mutation).strict(),
	},
	{
		name: "answer_run",
		scope: "operate",
		description:
			"Answer current workflow questions, or explicitly request an explanation. Operator grants cannot approve human reviews.",
		schema: z
			.object({
				...mutation,
				answer: z.string().trim().min(1).max(100000),
				kind: z.enum(["answer", "explanation"]).optional(),
				context,
			})
			.strict(),
	},
	{
		name: "steer_run",
		scope: "operate",
		description:
			"Send steering through enabled workflow chat, using current state context.",
		schema: z
			.object({ ...mutation, text: z.string().trim().min(1).max(100000) })
			.strict(),
	},
	{
		name: "inspect_mcp_connections",
		scope: "inspect",
		description:
			"Inspect effective run connections, runner authentication path, permissions and writable source revision without credentials.",
		schema: z.object(run).strict(),
		readOnly: true,
	},
	{
		name: "check_mcp_connection",
		scope: "inspect",
		description:
			"Read the verified originating Taskbot ticket through this run's actual transport and runner authentication. No arbitrary tool execution.",
		schema: z.object(run).strict(),
		readOnly: true,
	},
	{
		name: "update_mcp_connection",
		scope: "configure",
		description:
			"Repair an owned legacy repository source or update a saved tool profile for future launches. Requires explicit exact tool permissions and a fresh configuration revision. Frozen run profiles are preserved.",
		schema: z
			.object({
				...run,
				expectedConfigRevision: id,
				server: z
					.string()
					.regex(/^[A-Za-z0-9_-]+$/)
					.refine(
						(v) => !["factory-context", "bobs-factory-operator"].includes(v),
					),
				connection: operatorConnectionSchema,
				permissions: z
					.array(z.string().regex(/^[A-Za-z0-9_-]+$/))
					.min(1)
					.max(100),
				profileId: id.optional(),
			})
			.strict(),
	},
] as const;
export function operatorCatalog(scopes: readonly string[]) {
	return operatorTools
		.filter((t) => scopes.includes(t.scope))
		.map((t) => ({
			name: t.name,
			description: t.description,
			inputSchema: z.toJSONSchema(t.schema, { target: "draft-7", io: "input" }),
			annotations: {
				readOnlyHint: "readOnly" in t && t.readOnly,
				destructiveHint: t.name === "stop_run",
				openWorldHint: false,
			},
		}));
}
export type OperatorRequest = (
	path: "tools" | "call",
	body?: unknown,
) => Promise<any>;
export function createFactoryOperatorBridge(request: OperatorRequest) {
	const server = new Server(
		{ name: "bobs-factory-operator", version: "1.0.0" },
		{
			capabilities: { tools: {} },
			instructions:
				"Inspect before changing runs. Operator authorization never replaces human review or merge approval. Mutations require current revisions; connectivity uses the retained runner.",
		},
	);
	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: await request("tools"),
	}));
	server.setRequestHandler(CallToolRequestSchema, async (req) => {
		const result = await request("call", {
			name: req.params.name,
			arguments: req.params.arguments ?? {},
		});
		return {
			isError: result.ok === false,
			content: [{ type: "text", text: JSON.stringify(result) }],
			structuredContent: result,
		};
	});
	return server;
}
export async function serveFactoryOperator(request: OperatorRequest) {
	await createFactoryOperatorBridge(request).connect(
		new StdioServerTransport(),
	);
}
