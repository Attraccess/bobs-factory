import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

// Bootstrap and Application share ownership so the first load is not mistaken
// for inherited environment on subsequent loads.
const ownership = new WeakMap<
	NodeJS.ProcessEnv,
	Map<string, Map<string, string>>
>();

export function loadEnvFile(path: string, env = process.env): void {
	let files = ownership.get(env);
	if (!files) {
		files = new Map();
		ownership.set(env, files);
	}
	const file = resolve(path);
	const previous = files.get(file) ?? new Map<string, string>();
	let parsed: Record<string, string>;
	try {
		parsed = existsSync(file) ? dotenv.parse(readFileSync(file)) : {};
	} catch {
		// Keep the last successful load if the file is temporarily unreadable.
		// dotenv.config also treats read failures as nonfatal.
		return;
	}
	const next = new Map<string, string>();
	for (const [key, value] of Object.entries(parsed)) {
		if (env[key] !== undefined && env[key] !== previous.get(key)) continue;
		env[key] = value;
		next.set(key, value);
	}
	for (const [key, value] of previous) {
		if (!Object.hasOwn(parsed, key) && env[key] === value) delete env[key];
	}
	files.set(file, next);
}
