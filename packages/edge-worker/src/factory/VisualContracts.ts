import { z } from "zod";

const short = (max: number) => z.string().trim().min(1).max(max);
export const FlowSchema = z.object({
	title: short(100),
	steps: z
		.array(z.object({ label: short(60), detail: short(300) }))
		.min(2)
		.max(8),
});
const connection = z.object({
	source: short(80),
	target: short(80),
	label: short(50).optional(),
	weak: z.boolean().optional(),
});
export const SystemSchema = z.object({
	lanes: z
		.array(z.object({ id: short(80), name: short(60) }))
		.min(1)
		.max(8),
	parts: z
		.array(
			z.object({
				id: short(80),
				label: short(60),
				laneId: short(80),
				status: z.enum(["new", "changed", "unchanged", "legacy"]),
			}),
		)
		.min(1)
		.max(48),
	before: z.array(connection).max(96),
	after: z.array(connection).max(96),
});
export type GuideSystem = z.infer<typeof SystemSchema>;
export type GuideFlow = z.infer<typeof FlowSchema>;
