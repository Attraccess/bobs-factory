import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AgentActivitySignal,
	createLogger,
	presentLinearActivity,
} from "bobs-factory-core";
import { afterEach, expect, it, vi } from "vitest";
import { LinearDeliveryOutbox } from "../src/LinearDeliveryOutbox.js";

type Input = {
	id?: string;
	agentSessionId: string;
	content: { type: string; body: string };
};
const homes: string[] = [];
afterEach(() => {
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
function fixture(
	legacy?: { input: Input; ambiguous: boolean },
	reconciled = false,
) {
	const home = mkdtempSync(join(tmpdir(), "linear-publication-101-"));
	homes.push(home);
	const workspace = "fixture";
	const directory = join(home, "state", "linear-activity-delivery");
	if (legacy) {
		mkdirSync(directory, { recursive: true });
		writeFileSync(
			join(
				directory,
				`${createHash("sha256").update(workspace).digest("hex")}.json`,
			),
			JSON.stringify({
				version: 1,
				records: [
					{
						id: legacy.input.id,
						input: legacy.input,
						status: "pending",
						attempts: 1,
						nextAt: 0,
						ambiguous: legacy.ambiguous,
					},
				],
			}),
		);
	}
	const send = vi.fn(async (input: Input) => ({ success: true, id: input.id }));
	const reconcile = vi.fn(async (_input: Input) => reconciled);
	const owner = {};
	const box = LinearDeliveryOutbox.open(
		home,
		workspace,
		owner,
		send,
		createLogger({ component: "publication-test" }),
		reconcile,
		() => 0,
		"activity",
		() => 0,
		() => true,
		(input) => {
			const content = presentLinearActivity(input.content);
			return content ? { ...input, content } : undefined;
		},
		(input) => `${input.agentSessionId}:checks`,
	);
	const records = () =>
		JSON.parse(
			readFileSync(
				join(
					directory,
					readdirSync(directory).find((file) => file.endsWith(".json"))!,
				),
				"utf8",
			),
		).records;
	return { box, send, reconcile, owner, records };
}
it("suppresses an unsent legacy result and retains its evidence and disposition", async () => {
	const input = {
		id: "legacy",
		agentSessionId: "session",
		content: {
			type: "response",
			body: '```json\n{"findings":[],"summary":"Review completed"}\n```',
		},
	};
	const f = fixture({ input, ambiguous: false });
	await f.box.flush();
	expect(f.send).not.toHaveBeenCalled();
	expect(f.records()[0]).toMatchObject({
		status: "superseded",
		originalEvidence: input,
		presentation: {
			version: 1,
			reason: "Internal or routine content suppressed; original retained",
		},
	});
	await expect(f.box.post(input)).resolves.toEqual({
		success: true,
		id: undefined,
	});
	f.box.stop(f.owner);
});
it("reconciles ambiguous legacy delivery using its original content before presentation", async () => {
	const input = {
		id: "legacy",
		agentSessionId: "session",
		content: { type: "response", body: '{"status":"completed"}' },
	};
	const f = fixture({ input, ambiguous: true }, true);
	await f.box.flush();
	expect(f.reconcile).toHaveBeenCalledExactlyOnceWith(input);
	expect(f.send).not.toHaveBeenCalled();
	expect(f.records()[0]).toMatchObject({
		status: "delivered",
		originalEvidence: input,
	});
	f.box.stop(f.owner);
});
it("coalesces unchanged check states durably but publishes failure and resume transitions", async () => {
	const f = fixture();
	const input = {
		agentSessionId: "session",
		content: { type: "thought", body: "CI checks pending" },
	};
	await f.box.post(input);
	await f.box.post(input);
	await f.box.post({
		...input,
		content: { type: "error", body: "CI checks failed: restore access" },
	});
	await f.box.post(input);
	expect(f.send.mock.calls.map(([value]) => value.content)).toEqual([
		input.content,
		{ type: "error", body: "CI checks failed: restore access" },
		input.content,
	]);
	await expect(
		f.box.post({
			id: f.records()[0].id,
			...input,
			content: { type: "thought", body: "changed" },
		}),
	).rejects.toThrow("identity");
	f.box.stop(f.owner);
});

it("retains legacy operational comments pending without sending them as documentation", async () => {
	const { LinearClient } = await import("@linear/sdk");
	const { LinearIssueTrackerService } = await import(
		"../src/LinearIssueTrackerService.js"
	);
	const home = mkdtempSync(join(tmpdir(), "linear-legacy-comment-101-"));
	homes.push(home);
	const client = new LinearClient({ accessToken: "isolated-comment-fixture" });
	const request = vi.fn();
	client.client.request = request;
	const tracker = new LinearIssueTrackerService(client, undefined, undefined, {
		factoryHome: home,
		workspaceId: "legacy-comment",
		requestIntervalMs: 0,
	});
	await expect(
		tracker.createComment("issue", {
			body: "Factory work started: existing run",
		}),
	).rejects.toThrow("pending");
	expect(request).not.toHaveBeenCalled();
	expect(tracker.getActivityDeliveryStatus()).toMatchObject({
		pending: 1,
		error:
			"Operational Linear comment retained locally; restore its transcript binding before delivery",
	});
	const directory = join(home, "state", "linear-comment-delivery");
	const saved = JSON.parse(
		readFileSync(join(directory, readdirSync(directory)[0]!), "utf8"),
	);
	expect(saved.records[0].input.body).toBe(
		"Factory work started: existing run",
	);
	tracker.stopDelivery();
});

it("retains the full failed log locally while sending only diagnostic prose", async () => {
	const f = fixture();
	const input = {
		agentSessionId: "session",
		content: {
			type: "error",
			body: `${"Building module\n".repeat(3000)}error TS2345: Expected a string.`,
		},
	};
	await f.box.post(input);
	expect(f.send.mock.calls[0]![0].content).toEqual({
		type: "error",
		body: "Building module\nerror TS2345: Expected a string.…\n\nFull output is retained in Factory.",
	});
	expect(f.records()[0]).toMatchObject({
		status: "delivered",
		originalEvidence: input,
	});
	f.box.stop(f.owner);
});

it("preserves native lifecycle and signals through direct and queued SDK delivery", async () => {
	const { LinearClient } = await import("@linear/sdk");
	const { LinearIssueTrackerService } = await import(
		"../src/LinearIssueTrackerService.js"
	);
	const home = mkdtempSync(join(tmpdir(), "linear-operational-thoughts-"));
	homes.push(home);
	for (const factoryHome of [undefined, home]) {
		const sent: unknown[] = [];
		const client = new LinearClient({ accessToken: "isolated-wire-fixture" });
		client.client.request = vi.fn(async (_document, variables: any) => {
			sent.push(variables.input);
			return {
				agentActivityCreate: {
					success: true,
					agentActivity: { id: variables.input.id },
					lastSyncId: 1,
				},
			};
		}) as any;
		const tracker = new LinearIssueTrackerService(
			client,
			undefined,
			undefined,
			{ factoryHome, workspaceId: "wire-fixture", requestIntervalMs: 0 },
		);
		try {
			for (const type of ["response", "elicitation", "error"]) {
				await tracker.createAgentActivity({
					agentSessionId: "session",
					content: { type, body: "Please restore access." },
					ephemeral: true,
					...(type === "elicitation"
						? {
								signal: AgentActivitySignal.Auth,
								signalMetadata: { url: "https://example.com/approve" },
							}
						: {}),
				});
			}
			expect(sent).toEqual(
				["response", "elicitation", "error"].map((type) => ({
					agentSessionId: "session",
					content: { type, body: "Please restore access." },
					ephemeral: undefined,
					...(type === "elicitation"
						? {
								signal: "auth",
								signalMetadata: { url: "https://example.com/approve" },
							}
						: {}),
					...(factoryHome ? { id: expect.any(String) } : {}),
				})),
			);
		} finally {
			tracker.stopDelivery();
		}
	}
});
