import { ZodError } from "zod";
import type { AgentCheckpoint } from "./WorkflowRuntime.js";
export class OutputValidationError extends Error {
	constructor(
		public output: unknown,
		public issues: NonNullable<AgentCheckpoint["rejected"]>["issues"],
	) {
		super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
	}
}
export function outputValidationError(
	output: unknown,
	error: unknown,
): OutputValidationError {
	if (error instanceof OutputValidationError) return error;
	return new OutputValidationError(
		output,
		error instanceof ZodError
			? error.issues.map((issue) => ({
					path: `/${issue.path.join("/")}`,
					message: issue.message,
					actual: issue.path.reduce<unknown>(
						(value, key) =>
							value && typeof value === "object"
								? (value as Record<PropertyKey, unknown>)[key]
								: undefined,
						output,
					),
				}))
			: [
					{
						path: "/",
						message: error instanceof Error ? error.message : String(error),
					},
				],
	);
}
