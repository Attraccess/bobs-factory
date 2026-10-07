import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { canonicalPath } from "./paths.js";

const runner = z.enum(["claude", "codex", "gemini", "cursor", "opencode"]);
const path = z
	.string()
	.min(1)
	.refine(isAbsolute, "Preservation paths must be absolute")
	.transform(canonicalPath);
export const PreservationPlanSchema = z
	.object({
		version: z.literal(1),
		backupPaths: z.array(path).default([]),
		restorePaths: z.array(path).default([]),
		nativeCopies: z
			.array(z.object({ source: path, destination: path }))
			.default([]),
		continuations: z
			.array(
				z.object({
					runner,
					sessionId: z.string().min(1),
					workspace: path,
					evidencePath: path,
					evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
				}),
			)
			.default([]),
	})
	.strict();
export type PreservationPlan = z.infer<typeof PreservationPlanSchema>;
export interface NativeSession {
	runner: z.infer<typeof runner>;
	sessionId: string;
	workspace?: string;
}

/** Find operational checkpoints, excluding immutable transcripts and accepted recipes. */
export function nativeSessions(
	value: unknown,
	workspace?: string,
): NativeSession[] {
	if (!value || typeof value !== "object") return [];
	if (Array.isArray(value))
		return value.flatMap((item) => nativeSessions(item, workspace));
	const object = value as Record<string, unknown>;
	const working =
		typeof object.workspace === "string"
			? object.workspace
			: typeof (object.workspace as { path?: string } | undefined)?.path ===
					"string"
				? (object.workspace as { path: string }).path
				: typeof object.workingDirectory === "string"
					? object.workingDirectory
					: workspace;
	const sessions: NativeSession[] = [];
	for (const provider of runner.options) {
		const id = object[`${provider}SessionId`];
		if (typeof id === "string" && id)
			sessions.push({ runner: provider, sessionId: id, workspace: working });
	}
	if (
		runner.safeParse(object.runner).success &&
		typeof object.sessionId === "string"
	)
		sessions.push({
			runner: runner.parse(object.runner),
			sessionId: object.sessionId,
			workspace: working,
		});
	for (const [key, child] of Object.entries(object))
		if (
			![
				"history",
				"messages",
				"agentSessionEntries",
				"workflow",
				"workflowDefinitions",
				"output",
				"outputs",
				"events",
			].includes(key)
		)
			sessions.push(...nativeSessions(child, working));
	return sessions;
}

/** Evidence is produced by the migration assistant after actual provider continuation. */
export function verifyContinuations(
	sessions: NativeSession[],
	plan: PreservationPlan,
	destinationWorkspace: (workspace: string) => string,
) {
	for (const session of sessions) {
		if (!session.workspace)
			throw new Error("Cannot determine native conversation workspace");
		const workspace = canonicalPath(session.workspace);
		const mapping = plan.continuations.find(
			(entry) =>
				entry.runner === session.runner &&
				entry.sessionId === session.sessionId &&
				entry.workspace === workspace,
		);
		if (!mapping)
			throw new Error(
				"Native agent conversation relocation needs an agent-verified continuation mapping before apply",
			);
		const bytes = readFileSync(mapping.evidencePath);
		if (
			createHash("sha256").update(bytes).digest("hex") !==
			mapping.evidenceSha256
		)
			throw new Error("Native continuation evidence changed");
		const evidence = JSON.parse(bytes.toString("utf8"));
		if (
			evidence.outcome !== "passed" ||
			evidence.runner !== session.runner ||
			evidence.sessionId !== session.sessionId ||
			canonicalPath(evidence.originalWorkspace) !== workspace ||
			canonicalPath(evidence.relocatedWorkspace) !==
				destinationWorkspace(workspace) ||
			!evidence.command ||
			!Number.isFinite(Date.parse(evidence.verifiedAt))
		)
			throw new Error(
				"Native continuation evidence does not match the planned migration",
			);
	}
}
