import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkAccess } from "../src/factory/web/auth-state.js";
import {
	readComposerExecution,
	writeComposerExecution,
} from "../src/factory/web/execution-selection.js";

beforeEach(async () => {
	const previous = globalThis.fetch;
	globalThis.fetch = async () =>
		Response.json({ authenticated: true, expires: Date.now() + 3600000 });
	await checkAccess();
	globalThis.fetch = previous;
});
afterEach(() => vi.unstubAllGlobals());
it("round-trips independent profile IDs across reloads without storing profile contents", () => {
	const values = new Map<string, string>();
	vi.stubGlobal("sessionStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
	writeComposerExecution({
		identityProfile: "native-claude",
		toolProfile: "shared",
	});
	expect(readComposerExecution()).toEqual({
		identityProfile: "native-claude",
		toolProfile: "shared",
	});
	writeComposerExecution({ identityProfile: "native-claude" });
	expect(readComposerExecution()).toEqual({ identityProfile: "native-claude" });
	values.set(
		"bob-composer-execution",
		JSON.stringify({
			identityProfile: "bob",
			credential: "secret",
			toolProfile: 1,
		}),
	);
	expect(readComposerExecution()).toEqual({ identityProfile: "bob" });
	writeComposerExecution(readComposerExecution());
	expect(values.get("bob-composer-execution")).toBe(
		'{"identityProfile":"bob"}',
	);
	writeComposerExecution({});
	expect(readComposerExecution()).toEqual({});
});

it("keeps the composer usable when storage is denied", () => {
	vi.stubGlobal("sessionStorage", {
		getItem: () => {
			throw new Error("Denied");
		},
		setItem: () => {
			throw new Error("Denied");
		},
	});
	expect(readComposerExecution()).toEqual({});
	expect(() =>
		writeComposerExecution({ identityProfile: "bob" }),
	).not.toThrow();
});
