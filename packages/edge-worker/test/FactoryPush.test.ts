import { createECDH } from "node:crypto";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import webPush from "web-push";
import { FactoryPush } from "../src/factory/FactoryPush.js";
import {
	type PushEvent,
	type PushSession,
	runPushEvent,
	sessionPushEvent,
} from "../src/factory/PushEvents.js";
import {
	publicAddress,
	SubscriptionSchema,
} from "../src/factory/PushTransport.js";
import { validateWorkflows } from "../src/factory/Workflow.js";
import {
	type FactoryRun,
	WorkflowRuntime,
} from "../src/factory/WorkflowRuntime.js";

const homes: string[] = [];
const home = () => {
	const value = mkdtempSync(join(tmpdir(), "factory-push-"));
	homes.push(value);
	return value;
};
const subject = "mailto:test@example.com";
const ec = createECDH("prime256v1");
ec.generateKeys();
const subscription = (id: string) => ({
	endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
	keys: {
		p256dh: ec.getPublicKey().toString("base64url"),
		auth: Buffer.alloc(16, 1).toString("base64url"),
	},
});
const event = (
	identity: string,
	category: PushEvent["category"] = "question",
): PushEvent => ({ identity, category, destination: "/#/runs/run" });
const observe = (push: FactoryPush, value?: PushEvent, baseline = false) =>
	push.observe(new Map([["run", value]]), baseline);
const tick = () => vi.advanceTimersByTimeAsync(750);
afterEach(() => {
	vi.useRealTimers();
	for (const path of homes.splice(0))
		rmSync(path, { recursive: true, force: true });
});
it("baselines attention, deduplicates saves, captures eligible devices and coalesces destinations", async () => {
	vi.useFakeTimers();
	const sender = vi.fn(async () => {});
	const push = new FactoryPush(home(), sender, Date.now, subject);
	observe(push, event("existing"), true);
	const first = push.register({
		label: "one",
		subscription: subscription("one"),
	});
	expect(
		push.register({ label: "one again", subscription: subscription("one") }).id,
	).toBe(first.id);
	observe(push, event("existing"));
	await tick();
	expect(sender).not.toHaveBeenCalled();
	observe(push, event("new"));
	observe(push, event("gate", "review"));
	push.register({ label: "two", subscription: subscription("two") });
	await tick();
	expect(sender).toHaveBeenCalledTimes(1);
	expect(JSON.parse(sender.mock.calls[0]![1])).toMatchObject({
		category: "review",
		title: "Bob’s Factory",
	});
	observe(push, event("gate", "review"));
	await tick();
	expect(sender).toHaveBeenCalledTimes(1);
	observe(push);
	observe(push, event("done", "completion"));
	await tick();
	expect(sender).toHaveBeenCalledTimes(3);
	await push.stop();
});
it("consumes transient failures/backoff events without recovery replay, and removes expired endpoints", async () => {
	vi.useFakeTimers();
	let now = Date.now();
	const sender = vi.fn(async () => {
		throw { statusCode: 503 };
	});
	const push = new FactoryPush(home(), sender, () => now, subject);
	push.register({ label: "one", subscription: subscription("one") });
	observe(push, event("1"));
	await tick();
	expect(push.status().devices[0]?.health).toBe("degraded");
	observe(push, event("2"));
	now += 60000;
	await tick();
	expect(sender).toHaveBeenCalledTimes(1); // Created during backoff, even when dispatch occurs after it.
	sender.mockImplementation(async () => {});
	observe(push, event("2"));
	await tick();
	expect(sender).toHaveBeenCalledTimes(1);
	observe(push, event("3"));
	await tick();
	expect(sender).toHaveBeenCalledTimes(2);
	sender.mockImplementation(async () => {
		throw { statusCode: 410 };
	});
	observe(push, event("4"));
	await tick();
	expect(push.status().devices).toEqual([]);
	await push.stop();
});
it("rechecks disable/generation and does not replay claimed or queued events across restart", async () => {
	vi.useFakeTimers();
	const path = home();
	const sender = vi.fn(async () => {});
	let push = new FactoryPush(path, sender, Date.now, subject);
	const { id } = push.register({
		label: "one",
		subscription: subscription("one"),
	});
	observe(push, event("1"));
	push.update(id, { enabled: false });
	push.register({ label: "one", subscription: subscription("one") });
	await tick();
	expect(sender).not.toHaveBeenCalled();
	observe(push, event("2"));
	await tick();
	expect(sender).toHaveBeenCalledTimes(1);
	const store = JSON.parse(
		readFileSync(join(path, "factory/push.json"), "utf8"),
	);
	expect(
		store.receipts.some((r: { outcome: string }) => r.outcome === "claimed"),
	).toBe(true);
	observe(push, event("3"));
	const key = push.status().publicKey;
	await push.stop();
	push = new FactoryPush(path, sender, Date.now, subject);
	expect(push.status().publicKey).toBe(key);
	observe(push, event("4"), true);
	await tick();
	expect(sender).toHaveBeenCalledTimes(1);
	observe(push, event("5"));
	await tick();
	expect(sender).toHaveBeenCalledTimes(2);
	expect(statSync(join(path, "factory/push.json")).mode & 0o777).toBe(0o600);
	await push.stop();
});
it.each([
	"question",
	"review",
] as const)("retains unresolved %s through ticket-backed restart preparation, then sends new attention", async (category) => {
	vi.useFakeTimers();
	const path = home();
	const sender = vi.fn(async () => {});
	const hooks = {
		prepare: async () => {},
		agent: async () => ({ questions: ["Choose an option"] }),
		script: async () => ({}),
		tool: async () => ({ headSha: "revision", url: "https://example.com/pr" }),
	};
	let runtime = new WorkflowRuntime(path, hooks);
	let push = new FactoryPush(path, sender, Date.now, subject);
	const source = { sessions: () => [], subscribe: () => () => {} };
	push.attach(runtime, source);
	push.register({ label: "one", subscription: subscription("one") });
	const workflow = validateWorkflows([
		...runtime.listWorkflows(),
		{
			id: "fixture",
			name: "Fixture",
			steps: [
				category === "question"
					? {
							id: "attention",
							name: "Question",
							type: "agent",
							prompt: "Ask",
							askQuestions: true,
							maxVisits: 3,
						}
					: {
							id: "attention",
							name: "Review",
							type: "tool",
							tool: "human-review",
							maxVisits: 3,
							branches: [
								{
									when: { path: "decision", equals: "reject" },
									next: "attention",
								},
							],
						},
			],
		},
	]).at(-1)!;
	let run = runtime.create({
		workflow,
		triggerOrigin: {
			type: "manual",
			workflowId: workflow.id,
			at: new Date().toISOString(),
		},
		repositoryId: "fixture",
		workspace: path,
		input: "Fixture",
		ticketReference: {
			provider: "taskbot",
			instance: "https://example.com",
			project: "fixture",
			id: 1,
			url: "https://example.com/t/1",
		},
	});
	void runtime.launch(run);
	await vi.waitFor(() => expect(run.status).toBe("waiting"));
	await tick();
	expect(sender).toHaveBeenCalledTimes(1);
	const original = runPushEvent(run);
	await runtime.shutdown();
	await push.stop();
	runtime = new WorkflowRuntime(path, hooks);
	push = new FactoryPush(path, sender, Date.now, subject);
	push.attach(runtime, source);
	run = runtime.get(run.id);
	runtime.resumeAll();
	await vi.waitFor(() => expect(run.status).toBe("waiting"));
	expect(runPushEvent(run)).toEqual(original);
	await tick();
	expect(sender).toHaveBeenCalledTimes(1);
	if (category === "question") runtime.answer(run.id, "Ask again");
	else
		runtime.decide(run.id, {
			reviewId: run.reviewGate!.id,
			headSha: run.reviewGate!.headSha,
			decision: "reject",
			feedback: "Revise",
		});
	await vi.waitFor(() => expect(run.status).toBe("waiting"));
	await tick();
	expect(sender).toHaveBeenCalledTimes(2);
	expect(JSON.parse(sender.mock.calls[1]![1]).category).toBe(category);
	await runtime.shutdown();
	await push.stop();
});
it("defers native completion while work is pending, then sends the final completion once", async () => {
	vi.useFakeTimers();
	const sender = vi.fn(async () => {});
	const push = new FactoryPush(home(), sender, Date.now, subject);
	const runtime = new WorkflowRuntime(home(), {
		agent: async () => ({}),
		script: async () => ({}),
		tool: async () => ({}),
	});
	const session: PushSession = { id: "native", status: "active" };
	let notify = () => {};
	push.attach(runtime, {
		sessions: () => [session],
		subscribe: (listener) => {
			notify = listener;
			return () => {};
		},
	});
	push.register({ label: "one", subscription: subscription("one") });
	session.status = "complete";
	session.pendingWork = true;
	notify();
	await tick();
	expect(sender).not.toHaveBeenCalled();
	session.status = "active";
	notify();
	session.pendingWork = false;
	session.status = "complete";
	notify();
	await tick();
	expect(sender).toHaveBeenCalledTimes(1);
	expect(JSON.parse(sender.mock.calls[0]![1]).category).toBe("completion");
	notify();
	await tick();
	expect(sender).toHaveBeenCalledTimes(1);
	expect(
		sessionPushEvent({ id: "failed", status: "error", pendingWork: true })
			?.category,
	).toBe("failure");
	await runtime.shutdown();
	await push.stop();
});
it("claims before dispatch, isolates corrupt storage and never exposes private records", async () => {
	vi.useFakeTimers();
	const path = home();
	const sender = vi.fn(async () => {
		const persisted = JSON.parse(
			readFileSync(join(path, "factory/push.json"), "utf8"),
		);
		expect(persisted.receipts.at(-1).outcome).toBe("claimed");
	});
	const push = new FactoryPush(path, sender, Date.now, subject);
	push.register({
		label: "browser",
		subscription: subscription("private-endpoint"),
	});
	observe(push, event("1"));
	await tick();
	expect(JSON.stringify(push.status())).not.toMatch(
		/privateKey|endpoint|p256dh|auth"/,
	);
	expect(JSON.parse(sender.mock.calls[0]![1])).not.toHaveProperty("questions");
	await push.stop();
	writeFileSync(join(path, "factory/push.json"), "corrupt");
	const broken = new FactoryPush(path, sender, Date.now, subject);
	expect(broken.status().available).toBe(false);
	expect(() => observe(broken, event("new"))).not.toThrow();
	expect(() =>
		broken.register({ label: "x", subscription: subscription("x") }),
	).toThrow(/storage/);
	expect(readFileSync(join(path, "factory/push.json"), "utf8")).toBe("corrupt");
	await broken.stop();
});
it("runs real transport tests only for enabled devices, with rate limiting and auth health", async () => {
	const sender = vi.fn(async () => {});
	const push = new FactoryPush(home(), sender, Date.now, subject);
	const { id } = push.register({
		label: "one",
		subscription: subscription("one"),
	});
	expect((await push.test(id)).accepted).toBe(true);
	expect(JSON.parse(sender.mock.calls[0]![1]).category).toBe("test");
	await expect(push.test(id)).rejects.toThrow(/30 seconds/);
	push.update(id, { enabled: false });
	await expect(push.test(id)).rejects.toThrow(/Enable/);
	await push.stop();
});
it("restricts outbound destinations and sets zero provider TTL with encrypted VAPID requests", () => {
	const keys = webPush.generateVAPIDKeys();
	const request = webPush.generateRequestDetails(
		subscription("real-shaped"),
		"minimal payload",
		{ vapidDetails: { subject, ...keys }, TTL: 0, timeout: 5000 },
	);
	expect(request.headers.TTL).toBe(0);
	expect(request.body?.toString()).not.toContain("minimal payload");
	expect(request.headers.Authorization).toBeTruthy();
	for (const endpoint of [
		"http://fcm.googleapis.com/x",
		"https://localhost/x",
		"https://100.64.0.1/x",
		"https://fcm.googleapis.com.evil.test/x",
		"https://u:p@fcm.googleapis.com/x",
		"https://fcm.googleapis.com:443/x#fragment",
	])
		expect(
			SubscriptionSchema.safeParse({ ...subscription("x"), endpoint }).success,
		).toBe(false);
	for (const address of [
		"127.0.0.1",
		"10.0.0.1",
		"172.16.0.1",
		"192.168.1.2",
		"100.64.0.1",
		"::1",
		"::ffff:127.0.0.1",
		"fd00::1",
	])
		expect(publicAddress(address)).toBe(false);
	expect(publicAddress("142.250.1.1")).toBe(true);
	expect(publicAddress("2607:f8b0::1")).toBe(true);
});
it("classifies explicit attention and completion, excluding ordinary activity and automatic recovery", () => {
	const base = {
		id: "run",
		status: "running",
		questions: [],
		answers: [],
		outputs: {},
	} as unknown as FactoryRun;
	expect(runPushEvent(base)).toBeUndefined();
	const question = {
		...base,
		status: "waiting",
		step: "clarify",
		questions: ["Secret ticket text"],
	} as FactoryRun;
	expect(runPushEvent(question)?.category).toBe("question");
	expect(
		runPushEvent({ ...question, title: "changed", updatedAt: "new" }),
	).toEqual(runPushEvent(question));
	expect(
		runPushEvent({ ...question, questions: ["Changed"] })?.identity,
	).not.toBe(runPushEvent(question)?.identity);
	expect(
		runPushEvent({
			...question,
			reviewGate: {
				id: "gate",
				status: "pending",
				headSha: "abc",
				url: "private",
			},
		})?.destination,
	).toBe("/#/runs/run/review");
	for (const status of ["failed", "interrupted"])
		expect(runPushEvent({ ...base, status } as FactoryRun)?.category).toBe(
			"failure",
		);
	expect(runPushEvent({ ...base, status: "stopped" })).toBeUndefined();
	expect(runPushEvent({ ...base, status: "completed" })?.category).toBe(
		"completion",
	);
	const readiness = {
		headSha: "abc",
		blockers: [{ kind: "rules", action: "human", message: "approval" }],
	};
	expect(
		runPushEvent({ ...base, outputs: { "merge-readiness": readiness } })
			?.category,
	).toBe("blocker");
	expect(
		runPushEvent({
			...base,
			reviewGate: {
				id: "existing",
				headSha: "abc",
				status: "approve",
				url: "private",
			},
			outputs: {
				"merge-readiness": {
					...readiness,
					blockers: [
						{ kind: "draft", action: "human", message: "approve guide" },
					],
				},
			},
		}),
	).toBeUndefined();

	expect(
		runPushEvent({
			...base,
			outputs: {
				"merge-readiness": {
					...readiness,
					blockers: [...readiness.blockers, { action: "wait" }],
				},
			},
		}),
	).toBeUndefined();
	expect(sessionPushEvent({ id: "simple", status: "complete" })?.category).toBe(
		"completion",
	);
	expect(
		sessionPushEvent({ id: "simple", status: "error", stopped: true }),
	).toBeUndefined();
	expect(
		sessionPushEvent({ id: "simple", status: "error", recovering: true }),
	).toBeUndefined();
});
