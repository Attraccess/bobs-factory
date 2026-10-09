// Entry point for `bobs-factory tui`.
import { requestFactoryTerminalSession } from "bobs-factory-edge-worker";
import { TodayApp } from "./app.js";
import { FactoryClient } from "./client.js";
import { KeyParser } from "./terminal.js";
import {
	detectTheme,
	sgrFor,
	type ThemeName,
	truecolorSupported,
} from "./theme.js";

export interface TuiOptions {
	home: string;
	port: number;
	theme?: string;
}

/** Resolves the dashboard port: an explicit --port wins, then the service setting, then 3457. */
export function tuiPort(
	explicit: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
) {
	const value = explicit ?? env.BOBS_FACTORY_FACTORY_PORT ?? "3457";
	const port = Number(value);
	if (port === 0)
		throw new Error(
			"The factory dashboard is disabled (port 0); the TUI needs it running.",
		);
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw new Error(`Invalid dashboard port: ${value}`);
	return port;
}

export async function runTui(options: TuiOptions): Promise<void> {
	const input = process.stdin;
	const output = process.stdout;
	if (!input.isTTY || !output.isTTY)
		throw new Error("bobs-factory tui needs an interactive terminal.");
	if (options.theme && !["auto", "light", "dark"].includes(options.theme))
		throw new Error("--theme must be auto, light or dark");

	input.setRawMode(true);
	input.setEncoding("utf8");
	input.resume();
	// Alternate screen, hidden cursor, bracketed paste.
	output.write("\x1b[?1049h\x1b[?25l\x1b[?2004h");
	let restored = false;
	const restore = () => {
		if (restored) return;
		restored = true;
		output.write("\x1b[0m\x1b[?2004l\x1b[?25h\x1b[?1049l");
		if (input.isTTY) input.setRawMode(false);
		input.pause();
	};
	process.once("exit", restore);
	try {
		const theme: ThemeName =
			options.theme === "light" || options.theme === "dark"
				? options.theme
				: await detectTheme(input, output);
		const client = new FactoryClient({
			port: options.port,
			home: options.home,
			requestSession: requestFactoryTerminalSession,
		});

		await new Promise<void>((resolve) => {
			const parser = new KeyParser();
			let escapeTimer: ReturnType<typeof setTimeout> | undefined;
			const finish = () => {
				app.stop();
				if (escapeTimer) clearTimeout(escapeTimer);
				input.off("data", onData);
				output.off("resize", onResize);
				process.off("SIGTERM", finish);
				process.off("SIGHUP", finish);
				restore();
				resolve();
			};
			const app = new TodayApp({
				client,
				theme,
				sgr: sgrFor(truecolorSupported()),
				write: (frame) => output.write(frame),
				size: () => ({
					columns: output.columns || 80,
					rows: output.rows || 24,
				}),
				openUrl: async (url) => {
					const { default: open } = await import("open");
					await open(url);
				},
				quit: finish,
			});
			const onData = (data: string) => {
				if (escapeTimer) clearTimeout(escapeTimer);
				for (const key of parser.push(data)) app.key(key);
				if (parser.awaitingEscape)
					escapeTimer = setTimeout(() => {
						for (const key of parser.flushEscape()) app.key(key);
					}, 35);
			};
			const onResize = () => app.render();
			input.on("data", onData);
			output.on("resize", onResize);
			process.once("SIGTERM", finish);
			process.once("SIGHUP", finish);
			app.start();
			app.render();
		});
	} finally {
		restore();
		process.off("exit", restore);
	}
}
