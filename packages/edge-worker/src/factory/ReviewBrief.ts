import { z } from "zod";
import type { Guide } from "./FactoryResults.js";
import { BRIEF_CONTRACT } from "./GuideAuthoring.js";
import { OutputValidationError } from "./OutputValidation.js";
import {
	activeRequirements,
	aggregateForContext,
	assertAggregateRevision,
} from "./SpecialistReview.js";
import type { VideoCapture } from "./Video.js";
import type { ExecutionContext } from "./WorkflowRuntime.js";

/**
 * The review brief replaces chapter guides for steps declaring this contract.
 * It answers, in order: was the right thing built (ask + interpretation), does
 * it work (one decisive proof per requirement), what needs a human (your
 * call), and what else changed or remains unproven. Older guides stay readable.
 */
export { BRIEF_CONTRACT };

const text = (max: number) => z.string().trim().min(1).max(max);
const slug = z
	.string()
	.trim()
	.regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Use a short lowercase-kebab ID");
const files = z.array(text(400)).max(400);

const ShotSchema = z.object({
	area: text(200),
	state: text(300),
	label: text(120),
	/** Crop in percent of the image so the reader sees the relevant pixels. */
	focus: z
		.object({
			x: z.number().min(0).max(100),
			y: z.number().min(0).max(100),
			w: z.number().min(1).max(100),
			h: z.number().min(1).max(100),
		})
		.refine((f) => f.x + f.w <= 100.5 && f.y + f.h <= 100.5, {
			message: "Focus must stay inside the image",
		})
		.optional(),
});
const TableRowSchema = z.object({
	cells: z.array(text(240)).min(2).max(5),
	mark: z.enum(["good", "bad", "neutral"]).optional(),
});
export const ProofSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("screens"),
		shots: z.array(ShotSchema).min(1).max(4),
		note: text(300).optional(),
	}),
	z.object({
		kind: z.literal("video"),
		taskId: text(200),
		sha256: z.string().regex(/^[a-f0-9]{64}$/),
		label: text(120),
	}),
	z.object({
		kind: z.literal("table"),
		method: text(200).optional(),
		columns: z.array(text(48)).min(2).max(5),
		rows: z.array(TableRowSchema).min(1).max(14),
	}),
	z.object({
		kind: z.literal("code"),
		file: text(300),
		excerpt: text(2000),
		note: text(300),
	}),
	z.object({
		kind: z.literal("test"),
		file: text(300),
		excerpt: text(2000),
		result: text(300),
	}),
	z.object({
		kind: z.literal("command"),
		command: text(400),
		output: text(2000),
		note: text(300).optional(),
	}),
	z.object({
		kind: z.literal("steps"),
		steps: z
			.array(
				z.object({
					label: text(40),
					detail: text(240),
					change: z.enum(["new", "changed", "manual"]).optional(),
				}),
			)
			.min(2)
			.max(7),
		note: text(300).optional(),
	}),
	z.object({
		kind: z.literal("flowRef"),
		flow: slug,
		steps: z.array(z.number().int().min(1)).min(1).max(12),
		note: text(240),
	}),
]);
export type BriefProof = z.infer<typeof ProofSchema>;

const FlowStepSchema = z.object({
	from: slug,
	to: slug,
	label: text(140),
	detail: text(240).optional(),
	change: z.enum(["new", "changed"]).optional(),
	dashed: z.boolean().optional(),
	outcome: z.enum(["good", "bad"]).optional(),
});
const FlowSchema = z.object({
	id: slug,
	title: text(120),
	trigger: text(160),
	implements: z.array(slug).min(1),
	participants: z
		.array(
			z.object({
				id: slug,
				label: text(40),
				detail: text(80).optional(),
				external: z.boolean().optional(),
			}),
		)
		.min(2)
		.max(6),
	steps: z.array(FlowStepSchema).min(1).max(12),
	before: z.array(FlowStepSchema).min(1).max(12).optional(),
	note: text(300).optional(),
});
export type BriefFlow = z.infer<typeof FlowSchema>;

const RequirementSchema = z.object({
	id: slug,
	text: text(180),
	origin: z.enum(["ask", "your-answer", "bob"]),
	/** Frozen inventory requirement IDs this line accounts for. */
	covers: z.array(text(80)).optional(),
	status: z.enum(["shown", "tested", "partly", "not-shown", "gap", "waived"]),
	proof: ProofSchema,
	more: z.array(ProofSchema).max(4).optional(),
	caveat: text(260).optional(),
	files,
});
export type BriefRequirement = z.infer<typeof RequirementSchema>;

const ReviewBriefFields = {
	contract: z.literal(BRIEF_CONTRACT),
	verdict: z.object({
		headline: text(160),
		readiness: z.enum(["ready", "ready-with-caveats", "not-ready"]),
		why: text(260),
	}),
	ask: z.object({
		source: text(80),
		url: z.string().trim().url().optional(),
		quote: text(1500),
	}),
	interpretation: z
		.array(
			z.object({
				topic: text(60),
				chosen: text(260),
				alternatives: z.array(text(180)).max(3).optional(),
				decidedBy: z.enum(["you", "ticket", "bob"]),
				note: text(180).optional(),
			}),
		)
		.max(10),
	sinceLastReview: z
		.object({
			previousHeadSha: z.string().regex(/^[a-f0-9]{7,64}$/),
			summary: text(260),
			changes: z
				.array(z.object({ what: text(240), files }))
				.min(1)
				.max(10),
		})
		.optional(),
	requirements: z.array(RequirementSchema).min(1).max(24),
	yourCall: z
		.array(
			z.object({
				question: text(160),
				context: text(600),
				bobChose: text(260),
				proof: ProofSchema.optional(),
			}),
		)
		.max(5),
	system: z
		.object({
			summary: text(600),
			flows: z.array(FlowSchema).min(1).max(6),
			interfaces: z
				.array(
					z.object({
						title: text(60),
						why: text(300),
						columns: z.array(text(48)).min(2).max(5),
						rows: z
							.array(
								z.object({
									cells: z.array(text(300)).min(2).max(5),
									mark: z
										.enum(["new", "changed", "removed", "risk", "same"])
										.optional(),
								}),
							)
							.min(1)
							.max(24),
					}),
				)
				.max(4),
		})
		.optional(),
	beyondAsk: z
		.array(
			z.object({
				what: text(240),
				why: text(360),
				attention: z.enum(["none", "low", "look"]),
				files,
			}),
		)
		.max(16),
	notVerified: z.array(z.object({ what: text(140), why: text(280) })).max(6),
	noticed: z.array(text(280)).max(5).optional(),
	hygiene: z
		.array(z.object({ text: text(200), covers: z.array(text(80)).optional() }))
		.max(10),
};

const BriefObject = z.object(ReviewBriefFields);
/** Structure only, so evidence checks can run alongside authoring-rule failures. */
const BriefStructureSchema = BriefObject.loose();
/** Reading schema: the stored brief plus runtime-owned attachments. */
export const ReviewBriefSchema = BriefObject.loose().superRefine((brief, ctx) =>
	refineBrief(brief, ctx),
);
/** Authoring schema: unknown keys usually mean a legacy guide shape slipped in. */
export const GeneratedBriefSchema = BriefObject.strict().superRefine(
	(brief, ctx) => refineBrief(brief, ctx),
);
export type ReviewBrief = z.infer<typeof BriefObject> & {
	reviewFiles?: { snapshotId: string; baseSha: string; headSha: string };
	requirementCoverage?: Guide["requirementCoverage"];
};

/** Authored text must not carry receipts; the runtime keeps those. */
const LOCAL_PATH =
	/(^|[\s"'`(=])(\/Users\/|\/home\/|\/private\/|\/var\/folders\/|\/tmp\/|~\/\.|[A-Za-z]:\\)/;
const FULL_SHA = /\b[0-9a-f]{40}\b/;
const RECEIPT_FIELDS = new Set(["excerpt", "output", "command"]);
const NON_PROSE = new Set(["url", "sha256", "previousHeadSha", "files"]);

function refineBrief(
	brief: z.infer<z.ZodObject<typeof ReviewBriefFields>>,
	ctx: z.RefinementCtx,
) {
	const fail = (path: (string | number)[], message: string) =>
		ctx.addIssue({ code: "custom", path, message });
	const requirementIds = new Set<string>();
	brief.requirements.forEach((r, i) => {
		if (requirementIds.has(r.id))
			fail(["requirements", i, "id"], "Requirement IDs must be unique");
		requirementIds.add(r.id);
	});
	const flows = new Map((brief.system?.flows ?? []).map((f) => [f.id, f]));
	if (flows.size !== (brief.system?.flows.length ?? 0))
		fail(["system", "flows"], "Flow IDs must be unique");
	brief.system?.flows.forEach((flow, i) => {
		const actors = new Set(flow.participants.map((p) => p.id));
		if (actors.size !== flow.participants.length)
			fail(
				["system", "flows", i, "participants"],
				"Participant IDs must be unique",
			);
		for (const mode of ["steps", "before"] as const)
			flow[mode]?.forEach((step, j) => {
				for (const end of ["from", "to"] as const)
					if (!actors.has(step[end]))
						fail(
							["system", "flows", i, mode, j, end],
							`Unknown participant "${step[end]}"`,
						);
			});
		flow.implements.forEach((id, j) => {
			if (!requirementIds.has(id))
				fail(
					["system", "flows", i, "implements", j],
					`Unknown requirement ID "${id}"`,
				);
		});
	});
	for (const [i, table] of (brief.system?.interfaces ?? []).entries())
		for (const [j, row] of table.rows.entries())
			if (row.cells.length !== table.columns.length)
				fail(
					["system", "interfaces", i, "rows", j, "cells"],
					"Each row needs exactly one cell per column",
				);
	const proofs: [BriefProof, (string | number)[]][] = [];
	brief.requirements.forEach((r, i) => {
		proofs.push([r.proof, ["requirements", i, "proof"]]);
		for (const [j, p] of (r.more ?? []).entries())
			proofs.push([p, ["requirements", i, "more", j]]);
		if (r.status === "gap" && brief.verdict.readiness !== "not-ready")
			fail(
				["verdict", "readiness"],
				"A requirement with status gap makes the brief not-ready",
			);
	});
	brief.yourCall.forEach((c, i) => {
		if (c.proof) proofs.push([c.proof, ["yourCall", i, "proof"]]);
	});
	for (const [proof, path] of proofs) {
		if (proof.kind === "table")
			proof.rows.forEach((row, j) => {
				if (row.cells.length !== proof.columns.length)
					fail(
						[...path, "rows", j, "cells"],
						"Each row needs exactly one cell per column",
					);
			});
		if (proof.kind === "flowRef") {
			const flow = flows.get(proof.flow);
			if (!flow) fail([...path, "flow"], `Unknown flow "${proof.flow}"`);
			else
				proof.steps.forEach((step, j) => {
					if (step > flow.steps.length)
						fail(
							[...path, "steps", j],
							`Flow "${flow.id}" has ${flow.steps.length} steps`,
						);
				});
		}
	}
	const visit = (value: unknown, path: (string | number)[]) => {
		if (typeof value === "string") {
			const key = path.at(-1);
			if (NON_PROSE.has(String(path.at(-2))) || NON_PROSE.has(String(key)))
				return;
			if (LOCAL_PATH.test(value))
				fail(
					path,
					"Remove local absolute paths; the runtime keeps receipts. Name the behavior or repository-relative file instead",
				);
			else if (!RECEIPT_FIELDS.has(String(key)) && FULL_SHA.test(value))
				fail(
					path,
					"Remove commit SHAs from prose; the reader shows the reviewed revision",
				);
			return;
		}
		if (Array.isArray(value))
			for (const [i, item] of value.entries()) visit(item, [...path, i]);
		else if (value && typeof value === "object")
			for (const [key, item] of Object.entries(value))
				visit(item, [...path, key]);
	};
	const {
		requirementCoverage: _coverage,
		reviewFiles: _files,
		...authored
	} = brief as Record<string, unknown>;
	visit(authored, []);
}

export function isReviewBrief(value: unknown): value is ReviewBrief {
	return Boolean(
		value &&
			typeof value === "object" &&
			(value as { contract?: unknown }).contract === BRIEF_CONTRACT,
	);
}

/** Context-dependent checks: inventory coverage, real files and real evidence. */
export function validateBriefCoverage(
	context: ExecutionContext,
	value: unknown,
): void {
	const brief = BriefStructureSchema.parse(value) as ReviewBrief;
	const issues: {
		path: string;
		message: string;
		expected?: unknown;
		actual?: unknown;
	}[] = [];
	const aggregate = aggregateForContext(context);
	if (aggregate) {
		assertAggregateRevision(
			aggregate,
			context.progress?.currentRevision?.headSha ?? "",
		);
		const active = activeRequirements(aggregate.baseline.inventory);
		const status = new Map(
			aggregate.coverage.map((a) => [a.requirementId, a.status]),
		);
		const known = new Set(active.map((r) => r.id));
		const covered = new Set<string>();
		brief.requirements.forEach((r, i) => {
			if (!r.covers?.length) {
				issues.push({
					path: `/requirements/${i}/covers`,
					message:
						"Name the frozen inventory requirement IDs this line accounts for",
				});
				return;
			}
			for (const id of r.covers) {
				if (!known.has(id))
					issues.push({
						path: `/requirements/${i}/covers`,
						message: `Unknown or inactive inventory requirement "${id}"`,
					});
				covered.add(id);
			}
			const states = r.covers.map((id) => status.get(id));
			if (states.includes("not_met") && r.status !== "gap")
				issues.push({
					path: `/requirements/${i}/status`,
					message:
						"Review coverage marks a covered requirement not_met; status must be gap",
				});
			if (r.status === "gap" && !states.includes("not_met"))
				issues.push({
					path: `/requirements/${i}/status`,
					message:
						"Status gap needs a covered requirement that review coverage marks not_met",
				});
			if (
				r.status === "waived" &&
				!states.every((s) => s === "deliberately_skipped")
			)
				issues.push({
					path: `/requirements/${i}/status`,
					message:
						"Status waived is only for requirements review coverage marks deliberately_skipped",
				});
			if (
				states.length &&
				states.every((s) => s === "deliberately_skipped") &&
				r.status !== "waived"
			)
				issues.push({
					path: `/requirements/${i}/status`,
					message: "Deliberately skipped requirements use status waived",
				});
		});
		brief.hygiene.forEach((h, i) => {
			for (const id of h.covers ?? []) {
				if (!known.has(id))
					issues.push({
						path: `/hygiene/${i}/covers`,
						message: `Unknown or inactive inventory requirement "${id}"`,
					});
				if (status.get(id) === "not_met")
					issues.push({
						path: `/hygiene/${i}/covers`,
						message: `"${id}" is not met; show it as a requirement line with status gap`,
					});
				covered.add(id);
			}
		});
		const missing = active.filter((r) => !covered.has(r.id)).map((r) => r.id);
		if (missing.length)
			issues.push({
				path: "/requirements",
				message: `Account for every active inventory requirement in requirements[].covers or hygiene[].covers; missing: ${missing.join(", ")}`,
				expected: active.map((r) => r.id),
				actual: [...covered],
			});
	}

	const scope = context.progress?.reviewScope;
	if (!scope)
		throw new Error(
			"Whole-PR revision scope is unavailable; cannot produce a complete review brief",
		);
	const prFiles = new Set(scope.files);
	const accounted = new Set<string>();
	const checkFiles = (list: string[], path: string) =>
		list.forEach((file, j) => {
			if (!prFiles.has(file))
				issues.push({
					path: `${path}/${j}`,
					message: `"${file}" is not a changed file in this PR; use exact paths from /progress/reviewScope/files`,
				});
			accounted.add(file);
		});
	for (const [i, r] of brief.requirements.entries())
		checkFiles(r.files, `/requirements/${i}/files`);
	for (const [i, b] of brief.beyondAsk.entries())
		checkFiles(b.files, `/beyondAsk/${i}/files`);
	for (const [i, c] of (brief.sinceLastReview?.changes ?? []).entries())
		checkFiles(c.files, `/sinceLastReview/changes/${i}/files`);
	const omitted = scope.files.filter((file) => !accounted.has(file));
	if (omitted.length)
		issues.push({
			path: "/requirements/files",
			message: `Every changed file belongs to a requirement line or a beyondAsk item; unexplained: ${omitted.join(", ")}`,
			expected: scope.files,
			actual: [...accounted],
		});

	const shots =
		(
			context.run.outputs.capture as
				| { screenshots?: { area: string; state: string }[] }
				| undefined
		)?.screenshots ?? [];
	const videos =
		(context.run.outputs.capture as VideoCapture | undefined)?.videos ?? [];
	const receipts =
		(
			context.run.outputs["visual-review"] as
				| {
						acceptedVideos?: {
							taskId: string;
							sha256: string;
							inspectedPlayback: boolean;
						}[];
				  }
				| undefined
		)?.acceptedVideos ?? [];
	const head = context.progress?.currentRevision?.headSha;
	for (const [proof, path] of briefProofs(brief)) {
		if (proof.kind === "screens")
			proof.shots.forEach((shot, j) => {
				if (!shots.some((s) => s.area === shot.area && s.state === shot.state))
					issues.push({
						path: `${path}/shots/${j}`,
						message: `Screenshot is not in the accepted capture inventory: ${shot.area} / ${shot.state}`,
					});
			});
		if (proof.kind === "video") {
			const video = videos.find(
				(v) =>
					v.taskId === proof.taskId && v.validation?.sha256 === proof.sha256,
			);
			if (
				!video?.validation ||
				video.validation.dirty ||
				video.validation.validatedRevision !== head ||
				!receipts.some(
					(r) =>
						r.taskId === proof.taskId &&
						r.sha256 === proof.sha256 &&
						r.inspectedPlayback,
				)
			)
				issues.push({
					path,
					message: `Video is stale or was not accepted after playback: ${proof.taskId}`,
				});
		}
	}

	if (brief.sinceLastReview) {
		const previous = brief.sinceLastReview.previousHeadSha;
		if (
			!(context.run.humanDecisions ?? []).some((d) =>
				d.headSha.startsWith(previous),
			)
		)
			issues.push({
				path: "/sinceLastReview/previousHeadSha",
				message:
					"sinceLastReview requires a revision you actually reviewed; omit it on the first brief",
			});
	}
	if (issues.length) throw new OutputValidationError(value, issues);
}

function briefProofs(brief: ReviewBrief): [BriefProof, string][] {
	return [
		...brief.requirements.flatMap((r, i): [BriefProof, string][] => [
			[r.proof, `/requirements/${i}/proof`],
			...(r.more ?? []).map((p, j): [BriefProof, string] => [
				p,
				`/requirements/${i}/more/${j}`,
			]),
		]),
		...brief.yourCall.flatMap((c, i): [BriefProof, string][] =>
			c.proof ? [[c.proof, `/yourCall/${i}/proof`]] : [],
		),
	];
}

/** One line for tickets, notifications and Today cards. */
export function guideHeadline(guide: unknown): string {
	if (isReviewBrief(guide)) return guide.verdict.headline;
	const legacy = guide as Partial<Guide> | undefined;
	return legacy?.summary ?? legacy?.goal ?? "Review guide";
}

/** Whether handoff may ask a human to approve this guide. */
export function guideReady(guide: unknown): boolean {
	if (isReviewBrief(guide))
		return (
			guide.verdict.readiness !== "not-ready" &&
			!guide.requirements.some((r) => r.status === "gap")
		);
	return (guide as Partial<Guide> | undefined)?.decision?.status === "ready";
}

/** Unresolved items that route the run back to correction before handoff. */
export function guideGaps(
	guide: unknown,
): { id: string; status: string; line: string }[] {
	if (isReviewBrief(guide)) {
		const inventory = Boolean(guide.requirementCoverage);
		return guide.requirements
			.filter(
				(r) => r.status === "gap" || (!inventory && r.status === "not-shown"),
			)
			.map((r) => ({
				id: r.covers?.join(",") || r.id,
				status: r.status,
				line: `${r.text} (${r.status})${r.caveat ? `: ${r.caveat}` : ""}`,
			}));
	}
	return ((guide as Partial<Guide> | undefined)?.requirements ?? [])
		.filter((r) => ["gap", "unverified"].includes(r.status))
		.map((r) => ({
			id: r.requirementId ?? r.criterion,
			status: r.status,
			line: `${r.criterion} (${r.status}): ${r.evidence.join("; ")}`,
		}));
}

export function guideWhy(guide: unknown): string {
	if (isReviewBrief(guide)) return guide.verdict.why;
	return (guide as Partial<Guide> | undefined)?.decision?.summary ?? "";
}

const STATUS_LABEL: Record<BriefRequirement["status"], string> = {
	shown: "✅ shown working",
	tested: "🧪 tests only",
	partly: "◑ partly proven",
	"not-shown": "○ no evidence",
	gap: "❌ not met",
	waived: "⏭ waived",
};

function proofMarkdown(proof: BriefProof, flows: BriefFlow[]): string {
	switch (proof.kind) {
		case "screens":
			return `Screenshots: ${proof.shots.map((s) => s.label).join(" · ")}${proof.note ? `. ${proof.note}` : ""}`;
		case "video":
			return `Recording: ${proof.label}`;
		case "table":
			return [
				proof.method ? `_${proof.method}_\n` : "",
				`| ${proof.columns.join(" | ")} |`,
				`| ${proof.columns.map(() => "---").join(" | ")} |`,
				...proof.rows.map(
					(row) =>
						`| ${row.cells.map((c) => c.replaceAll("|", "\\|")).join(" | ")}${row.mark === "bad" ? " ⚠" : ""} |`,
				),
			].join("\n");
		case "code":
			return `\`${proof.file}\` — ${proof.note}\n\n\`\`\`diff\n${proof.excerpt}\n\`\`\``;
		case "test":
			return `\`${proof.file}\` — ${proof.result}\n\n\`\`\`\n${proof.excerpt}\n\`\`\``;
		case "command":
			return `\`\`\`\n$ ${proof.command}\n${proof.output}\n\`\`\`${proof.note ? `\n${proof.note}` : ""}`;
		case "steps":
			return proof.steps
				.map(
					(s) =>
						`**${s.label}**${s.change ? ` (${s.change})` : ""}: ${s.detail}`,
				)
				.join(" → ");
		case "flowRef": {
			const flow = flows.find((f) => f.id === proof.flow);
			return `See flow “${flow?.title ?? proof.flow}”, steps ${proof.steps.join(", ")}: ${proof.note}`;
		}
	}
}

/** PR description and ticket comment. The dashboard shows images and diagrams. */
export function briefMarkdown(brief: ReviewBrief, headSha: string): string {
	const flows = brief.system?.flows ?? [];
	const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n");
	const readiness = {
		ready: "Ready to approve",
		"ready-with-caveats": `Ready, with ${brief.yourCall.length} decision${brief.yourCall.length === 1 ? "" : "s"} for you`,
		"not-ready": "Not ready",
	}[brief.verdict.readiness];
	const sections = [
		`## ${brief.verdict.headline}\n**${readiness}.** ${brief.verdict.why}`,
		`### What was asked\n> ${brief.ask.quote.replaceAll("\n", "\n> ")}\n>\n> — ${brief.ask.url ? `[${brief.ask.source}](${brief.ask.url})` : brief.ask.source}${
			brief.interpretation.length
				? `\n\n**How Bob read it**\n${list(
						brief.interpretation.map(
							(d) =>
								`**${d.topic}:** ${d.chosen} _(${{ you: "you decided", ticket: "in the ticket", bob: "Bob decided" }[d.decidedBy]})_${d.alternatives?.length ? ` Instead of: ${d.alternatives.join("; ")}.` : ""}`,
						),
					)}`
				: ""
		}`,
	];
	if (brief.sinceLastReview)
		sections.push(
			`### Since your last review\n${brief.sinceLastReview.summary}\n\n${list(brief.sinceLastReview.changes.map((c) => c.what))}`,
		);
	sections.push(
		`### Does it do that?\n${brief.requirements
			.map(
				(r, i) =>
					`**${i + 1}. ${r.text}** — ${STATUS_LABEL[r.status]}\n\n${proofMarkdown(r.proof, flows)}${r.caveat ? `\n\n⚠ ${r.caveat}` : ""}`,
			)
			.join("\n\n")}`,
	);
	if (brief.yourCall.length)
		sections.push(
			`### Your call\n${brief.yourCall
				.map(
					(c, i) =>
						`**${i + 1}. ${c.question}**\n${c.context}\n\n_Bob chose:_ ${c.bobChose}`,
				)
				.join("\n\n")}`,
		);
	if (brief.system)
		sections.push(
			`### How it’s built\n${brief.system.summary}\n\n${flows
				.map(
					(f) =>
						`**${f.title}** (${f.trigger})\n${f.steps
							.map(
								(s, i) =>
									`${i + 1}. ${s.from} → ${s.to}: ${s.label}${s.change ? ` _(${s.change})_` : ""}`,
							)
							.join("\n")}`,
				)
				.join(
					"\n\n",
				)}${brief.system.interfaces.map((t) => `\n\n**${t.title}** — ${t.why}\n\n| ${["", ...t.columns].join(" | ")} |\n| ${["", ...t.columns].map(() => "---").join(" | ")} |\n${t.rows.map((r) => `| ${[r.mark ?? "", ...r.cells.map((c) => c.replaceAll("|", "\\|"))].join(" | ")} |`).join("\n")}`).join("")}`,
		);
	if (brief.beyondAsk.length)
		sections.push(
			`### Changed beyond the ask\n${list(brief.beyondAsk.map((b) => `${b.attention === "look" ? "👀 " : ""}**${b.what}** ${b.why}`))}`,
		);
	if (brief.notVerified.length)
		sections.push(
			`### Not verified\n${list(brief.notVerified.map((n) => `**${n.what}.** ${n.why}`))}`,
		);
	if (brief.noticed?.length)
		sections.push(`### Noticed along the way\n${list(brief.noticed)}`);
	if (brief.hygiene.length)
		sections.push(list(brief.hygiene.map((h) => `✓ ${h.text}`)));
	sections.push(
		`Revision: ${headSha}\nOpen the review in Bob’s Factory for screenshots, flows and per-line feedback.\n\n<!-- generated-by-bobs-factory -->`,
	);
	return sections.join("\n\n");
}
