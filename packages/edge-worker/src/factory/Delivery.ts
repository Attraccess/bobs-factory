import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { deliveryRevisions } from "./RepositoryScope.js";
import type { FactoryRun } from "./WorkflowRuntime.js";

const text = z.string().min(1);
const relation = z.object({
	type: z.enum(["blocks", "related", "duplicate", "similar"]),
	from: text,
	to: text,
});
export const TicketTargetSchema = z
	.discriminatedUnion("provider", [
		z.object({
			provider: z.literal("linear"),
			workspaceId: text,
			instance: z.literal("https://linear.app"),
			project: text,
			id: z.string().uuid(),
			url: z.string().url(),
		}),
		z.object({
			provider: z.literal("taskbot"),
			server: text,
			instance: z.string().url(),
			project: z.string().regex(/^[a-z0-9-]+$/),
			id: z.string().regex(/^[1-9]\d*$/),
			url: z.string().url(),
		}),
	])
	.superRefine((target, ctx) => {
		const url = new URL(target.url);
		if (
			url.origin !== target.instance ||
			url.username ||
			url.password ||
			(target.provider === "taskbot" &&
				target.url !== `${target.instance}/p/${target.project}/t/${target.id}`)
		)
			ctx.addIssue({
				code: "custom",
				message: "Target URL must match verified tracker coordinates",
			});
	});
export type TicketTarget = z.infer<typeof TicketTargetSchema>;
export type TicketRelation = z.infer<typeof relation>;
const fields = z
	.object({
		title: z.string().optional(),
		description: z.string().nullable().optional(),
	})
	.strict();
export const DeliveryContractSchema = z
	.object({
		format: z.literal("delivery-v1"),
		version: z.number().int().positive(),
		mode: z.enum(["repository", "external", "mixed"]),
		authorization: z.object({
			status: z.enum(["authorized", "deferred"]),
			reference: text,
		}),
		executionReference: text,
		targets: z.array(
			z.object({
				key: text,
				resource: TicketTargetSchema,
				capabilities: z
					.array(z.enum(["read", "content", "relationships"]))
					.min(1),
				baseline: z.object({ fields, relationships: z.array(relation) }),
				operations: z.array(
					z.discriminatedUnion("kind", [
						z.object({ id: text, kind: z.literal("content"), fields }),
						z.object({
							id: text,
							kind: z.enum(["add", "remove"]),
							relationship: relation,
						}),
					]),
				),
				criteria: z
					.array(
						z.object({
							id: text,
							requirementRef: text,
							description: text,
							fields,
							relationships: z.array(relation),
							absentRelationships: z.array(relation),
						}),
					)
					.min(1),
				preservedRelationships: z.array(relation),
			}),
		),
	})
	.superRefine((contract, ctx) => {
		const fail = (message: string) => ctx.addIssue({ code: "custom", message });
		if ((contract.mode === "repository") !== (contract.targets.length === 0))
			fail(
				"External and mixed delivery need targets; repository delivery cannot contain ticket mutations",
			);
		const ids = new Set<string>();
		const unique = (id: string) => {
			if (ids.has(id)) fail(`Duplicate delivery reference: ${id}`);
			ids.add(id);
		};
		const resources = new Set<string>();
		for (const target of contract.targets) {
			unique(target.key);
			const identity = JSON.stringify(target.resource);
			if (resources.has(identity)) fail("A ticket may appear only once");
			resources.add(identity);
			if (!target.capabilities.includes("read"))
				fail("Every target requires read access");
			for (const op of target.operations) {
				unique(op.id);
				if (op.kind === "content") {
					if (
						!Object.keys(op.fields).length ||
						!target.capabilities.includes("content")
					)
						fail("Content operations require fields and capability");
					for (const key of Object.keys(op.fields))
						if (!(key in target.baseline.fields))
							fail("Authorized fields require a before-state");
				} else {
					if (!["blocks", "related"].includes(op.relationship.type))
						fail(
							"Only blocks and related relationship mutations are supported; all other relationships are preserved",
						);
					if (!target.capabilities.includes("relationships"))
						fail("Relationship operations require capability");
					if (
						op.relationship.from !== target.resource.id &&
						op.relationship.to !== target.resource.id
					)
						fail("Relationship must touch the target");
					if (
						op.kind === "remove" &&
						target.preservedRelationships.some((r) =>
							sameRelation(r, op.relationship),
						)
					)
						fail("Cannot remove a preserved relationship");
				}
			}
			for (const baseline of target.baseline.relationships)
				if (
					!target.operations.some(
						(op) =>
							op.kind === "remove" && sameRelation(op.relationship, baseline),
					) &&
					!target.preservedRelationships.some((r) => sameRelation(r, baseline))
				)
					fail("Unchanged baseline relationships must be explicitly preserved");
			for (const criterion of target.criteria) unique(criterion.id);
		}
	});
export type DeliveryContract = z.infer<typeof DeliveryContractSchema>;
export interface TicketState {
	resource: TicketTarget;
	fields: { title?: string; description?: string | null };
	relationships: TicketRelation[];
	complete: boolean;
}
export interface TicketDeliveryAdapter {
	capabilities: ("read" | "content" | "relationships")[];
	read(): Promise<TicketState>;
	content(fields: TicketState["fields"]): Promise<void>;
	relationship(kind: "add" | "remove", value: TicketRelation): Promise<void>;
	limitation: string;
}
export interface DeliveryReceipt {
	id: string;
	target: string;
	intent: DeliveryContract["targets"][number]["operations"][number];
	before: TicketState;
	after?: TicketState;
	status: "pending" | "applied" | "failed" | "uncertain" | "conflicted";
	attempts: number;
	error?: string;
	limitation: string;
}
export interface ExternalSnapshot {
	format: "external-evidence-v1";
	contractDigest: string;
	contractVersion: number;
	resources: TicketState[];
	criteria: { id: string; passed: boolean; observed: TicketState }[];
	digest: string;
	at: string;
}
export interface DeliveryState {
	contract: DeliveryContract;
	contractDigest: string;
	receipts: DeliveryReceipt[];
	verification?: ExternalSnapshot;
	finalCheck?: { digest: string; reviewId: string; at: string };
}
export function digest(value: unknown): string {
	const canonical = (v: unknown): unknown =>
		Array.isArray(v)
			? v.map(canonical)
			: v && typeof v === "object"
				? Object.fromEntries(
						Object.entries(v)
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([k, x]) => [k, canonical(x)]),
					)
				: v;
	return createHash("sha256")
		.update(JSON.stringify(canonical(value)) ?? "null")
		.digest("hex");
}
export function sameRelation(a: TicketRelation, b: TicketRelation): boolean {
	return (
		a.type === b.type &&
		((a.from === b.from && a.to === b.to) ||
			(a.type === "related" && a.from === b.to && a.to === b.from))
	);
}
function normalized(
	state: TicketState,
	target: DeliveryContract["targets"][number],
): TicketState {
	if (!state.complete || !isDeepStrictEqual(state.resource, target.resource))
		throw new Error(`Incomplete or wrong tracker resource: ${target.key}`);
	const keys = new Set([
		...Object.keys(target.baseline.fields),
		...target.criteria.flatMap((c) => Object.keys(c.fields)),
	]);
	const relationships = state.relationships.map((r) =>
		r.type === "related" && r.from > r.to
			? { ...r, from: r.to, to: r.from }
			: r,
	);
	return {
		resource: state.resource,
		complete: true,
		fields: Object.fromEntries(
			[...keys]
				.sort()
				.map((k) => [k, state.fields[k as keyof TicketState["fields"]]]),
		),
		relationships: relationships.sort((a, b) =>
			JSON.stringify(a).localeCompare(JSON.stringify(b)),
		),
	};
}
function matchesFields(
	actual: TicketState["fields"],
	expected: TicketState["fields"],
): boolean {
	return Object.entries(expected).every(
		([key, value]) => actual[key as keyof typeof actual] === value,
	);
}
function achieved(state: TicketState, op: DeliveryReceipt["intent"]): boolean {
	return op.kind === "content"
		? matchesFields(state.fields, op.fields)
		: state.relationships.some((r) => sameRelation(r, op.relationship)) ===
				(op.kind === "add");
}
export function freezeDelivery(run: FactoryRun, value: unknown): DeliveryState {
	const contract = DeliveryContractSchema.parse(value);
	if (contract.authorization.status !== "authorized")
		throw new Error(
			`Execution is deferred: ${contract.authorization.reference}`,
		);
	const contractDigest = digest(contract);
	if (
		contract.executionReference !==
		digest(
			run.executionSnapshot ?? {
				runner: run.runner,
				repositoryId: run.repositoryId,
			},
		)
	)
		throw new Error(
			"Delivery contract execution identity/tool snapshot differs from accepted run",
		);
	if (run.delivery && run.delivery.contractDigest !== contractDigest) {
		if (contract.version <= run.delivery.contract.version)
			throw new Error(
				"Revised delivery contract must advance its reviewed version",
			);
		for (const target of contract.targets)
			for (const op of target.operations) {
				const prior = run.delivery.receipts.find((r) => r.id === op.id);
				if (
					prior &&
					(!isDeepStrictEqual(prior.intent, op) || prior.target !== target.key)
				)
					throw new Error("Changed operation intents require new stable IDs");
			}
		run.deliveryContracts ??= [];
		run.deliveryContracts.push(structuredClone(run.delivery));
		run.delivery = {
			contract: structuredClone(contract),
			contractDigest,
			receipts: run.delivery.receipts,
		};
		delete run.reviewGate;
	}
	run.delivery ??= {
		contract: structuredClone(contract),
		contractDigest,
		receipts: [],
	};
	return run.delivery;
}
export class TicketDelivery {
	constructor(
		private adapter: (
			run: FactoryRun,
			target: TicketTarget,
		) => Promise<TicketDeliveryAdapter>,
		private save: (run: FactoryRun) => void,
	) {}
	private accepted(run: FactoryRun): DeliveryState {
		if (
			!run.delivery ||
			digest(run.delivery.contract) !== run.delivery.contractDigest
		)
			throw new Error("Accepted delivery contract required");
		if (run.delivery.contract.authorization.status !== "authorized")
			throw new Error("Execution is deferred");
		return run.delivery;
	}
	async preflight(run: FactoryRun): Promise<void> {
		for (const target of this.accepted(run).contract.targets) {
			const adapter = await this.adapter(run, target.resource);
			if (target.capabilities.some((c) => !adapter.capabilities.includes(c)))
				throw new Error(
					`Missing configured ticket capability for ${target.key}`,
				);
			normalized(await adapter.read(), target);
		}
	}
	async apply(run: FactoryRun): Promise<void> {
		const delivery = this.accepted(run);
		await this.preflight(run);
		delete delivery.verification;
		delete delivery.finalCheck;
		this.save(run);
		for (const target of delivery.contract.targets) {
			const adapter = await this.adapter(run, target.resource);
			for (const op of target.operations) {
				const actual = normalized(await adapter.read(), target);
				let receipt = delivery.receipts.find((r) => r.id === op.id);
				if (achieved(actual, op)) {
					if (!receipt) {
						receipt = {
							id: op.id,
							target: target.key,
							intent: op,
							before: actual,
							status: "applied",
							attempts: 0,
							limitation: adapter.limitation,
						};
						delivery.receipts.push(receipt);
					}
					receipt.after = actual;
					receipt.status = "applied";
					delete receipt.error;
					this.save(run);
					continue;
				}
				if (receipt?.status === "applied")
					throw new Error(
						`Applied ticket change drifted: ${op.id}; do not overwrite intervening work`,
					);
				const baseline =
					receipt?.before ??
					normalized(
						{ resource: target.resource, ...target.baseline, complete: true },
						target,
					);
				if (!receipt)
					for (const prior of target.operations.slice(
						0,
						target.operations.indexOf(op),
					)) {
						if (
							!delivery.receipts.some(
								(r) => r.id === prior.id && r.status === "applied",
							)
						)
							continue;
						if (prior.kind === "content")
							Object.assign(baseline.fields, prior.fields);
						else if (
							prior.kind === "add" &&
							!baseline.relationships.some((r) =>
								sameRelation(r, prior.relationship),
							)
						)
							baseline.relationships.push(prior.relationship);
						else if (prior.kind === "remove")
							baseline.relationships = baseline.relationships.filter(
								(r) => !sameRelation(r, prior.relationship),
							);
					}
				baseline.relationships = normalized(baseline, target).relationships;
				// Compare affected fields and ALL relationships so unrelated concurrent edits are preserved.
				const safe =
					op.kind === "content"
						? Object.keys(op.fields).every(
								(k) =>
									actual.fields[k as keyof typeof actual.fields] ===
									baseline.fields[k as keyof typeof baseline.fields],
							)
						: isDeepStrictEqual(actual.relationships, baseline.relationships);
				if (!receipt) {
					receipt = {
						id: op.id,
						target: target.key,
						intent: op,
						before: actual,
						status: "pending",
						attempts: 0,
						limitation: adapter.limitation,
					};
					delivery.receipts.push(receipt);
				}
				if (!safe) {
					receipt.status = "conflicted";
					receipt.error = "Relevant state changed since accepted baseline";
					this.save(run);
					throw new Error(`${op.id}: ${receipt.error}`);
				}
				receipt.status = "pending";
				receipt.attempts++;
				this.save(run);
				try {
					if (op.kind === "content") await adapter.content(op.fields);
					else await adapter.relationship(op.kind, op.relationship);
					receipt.after = normalized(await adapter.read(), target);
					receipt.status = achieved(receipt.after, op)
						? "applied"
						: "uncertain";
					if (receipt.status !== "applied")
						throw new Error(
							"Provider response did not establish the expected change",
						);
					delete receipt.error;
				} catch (error) {
					receipt.status = "uncertain";
					receipt.error = String(error);
					throw error;
				} finally {
					this.save(run);
				}
			}
		}
	}
	async collect(run: FactoryRun): Promise<ExternalSnapshot> {
		const delivery = this.accepted(run);
		const read = async () => {
			const resources: TicketState[] = [];
			for (const target of delivery.contract.targets)
				resources.push(
					normalized(
						await (await this.adapter(run, target.resource)).read(),
						target,
					),
				);
			return resources;
		};
		const resources = await read();
		if (!isDeepStrictEqual(resources, await read()))
			throw new Error(
				"Ticket state changed during verification; collect again",
			);
		const criteria = delivery.contract.targets.flatMap((target, i) =>
			target.criteria.map((c) => ({
				id: c.id,
				observed: resources[i]!,
				passed:
					matchesFields(resources[i]!.fields, c.fields) &&
					[...c.relationships, ...target.preservedRelationships].every((r) =>
						resources[i]!.relationships.some((x) => sameRelation(x, r)),
					) &&
					c.absentRelationships.every(
						(r) => !resources[i]!.relationships.some((x) => sameRelation(x, r)),
					),
			})),
		);
		const payload = {
			format: "external-evidence-v1" as const,
			contractDigest: delivery.contractDigest,
			contractVersion: delivery.contract.version,
			resources,
			criteria,
		};
		return {
			...payload,
			digest: digest(payload),
			at: new Date().toISOString(),
		};
	}
	async verify(run: FactoryRun): Promise<ExternalSnapshot> {
		const delivery = this.accepted(run);
		if (
			delivery.receipts.some(
				(r) =>
					delivery.contract.targets.some((t) =>
						t.operations.some((o) => o.id === r.id),
					) && r.status !== "applied",
			)
		)
			throw new Error(
				"Unresolved ticket operations block independent verification",
			);
		const snapshot = await this.collect(run);
		for (const [i, target] of delivery.contract.targets.entries())
			if (target.operations.some((op) => !achieved(snapshot.resources[i]!, op)))
				throw new Error(`Ticket outcome not achieved: ${target.key}`);
		if (snapshot.criteria.some((c) => !c.passed))
			throw new Error("External acceptance criteria failed");
		for (const [i, target] of delivery.contract.targets.entries())
			for (const op of target.operations) {
				if (!delivery.receipts.some((r) => r.id === op.id))
					delivery.receipts.push({
						id: op.id,
						target: target.key,
						intent: op,
						before: normalized(
							{ resource: target.resource, ...target.baseline, complete: true },
							target,
						),
						after: snapshot.resources[i],
						status: "applied",
						attempts: 0,
						limitation:
							"Reconciled current state; historical mutation attribution is not independently established.",
					});
			}
		delivery.verification = snapshot;
		delete delivery.finalCheck;
		this.save(run);
		return snapshot;
	}
	async finalCheck(run: FactoryRun): Promise<boolean> {
		const delivery = this.accepted(run),
			accepted = run.humanDecisions?.at(-1);
		if (
			!validExternalSnapshot(delivery) ||
			!delivery.verification ||
			accepted?.decision !== "approve" ||
			accepted.externalDigest !== delivery.verification.digest ||
			accepted.reviewId !== run.reviewGate?.id
		)
			throw new Error(
				"Explicit acceptance of independently verified ticket state required",
			);
		delete delivery.finalCheck;
		this.save(run);
		const snapshot = await this.collect(run);
		if (snapshot.digest !== accepted.externalDigest) {
			delete delivery.finalCheck;
			this.save(run);
			return false;
		}
		delivery.finalCheck = {
			digest: snapshot.digest,
			reviewId: accepted.reviewId,
			at: new Date().toISOString(),
		};
		this.save(run);
		return true;
	}
}
export function validExternalSnapshot(delivery: DeliveryState): boolean {
	const snapshot = delivery.verification;
	if (
		!snapshot ||
		snapshot.contractDigest !== delivery.contractDigest ||
		snapshot.contractVersion !== delivery.contract.version
	)
		return false;
	const { digest: stored, at: _at, ...payload } = snapshot;
	if (
		stored !== digest(payload) ||
		snapshot.resources.length !== delivery.contract.targets.length
	)
		return false;
	const expected = delivery.contract.targets.flatMap((t) =>
		t.criteria.map((c) => c.id),
	);
	if (
		!isDeepStrictEqual(
			snapshot.criteria.map((c) => c.id),
			expected,
		) ||
		snapshot.criteria.some((c) => !c.passed)
	)
		return false;
	return delivery.contract.targets.every((t, i) => {
		const state = snapshot.resources[i]!;
		return (
			state.complete &&
			isDeepStrictEqual(state.resource, t.resource) &&
			t.operations.every((o) => achieved(state, o)) &&
			t.criteria.every(
				(c) =>
					matchesFields(state.fields, c.fields) &&
					[...c.relationships, ...t.preservedRelationships].every((r) =>
						state.relationships.some((x) => sameRelation(x, r)),
					) &&
					c.absentRelationships.every(
						(r) => !state.relationships.some((x) => sameRelation(x, r)),
					),
			)
		);
	});
}
export function repositoryCompletionProven(run: FactoryRun): boolean {
	const merged = run.outputs.merge as
		| { merged?: boolean; url?: string; headSha?: string }
		| undefined;
	const published = run.outputs["draft-pr"] as
		| { url?: string; headSha?: string }
		| undefined;
	const decision = run.humanDecisions?.at(-1);
	if (merged?.merged !== true || decision?.decision !== "approve" || !published)
		return false;
	const revisions = deliveryRevisions(published);
	if (revisions.length)
		return (
			isDeepStrictEqual(decision.repositories, revisions) &&
			isDeepStrictEqual(deliveryRevisions(merged), revisions)
		);
	return (
		!!published.url &&
		!!published.headSha &&
		merged.url === published.url &&
		merged.headSha === published.headSha &&
		decision.headSha === published.headSha
	);
}
export function externalCompletionProven(run: FactoryRun): boolean {
	const delivery = run.delivery,
		decision = run.humanDecisions?.at(-1);
	return (
		!!delivery &&
		(delivery.contract.mode === "external" ||
			(delivery.contract.mode === "mixed" &&
				repositoryCompletionProven(run))) &&
		delivery.contract.authorization.status === "authorized" &&
		digest(delivery.contract) === delivery.contractDigest &&
		validExternalSnapshot(delivery) &&
		!!delivery.verification &&
		decision?.decision === "approve" &&
		decision.externalDigest === delivery.verification.digest &&
		delivery.finalCheck?.digest === decision.externalDigest &&
		delivery.finalCheck.reviewId === decision.reviewId
	);
}
