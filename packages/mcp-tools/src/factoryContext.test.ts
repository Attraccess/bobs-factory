import { existsSync, readFileSync, statSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it } from "vitest";
import {
	createFactoryContextServer,
	prepareFactoryContext,
} from "./factoryContext.js";

async function withContext(
	input: unknown,
	check: (client: Client) => Promise<void>,
) {
	const server = createFactoryContextServer(input);
	const client = new Client({ name: "factory-test", version: "1" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	await client.connect(b);
	try {
		await check(client);
	} finally {
		await client.close();
		await server.close();
	}
}

it("pages oversized values and all discussion entries without dropping data", async () => {
	const text = "Ticket detail: 🏭\n".repeat(70000);
	const comments = Array.from({ length: 103 }, (_, id) => ({
		id,
		body: `Comment ${id}`,
	}));
	await withContext(
		{ outputs: { ticket: { description: text, comments } } },
		async (client) => {
			const paths: string[] = [];
			let offset: number | null = 0;
			while (offset !== null) {
				const page = (
					await client.callTool({
						name: "list_context",
						arguments: {
							path: "/outputs/ticket/comments",
							offset,
						},
					})
				).structuredContent as {
					entries: { path: string }[];
					nextOffset: number | null;
				};
				paths.push(...page.entries.map((entry) => entry.path));
				offset = page.nextOffset;
			}
			expect(paths).toEqual(
				comments.map((_, id) => `/outputs/ticket/comments/${id}`),
			);
			let recovered = "";
			offset = 0;
			while (offset !== null) {
				const page = (
					await client.callTool({
						name: "read_context",
						arguments: {
							path: "/outputs/ticket/description",
							offset,
							limit: 16000,
						},
					})
				).structuredContent as { text: string; nextOffset: number | null };
				expect(page.text.length).toBeLessThanOrEqual(16000);
				recovered += page.text;
				offset = page.nextOffset;
			}
			expect(recovered).toBe(text);
			expect(
				(
					await client.callTool({
						name: "read_context",
						arguments: {
							path: paths.at(-1),
						},
					})
				).structuredContent,
			).toMatchObject({
				encoding: "json",
				text: JSON.stringify(comments.at(-1)),
				nextOffset: null,
			});
		},
	);
});

it("exposes only declared inputs, supports escaped paths, and rejects invalid reads", async () => {
	await withContext({ plan: { "a/b~c": "Accepted plan" } }, async (client) => {
		expect(
			(await client.callTool({ name: "list_context", arguments: {} }))
				.structuredContent,
		).toMatchObject({
			entries: [{ path: "/plan", type: "object", entries: 1 }],
			total: 1,
			nextOffset: null,
		});
		expect(
			(
				await client.callTool({
					name: "read_context",
					arguments: { path: "/plan/a~1b~0c" },
				})
			).structuredContent,
		).toMatchObject({ text: "Accepted plan", encoding: "text" });
		for (const path of [
			"/originalInput",
			"/history",
			"/__proto__",
			"/plan/toString",
			"/plan/a~2",
		])
			expect(
				(await client.callTool({ name: "read_context", arguments: { path } }))
					.isError,
			).toBe(true);
		expect(
			(
				await client.callTool({
					name: "read_context",
					arguments: { limit: 1000000 },
				})
			).isError,
		).toBe(true);
	});
});

it("isolates snapshots across roles/rounds and removes private files on cleanup", () => {
	const previous = {
		history: [{ step: "code-review", output: { findings: ["old finding"] } }],
	};
	const first = prepareFactoryContext(previous);
	const second = prepareFactoryContext({ plan: "Plan only" });
	try {
		previous.history.push({
			step: "code-fix",
			output: { findings: ["fixed"] },
		});
		const firstPath = first.config.args[1]!;
		const secondPath = second.config.args[1]!;
		expect(firstPath).not.toBe(secondPath);
		expect(JSON.parse(readFileSync(firstPath, "utf8")).history).toHaveLength(1);
		expect(JSON.parse(readFileSync(secondPath, "utf8"))).toEqual({
			plan: "Plan only",
		});
		expect(statSync(firstPath).mode & 0o777).toBe(0o600);
		first.cleanup();
		expect(existsSync(firstPath)).toBe(false);
		expect(existsSync(secondPath)).toBe(true);
	} finally {
		first.cleanup();
		second.cleanup();
	}
});
