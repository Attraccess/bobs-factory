import { z } from "zod";

/** Persisted coordinator state shared by admission and migration validation. */
export const CapacityOwnerSchema = z.object({
	pid: z.number().int().positive(),
	start: z.string().min(1),
	incarnation: z.string().min(1),
});
export const CapacityWorkflowSchema = z.object({
	identity: z.string().min(1),
	createdAt: z.iso.datetime({ offset: true }),
});
export type CapacityWorkflow = z.infer<typeof CapacityWorkflowSchema>;
const Request = z.object({
	id: z.string(),
	token: z.string(),
	owner: CapacityOwnerSchema,
	sequence: z.number().int().positive(),
	admissionPosition: z.number().int().positive().optional(),
	workflowRun: CapacityWorkflowSchema.optional(),
	queuedAt: z.string(),
	phase: z.enum(["queued", "executing", "stopping"]),
	background: z.boolean(),
	parked: z.boolean().default(false),
	identity: z.string(),
	recoverable: z.boolean(),
	remote: z.boolean(),
});
export const CapacityStateSchema = z
	.object({
		version: z.literal(1),
		limit: z.number().int().positive(),
		sequence: z.number().int().nonnegative(),
		bypass: z.number().int().nonnegative(),
		requests: z.array(Request),
	})
	.superRefine((state, ctx) => {
		for (const field of ["id", "token", "identity", "sequence"] as const) {
			if (
				new Set(state.requests.map((request) => request[field])).size !==
				state.requests.length
			)
				ctx.addIssue({
					code: "custom",
					message: `Duplicate capacity ${field}`,
				});
		}
		const positions = state.requests.map(
			(r) => r.admissionPosition ?? r.sequence,
		);
		if (
			new Set(positions).size !== positions.length ||
			positions.some((p) => p > state.sequence)
		)
			ctx.addIssue({
				code: "custom",
				message: "Invalid capacity admission positions",
			});
		const ages = new Map<string, number>();
		for (const request of state.requests) {
			if (!request.workflowRun) continue;
			const age = Date.parse(request.workflowRun.createdAt);
			const previous = ages.get(request.workflowRun.identity);
			if (previous !== undefined && previous !== age)
				ctx.addIssue({
					code: "custom",
					message: "Conflicting capacity workflow age",
				});
			ages.set(request.workflowRun.identity, age);
		}
		if (
			state.requests.some(
				(request) =>
					request.sequence > state.sequence ||
					(request.parked && request.phase !== "queued"),
			)
		)
			ctx.addIssue({
				code: "custom",
				message: "Invalid capacity queue bookkeeping",
			});
	});
export type CapacityRequest = z.infer<typeof Request>;
export type CapacityOwner = z.infer<typeof CapacityOwnerSchema>;
