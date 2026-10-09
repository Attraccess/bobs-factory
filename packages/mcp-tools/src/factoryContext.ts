import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	type FactoryArtifactBinding,
	submitFactoryResultArtifact,
} from "./factoryArtifacts.js";
import { factoryContextView } from "./factoryContextMemory.js";

export const factoryContextInstructions = `Your step input is served by the factory-context MCP server, not embedded in this prompt. First call list_context at path "" to discover it. Browse objects/arrays with list_context and read values with read_context using JSON Pointer paths (escape ~ as ~0 and / as ~1). read_context defaults to 12000 characters and caps positive requests at 16000; list_context defaults to 25 entries and caps positive requests at 50. Responses report the applied limit. Both tools paginate: follow nextOffset until null for every relevant collection/value. Read all ticket comments, answers, decisions and assets required by your role. When /contextMemory is present with format factory-context-memory-v1, reviewers/fixers must read /contextMemory/reviewLedger and /contextMemory/reviewRounds: the ledger contains every distinct past finding, disposition and observation verbatim, with first/latest source paths and chronological round indexes. Repeated identical claims are deduplicated. reviewRounds retains chronological review summaries, gate outcomes, feedback and questions; read these alongside the claims so acceptance/rejection reasoning is preserved. A fixer disposition is a claim, not reviewer acceptance; use the current gate and new evidence to assess unresolved findings, disagreements and reopenings. This ledger satisfies the historical review reading requirement; do not reread every old review output. /contextMemory/latestSteps, /history and /progress/newHistory are compact indexes with fullPath/outputPath references, not complete outputs. On repeated visits, start with /progress, current role inputs and the ledger; inspect the delta and read referenced original evidence only when needed. Current requirements, decisions, answers and outputs remain complete. Read small records/arrays with one read_context call rather than field by field; listings include short metadata previews so never read every /history/<n>/step to identify roles. For large values, browse relevant sections instead of downloading the entire root or duplicate outputs/history. read_context and list_context accept view="full" to access original records at the same paths; indexed outputPath references also work directly. Full history remains available on demand, including when compact memory is absent. originalInput may itself contain JSON: read it in pages and parse it. Never infer missing pages or claim unread original evidence was inspected. Screenshot source fingerprints are compact runtime provenance summaries; do not request or reconstruct full hash maps. Only this role's declared step inputs are available. If these tools are unavailable, return {"infrastructureFailure":{"reason":"precise unavailable tool/connection diagnosis"}} as the complete result. Infrastructure failures preserve output-correction budgets; never invent a result without the input. When /resultSubmission is present, large JSON results may be saved in its directory and submitted with submit_result_artifact; return that tool’s bounded factoryArtifact envelope as the complete final response. /provenance exposes runtime/workflow/contract identity for this run; do not copy it into role output.`;

/** One immutable snapshot per role, including only the workflow's scoped input. */
/** Runtime provenance is not role input. Project every path, including old history. */
export function compactFactoryContext(input: unknown): unknown {
	const manifests = new Map<
		object,
		{ digest: string; entries: number; version: number }
	>();
	const project = (value: unknown): unknown => {
		if (!value || typeof value !== "object") return value;
		if (Array.isArray(value)) return value.map(project);
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => {
				if (
					(key === "dependencyManifests" ||
						key === "videoDependencyManifests") &&
					child &&
					typeof child === "object"
				)
					return [
						key === "videoDependencyManifests"
							? "videoManifestInventory"
							: "manifestInventory",
						{ count: Object.keys(child).length, runtimeOnly: true },
					];
				if (key === "dependencyHashes" && child && typeof child === "object") {
					let manifest = manifests.get(child);
					if (!manifest) {
						manifest = {
							digest: createHash("sha256")
								.update(JSON.stringify(child))
								.digest("hex"),
							entries: Object.keys(child).length,
							version: Number(
								(value as Record<string, unknown>).fingerprintVersion ?? 1,
							),
						};
						manifests.set(child, manifest);
					}
					return ["sourceFingerprint", manifest];
				}
				return [key, project(child)];
			}),
		);
	};
	return project(input);
}

export function prepareFactoryContext(
	input: unknown,
	artifacts?: FactoryArtifactBinding,
) {
	input = compactFactoryContext(input);
	const directory = mkdtempSync(join(tmpdir(), "bobs-factory-context-"));
	const path = join(directory, "input.json");
	try {
		writeFileSync(path, JSON.stringify(input) ?? "null", { mode: 0o600 });
		if (artifacts)
			writeFileSync(
				join(directory, "artifacts.json"),
				JSON.stringify(artifacts),
				{ mode: 0o600 },
			);
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
	return {
		config: {
			type: "stdio" as const,
			command: process.execPath,
			args: process.env.BOBS_FACTORY_INTERNAL_EXECUTABLE
				? ["internal", "factory-context", path]
				: [
						fileURLToPath(
							new URL("./factory-context-main.js", import.meta.url),
						),
						path,
					],
		},
		cleanup: () => rmSync(directory, { recursive: true, force: true }),
	};
}

function valueAt(input: unknown, path: string): unknown {
	if (path === "") return input;
	if (!path.startsWith("/") || /~(?![01])/u.test(path))
		throw new Error("Use a JSON Pointer path, or an empty path for the root");
	let value = input;
	for (const part of path.slice(1).split("/")) {
		const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
		if (
			value === null ||
			typeof value !== "object" ||
			!Object.hasOwn(value, key)
		)
			throw new Error("Context path not found");
		value = (value as Record<string, unknown>)[key];
	}
	return value;
}

const kind = (value: unknown) =>
	value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
const result = (data: Record<string, unknown>) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data) }],
	structuredContent: data,
});
const location = {
	path: z
		.string()
		.max(2000)
		.default("")
		.describe("JSON Pointer into this role's input; empty string is root"),
	offset: z.number().int().min(0).default(0),
};
const viewOption = z
	.enum(["compact", "full"])
	.default("compact")
	.describe(
		"Compact history indexes by default; full reads the original scoped snapshot",
	);
const annotations = {
	readOnlyHint: true,
	destructiveHint: false,
	openWorldHint: false,
};

export function createFactoryContextServer(
	input: unknown,
	artifacts?: FactoryArtifactBinding,
): McpServer {
	input = structuredClone(input);
	const compact = factoryContextView(input);
	const contextValue = (path: string, view: "compact" | "full") => {
		if (view === "full") return valueAt(input, path);
		try {
			return valueAt(compact, path);
		} catch {
			// Existing conversations can still follow original deep output paths.
			return valueAt(input, path);
		}
	};
	const server = new McpServer({ name: "factory-context", version: "1.0.0" });
	if (artifacts)
		server.registerTool(
			"submit_result_artifact",
			{
				description:
					"Submit a complete JSON role result saved in the authorized result artifact directory. Returns a bounded run/role/revision-bound factoryArtifact envelope: use that envelope as the entire final response. Finalization applies the same output schema, coverage and evidence checks as inline JSON. File size limit is 8 MiB; path must be relative to the runtime's resultSubmission.directory.",
				inputSchema: { path: z.string().min(1).max(2000) },
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					openWorldHint: false,
				},
			},
			async ({ path }) =>
				result(await submitFactoryResultArtifact(artifacts, path)),
		);
	server.registerTool(
		"list_context",
		{
			description:
				"List immediate fields or array entries with short identity/step metadata previews. History is a compact index with original output paths. Follow nextOffset to discover every entry; use returned paths with list_context/read_context. Input is an immutable snapshot scoped to the current workflow role.",
			inputSchema: {
				...location,
				view: viewOption,
				limit: z
					.number()
					.int()
					.min(1)
					.default(25)
					.describe(
						"Entries per page; positive requests above 50 are capped at 50",
					),
			},
			annotations,
		},
		async ({ path, offset, limit, view }) => {
			limit = Math.min(limit, 50);
			const value = contextValue(path, view);
			if (value === null || typeof value !== "object")
				return result({
					path,
					view,
					type: kind(value),
					entries: [],
					total: 0,
					limit,
					offset,
					nextOffset: null,
				});
			const keys = Object.keys(value);
			const entries = keys.slice(offset, offset + limit).map((key) => {
				const child = (value as Record<string, unknown>)[key];
				const preview =
					child !== null && typeof child === "object"
						? Object.fromEntries(
								["step", "at", "outputPath", "id", "scope"].flatMap((field) => {
									const value = Object.hasOwn(child, field)
										? (child as Record<string, unknown>)[field]
										: undefined;
									return typeof value === "string" && value.length <= 200
										? [[field, value]]
										: [];
								}),
							)
						: {};
				return {
					...(Object.keys(preview).length ? { preview } : {}),
					path: `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`,
					type: kind(child),
					...(typeof child === "string" ? { characters: child.length } : {}),
					...(child !== null && typeof child === "object"
						? { entries: Object.keys(child).length }
						: {}),
				};
			});
			return result({
				path,
				view,
				type: kind(value),
				entries,
				total: keys.length,
				limit,
				offset,
				nextOffset:
					offset + entries.length < keys.length
						? offset + entries.length
						: null,
			});
		},
	);
	server.registerTool(
		"read_context",
		{
			description:
				"Read a bounded character page of a context value. Default history reads are compact indexes; view=full recovers the original records. The review ledger preserves distinct claims without rereading repeated outputs. Strings are returned as raw text; other values as JSON. Concatenate text pages using nextOffset until null to recover the complete value; no context is silently truncated. Prefer specific fields over root reads.",
			inputSchema: {
				...location,
				view: viewOption,
				limit: z
					.number()
					.int()
					.min(1)
					.default(12000)
					.describe(
						"Characters per page; positive requests above 16000 are capped at 16000",
					),
			},
			annotations,
		},
		async ({ path, offset, limit, view }) => {
			limit = Math.min(limit, 16000);
			const value = contextValue(path, view);
			const serialized =
				typeof value === "string" ? value : JSON.stringify(value);
			const text = serialized.slice(offset, offset + limit);
			return result({
				path,
				view,
				encoding: typeof value === "string" ? "text" : "json",
				limit,
				text,
				totalCharacters: serialized.length,
				offset,
				nextOffset:
					offset + text.length < serialized.length
						? offset + text.length
						: null,
			});
		},
	);
	return server;
}
