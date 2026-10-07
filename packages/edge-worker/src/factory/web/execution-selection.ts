import type { ExecutionSelection } from "../ExecutionProfiles";
import { readStored, writeStored } from "./review-state";

const key = "bob-composer-execution";
function selection(value: unknown): ExecutionSelection {
	const result: ExecutionSelection = {};
	if (value && typeof value === "object" && !Array.isArray(value)) {
		for (const key of ["identityProfile", "toolProfile"] as const) {
			const id = (value as ExecutionSelection)[key];
			if (typeof id === "string" && id) result[key] = id;
		}
	}
	return result;
}

// Keep each tab's explicit choices across reloads; never store resolved profiles.
export function readComposerExecution(): ExecutionSelection {
	return selection(readStored(key, {}, true));
}
export function writeComposerExecution(value: ExecutionSelection) {
	writeStored(key, selection(value), true);
}
