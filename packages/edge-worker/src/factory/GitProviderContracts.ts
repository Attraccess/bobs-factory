import { z } from "zod";

const branch = z
	.string()
	.regex(/^[a-zA-Z0-9][a-zA-Z0-9/_\-.]*$/)
	.refine((v) => !v.includes("..") && !v.includes("@{"));
export const PullRequestSchema = z.object({
	url: z.string().url(),
	number: z.number().int().positive(),
	title: z.string(),
	body: z.string(),
	headRefName: branch,
	headRefOid: z.string().min(1),
	baseRefName: branch,
	state: z.enum(["OPEN", "MERGED", "CLOSED"]),
	isDraft: z.boolean(),
	isCrossRepository: z.boolean(),
});
export const TakeoverPullRequestSchema = PullRequestSchema.extend({
	state: z.literal("OPEN"),
	isCrossRepository: z.literal(false),
	comments: z.array(z.unknown()),
	reviews: z.array(z.unknown()),
	reviewComments: z.array(z.unknown()),
});
export type TakeoverPullRequest = z.infer<typeof TakeoverPullRequestSchema>;
export const ReadinessSchema = z
	.object({
		metadata: z.object({ title: z.string() }).optional(),
		headSha: z.string().min(1),
		baseSha: z.string().min(1),
		url: z.string().url(),
		state: z.enum(["OPEN", "MERGED", "CLOSED"]),
		isDraft: z.boolean(),
		approved: z.boolean(),
		reviewReady: z.boolean(),
		fix: z.boolean(),
		blockers: z.array(
			z.object({
				kind: z.string(),
				message: z.string(),
				action: z.enum(["fix", "wait", "human"]),
			}),
		),
		checks: z.array(
			z.object({
				name: z.string(),
				state: z.string(),
				bucket: z.enum(["pass", "fail", "pending"]),
				link: z.string().optional(),
				failure: z
					.object({
						kind: z.enum(["infrastructure", "metadata", "unknown"]),
						evidence: z.string(),
					})
					.optional(),
				retry: z
					.object({
						status: z
							.enum([
								"queued",
								"in_progress",
								"completed",
								"waiting",
								"pending",
								"requested",
							])
							.optional(),
						id: z.string().min(1),
						attempt: z.number().int().positive(),
						headSha: z.string().min(1),
						kind: z.enum(["github-run", "gitlab-job"]),
						metadataRecheck: z.boolean().optional(),
						lineage: z.string().optional(),
					})
					.optional(),
			}),
		),
		threads: z.array(z.unknown()),
		comments: z.array(
			z
				.object({
					id: z.union([z.string(), z.number()]),
					body: z.string(),
					html_url: z.string().optional(),
					updated_at: z.string().optional(),
					user: z
						.object({ login: z.string(), type: z.string().optional() })
						.optional(),
				})
				.passthrough(),
		),
		reviews: z.array(z.unknown()),
		queued: z.boolean(),
		mergeMethod: z.enum(["squash", "merge", "rebase"]),
	})
	.superRefine((v, ctx) => {
		if (
			(v.approved &&
				(v.state !== "OPEN" ||
					v.isDraft ||
					v.blockers.length ||
					v.checks.some((c) => c.bucket !== "pass"))) ||
			(v.reviewReady &&
				(v.state !== "OPEN" ||
					v.blockers.some((b) => b.action !== "human") ||
					v.checks.some((c) => c.bucket !== "pass"))) ||
			v.fix !== v.blockers.some((b) => b.action === "fix")
		)
			ctx.addIssue({
				code: "custom",
				message: "Provider readiness contradicts its blockers, checks or state",
			});
	});
