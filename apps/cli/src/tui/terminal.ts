// Fullscreen terminal primitives for the Bob's Factory TUI: a cell grid that
// renders with ANSI, key parsing and text inputs. No dependencies.

export interface Style {
	fg?: string;
	bg?: string;
	bold?: boolean;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Removes terminal control sequences so agent or ticket text cannot drive the terminal. */
export function sanitize(text: string): string {
	// biome-ignore-start lint/suspicious/noControlCharactersInRegex: stripping control sequences is the point
	return text
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)?/g, "")
		.replace(/\t/g, "  ")
		.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
	// biome-ignore-end lint/suspicious/noControlCharactersInRegex: stripping control sequences is the point
}

export function graphemes(text: string): string[] {
	return Array.from(segmenter.segment(text), (part) => part.segment);
}

function wide(code: number) {
	return (
		(code >= 0x1100 && code <= 0x115f) ||
		(code >= 0x2e80 && code <= 0x303e) ||
		(code >= 0x3041 && code <= 0x33ff) ||
		(code >= 0x3400 && code <= 0x4dbf) ||
		(code >= 0x4e00 && code <= 0x9fff) ||
		(code >= 0xa000 && code <= 0xa4cf) ||
		(code >= 0xac00 && code <= 0xd7a3) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xfe30 && code <= 0xfe4f) ||
		(code >= 0xff00 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6) ||
		(code >= 0x1f300 && code <= 0x1f64f) ||
		(code >= 0x1f680 && code <= 0x1f6ff) ||
		(code >= 0x1f900 && code <= 0x1f9ff) ||
		(code >= 0x20000 && code <= 0x3fffd)
	);
}

/** Terminal cells occupied by one grapheme. */
export function cellWidth(grapheme: string): number {
	const code = grapheme.codePointAt(0) ?? 0;
	if (code < 0x20) return 0;
	if (wide(code)) return 2;
	if (grapheme.includes("️") && /\p{Extended_Pictographic}/u.test(grapheme))
		return 2;
	return 1;
}

export function width(text: string): number {
	let total = 0;
	for (const g of graphemes(text)) total += cellWidth(g);
	return total;
}

export function clip(text: string, max: number): string {
	if (max <= 0) return "";
	if (width(text) <= max) return text;
	let out = "";
	let used = 0;
	for (const g of graphemes(text)) {
		const w = cellWidth(g);
		if (used + w > max - 1) break;
		out += g;
		used += w;
	}
	return `${out}…`;
}

export function pad(text: string, size: number): string {
	const clipped = clip(text, size);
	return clipped + " ".repeat(Math.max(0, size - width(clipped)));
}

/** Word-wraps text to a width, keeping explicit newlines. */
export function wrap(text: string, max: number): string[] {
	const lines: string[] = [];
	const size = Math.max(1, max);
	for (const paragraph of sanitize(text).split("\n")) {
		let line = "";
		for (const word of paragraph.split(" ")) {
			const candidate = line ? `${line} ${word}` : word;
			if (width(candidate) <= size) {
				line = candidate;
				continue;
			}
			if (line) lines.push(line);
			line = "";
			// Hard-break words longer than the line.
			let chunk = "";
			for (const g of graphemes(word)) {
				if (width(chunk + g) > size) {
					lines.push(chunk);
					chunk = "";
				}
				chunk += g;
			}
			line = chunk;
		}
		lines.push(line);
	}
	return lines;
}

export class Screen {
	readonly cells: string[];
	readonly styles: Style[];
	cursor?: { x: number; y: number };
	/** Foregrounds remapped on a selection background so status colours stay legible. */
	selection?: { bg: string; fg: Map<string, string>; fallback: string };

	constructor(
		readonly w: number,
		readonly h: number,
		readonly base: Style,
	) {
		this.cells = new Array(w * h).fill(" ");
		this.styles = new Array(w * h).fill(base);
	}

	private set(x: number, y: number, cell: string, style: Style) {
		const i = y * this.w + x;
		// Never leave half of a wide character behind.
		if (this.cells[i] === "" && x > 0) this.cells[i - 1] = " ";
		if (cellWidth(this.cells[i] ?? " ") === 2 && x + 1 < this.w)
			this.cells[i + 1] = " ";
		this.cells[i] = cell;
		this.styles[i] = style;
	}

	private merge(x: number, y: number, style: Style): Style {
		const under = this.styles[y * this.w + x]!;
		if (style.bg) return { ...style, fg: style.fg ?? under.fg };
		const bg = under.bg;
		let fg = style.fg;
		if (this.selection && bg === this.selection.bg && fg)
			fg = this.selection.fg.get(fg) ?? this.selection.fallback;
		return { ...style, bg, fg: fg ?? under.fg };
	}

	/** Draws single-line text; returns the cells used. */
	put(x: number, y: number, text: string, style: Style = {}, max?: number) {
		if (y < 0 || y >= this.h) return 0;
		const limit = Math.min(this.w, max === undefined ? this.w : x + max);
		const content =
			max === undefined
				? sanitize(text).replace(/\n/g, " ")
				: clip(sanitize(text).replace(/\n/g, " "), max);
		let cx = x;
		for (const g of graphemes(content)) {
			const w = cellWidth(g);
			if (w === 0) continue;
			if (cx + w > limit) break;
			if (cx >= 0) {
				const merged = this.merge(cx, y, style);
				this.set(cx, y, g, merged);
				if (w === 2) this.set(cx + 1, y, "", merged);
			}
			cx += w;
		}
		return cx - x;
	}

	fill(x: number, y: number, w: number, h: number, style: Style) {
		for (let j = Math.max(0, y); j < Math.min(this.h, y + h); j++)
			for (let i = Math.max(0, x); i < Math.min(this.w, x + w); i++)
				this.set(i, j, " ", { ...this.base, ...style });
	}

	hline(x: number, y: number, w: number, style: Style, char = "─") {
		this.put(x, y, char.repeat(Math.max(0, w)), style);
	}

	vline(x: number, y: number, h: number, style: Style, char = "│") {
		for (let j = 0; j < h; j++) this.put(x, y + j, char, style);
	}

	box(
		x: number,
		y: number,
		w: number,
		h: number,
		style: Style,
		title?: { text: string; style: Style },
	) {
		this.put(x, y, `╭${"─".repeat(Math.max(0, w - 2))}╮`, style);
		this.put(x, y + h - 1, `╰${"─".repeat(Math.max(0, w - 2))}╯`, style);
		this.vline(x, y + 1, h - 2, style);
		this.vline(x + w - 1, y + 1, h - 2, style);
		if (title) this.put(x + 2, y, ` ${title.text} `, title.style, w - 4);
	}

	render(sgr: (style: Style) => string): string {
		let out = "\x1b[?25l\x1b[H";
		for (let y = 0; y < this.h; y++) {
			out += `\x1b[${y + 1};1H`;
			let current: string | undefined;
			for (let x = 0; x < this.w; x++) {
				const cell = this.cells[y * this.w + x]!;
				if (cell === "") continue;
				const style = sgr(this.styles[y * this.w + x]!);
				if (style !== current) {
					out += `\x1b[0m${style}`;
					current = style;
				}
				out += cell;
			}
		}
		out += "\x1b[0m";
		if (this.cursor)
			out += `\x1b[${this.cursor.y + 1};${this.cursor.x + 1}H\x1b[?25h`;
		return out;
	}
}

/** A key press; "text" and "paste" carry their characters in `text`. */
export interface Key {
	name: string;
	text?: string;
}

const SEQUENCES: Record<string, string> = {
	"\x1b[A": "up",
	"\x1b[B": "down",
	"\x1b[C": "right",
	"\x1b[D": "left",
	"\x1bOA": "up",
	"\x1bOB": "down",
	"\x1bOC": "right",
	"\x1bOD": "left",
	"\x1b[H": "home",
	"\x1b[F": "end",
	"\x1bOH": "home",
	"\x1bOF": "end",
	"\x1b[1~": "home",
	"\x1b[4~": "end",
	"\x1b[5~": "pageup",
	"\x1b[6~": "pagedown",
	"\x1b[3~": "delete",
	"\x1b[Z": "shift-tab",
	"\x1b[1;3D": "alt-left",
	"\x1b[1;3C": "alt-right",
	"\x1bb": "alt-left",
	"\x1bf": "alt-right",
	"\x1b\r": "alt-enter",
	"\x1b[13;2u": "shift-enter",
	"\x1b[27;2;13~": "shift-enter",
	"\x1b[19~": "f8",
};
const ORDERED = Object.keys(SEQUENCES).sort((a, b) => b.length - a.length);
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/** Parses raw stdin data into keys. Text runs and bracketed pastes stay intact. */
export function parseKeys(data: string): Key[] {
	if (data === "\x1b") return [{ name: "escape" }];
	const keys: Key[] = [];
	let i = 0;
	const text = (char: string) => {
		const last = keys.at(-1);
		if (last?.name === "text") last.text = `${last.text ?? ""}${char}`;
		else keys.push({ name: "text", text: char });
	};
	while (i < data.length) {
		if (data.startsWith(PASTE_START, i)) {
			const end = data.indexOf(PASTE_END, i);
			const stop = end < 0 ? data.length : end;
			keys.push({
				name: "paste",
				text: data.slice(i + PASTE_START.length, stop).replace(/\r\n?/g, "\n"),
			});
			i = end < 0 ? data.length : end + PASTE_END.length;
			continue;
		}
		const sequence = ORDERED.find((s) => data.startsWith(s, i));
		if (sequence) {
			keys.push({ name: SEQUENCES[sequence]! });
			i += sequence.length;
			continue;
		}
		const char = data[i]!;
		if (char === "\x1b") {
			// biome-ignore lint/suspicious/noControlCharactersInRegex: parses terminal escape sequences
			const csi = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(data.slice(i));
			if (csi) {
				i += csi[0].length; // unknown sequence: ignore
				continue;
			}
			if (i + 1 < data.length) {
				keys.push({ name: `alt-${data[i + 1]}` });
				i += 2;
				continue;
			}
			keys.push({ name: "escape" });
			i++;
			continue;
		}
		const code = char.charCodeAt(0);
		if (char === "\r" || char === "\n") keys.push({ name: "enter" });
		else if (char === "\t") keys.push({ name: "tab" });
		else if (code === 127 || code === 8) keys.push({ name: "backspace" });
		else if (code === 0) keys.push({ name: "ctrl-space" });
		else if (code < 27)
			keys.push({ name: `ctrl-${String.fromCharCode(code + 96)}` });
		else if (code === 28) keys.push({ name: "ctrl-\\" });
		else if (code === 29) keys.push({ name: "ctrl-]" });
		else if (code >= 32) {
			// Keep surrogate pairs together.
			const point = data.codePointAt(i)!;
			const symbol = String.fromCodePoint(point);
			text(symbol);
			i += symbol.length;
			continue;
		}
		i++;
	}
	return keys;
}

/** Stdin chunks need not end on key or paste boundaries. Hold incomplete sequences. */
export class KeyParser {
	private buffer = "";

	get awaitingEscape() {
		return this.buffer === "\x1b";
	}

	flushEscape(): Key[] {
		if (!this.awaitingEscape) return [];
		this.buffer = "";
		return [{ name: "escape" }];
	}

	push(data: string): Key[] {
		this.buffer += data;
		const keys: Key[] = [];
		let end = 0;
		while (end < this.buffer.length) {
			const tail = this.buffer.slice(end);
			if (tail.startsWith(PASTE_START)) {
				const close = tail.indexOf(PASTE_END, PASTE_START.length);
				if (close < 0) break;
				end += close + PASTE_END.length;
				continue;
			}
			if (
				[PASTE_START, ...ORDERED].some(
					(sequence) =>
						sequence.length > tail.length && sequence.startsWith(tail),
				)
			)
				break;
			const sequence = ORDERED.find((item) => tail.startsWith(item));
			if (sequence) {
				end += sequence.length;
				continue;
			}
			// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal CSI framing
			if (/^\x1b\[[0-?]*[ -/]*$/.test(tail)) break;
			end++;
		}
		keys.push(...parseKeys(this.buffer.slice(0, end)));
		this.buffer = this.buffer.slice(end);
		return keys;
	}
}

/** Soft-wrapping text input. Single-line inputs turn newlines into spaces. */
export class TextInput {
	private parts: string[] = [];
	cursor = 0;

	constructor(
		public placeholder = "",
		readonly multiline = false,
	) {}

	get value() {
		return this.parts.join("");
	}

	set value(text: string) {
		this.parts = graphemes(this.clean(text));
		this.cursor = this.parts.length;
	}

	private clean(text: string) {
		const safe = sanitize(text.replace(/\r\n?/g, "\n").replace(/\t/g, "  "));
		return this.multiline ? safe : safe.replace(/\n/g, " ");
	}

	private insert(text: string) {
		const added = graphemes(this.clean(text));
		this.parts = this.parts
			.slice(0, this.cursor)
			.concat(added, this.parts.slice(this.cursor));
		this.cursor += added.length;
	}

	/** Returns true when the key changed the input or its cursor. */
	handle(key: Key): boolean {
		if (key.name === "text" || key.name === "paste") {
			this.insert(key.text!);
			return true;
		}
		const words = () => {
			let i = this.cursor;
			while (i > 0 && this.parts[i - 1] === " ") i--;
			while (i > 0 && this.parts[i - 1] !== " " && this.parts[i - 1] !== "\n")
				i--;
			return i;
		};
		switch (key.name) {
			case "backspace":
				if (this.cursor > 0) this.parts.splice(--this.cursor, 1);
				return true;
			case "delete":
				this.parts.splice(this.cursor, 1);
				return true;
			case "left":
				this.cursor = Math.max(0, this.cursor - 1);
				return true;
			case "right":
				this.cursor = Math.min(this.parts.length, this.cursor + 1);
				return true;
			case "home":
			case "ctrl-a":
				this.cursor = 0;
				return true;
			case "end":
			case "ctrl-e":
				this.cursor = this.parts.length;
				return true;
			case "alt-left":
				this.cursor = words();
				return true;
			case "alt-right":
				while (
					this.cursor < this.parts.length &&
					this.parts[this.cursor] === " "
				)
					this.cursor++;
				while (
					this.cursor < this.parts.length &&
					this.parts[this.cursor] !== " "
				)
					this.cursor++;
				return true;
			case "ctrl-u":
				this.parts.splice(0, this.cursor);
				this.cursor = 0;
				return true;
			case "ctrl-k":
				this.parts.splice(this.cursor);
				return true;
			case "ctrl-w": {
				const start = words();
				this.parts.splice(start, this.cursor - start);
				this.cursor = start;
				return true;
			}
			case "alt-enter":
			case "shift-enter":
			case "ctrl-j":
				if (!this.multiline) return false;
				this.insert("\n");
				return true;
			default:
				return false;
		}
	}

	/** Lays the value out in rows; returns the rows and the cursor row/column. */
	layout(max: number) {
		const rows: string[] = [""];
		let used = 0;
		let cursor = { row: 0, col: 0 };
		this.parts.forEach((g, index) => {
			const w = g === "\n" ? 0 : cellWidth(g);
			if (used + w > max) {
				rows.push("");
				used = 0;
			}
			if (index === this.cursor) cursor = { row: rows.length - 1, col: used };
			if (g === "\n") {
				rows.push("");
				used = 0;
				return;
			}
			rows[rows.length - 1] += g;
			used += w;
		});
		if (this.cursor >= this.parts.length) {
			if (used >= max) {
				rows.push("");
				used = 0;
			}
			cursor = { row: rows.length - 1, col: used };
		}
		return { rows, cursor };
	}

	/** Renders up to `h` rows, keeping the cursor visible. Returns the rows drawn. */
	render(
		screen: Screen,
		x: number,
		y: number,
		w: number,
		h: number,
		style: Style,
		placeholderStyle: Style,
		focused: boolean,
	) {
		if (!this.parts.length) {
			screen.put(x, y, this.placeholder, placeholderStyle, w);
			if (focused) screen.cursor = { x, y };
			return 1;
		}
		const { rows, cursor } = this.layout(w);
		const start = Math.max(0, Math.min(cursor.row - h + 1, rows.length - h));
		const visible = rows.slice(start, start + h);
		visible.forEach((row, i) => {
			screen.put(x, y + i, row, style, w);
		});
		if (focused)
			screen.cursor = { x: x + cursor.col, y: y + cursor.row - start };
		return visible.length;
	}
}
