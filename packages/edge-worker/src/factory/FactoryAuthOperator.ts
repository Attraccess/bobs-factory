import { createHash, randomBytes } from "node:crypto";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	renameSync,
} from "node:fs";
import { join } from "node:path";
import { atomicPrivateFile, privateFile } from "./FactoryAuthStore.js";

function authDirectory(home: string) {
	const directory = join(home, "factory", "auth");
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const stat = lstatSync(directory);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(process.getuid && stat.uid !== process.getuid())
	)
		throw new Error("Authentication directory must belong to this operator");
	chmodSync(directory, 0o700);
	return directory;
}
/** Local filesystem authority only. Never expose these functions as dashboard endpoints. */
export function authorizeFactoryEnrollment(home: string): string {
	const directory = authDirectory(home),
		token = randomBytes(32).toString("base64url");
	atomicPrivateFile(
		join(directory, "enroll.json"),
		JSON.stringify({ token, expires: Date.now() + 600000 }),
	);
	return token;
}
/**
 * Local filesystem authority only: request a terminal session from the running
 * server. Only the token hash is written; the server consumes the request within a
 * minute and accepts the token as a Bearer credential on its localhost origin.
 */
export function requestFactoryTerminalSession(home: string): string {
	const directory = authDirectory(home),
		token = randomBytes(32).toString("base64url");
	atomicPrivateFile(
		join(directory, `terminal-${randomBytes(16).toString("hex")}.json`),
		JSON.stringify({
			hash: createHash("sha256").update(token).digest("hex"),
			expires: Date.now() + 60000,
		}),
	);
	return token;
}
export function requestFactoryAuthRecovery(
	home: string,
	confirmation: string | undefined,
): void {
	if (confirmation !== "RESET FACTORY AUTHENTICATION")
		throw new Error(
			'Recovery revokes every Factory passkey and session, preserving runs and integrations. Repeat with --confirm "RESET FACTORY AUTHENTICATION".',
		);
	const directory = authDirectory(home),
		state = join(directory, "state.json");
	if (existsSync(state)) {
		privateFile(state); // Verify ownership and enforce private permissions even for corrupt files.
		renameSync(
			state,
			join(
				directory,
				`state-recovered-${Date.now()}-${randomBytes(8).toString("hex")}.json`,
			),
		);
	}
	atomicPrivateFile(join(directory, "recover"), "RESET FACTORY AUTHENTICATION");
}
