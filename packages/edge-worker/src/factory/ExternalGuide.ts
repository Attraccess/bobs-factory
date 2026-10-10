import { z } from "zod";
import type { FactoryRun } from "./WorkflowRuntime.js";

export const ExternalGuideFields = {
	deliveryMode: z.enum(["external", "mixed"]),
	externalDigest: z.string().regex(/^[a-f0-9]{64}$/),
	externalResources: z
		.array(z.object({ key: z.string().min(1), url: z.string().url() }))
		.min(1),
	externalChanges: z.array(
		z.object({
			id: z.string().min(1),
			target: z.string().min(1),
			outcome: z.string(),
			before: z.string(),
			after: z.string(),
			limitation: z.string(),
		}),
	),
	externalCriteria: z
		.array(
			z.object({
				id: z.string(),
				criterion: z.string(),
				passed: z.literal(true),
				observed: z.string(),
			}),
		)
		.min(1),
};
export const ExternalGuideSchema = z.object(ExternalGuideFields);
export function externalGuideEvidence(run: FactoryRun) {
	const delivery = run.delivery,
		snapshot = delivery?.verification;
	if (
		!delivery ||
		!snapshot ||
		snapshot.contractDigest !== delivery.contractDigest ||
		snapshot.criteria.some((c) => !c.passed)
	)
		throw new Error("Independent external verification required for guide");
	const readable = (value: unknown) => JSON.stringify(value, null, 2);
	return ExternalGuideSchema.parse({
		deliveryMode: delivery.contract.mode,
		externalDigest: snapshot.digest,
		externalResources: delivery.contract.targets.map((t) => ({
			key: t.key,
			url: t.resource.url,
		})),
		externalChanges: delivery.receipts.map((r) => ({
			id: r.id,
			target: r.target,
			outcome: r.status,
			before: readable({
				fields: r.before.fields,
				relationships: r.before.relationships,
			}),
			after: readable(
				r.after
					? { fields: r.after.fields, relationships: r.after.relationships }
					: null,
			),
			limitation: r.limitation,
		})),
		externalCriteria: delivery.contract.targets.flatMap((t) =>
			t.criteria.map((c) => ({
				id: c.id,
				criterion: c.description,
				passed: snapshot.criteria.find((x) => x.id === c.id)?.passed,
				observed: readable(
					snapshot.criteria.find((x) => x.id === c.id)?.observed,
				),
			})),
		),
	});
}
