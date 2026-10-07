import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import { factoryWebAssets } from "../src/factory/FactoryWebAssets.js";
import {
	applyTheme,
	readThemeChoice,
	resolveTheme,
} from "../src/factory/web/theme.js";

afterEach(() => vi.unstubAllGlobals());

function documentTheme() {
	const attributes: Record<string, string> = {};
	const root = { dataset: {}, style: {} };
	return {
		root,
		attributes,
		document: {
			documentElement: root,
			querySelector: () => ({
				setAttribute: (key: string, value: string) => {
					attributes[key] = value;
				},
			}),
		},
	};
}

// Execute the bootstrap actually shipped in the integrity-checked cached HTML.
const html = factoryWebAssets()
	.assets.find((asset) => asset.path === "/")!
	.bytes.toString();
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!bootstrap)
	throw new Error("Factory shell has no blocking theme bootstrap");

it.each([
	["dark", false, "dark", "#16122a"],
	["light", true, "light", "#fffaf3"],
	["system", true, "dark", "#16122a"],
	["system", false, "light", "#fffaf3"],
	[null, true, "dark", "#16122a"],
	[null, false, "light", "#fffaf3"],
	["invalid", true, "dark", "#16122a"],
	["invalid", false, "light", "#fffaf3"],
] as const)("initializes %s with system dark=%s before the app loads", (saved, systemDark, theme, color) => {
	const state = documentTheme();
	runInNewContext(bootstrap, {
		document: state.document,
		localStorage: { getItem: () => saved },
		matchMedia: () => ({ matches: systemDark }),
	});
	expect(state.root).toEqual({
		dataset: { theme },
		style: { colorScheme: theme, backgroundColor: color },
	});
	expect(state.attributes).toEqual({ content: color });
});

it("initializes System even when accessing storage throws", () => {
	const state = documentTheme();
	const context = {
		document: state.document,
		matchMedia: () => ({ matches: true }),
		get localStorage() {
			throw new Error("Storage denied");
		},
	};
	runInNewContext(bootstrap, context);
	vi.stubGlobal("localStorage", {
		getItem: () => {
			throw new Error("Storage denied");
		},
	});
	expect(readThemeChoice()).toBe("system");
	expect(state.root.dataset).toEqual({ theme: "dark" });
	expect(state.attributes).toEqual({ content: "#16122a" });
});

it("keeps root colors and chrome together through live theme changes", () => {
	const state = documentTheme();
	vi.stubGlobal("document", state.document);
	for (const [choice, systemDark, expected, color] of [
		["light", true, "light", "#fffaf3"],
		["dark", false, "dark", "#16122a"],
		["system", false, "light", "#fffaf3"],
		["system", true, "dark", "#16122a"],
		["light", true, "light", "#fffaf3"],
	] as const) {
		applyTheme(resolveTheme(choice, systemDark));
		expect(state.root).toEqual({
			dataset: { theme: expected },
			style: { colorScheme: expected, backgroundColor: color },
		});
		expect(state.attributes).toEqual({ content: color });
	}
});
