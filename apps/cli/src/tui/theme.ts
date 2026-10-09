// Colours for the TUI: the web dashboard's RainbowBob tokens
// (packages/edge-worker/src/factory/web/styles.css, light and [data-theme="dark"]).
import type { Style } from "./terminal.js";

export type ThemeName = "light" | "dark";

const WEB = {
	light: {
		bg: "#fffaf3",
		surface: "#ffffff",
		text: "#2b2346",
		secondary: "#4f4769",
		muted: "#6f6889",
		quiet: "#f2eff7",
		track: "#f1ecf8",
		indigo: "#eeeaff",
		red: "#ffe9ec",
		orange: "#fff1e2",
		green: "#e3faf0",
		blue: "#e4f7fd",
		question: "#9a4a00",
		stuck: "#b0183a",
		review: "#08683f",
		working: "#075e7c",
		link: "#6946dc",
		focus: "#7b61ff",
		teal: "#2c7c8d",
	},
	dark: {
		bg: "#16122a",
		surface: "#221b3d",
		text: "#f4f0ff",
		secondary: "#cfc6ea",
		muted: "#a79fc6",
		quiet: "#2b2447",
		track: "#2e2650",
		indigo: "#28224f",
		red: "#3d1d30",
		orange: "#3b2a1c",
		green: "#173628",
		blue: "#15303f",
		question: "#ffbd7a",
		stuck: "#ff9cad",
		review: "#74ebb7",
		working: "#86dcf7",
		link: "#bda5ff",
		focus: "#ac9aff",
		teal: "#8cd9e8",
	},
} as const;

const rgb = (hex: string) =>
	[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [
		number,
		number,
		number,
	];
const mix = (a: string, b: string, amount: number) => {
	const [x, y] = [rgb(a), rgb(b)];
	return `#${x
		.map((v, i) =>
			Math.round(v + (y[i]! - v) * amount)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
};

export function tokens(name: ThemeName) {
	const p = WEB[name];
	const fg = (hex: string, bold = false): Style => ({ fg: hex, bold });
	return {
		name,
		base: { bg: p.bg, fg: p.text } as Style,
		text: fg(p.text),
		bold: fg(p.text, true),
		secondary: fg(p.secondary),
		muted: fg(p.muted),
		faint: fg(mix(p.muted, p.bg, 0.4)),
		border: fg(mix(p.muted, p.bg, 0.5)),
		focus: fg(p.focus),
		accent: fg(p.link),
		accentBold: fg(p.link, true),
		question: fg(p.question),
		stuck: fg(p.stuck),
		review: fg(p.review),
		working: fg(p.working),
		system: fg(p.teal),
		panel: { bg: name === "light" ? p.quiet : p.surface } as Style,
		raised: { bg: name === "light" ? p.surface : p.quiet } as Style,
		field: { bg: p.indigo } as Style,
		// Selection mirrors the web navigation pill: text and surface inverted.
		selection: { bg: p.text, fg: p.surface } as Style,
		selectionBold: { bg: p.text, fg: p.surface, bold: true } as Style,
		tint: {
			question: { bg: p.orange } as Style,
			stuck: { bg: p.red } as Style,
			review: { bg: p.green } as Style,
			working: { bg: p.blue } as Style,
		},
		toast: { bg: p.green, fg: p.review, bold: true } as Style,
		error: { bg: p.red, fg: p.stuck, bold: true } as Style,
		badge: { bg: "#ff9f43", fg: "#2b2346", bold: true } as Style,
		rainbow: [
			"#ff5d73",
			"#ff9f43",
			"#ffd23f",
			"#3ddc97",
			"#4cc9f0",
			"#7b61ff",
			"#c77dff",
		],
	};
}
export type Theme = ReturnType<typeof tokens>;

/** Foreground remapping for inverted selections: each colour becomes its counterpart from the other theme. */
export function selectionColors(theme: Theme) {
	const other = tokens(theme.name === "light" ? "dark" : "light");
	const map = new Map<string, string>();
	for (const key of [
		"text",
		"secondary",
		"muted",
		"faint",
		"border",
		"focus",
		"accent",
		"question",
		"stuck",
		"review",
		"working",
		"system",
	] as const)
		map.set(theme[key].fg!, other[key].fg!);
	return { bg: theme.selection.bg!, fg: map, fallback: theme.selection.fg! };
}

export function truecolorSupported(env: NodeJS.ProcessEnv = process.env) {
	if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? "")) return true;
	if (
		["iTerm.app", "WezTerm", "ghostty", "vscode", "Hyper", "Tabby"].includes(
			env.TERM_PROGRAM ?? "",
		)
	)
		return true;
	return /kitty|ghostty|alacritty|direct|truecolor/i.test(env.TERM ?? "");
}

const levels = [0, 95, 135, 175, 215, 255];
const nearest = (v: number) =>
	levels.reduce(
		(best, level, i) =>
			Math.abs(level - v) < Math.abs(levels[best]! - v) ? i : best,
		0,
	);
/** Closest xterm-256 colour for terminals without 24-bit support. */
export function ansi256(hex: string) {
	const [r, g, b] = rgb(hex);
	const cube = [nearest(r), nearest(g), nearest(b)] as const;
	const cubeColor = cube.map((i) => levels[i]!);
	const gray = Math.max(
		0,
		Math.min(23, Math.round((r + g + b) / 3 / 10.6 - 0.8)),
	);
	const grayValue = 8 + gray * 10;
	const distance = (c: number[]) =>
		(c[0]! - r) ** 2 + (c[1]! - g) ** 2 + (c[2]! - b) ** 2;
	return distance(cubeColor) <= distance([grayValue, grayValue, grayValue])
		? 16 + cube[0] * 36 + cube[1] * 6 + cube[2]
		: 232 + gray;
}

export function sgrFor(truecolor: boolean) {
	const cache = new Map<string, string>();
	const color = (layer: 38 | 48, hex: string) =>
		truecolor
			? `${layer};2;${rgb(hex).join(";")}`
			: `${layer};5;${ansi256(hex)}`;
	return (style: Style) => {
		// Frames create fresh cell styles; cache by value so long-running TUIs stay bounded.
		const key = `${style.bold ?? false}/${style.fg ?? ""}/${style.bg ?? ""}`;
		let value = cache.get(key);
		if (value === undefined) {
			const parts = [
				style.bold ? "1" : "",
				style.fg ? color(38, style.fg) : "",
				style.bg ? color(48, style.bg) : "",
			].filter(Boolean);
			value = parts.length ? `\x1b[${parts.join(";")}m` : "";
			cache.set(key, value);
		}
		return value;
	};
}

/** Theme from the terminal background (OSC 11), then COLORFGBG, else dark. */
export function detectTheme(
	input: NodeJS.ReadStream,
	output: NodeJS.WriteStream,
	env: NodeJS.ProcessEnv = process.env,
): Promise<ThemeName> {
	const background = env.COLORFGBG?.split(";").at(-1);
	const fallback: ThemeName =
		background && ["7", "15"].includes(background) ? "light" : "dark";
	return new Promise((resolve) => {
		const finish = (theme: ThemeName) => {
			clearTimeout(timer);
			input.off("data", listener);
			resolve(theme);
		};
		const listener = (data: Buffer | string) => {
			const match = /rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i.exec(
				String(data),
			);
			if (!match) return;
			const [r, g, b] = match
				.slice(1)
				.map((part) => Number.parseInt(part.slice(0, 2), 16));
			finish(0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 140 ? "light" : "dark");
		};
		const timer = setTimeout(() => finish(fallback), 300);
		input.on("data", listener);
		output.write("\x1b]11;?\x07");
	});
}
