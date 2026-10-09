import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { SystemSchema } from "./VisualContracts.js";

const text = z.string().trim().min(1);
export const CandidatePlanSchema = z.object({
	plan: text,
	assets: z.array(z.object({ path: text, purpose: text })),
});
export const ArchitectureSchema = z
	.object({
		architectureContract: z.literal("architecture-v1"),
		classification: z.enum(["meaningful", "routine"]),
		rationale: text,
		evidence: z
			.array(
				z.object({
					repository: text,
					paths: z.array(text).min(1),
					observation: text,
				}),
			)
			.min(1),
		recommendation: text,
		interfaces: z.array(text),
		alternatives: z.array(z.object({ option: text, tradeoffs: text })),
		risks: z.array(text),
		unresolvedDecisions: z.array(text),
		visual: z.object({ explanation: text, system: SystemSchema }).optional(),
		candidate: CandidatePlanSchema,
	})
	.strict()
	.superRefine((proposal, ctx) => {
		if (proposal.classification === "meaningful") {
			if (!proposal.visual)
				ctx.addIssue({
					code: "custom",
					path: ["visual"],
					message: "Meaningful choices require a diagram and explanation",
				});
			if (!proposal.interfaces.length)
				ctx.addIssue({
					code: "custom",
					path: ["interfaces"],
					message:
						"Meaningful choices require concrete responsibilities and interfaces",
				});
			if (!proposal.alternatives.length)
				ctx.addIssue({
					code: "custom",
					path: ["alternatives"],
					message: "Meaningful choices require alternatives and trade-offs",
				});
		}
		const system = proposal.visual?.system;
		if (!system) return;
		const lanes = new Set(system.lanes.map((l) => l.id));
		const parts = new Set(system.parts.map((p) => p.id));
		if (
			lanes.size !== system.lanes.length ||
			parts.size !== system.parts.length ||
			system.parts.some((p) => !lanes.has(p.laneId)) ||
			[...system.before, ...system.after].some(
				(e) => !parts.has(e.source) || !parts.has(e.target),
			)
		)
			ctx.addIssue({
				code: "custom",
				path: ["visual", "system"],
				message: "Diagram IDs must be unique and all references must exist",
			});
	});
export const ArchitectureReviewSchema = z
	.object({ approved: z.boolean(), feedback: z.array(text) })
	.strict()
	.refine(
		(r) => r.approved || r.feedback.length > 0,
		"Rejected candidate review requires feedback",
	);
export type Architecture = z.infer<typeof ArchitectureSchema>;
export interface ArchitectureProposal {
	id: string;
	version: number;
	digest: string;
	source: string;
	bypassReason?: string;
	status:
		| "proposed"
		| "pending"
		| "accepted"
		| "rejected"
		| "superseded"
		| "routine";
	content: Architecture;
	assetDigests: { path: string; digest: string }[];
	feedback: {
		kind: "revise" | "discuss" | "explain" | "explanation";
		text: string;
		at: string;
	}[];
	at: string;
}
export const ArchitectureDecisionSchema = z
	.object({
		proposalId: text,
		version: z.number().int().positive(),
		digest: text,
		decision: z.enum(["accept", "revise", "discuss", "explain"]),
		feedback: z.string().trim().max(100000).optional(),
	})
	.strict()
	.refine(
		(d) => d.decision === "accept" || !!d.feedback,
		"Enter feedback or an explanation request",
	);
export type ArchitectureDecision = z.infer<
	typeof ArchitectureDecisionSchema
> & { at: string };
export function architectureDigest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function proposalDigest(proposal: ArchitectureProposal): string {
	return architectureDigest({
		content: proposal.content,
		assets: proposal.assetDigests,
	});
}
export function verifyProposal(proposal: ArchitectureProposal): void {
	if (proposalDigest(proposal) !== proposal.digest)
		throw new Error("Architecture content changed; regenerate the proposal");
	for (const asset of proposal.assetDigests)
		if (
			createHash("sha256").update(readFileSync(asset.path)).digest("hex") !==
			asset.digest
		)
			throw new Error("Architecture asset changed; regenerate the proposal");
}
export async function snapshotProposal(
	value: unknown,
	source: string,
	version: number,
	directory: string,
	signal: AbortSignal,
	allowedDirectories: readonly string[] = [directory],
): Promise<ArchitectureProposal> {
	const content = ArchitectureSchema.parse(value);
	const id = randomUUID();
	const assetDigests: ArchitectureProposal["assetDigests"] = [];
	const snapshots = new Map<string, string>();
	const contains = (root: string, path: string) => {
		const child = relative(root, path);
		return (
			child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child)
		);
	};
	for (const [index, asset] of content.candidate.assets.entries()) {
		const original = asset.path;
		let bytes: Buffer;
		if (/^https?:\/\//.test(asset.path)) {
			const response = await fetch(asset.path, { signal });
			if (!response.ok)
				throw new Error(
					`Cannot snapshot architecture asset: HTTP ${response.status}`,
				);
			const chunks: Uint8Array[] = [];
			let size = 0;
			if (!response.body) throw new Error("Architecture asset has no body");
			for await (const chunk of response.body) {
				size += chunk.length;
				if (size > 25 * 1024 * 1024)
					throw new Error("Architecture asset exceeds 25 MiB");
				chunks.push(chunk);
			}
			if (size === 0) throw new Error("Architecture asset has no body");
			bytes = Buffer.concat(chunks);
		} else {
			if (!isAbsolute(asset.path))
				throw new Error(
					"Architecture asset paths must be absolute or HTTP URLs",
				);
			const resolved = realpathSync(asset.path);
			if (
				!allowedDirectories.some(
					(root) =>
						existsSync(root) &&
						contains(resolve(root), resolve(asset.path)) &&
						contains(realpathSync(root), resolved),
				)
			)
				throw new Error("Architecture asset is outside authorized directories");
			bytes = readFileSync(resolved);
		}
		const folder = join(directory, "architecture", id);
		mkdirSync(folder, { recursive: true });
		const path = join(
			folder,
			`${index}-${basename(asset.path.split("?")[0]!) || "asset"}`,
		);
		writeFileSync(path, bytes, { flag: "wx" });
		asset.path = path;
		snapshots.set(original, path);
		assetDigests.push({
			path,
			digest: createHash("sha256").update(bytes).digest("hex"),
		});
	}
	content.candidate.plan += `\n\n## Architecture proposal ${id} (version ${version})\n\n${content.recommendation}\n\nClassification: ${content.classification}\n\nRationale: ${content.rationale}\n\nResponsibilities and interfaces:\n${content.interfaces.map((x) => `- ${x}`).join("\n")}\n\nRepository evidence:\n${content.evidence.map((x) => `- ${x.repository}: ${x.paths.join(", ")}. ${x.observation}`).join("\n")}\n\nAlternatives and trade-offs:\n${content.alternatives.map((x) => `- ${x.option}: ${x.tradeoffs}`).join("\n")}\n\nRisks:\n${content.risks.map((x) => `- ${x}`).join("\n")}\n\nUnresolved decisions:\n${content.unresolvedDecisions.map((x) => `- ${x}`).join("\n") || "None"}\n\n${content.visual ? `Diagram explanation: ${content.visual.explanation}\n\nDiagram data: ${JSON.stringify(content.visual.system)}` : ""}`;
	if (snapshots.size) {
		const references = [...snapshots.keys()].sort(
			(a, b) => b.length - a.length,
		);
		const pattern = new RegExp(
			references
				.map((path) => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
				.join("|"),
			"g",
		);
		content.candidate.plan = content.candidate.plan.replace(
			pattern,
			(path) => snapshots.get(path)!,
		);
		content.candidate.plan += `\n\n## Accepted asset snapshots\nUse only the frozen snapshot paths in candidate.assets for implementation. Original paths and URLs below identify sources; do not read or fetch them, including references expressed in another form.\n${JSON.stringify([...snapshots].map(([original, snapshot]) => ({ original, snapshot })))}`;
	}
	const proposal: ArchitectureProposal = {
		id,
		version,
		digest: "",
		source,
		status: "proposed",
		content,
		assetDigests,
		feedback: [],
		at: new Date().toISOString(),
	};
	proposal.digest = proposalDigest(proposal);
	return proposal;
}
export const architectureInstructions = `Inspect the selected repositories, actual module boundaries and conventions, all requirements, comments, answers and decisions, the draft plan and prior candidate-review feedback. Preserve Takeover's completed work, PR URL and branch. Propose the smallest adequate design; do not implement or invent human acceptance. Routine unsplit changes using established patterns may bypass architecture approval with a concrete rationale; meaningful responsibilities, boundaries, interfaces or trade-offs require human acceptance. Return ONLY architecture-v1: {"architectureContract":"architecture-v1","classification":"meaningful or routine","rationale":"concrete reason","evidence":[{"repository":"selected repo","paths":["actual inspected path"],"observation":"observed boundary or convention"}],"recommendation":"responsibilities and design","interfaces":["concrete interfaces"],"alternatives":[{"option":"alternative","tradeoffs":"concrete consequences"}],"risks":[],"unresolvedDecisions":[],"visual":{"explanation":"readable explanation","system":{"lanes":[{"id":"lane","name":"Boundary"}],"parts":[{"id":"part","label":"Module","laneId":"lane","status":"new or changed or unchanged or legacy"}],"before":[],"after":[{"source":"part","target":"other-existing-part","label":"interface"}]}},"candidate":{"plan":"COMPLETE self-contained implementation plan incorporating this architecture, every accepted requirement/decision, repository/base/delivery targets, original Takeover PR/work and validation expectations","assets":[{"path":"absolute path or HTTP URL","purpose":"..."}]}}. Meaningful choices require a useful diagram and alternatives. Routine outputs may omit visual. Never return approval fields. Include every detail the implementer needs in candidate; it will receive only the accepted plan/assets. Read architectureProposals and architectureDecisions for feedback; explanation requests are not authorization. Independent child delivery is separate future work, not executable scheduling here.`;
