import { existsSync, readFileSync, statSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it } from "vitest";
import {
	compactFactoryContext,
	createFactoryContextServer,
	prepareFactoryContext,
} from "./factoryContext.js";
import { factoryContextView } from "./factoryContextMemory.js";

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
		const firstPath = first.config.args.at(-1)!;
		const secondPath = second.config.args.at(-1)!;
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

it("projects machine provenance in outputs, history and correction without dropping requirements", () => {
	const hashes = Object.fromEntries(
		Array.from({ length: 16000 }, (_, i) => [`build/${i}`, "a".repeat(64)]),
	);
	const shot = {
		area: "Reader",
		state: "Paid",
		path: "reader.png",
		imageSha256: "image",
		dependencyHashes: hashes,
	};
	const input = {
		outputs: { capture: { screenshots: [shot] } },
		history: [{ output: { screenshots: [shot] } }],
		outputCorrection: { output: { screenshots: [shot] } },
		requirements: ["Keep every requirement"],
		current: { dependencyManifests: { digest: hashes } },
	};
	const projected = compactFactoryContext(input);
	expect(JSON.stringify(projected).length).toBeLessThan(2000);
	expect(projected).toMatchObject({
		outputs: {
			capture: {
				screenshots: [
					{
						area: "Reader",
						state: "Paid",
						path: "reader.png",
						imageSha256: "image",
						sourceFingerprint: { entries: 16000, version: 1 },
					},
				],
			},
		},
		requirements: input.requirements,
		current: { manifestInventory: { count: 1, runtimeOnly: true } },
	});
	expect(input.outputs.capture.screenshots[0]!.dependencyHashes).toBe(hashes);
});

async function readValue(client: Client, path: string, view = "compact") {
	let text = "";
	let offset: number | null = 0;
	while (offset !== null) {
		const page = (
			await client.callTool({
				name: "read_context",
				arguments: { path, view, offset, limit: 16000 },
			})
		).structuredContent as { text: string; nextOffset: number | null };
		text += page.text;
		offset = page.nextOffset;
	}
	return JSON.parse(text);
}

it("compacts repeated history while preserving current inputs and all original evidence", async () => {
	const finding = {
		id: "access",
		rating: 3,
		status: "open",
		summary: "Access still fails",
		evidence: "Readback rejected",
	};
	const history = Array.from({ length: 92 }, (_, i) => ({
		step: i % 2 ? "pipeline/capture" : "pipeline/visual-review",
		at: `round-${i}`,
		output:
			i % 2
				? { receipt: "Raw QA evidence 🏭".repeat(3000) }
				: { findings: [finding], summary: "Reviewed" },
	}));
	const input = {
		outputs: {
			decisions: { requirements: ["Exact requirement"], answer: "Keep it" },
		},
		answers: [{ answer: "No waiver", questions: ["Access?"], at: "today" }],
		history,
		progress: { visit: 6, newHistory: history.slice(-10), diff: "Exact diff" },
	};
	const before = JSON.stringify(input);
	await withContext(input, async (client) => {
		const compact = await readValue(client, "");
		expect(JSON.stringify(compact).length).toBeLessThan(before.length / 20);
		expect(compact.outputs).toEqual(input.outputs);
		expect(compact.answers).toEqual(input.answers);
		expect(compact.progress.diff).toBe("Exact diff");
		expect(compact.history).toHaveLength(92);
		expect(compact.contextMemory.reviewLedger).toHaveLength(1);
		expect(compact.contextMemory.reviewLedger[0].findings).toEqual([
			{
				value: finding,
				firstPath: "/history/0/output/findings/0",
				latestPath: "/history/90/output/findings/0",
				firstRound: 0,
				latestRound: 90,
				occurrences: 46,
			},
		]);
		expect(await readValue(client, "/history", "full")).toEqual(history);
		expect(await readValue(client, compact.history[91].outputPath)).toEqual(
			history[91]!.output,
		);
		expect(
			await readValue(client, compact.progress.newHistory[9].outputPath),
		).toEqual(history[91]!.output);
		expect(await readValue(client, "/progress/newHistory", "full")).toEqual(
			history.slice(-10),
		);
	});
	expect(JSON.stringify(input)).toBe(before);
});

it("retains rejected fixes, distinct evidence and identical reopened claims without inferring resolution", async () => {
	const finding = {
		id: "bug",
		rating: 2,
		status: "open",
		evidence: "First probe",
	};
	const rejection = {
		id: "bug",
		status: "rejected",
		reason: "Original boundary is intentional",
	};
	const fixed = { id: "bug", status: "fixed", reason: "Applied correction" };
	const revised = { ...finding, evidence: "New failure after correction" };
	const observation = {
		id: "note",
		summary: "Nonblocking wording",
		evidence: "Recorded text",
	};
	const input = {
		history: [
			{
				step: "pipeline/code-review",
				output: { findings: [finding], observations: [observation] },
			},
			{ step: "pipeline/code-fix", output: { dispositions: [rejection] } },
			{
				step: "pipeline/code-review",
				output: {
					findings: [finding],
					summary: "Rejection denied: boundary still fails",
				},
			},
			{ step: "pipeline/code-fix", output: { dispositions: [fixed] } },
			{ step: "pipeline/code-review", output: { findings: [revised] } },
			{
				step: "pipeline/review-gate",
				output: {
					approved: true,
					findings: [],
					summary: "Correction accepted after fresh review",
				},
			},
			{
				step: "other/code-review",
				output: {
					findings: [{ ...finding, evidence: "Independent workflow" }],
				},
			},
		],
	};
	await withContext(input, async (client) => {
		const ledger = await readValue(client, "/contextMemory/reviewLedger");
		const bug = ledger.find(
			(item: { scope: string; id: string }) =>
				item.scope === "pipeline" && item.id === "bug",
		);
		expect(
			bug.findings.map((claim: { value: unknown }) => claim.value),
		).toEqual([finding, revised]);
		expect(bug.findings[0]).toMatchObject({
			firstRound: 0,
			latestRound: 2,
			occurrences: 2,
		});
		expect(
			bug.dispositions.map((claim: { value: unknown }) => claim.value),
		).toEqual([rejection, fixed]);
		expect(bug.findings[1].latestRound).toBeGreaterThan(
			bug.dispositions[1].latestRound,
		);
		expect(bug).not.toHaveProperty("resolved");
		expect(
			ledger.find((item: { id: string }) => item.id === "note").observations[0]
				.value,
		).toEqual(observation);
		expect(
			ledger.filter((item: { id: string }) => item.id === "bug"),
		).toHaveLength(2);
		for (const claim of [...bug.findings, ...bug.dispositions])
			expect(await readValue(client, claim.latestPath)).toEqual(claim.value);
		expect(await readValue(client, "/history/5/output")).toEqual({
			approved: true,
			findings: [],
			summary: "Correction accepted after fresh review",
		});
		const rounds = await readValue(client, "/contextMemory/reviewRounds");
		expect(rounds[2].summary).toBe("Rejection denied: boundary still fails");
		expect(rounds[5]).toMatchObject({
			approved: true,
			summary: "Correction accepted after fresh review",
			outputPath: "/history/5/output",
		});
	});
});

it("lists role identities in pages without one read per historical step", async () => {
	const history = Array.from({ length: 103 }, (_, i) => ({
		step: `pipeline/role-${i}`,
		at: `round-${i}`,
		output: { receipt: i },
	}));
	await withContext({ history }, async (client) => {
		const entries: {
			path: string;
			preview: { step: string; outputPath: string };
		}[] = [];
		let offset: number | null = 0;
		let calls = 0;
		while (offset !== null) {
			const page = (
				await client.callTool({
					name: "list_context",
					arguments: { path: "/history", limit: 50, offset },
				})
			).structuredContent as {
				entries: typeof entries;
				nextOffset: number | null;
			};
			entries.push(...page.entries);
			offset = page.nextOffset;
			calls++;
		}
		expect(calls).toBe(3);
		expect(entries.map((item) => item.preview.step)).toEqual(
			history.map((item) => item.step),
		);
		expect(await readValue(client, entries[102]!.preview.outputPath)).toEqual({
			receipt: 102,
		});
	});
});

it("keeps compact and full views scoped, immutable and compatible with unlabelled legacy claims", async () => {
	const input = {
		history: [
			{ step: "code-review", output: { findings: ["Legacy complaint"] } },
		],
	};
	await withContext(input, async (client) => {
		input.history.push({
			step: "code-review",
			output: { findings: ["Later mutation"] },
		});
		const compact = await readValue(client, "");
		expect(compact.history).toHaveLength(1);
		expect(compact.contextMemory.reviewLedger[0].findings[0].value).toBe(
			"Legacy complaint",
		);
		expect(await readValue(client, "/history", "full")).toHaveLength(1);
		for (const view of ["compact", "full"])
			for (const path of [
				"/outputs/ticket",
				"/__proto__",
				"/history/0/toString",
				"/history/~2",
			])
				expect(
					(
						await client.callTool({
							name: "read_context",
							arguments: { path, view },
						})
					).isError,
				).toBe(true);
	});
	const scoped = {
		plan: { requirements: ["Declared only"] },
		progress: { newHistory: [] },
	};
	expect(factoryContextView(scoped)).toEqual(scoped);
	const collision = {
		history: [],
		contextMemory: { answer: "Declared input" },
	};
	expect(factoryContextView(collision)).toEqual(collision);
});
