import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonObject, RunnerType } from "bobs-factory-core";
import { resolvePath } from "bobs-factory-core";
import type { ToolProfile } from "./ExecutionProfiles.js";

const fields: Record<RunnerType, string[]> = {
	claude: [
		"language",
		"outputStyle",
		"effortLevel",
		"includeCoAuthoredBy",
		"attribution",
		"autoMemoryEnabled",
	],
	codex: [
		"personality",
		"model_reasoning_summary",
		"model_verbosity",
		"hide_agent_reasoning",
	],
	gemini: ["ui"],
	cursor: [],
	opencode: ["theme", "compaction", "share"],
};
export function ordinarySettings(
	runner: RunnerType,
	input: unknown,
): JsonObject {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new Error("Runner settings must be an object");
	for (const key of Object.keys(input))
		if (!fields[runner].includes(key))
			throw new Error(
				`${runner} does not support imported setting ${key}. Authentication, MCP and permissions must use their separate profile fields`,
			);
	const validate = (value: unknown): void => {
		if (
			value === null ||
			["string", "boolean", "number"].includes(typeof value)
		)
			return;
		if (Array.isArray(value)) {
			value.forEach(validate);
			return;
		}
		if (!value || typeof value !== "object")
			throw new Error("Ordinary settings must contain JSON values");
		for (const [key, child] of Object.entries(value)) {
			if (
				/^(?:__proto__|constructor|prototype)$/.test(key) ||
				/token|secret|password|api.?key|credential|auth|hooks|permission|provider|mcp/i.test(
					key,
				)
			)
				throw new Error(
					"Authentication, hooks, providers and permissions cannot be embedded in ordinary settings",
				);
			validate(child);
		}
	};
	validate(input);
	return input as JsonObject;
}
export function mergeSettings(
	base: JsonObject,
	overlay: JsonObject,
): JsonObject {
	const result = { ...base };
	for (const [key, value] of Object.entries(overlay)) {
		const previous = result[key];
		result[key] =
			value &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			previous &&
			typeof previous === "object" &&
			!Array.isArray(previous)
				? mergeSettings(previous, value)
				: value;
	}
	return result;
}
/** Snapshot ordinary sources privately, independently of authentication and MCP sources. */
export function executionSettings(
	profile: ToolProfile,
	runner: RunnerType,
	root: string,
): JsonObject {
	let settings: JsonObject = {};
	for (const source of profile.runnerSettingsSources?.[runner] ?? []) {
		const path = resolvePath(source);
		const cache = join(
			root,
			"ordinary-settings",
			`${createHash("sha256").update(`${runner}:${path}`).digest("hex")}.json`,
		);
		if (profile.mode !== "share" && !existsSync(cache)) {
			mkdirSync(join(root, "ordinary-settings"), {
				recursive: true,
				mode: 0o700,
			});
			writeFileSync(cache, readFileSync(path), { mode: 0o600, flag: "wx" });
		}
		let data: unknown;
		try {
			data = JSON.parse(
				readFileSync(profile.mode === "share" ? path : cache, "utf8"),
			);
		} catch {
			throw new Error(
				"Declared ordinary settings source must be readable JSON. Native authentication/configuration import is unsupported",
			);
		}
		settings = mergeSettings(settings, ordinarySettings(runner, data));
	}
	return mergeSettings(
		settings,
		ordinarySettings(runner, profile.runnerSettings?.[runner] ?? {}),
	);
}
