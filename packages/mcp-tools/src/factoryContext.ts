import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const factoryContextInstructions = `Your step input is served by the factory-context MCP server, not embedded in this prompt. First call list_context at path "" to discover it. Browse objects/arrays with list_context and read values with read_context using JSON Pointer paths (escape ~ as ~0 and / as ~1). Both tools paginate: follow nextOffset until null for every relevant collection/value. Read all ticket comments, answers, decisions and assets required by your role; reviewers/fixers must also read all past review rounds and dispositions. Read small records/arrays with one read_context call rather than field by field. For large values, browse and read relevant sections instead of downloading the entire root context or repeated copies in outputs/history. originalInput may itself contain JSON: read it in pages and parse it. Never infer missing pages or claim unread context was reviewed. Screenshot source fingerprints are compact runtime provenance summaries; do not request or reconstruct full hash maps. Only this role's declared step inputs are available. If these tools are unavailable, fail explicitly rather than proceeding without the input.`;

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
				if (key === "dependencyManifests" && child && typeof child === "object")
					return [
						"manifestInventory",
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

export function prepareFactoryContext(input: unknown) {
	input = compactFactoryContext(input);
	const directory = mkdtempSync(join(tmpdir(), "cyrus-factory-context-"));
	const path = join(directory, "input.json");
	try {
		writeFileSync(path, JSON.stringify(input) ?? "null", { mode: 0o600 });
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
	return {
		config: {
			type: "stdio" as const,
			command: process.execPath,
			args: [
				fileURLToPath(new URL("./factory-context-stdio.js", import.meta.url)),
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
const annotations = {
	readOnlyHint: true,
	destructiveHint: false,
	openWorldHint: false,
};

export function createFactoryContextServer(input: unknown): McpServer {
	const server = new McpServer({ name: "factory-context", version: "1.0.0" });
	server.registerTool(
		"list_context",
		{
			description:
				"List immediate fields or array entries without their contents. Follow nextOffset to discover every entry; use returned paths with list_context/read_context. Input is an immutable snapshot scoped to the current workflow role.",
			inputSchema: {
				...location,
				limit: z.number().int().min(1).max(50).default(25),
			},
			annotations,
		},
		async ({ path, offset, limit }) => {
			const value = valueAt(input, path);
			if (value === null || typeof value !== "object")
				return result({
					path,
					type: kind(value),
					entries: [],
					total: 0,
					nextOffset: null,
				});
			const keys = Object.keys(value);
			const entries = keys.slice(offset, offset + limit).map((key) => {
				const child = (value as Record<string, unknown>)[key];
				return {
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
				type: kind(value),
				entries,
				total: keys.length,
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
				"Read a bounded character page of a context value. Strings are returned as raw text; other values as JSON. Concatenate text pages using nextOffset until null to recover the complete value; no context is silently truncated. Prefer specific fields over root reads.",
			inputSchema: {
				...location,
				limit: z.number().int().min(1).max(16000).default(12000),
			},
			annotations,
		},
		async ({ path, offset, limit }) => {
			const value = valueAt(input, path);
			const serialized =
				typeof value === "string" ? value : JSON.stringify(value);
			const text = serialized.slice(offset, offset + limit);
			return result({
				path,
				encoding: typeof value === "string" ? "text" : "json",
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
