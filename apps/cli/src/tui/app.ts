// The Bob's Factory TUI: a keyboard-first Today inbox with a fullscreen run view.
// Mirrors the web dashboard's Today: questions, stuck runs and reviews first,
// running work in compact rows and finished work in Settled.
import { attention, finished, settleReason } from "bobs-factory-edge-worker";
import type { FactoryChange, FactoryClient } from "./client.js";
import {
	AnswerForm,
	type FormResult,
	LaunchForm,
	PromptForm,
} from "./forms.js";
import {
	type ActivityPage,
	ago,
	type ConversationLine,
	conversation,
	type FactoryConfig,
	type RunDetail,
	type RunItem,
	repositoryName,
	type StepState,
	stateLabel,
	stepName,
	stepStrip,
	type Tone,
	today,
	workflowOf,
} from "./model.js";
import {
	clip,
	type Key,
	pad,
	Screen,
	type Style,
	TextInput,
	width,
	wrap,
} from "./terminal.js";
import {
	selectionColors,
	type Theme,
	type ThemeName,
	tokens,
} from "./theme.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SETTLED_TOGGLE = "settled";

type Overlay =
	| { kind: "help" }
	| { kind: "switcher"; input: TextInput; index: number }
	| { kind: "launch"; form: LaunchForm }
	| { kind: "answer"; form: AnswerForm }
	| {
			kind: "prompt";
			form: PromptForm;
			submit: (text: string) => Promise<unknown>;
	  }
	| { kind: "confirm"; text: string; action: () => Promise<unknown> };

type Row =
	| {
			kind: "header";
			label: string;
			count: number;
			tone: Tone;
			toggle?: boolean;
	  }
	| { kind: "card"; run: RunItem }
	| { kind: "run"; run: RunItem; settled?: string }
	| { kind: "empty"; text: string };

export interface AppOptions {
	client: FactoryClient;
	theme: ThemeName;
	sgr: (style: Style) => string;
	write: (frame: string) => void;
	size: () => { columns: number; rows: number };
	openUrl: (url: string) => Promise<unknown>;
	quit: () => void;
}

export class TodayApp {
	private theme: Theme;
	private config?: FactoryConfig;
	private runs: RunItem[] = [];
	private loaded = false;
	private loadError?: string;
	private live = false;
	private liveError?: string;
	private details = new Map<string, RunDetail>();
	private loadingDetails = new Set<string>();
	private activity = new Map<
		string,
		{ lines: ConversationLine[]; hasOlder: boolean }
	>();
	private view: "today" | "run" = "today";
	private runId?: string;
	private selected?: string;
	private showSettled = false;
	private scroll = 0;
	private maxScroll = 0;
	private overlay?: Overlay;
	private draft?: LaunchForm;
	private toast?: { text: string; error: boolean; until: number };
	private busy = false;
	private frame = 0;
	private stopEvents?: () => void;
	private refreshTimer?: ReturnType<typeof setTimeout>;
	private pendingIds = new Set<string>();
	private pendingConfig = false;
	private ticker?: ReturnType<typeof setInterval>;
	private stopped = false;
	private reloadDetails = new Set<string>();

	constructor(private options: AppOptions) {
		this.theme = tokens(options.theme);
	}

	start() {
		this.stopEvents = this.options.client.events(
			(change) => this.onChange(change),
			(live, error) => {
				this.live = live;
				this.liveError = error;
				if (live) void this.refreshAll();
				this.render();
			},
		);
		void this.refreshAll();
		this.ticker = setInterval(() => {
			this.frame++;
			if (this.toast && this.toast.until < Date.now()) this.toast = undefined;
			this.render();
		}, 120);
	}

	stop() {
		this.stopped = true;
		this.stopEvents?.();
		if (this.ticker) clearInterval(this.ticker);
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
	}

	// ── data ────────────────────────────────────────────────────────────────

	private async refreshAll() {
		try {
			const [config, runs] = await Promise.all([
				this.options.client.get<FactoryConfig>("/api/config"),
				this.options.client.get<RunItem[]>("/api/runs"),
			]);
			this.config = config;
			this.runs = runs;
			this.loaded = true;
			this.loadError = undefined;
			for (const id of this.details.keys()) void this.loadDetail(id);
			if (this.view === "run" && this.runId) void this.loadActivity(this.runId);
			this.ensureSelection();
		} catch (error) {
			this.loadError = (error as Error).message;
		}
		this.render();
	}

	private onChange(change: FactoryChange) {
		if (this.stopped) return;
		for (const id of change.ids) this.pendingIds.add(id);
		this.pendingConfig ||= change.config;
		if (this.refreshTimer) return;
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = undefined;
			const ids = [...this.pendingIds];
			const config = this.pendingConfig;
			this.pendingIds.clear();
			this.pendingConfig = false;
			void this.applyChange(ids, config);
		}, 150);
	}

	private async applyChange(ids: string[], config: boolean) {
		try {
			const [runs, nextConfig] = await Promise.all([
				this.options.client.get<RunItem[]>("/api/runs"),
				config
					? this.options.client.get<FactoryConfig>("/api/config")
					: undefined,
			]);
			this.runs = runs;
			if (nextConfig) this.config = nextConfig;
			this.loadError = undefined;
		} catch (error) {
			this.loadError = (error as Error).message;
		}
		// Workflow availability changes eligibility without changing saved runs.
		for (const id of config ? new Set([...ids, ...this.details.keys()]) : ids) {
			if (this.details.has(id)) void this.loadDetail(id);
			if (this.view === "run" && id === this.runId) void this.loadActivity(id);
		}
		this.ensureSelection();
		this.render();
	}

	private async loadDetail(id: string) {
		if (this.loadingDetails.has(id)) {
			this.reloadDetails.add(id);
			return;
		}
		this.loadingDetails.add(id);
		try {
			this.details.set(
				id,
				await this.options.client.get<RunDetail>(
					`/api/runs/${encodeURIComponent(id)}?view=dashboard`,
				),
			);
		} catch (error) {
			if ((error as { status?: number }).status === 404)
				this.details.delete(id);
		} finally {
			this.loadingDetails.delete(id);
			if (this.reloadDetails.delete(id) && !this.stopped)
				void this.loadDetail(id);
			this.render();
		}
	}

	private async loadActivity(id: string) {
		try {
			const page = await this.options.client.get<ActivityPage>(
				`/api/runs/${encodeURIComponent(id)}/activity?limit=200`,
			);
			const detail = this.details.get(id);
			this.activity.set(id, {
				lines: conversation(page, detail?.chatMessages, detail?.createdAt),
				hasOlder: Boolean(page.hasOlder),
			});
		} catch (error) {
			this.notify((error as Error).message, true);
		}
		this.render();
	}

	private ensureDetail(run?: RunItem) {
		if (run && !this.details.has(run.id)) void this.loadDetail(run.id);
	}

	// ── selection ───────────────────────────────────────────────────────────

	private rows(): Row[] {
		const { needsYou, working, settled } = today(this.runs);
		const rows: Row[] = [];
		rows.push({
			kind: "header",
			label: "NEEDS YOU",
			count: needsYou.length,
			tone: needsYou.length ? "question" : "muted",
		});
		if (needsYou.length)
			for (const run of needsYou) rows.push({ kind: "card", run });
		else
			rows.push({
				kind: "empty",
				text: working.length
					? `Inbox zero — Bob has ${working.length} running.`
					: "Inbox zero. Press n to start something.",
			});
		rows.push({
			kind: "header",
			label: "WORKING",
			count: working.length,
			tone: "muted",
		});
		if (working.length)
			for (const run of working) rows.push({ kind: "run", run });
		else rows.push({ kind: "empty", text: "Nothing running." });
		if (settled.length) {
			rows.push({
				kind: "header",
				label: "SETTLED",
				count: settled.length,
				tone: "muted",
				toggle: true,
			});
			if (this.showSettled)
				for (const run of settled)
					rows.push({
						kind: "run",
						run,
						settled: settleReason(run, this.runs),
					});
		}
		return rows;
	}

	private keyOf(row: Row) {
		return row.kind === "card" || row.kind === "run"
			? row.run.id
			: row.kind === "header" && row.toggle
				? SETTLED_TOGGLE
				: undefined;
	}

	private selectable() {
		return this.rows().filter((row) => this.keyOf(row));
	}

	private ensureSelection() {
		const keys = this.selectable().map((row) => this.keyOf(row));
		if (!this.selected || !keys.includes(this.selected))
			this.selected = keys[0];
		this.ensureDetail(this.selectedRun());
	}

	private selectedRun(): RunItem | undefined {
		return this.runs.find((run) => run.id === this.selected);
	}

	private target(): RunItem | undefined {
		return this.view === "run"
			? this.runs.find((run) => run.id === this.runId)
			: this.selectedRun();
	}

	private moveSelection(delta: number) {
		const keys = this.selectable().map((row) => this.keyOf(row)!);
		if (!keys.length) return;
		const index = Math.max(0, keys.indexOf(this.selected ?? ""));
		this.selected = keys[Math.min(keys.length - 1, Math.max(0, index + delta))];
		this.ensureDetail(this.selectedRun());
	}

	private openRun(id: string) {
		this.view = "run";
		this.runId = id;
		this.selected = id;
		this.scroll = 0;
		void this.loadDetail(id).then(() => this.loadActivity(id));
	}

	private switcherRuns(input: TextInput) {
		const query = input.value.trim().toLowerCase();
		return [...this.runs]
			.sort((a, b) =>
				(b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
			)
			.filter((run) =>
				`${run.title} ${run.id} ${repositoryName(this.config, run.repositoryId)}`
					.toLowerCase()
					.includes(query),
			);
	}

	// ── actions ─────────────────────────────────────────────────────────────

	private notify(text: string, error = false) {
		this.toast = { text, error, until: Date.now() + (error ? 6000 : 3000) };
	}

	private async perform(label: string, action: () => Promise<unknown>) {
		if (this.busy) return;
		this.busy = true;
		this.render();
		try {
			await action();
			if (label) this.notify(label);
		} catch (error) {
			this.notify((error as Error).message, true);
			throw error;
		} finally {
			this.busy = false;
			this.render();
		}
	}

	private path(run: RunItem, action: string) {
		return `/api/runs/${encodeURIComponent(run.id)}/${action}`;
	}

	private async submitOverlay(result: FormResult) {
		const overlay = this.overlay;
		if (!overlay || !result) return;
		if (result === "cancel") {
			if (overlay.kind === "launch") this.draft = overlay.form;
			this.overlay = undefined;
			return;
		}
		if (overlay.kind === "launch" || overlay.kind === "answer") {
			const { body, error } = overlay.form.request();
			if (!body) {
				overlay.form.error = error ?? "Incomplete";
				return;
			}
			try {
				if (overlay.kind === "launch") {
					await this.perform("Bob’s on it", async () => {
						const run = await this.options.client.post<{ id?: string }>(
							"/api/runs",
							body,
						);
						this.overlay = undefined;
						this.draft = undefined;
						await this.refreshAll();
						if (run?.id) this.openRun(run.id);
					});
				} else {
					const run = overlay.form.run;
					await this.perform("Reply sent", async () => {
						await this.options.client.post(
							this.path(run as RunItem, "answer"),
							body,
						);
						this.overlay = undefined;
					});
				}
			} catch (error) {
				overlay.form.error = (error as Error).message;
			}
			return;
		}
		if (overlay.kind === "prompt") {
			try {
				await this.perform("", () =>
					overlay.submit(overlay.form.input.value.trim()),
				);
				this.overlay = undefined;
			} catch (error) {
				overlay.form.error = (error as Error).message;
			}
		}
	}

	private answer(run: RunItem) {
		const detail = this.details.get(run.id);
		if (!detail?.questions?.length) {
			this.ensureDetail(run);
			return this.notify("Loading the question…");
		}
		this.overlay = { kind: "answer", form: new AnswerForm(detail) };
	}

	private acceptRecommendations(run: RunItem) {
		const detail = this.details.get(run.id);
		const form = detail?.questions?.length ? new AnswerForm(detail) : undefined;
		if (!form) return this.notify("Loading the question…");
		if (form.questions.some((_, i) => !form.recommendation(i)))
			return this.answer(run);
		const { body } = form.request();
		void this.perform("Accepted Bob’s recommendations", () =>
			this.options.client.post(this.path(run, "answer"), body),
		).catch(() => {});
	}

	private approve(run: RunItem) {
		const gate = run.reviewGate;
		if (gate?.status !== "pending" || !gate.id || !gate.headSha)
			return this.notify("No review is waiting on this run", true);
		this.overlay = {
			kind: "confirm",
			text: `Approve “${run.title}”? Bob continues to merge.`,
			action: () =>
				this.options.client.post(this.path(run, "review"), {
					reviewId: gate.id,
					headSha: gate.headSha,
					decision: "approve",
				}),
		};
	}

	private requestChanges(run: RunItem) {
		const gate = run.reviewGate;
		if (gate?.status !== "pending" || !gate.id || !gate.headSha)
			return this.notify("No review is waiting on this run", true);
		this.overlay = {
			kind: "prompt",
			form: new PromptForm(
				"Request changes",
				run.title,
				"What should Bob change?",
			),
			submit: async (feedback) => {
				await this.options.client.post(this.path(run, "review"), {
					reviewId: gate.id,
					headSha: gate.headSha,
					decision: "reject",
					feedback,
				});
				this.notify("Feedback sent — Bob is on it");
			},
		};
	}

	private message(run: RunItem) {
		const detail = this.details.get(run.id);
		if (!detail) {
			this.ensureDetail(run);
			return this.notify("Loading the run…");
		}
		if (detail.chat?.available) {
			this.overlay = {
				kind: "prompt",
				form: new PromptForm(
					"Message Bob",
					run.title,
					"Questions or instructions while Bob works…",
				),
				submit: async (text) => {
					const result = await this.options.client.post<{ mode?: string }>(
						this.path(run, "messages"),
						{ text },
					);
					this.notify(
						run.status === "running"
							? "Queued · delivered after the current turn"
							: "Message sent",
					);
					return result;
				},
			};
			return;
		}
		if (finished(run.status)) {
			this.overlay = {
				kind: "prompt",
				form: new PromptForm(
					"Follow-up run",
					run.title,
					"What should the follow-up do?",
				),
				submit: async (feedback) => {
					const next = await this.options.client.post<{ id?: string }>(
						this.path(run, "followup"),
						{ feedback },
					);
					this.notify("Follow-up started");
					await this.refreshAll();
					if (next?.id) this.openRun(next.id);
				},
			};
			return;
		}
		this.notify(
			detail.chat?.reason ?? "Messages are not available for this step",
			true,
		);
	}

	private retry(run: RunItem) {
		if (attention(run) !== "stuck")
			return this.notify("Only stuck runs can be retried", true);
		const detail = this.details.get(run.id);
		if (run.workflowBlock || run.status === "blocked") {
			if (!detail) {
				this.ensureDetail(run);
				return this.notify("Loading Resume availability…");
			}
			if (!detail.resumeEligible)
				return this.notify(
					"Resume is unavailable. Enable the workflow in Recipes and wait for execution to stop.",
					true,
				);
			void this.perform("Resuming from saved progress", () =>
				this.options.client.post(this.path(run, "resume")),
			).catch(() => {});
			return;
		}
		void this.perform(
			detail?.iterationLimit
				? "Continuing with 4 more passes"
				: "Retrying from saved progress",
			() => this.options.client.post(this.path(run, "retry")),
		).catch(() => {});
	}

	private settle(run: RunItem) {
		if (settleReason(run, this.runs)) {
			void this.perform(
				"Brought back — it stays open until you settle it",
				() =>
					this.options.client.put(this.path(run, "view"), { keptOpen: true }),
			).catch(() => {});
			return;
		}
		if (!finished(run.status))
			return this.notify("Only finished runs can settle", true);
		void this.perform(`Settled “${run.title}”`, () =>
			this.options.client.put(this.path(run, "view"), {
				settledAt: new Date().toISOString(),
			}),
		).catch(() => {});
	}

	private stopRun(run: RunItem) {
		if (finished(run.status))
			return this.notify("This run has already finished", true);
		this.overlay = {
			kind: "confirm",
			text: `Stop “${run.title}”? Pending messages are cancelled.`,
			action: () => this.options.client.post(this.path(run, "stop")),
		};
	}

	private openInBrowser(run: RunItem) {
		const review = run.reviewGate?.status === "pending" ? "/review" : "";
		const url = `${this.options.client.origin}/#/runs/${encodeURIComponent(run.id)}${review}`;
		void this.options.openUrl(url).then(
			() => this.notify("Opened in your browser"),
			() => this.notify(`Open ${url}`, true),
		);
	}

	private toggleTheme() {
		this.theme = tokens(this.theme.name === "dark" ? "light" : "dark");
	}

	// ── keys ────────────────────────────────────────────────────────────────

	key(key: Key) {
		if (this.stopped) return;
		if (key.name === "ctrl-c") return this.options.quit();
		if (this.busy) return;
		const characters = Array.from(key.text ?? "");
		if (key.name === "text" && !this.overlay && characters.length > 1) {
			for (const text of characters) this.key({ name: "text", text });
			return;
		}
		const overlay = this.overlay;
		if (overlay) {
			if (overlay.kind === "switcher") {
				const runs = this.switcherRuns(overlay.input);
				if (key.name === "escape" || key.name === "ctrl-k")
					this.overlay = undefined;
				else if (key.name === "up" || key.name === "down")
					overlay.index = Math.max(
						0,
						Math.min(
							runs.length - 1,
							overlay.index + (key.name === "up" ? -1 : 1),
						),
					);
				else if (key.name === "enter") {
					const run = runs[overlay.index];
					if (run) {
						this.overlay = undefined;
						this.openRun(run.id);
					}
				} else if (overlay.input.handle(key)) overlay.index = 0;
			} else if (overlay.kind === "help") this.overlay = undefined;
			else if (overlay.kind === "confirm") {
				if (key.name === "text" && /^y$/i.test(key.text ?? "")) {
					this.overlay = undefined;
					void this.perform("Done", overlay.action).catch(() => {});
				} else if (
					key.name === "escape" ||
					(key.name === "text" && /^n$/i.test(key.text ?? ""))
				)
					this.overlay = undefined;
			} else void this.submitOverlay(overlay.form.key(key));
			return this.render();
		}
		const char = key.name === "text" ? key.text : undefined;
		const run = this.target();
		const name = char ?? key.name;
		switch (name) {
			case "ctrl-k":
				this.overlay = {
					kind: "switcher",
					input: new TextInput("Find by title, repository or run ID"),
					index: 0,
				};
				break;
			case "?":
				this.overlay = { kind: "help" };
				break;
			case "n":
				this.overlay = this.config
					? { kind: "launch", form: this.draft ?? new LaunchForm(this.config) }
					: undefined;
				if (!this.config) this.notify("Still connecting…", true);
				break;
			case "t":
			case "f8":
				this.toggleTheme();
				break;
			case "ctrl-r":
				void this.refreshAll();
				break;
			case "S":
				this.showSettled = !this.showSettled;
				this.ensureSelection();
				break;
			default:
				if (this.view === "today") this.todayKey(name, run);
				else this.runKey(name, run);
		}
		this.render();
	}

	private todayKey(name: string, run?: RunItem) {
		switch (name) {
			case "q":
				return this.options.quit();
			case "j":
			case "down":
				return this.moveSelection(1);
			case "k":
			case "up":
				return this.moveSelection(-1);
			case "g":
			case "home":
				return this.moveSelection(-Infinity);
			case "G":
			case "end":
				return this.moveSelection(Infinity);
			case "pagedown":
				return this.moveSelection(10);
			case "pageup":
				return this.moveSelection(-10);
			case "enter":
			case "l":
			case "right":
				if (this.selected === SETTLED_TOGGLE) {
					this.showSettled = !this.showSettled;
					return;
				}
				if (run) this.openRun(run.id);
				return;
		}
		if (run) this.runAction(name, run);
	}

	private runKey(name: string, run?: RunItem) {
		switch (name) {
			case "escape":
			case "q":
			case "h":
			case "left":
				this.view = "today";
				return;
			case "k":
			case "up":
				this.scroll = Math.min(this.maxScroll, this.scroll + 1);
				return;
			case "j":
			case "down":
				this.scroll = Math.max(0, this.scroll - 1);
				return;
			case "pageup":
				this.scroll = Math.min(this.maxScroll, this.scroll + 10);
				return;
			case "pagedown":
				this.scroll = Math.max(0, this.scroll - 10);
				return;
			case "g":
			case "home":
				this.scroll = this.maxScroll;
				return;
			case "G":
			case "end":
				this.scroll = 0;
				return;
			case "[":
			case "]": {
				const ids = this.selectable()
					.map((row) => this.keyOf(row))
					.filter((id): id is string => Boolean(id) && id !== SETTLED_TOGGLE);
				const index = ids.indexOf(this.runId ?? "");
				const next =
					ids[(index + (name === "]" ? 1 : -1) + ids.length) % ids.length];
				if (next) this.openRun(next);
				return;
			}
		}
		if (run) this.runAction(name, run);
	}

	private runAction(name: string, run: RunItem) {
		const kind = attention(run);
		switch (name) {
			case "a":
				if (kind === "question") return this.answer(run);
				if (kind === "review" && run.reviewGate?.status === "pending")
					return this.approve(run);
				return this.notify("Nothing to answer or approve here", true);
			case "y":
				if (kind === "question") return this.acceptRecommendations(run);
				return;
			case "r":
				return this.requestChanges(run);
			case "c":
				return this.retry(run);
			case "m":
				return this.message(run);
			case "s":
				return this.settle(run);
			case "x":
				return this.stopRun(run);
			case "o":
				return this.openInBrowser(run);
		}
	}

	// ── rendering ───────────────────────────────────────────────────────────

	render() {
		if (this.stopped) return;
		const { columns, rows } = this.options.size();
		const screen = new Screen(
			Math.max(1, columns),
			Math.max(1, rows),
			this.theme.base,
		);
		screen.selection = selectionColors(this.theme);
		if (columns < 60 || rows < 16) {
			screen.put(
				1,
				0,
				"Make the terminal at least 60×16 for Bob’s Factory.",
				this.theme.text,
			);
		} else {
			this.header(screen);
			if (!this.loaded) this.connecting(screen);
			else if (this.view === "run") this.runView(screen);
			else this.todayView(screen);
			this.footer(screen);
			this.overlays(screen);
			this.toastView(screen);
		}
		this.options.write(screen.render(this.options.sgr));
	}

	private tone(tone: Tone): Style {
		const t = this.theme;
		return {
			question: t.question,
			stuck: t.stuck,
			review: t.review,
			working: t.working,
			muted: t.muted,
			text: t.text,
		}[tone];
	}

	private glyph(run: RunItem): [string, Style] {
		const t = this.theme;
		const kind = attention(run);
		if (kind === "question") return ["?", t.question];
		if (kind === "stuck") return ["!", t.stuck];
		if (kind === "review")
			return run.reviewGate?.status === "pending"
				? ["◆", t.review]
				: ["✓", t.review];
		if (run.status === "capacity-waiting") return ["◌", t.muted];
		if (run.status === "stopping") return ["■", t.muted];
		if (["running", "active", "waiting"].includes(run.status))
			return [SPINNER[this.frame % SPINNER.length]!, t.working];
		if (["stopped", "cancelled"].includes(run.status)) return ["■", t.muted];
		if (["failed", "error", "interrupted"].includes(run.status))
			return ["✗", t.stuck];
		return ["✓", t.muted];
	}

	private header(screen: Screen) {
		const t = this.theme;
		screen.fill(0, 0, screen.w, 1, t.panel);
		screen.put(1, 0, "◆ Bob’s Factory", t.accentBold);
		screen.put(
			18,
			0,
			this.view === "run" ? "Today › Run" : "Today",
			t.secondary,
		);
		let x = screen.w - 1;
		const right = (text: string, style: Style) => {
			x -= width(text);
			screen.put(x, 0, text, style);
			x -= 2;
		};
		right(this.live ? "● live" : "○ offline", this.live ? t.review : t.stuck);
		const capacity = this.config?.capacity;
		if (capacity?.limit) {
			const used = Math.min(capacity.limit, capacity.active ?? 0);
			const bar =
				"▰".repeat(used) + "▱".repeat(Math.max(0, capacity.limit - used));
			right(
				`${used}/${capacity.limit}${capacity.queued ? ` +${capacity.queued} queued` : ""}`,
				t.muted,
			);
			x += 1;
			right(clip(bar, 12), t.working);
		}
		const needs = today(this.runs).needsYou.length;
		if (needs) right(` ${needs} need you `, t.badge);
	}

	private connecting(screen: Screen) {
		const t = this.theme;
		const y = Math.floor(screen.h / 2) - 1;
		const lines = this.loadError
			? [
					this.loadError,
					"Retrying when the factory is reachable · ctrl-r retry now · q quit",
				]
			: [
					`${SPINNER[this.frame % SPINNER.length]} Connecting to Bob’s Factory at ${this.options.client.origin}…`,
				];
		lines.forEach((line, i) => {
			wrap(line, screen.w - 8).forEach((part, j) => {
				screen.put(
					Math.max(2, Math.floor((screen.w - width(part)) / 2)),
					y + i * 2 + j,
					part,
					i ? t.muted : this.loadError ? t.stuck : t.text,
				);
			});
		});
	}

	private cardSummary(run: RunItem): string {
		const kind = attention(run);
		const detail = this.details.get(run.id);
		if (kind === "question")
			return detail?.questions?.[0] ?? "Bob has a question for you.";
		if (kind === "stuck")
			return (
				(
					run.workflowBlock?.reason ??
					detail?.workflowBlock?.reason ??
					run.error
				)?.split("\n")[0] ?? "The run stopped before finishing."
			);
		if (run.reviewGate?.status === "pending")
			return run.reviewGate.url
				? `Ready for review · ${run.reviewGate.url}`
				: "Ready for your review.";
		return "Finished — check the result, then settle it.";
	}

	private cardDetails(
		run: RunItem,
		inner: number,
	): { text: string; style: Style }[] {
		const t = this.theme;
		const detail = this.details.get(run.id);
		const kind = attention(run);
		const lines: { text: string; style: Style }[] = [];
		if (kind === "question") {
			if (!detail) return [{ text: "Loading the question…", style: t.muted }];
			(detail.questions ?? []).slice(0, 3).forEach((question, i) => {
				const lead = question.replace(/\s+/g, " ").trim();
				for (const line of wrap(`${i + 1}. ${lead}`, inner).slice(0, 2))
					lines.push({ text: line, style: t.text });
				const recommendation = detail.questionRecommendations?.find(
					(item) => item.questionIndex === i,
				);
				if (recommendation)
					lines.push({
						text: clip(`   → ${recommendation.answer}`, inner),
						style: t.review,
					});
			});
			if ((detail.questions?.length ?? 0) > 3)
				lines.push({
					text: `+${detail.questions!.length - 3} more questions`,
					style: t.muted,
				});
		} else if (kind === "stuck") {
			for (const line of wrap(
				run.workflowBlock?.reason ??
					detail?.workflowBlock?.reason ??
					run.error ??
					"The run stopped before finishing.",
				inner,
			).slice(0, 3))
				lines.push({ text: line, style: t.text });
			if (detail?.iterationLimit)
				lines.push({
					text: `Iteration limit reached (${detail.iterationLimit.visits}/${detail.iterationLimit.limit}). Continue grants 4 more passes.`,
					style: t.muted,
				});
		} else lines.push({ text: this.cardSummary(run), style: t.text });
		return lines;
	}

	private hints(run: RunItem): string {
		const kind = attention(run);
		const detail = this.details.get(run.id);
		if (kind === "question") {
			const all = detail?.questions?.every((_, i) =>
				detail.questionRecommendations?.some((r) => r.questionIndex === i),
			);
			return `a answer${all ? " · y accept recommendations" : ""} · enter open · x stop`;
		}
		if (kind === "stuck" && (run.workflowBlock || run.status === "blocked"))
			return detail?.resumeEligible
				? "c resume · enter open"
				: "Resume unavailable · enable workflow in Recipes and wait for execution to stop · enter open";
		if (kind === "stuck")
			return `c ${detail?.iterationLimit ? "continue (+4 passes)" : "retry step"} · enter open · s settle`;
		if (run.reviewGate?.status === "pending")
			return "a approve · r request changes · o open guide in browser · enter open";
		return "s settle · m follow-up · o open in browser · enter open";
	}

	private todayView(screen: Screen) {
		const t = this.theme;
		const w = Math.min(screen.w - 4, 120);
		const x = Math.floor((screen.w - w) / 2);
		const top = 2;
		const bottom = screen.h - 2;
		const rows = this.rows();
		const height = (row: Row) => {
			if (row.kind === "header") return 2;
			if (row.kind === "card")
				return row.run.id === this.selected
					? 3 + this.cardDetails(row.run, w - 6).length
					: 3;
			return 1;
		};
		// Scroll so the selection is visible.
		const selectedIndex = rows.findIndex(
			(row) => this.keyOf(row) === this.selected,
		);
		let first = 0;
		while (
			first < selectedIndex &&
			rows
				.slice(first, selectedIndex + 1)
				.reduce((n, row) => n + height(row), 0) >
				bottom - top
		)
			first++;
		let y = top;
		if (first > 0) screen.put(x + w - 10, top - 1, `↑ ${first} more`, t.muted);
		for (const row of rows.slice(first)) {
			if (y >= bottom) break;
			const key = this.keyOf(row);
			const selected = key !== undefined && key === this.selected;
			if (row.kind === "header") {
				const label = `${row.label} ${row.count}${row.toggle ? (this.showSettled ? "  ▾ S hide" : "  ▸ S show") : ""}`;
				if (selected) screen.fill(x, y, width(label) + 2, 1, t.selection);
				screen.put(x + 1, y, label, { ...this.tone(row.tone), bold: true });
				y += 2;
				continue;
			}
			if (row.kind === "empty") {
				screen.put(x + 2, y, row.text, t.muted, w - 4);
				y += 2;
				continue;
			}
			const run = row.run;
			const [glyph, glyphStyle] = this.glyph(run);
			const label =
				row.kind === "run" && row.settled
					? { text: row.settled, tone: "muted" as Tone }
					: stateLabel(run, this.config);
			if (row.kind === "card") {
				const kind = attention(run)!;
				const details = selected ? this.cardDetails(run, w - 6) : [];
				const h = selected ? 2 + details.length : 2;
				screen.fill(x, y, w, h, selected ? t.selection : t.tint[kind]);
				for (let i = 0; i < h; i++) screen.put(x, y + i, "▌", glyphStyle);
				screen.put(x + 2, y, glyph, glyphStyle);
				const right = `${label.text}`;
				const meta = clip(
					`${repositoryName(this.config, run.repositoryId)}${w >= 90 ? ` · ${ago(run.updatedAt ?? run.createdAt)}` : ""}`,
					Math.max(0, Math.min(35, w - width(right) - 30)),
				);
				screen.put(
					x + 4,
					y,
					run.title,
					t.bold,
					w - width(right) - width(meta) - 12,
				);
				screen.put(x + w - width(right) - width(meta) - 5, y, meta, t.muted);
				screen.put(x + w - width(right) - 2, y, right, this.tone(label.tone));
				if (selected) {
					details.forEach((line, i) => {
						screen.put(x + 4, y + 1 + i, line.text, line.style, w - 6);
					});
					screen.put(
						x + 4,
						y + 1 + details.length,
						this.busy ? "Working…" : this.hints(run),
						t.accentBold,
						w - 6,
					);
				} else
					screen.put(x + 4, y + 1, this.cardSummary(run), t.secondary, w - 6);
				y += h + 1;
				continue;
			}
			if (selected) screen.fill(x, y, w, 1, t.selection);
			screen.put(x + 2, y, glyph, glyphStyle);
			const repository =
				w >= 80
					? `${clip(repositoryName(this.config, run.repositoryId), 20)}  `
					: "";
			const right = `${repository}${pad(label.text, 22)}${w >= 70 ? `  ${pad(ago(run.updatedAt ?? run.createdAt), 8)}` : ""}`;
			screen.put(
				x + 4,
				y,
				run.title,
				run.titleGeneration?.status === "pending"
					? t.muted
					: selected
						? t.bold
						: t.text,
				w - width(right) - 7,
			);
			screen.put(x + w - width(right) - 1, y, right, t.muted);
			screen.put(
				x + w - width(right) - 1 + width(repository),
				y,
				label.text,
				this.tone(label.tone),
				22,
			);
			y += 1;
		}
	}

	private stepGlyph(state: StepState): [string, Style] {
		const t = this.theme;
		if (state === "done") return ["✓", t.review];
		if (state === "active")
			return [SPINNER[this.frame % SPINNER.length]!, t.working];
		if (state === "waiting") return ["◆", t.question];
		if (state === "failed") return ["✗", t.stuck];
		return ["○", t.faint];
	}

	private runView(screen: Screen) {
		const t = this.theme;
		const run = this.runs.find((item) => item.id === this.runId);
		const detail = this.runId ? this.details.get(this.runId) : undefined;
		if (!run) {
			screen.put(
				2,
				2,
				"This run is no longer available. Press esc to go back.",
				t.muted,
			);
			return;
		}
		const [glyph, glyphStyle] = this.glyph(run);
		const label = stateLabel(run, this.config);
		screen.put(2, 2, glyph, glyphStyle);
		screen.put(4, 2, run.title, t.bold, screen.w - width(label.text) - 8);
		screen.put(
			screen.w - width(label.text) - 2,
			2,
			label.text,
			this.tone(label.tone),
		);
		const workflow = workflowOf(detail ?? run, this.config);
		const meta = [
			run.id,
			repositoryName(this.config, run.repositoryId),
			workflow?.name,
			detail?.runner
				? `${detail.runner}${detail.model ? `/${detail.model}` : ""}`
				: undefined,
			ago(run.createdAt),
			run.reviewGate?.url,
		]
			.filter(Boolean)
			.join(" · ");
		screen.put(4, 3, meta, t.muted, screen.w - 6);
		let x = 4;
		for (const [i, step] of (detail ? stepStrip(detail) : []).entries()) {
			const [g, style] = this.stepGlyph(step.state);
			const current = step.state !== "done" && step.state !== "pending";
			const text = `${g} ${step.name}`;
			if (x + width(text) + 3 > screen.w - 2) {
				screen.put(x, 5, "…", t.muted);
				break;
			}
			if (i) x += screen.put(x, 5, " ─ ", t.faint);
			x += screen.put(x, 5, g, style);
			x += screen.put(
				x,
				5,
				` ${step.name}`,
				current ? t.bold : step.state === "done" ? t.muted : t.faint,
			);
		}
		screen.hline(0, 6, screen.w, t.border);
		const panel = attention(run) ? this.cardDetails(run, screen.w - 8) : [];
		const panelHeight = panel.length ? panel.length + 3 : 0;
		const bottom = screen.h - 2 - panelHeight;
		this.conversationView(screen, run, 2, 7, screen.w - 4, bottom - 7);
		if (panel.length) {
			const kind = attention(run)!;
			screen.fill(0, bottom, screen.w, panelHeight, t.tint[kind]);
			screen.put(0, bottom, "▌".repeat(1), glyphStyle);
			const heading =
				kind === "question"
					? "? Bob asks"
					: kind === "stuck"
						? "! Stuck"
						: run.reviewGate?.status === "pending"
							? "◆ Review"
							: "✓ Finished";
			screen.put(2, bottom, heading, { ...glyphStyle, bold: true });
			panel.forEach((line, i) => {
				screen.put(4, bottom + 1 + i, line.text, line.style, screen.w - 6);
			});
			screen.put(
				4,
				bottom + 1 + panel.length,
				this.busy ? "Working…" : this.hints(run).replace(" · enter open", ""),
				t.accentBold,
				screen.w - 6,
			);
		}
	}

	private conversationView(
		screen: Screen,
		run: RunItem,
		x: number,
		y: number,
		w: number,
		h: number,
	) {
		const t = this.theme;
		const activity = this.activity.get(run.id);
		if (!activity) {
			screen.put(
				x,
				y + 1,
				`${SPINNER[this.frame % SPINNER.length]} Loading activity…`,
				t.muted,
			);
			return;
		}
		const detail = this.details.get(run.id);
		const workflows = this.config?.workflows ?? [];
		const rows: { text: string; style: Style }[] = [];
		if (activity.hasOlder)
			rows.push({
				text: "Older activity is available in the browser (o).",
				style: t.faint,
			});
		for (const line of activity.lines) {
			switch (line.kind) {
				case "step": {
					const name =
						stepName(
							line.text,
							workflowOf(detail ?? run, this.config),
							workflows,
						) ?? line.text;
					rows.push({ text: "", style: t.text });
					rows.push({
						text: `▸ ${name} ${"─".repeat(Math.max(0, w - width(name) - 3))}`,
						style: t.faint,
					});
					break;
				}
				case "tool": {
					const mark =
						line.status === "error"
							? "✗"
							: line.status === "running"
								? SPINNER[this.frame % SPINNER.length]
								: "✓";
					rows.push({
						text: `  ${mark} ${line.text}${line.detail ? `  ${line.detail}` : ""}`,
						style: line.status === "error" ? t.stuck : t.muted,
					});
					break;
				}
				case "you":
					wrap(line.text, w - 7)
						.slice(0, 12)
						.forEach((part, i) => {
							rows.push({
								text: `${i ? "      " : "you › "}${part}`,
								style: i ? t.text : t.accent,
							});
						});
					break;
				case "system":
					wrap(line.text, w - 4)
						.slice(0, 4)
						.forEach((part) => {
							rows.push({ text: `  ${part}`, style: t.system });
						});
					break;
				case "error":
					wrap(line.text, w - 4).forEach((part) => {
						rows.push({ text: `  ${part}`, style: t.stuck });
					});
					break;
				default:
					wrap(line.text, w - 2).forEach((part) => {
						rows.push({
							text: `  ${part}`,
							style: line.kind === "response" ? t.bold : t.text,
						});
					});
			}
		}
		if (["running", "active"].includes(run.status))
			rows.push({
				text: `  ${SPINNER[this.frame % SPINNER.length]} working…`,
				style: t.working,
			});
		if (!activity.lines.length)
			rows.push({ text: "No activity yet.", style: t.muted });
		this.maxScroll = Math.max(0, rows.length - h);
		this.scroll = Math.min(this.scroll, this.maxScroll);
		const start = Math.max(0, rows.length - h - this.scroll);
		rows.slice(start, start + h).forEach((row, i) => {
			if (row.text.startsWith("you › ")) {
				screen.put(x, y + i, "you › ", t.accentBold);
				screen.put(x + 6, y + i, row.text.slice(6), t.text, w - 6);
			} else screen.put(x, y + i, row.text, row.style, w);
		});
		if (this.scroll > 0)
			screen.put(
				x + w - 22,
				y + h - 1,
				" ↓ G jump to latest ",
				t.selectionBold,
			);
	}

	private footer(screen: Screen) {
		const t = this.theme;
		const y = screen.h - 1;
		screen.fill(0, y, screen.w, 1, t.panel);
		const keys =
			this.view === "run"
				? "esc back  j/k scroll  [ ] prev/next  a answer/approve  r changes  c retry/resume  m message  s settle  x stop  o browser  ? help"
				: "j/k move  enter open  n new run  a answer/approve  y accept  c retry/resume  m message  s settle  ? help  q quit";
		screen.put(1, y, keys, t.secondary, screen.w - 2);
		if (this.liveError && !this.live)
			screen.put(
				Math.max(1, screen.w - width(this.liveError) - 2),
				y,
				this.liveError,
				t.stuck,
				screen.w - 2,
			);
	}

	private toastView(screen: Screen) {
		if (!this.toast) return;
		const text = ` ${clip(this.toast.text, screen.w - 6)} `;
		screen.put(
			screen.w - width(text) - 1,
			1,
			text,
			this.toast.error ? this.theme.error : this.theme.toast,
		);
	}

	private overlays(screen: Screen) {
		const t = this.theme;
		const overlay = this.overlay;
		if (!overlay) return;
		if (overlay.kind === "switcher") {
			const w = Math.min(96, screen.w - 4);
			const h = Math.min(20, screen.h - 2);
			const x = Math.floor((screen.w - w) / 2);
			const y = Math.floor((screen.h - h) / 2);
			screen.fill(x, y, w, h, t.raised);
			screen.box(x, y, w, h, t.focus, {
				text: "Switch run",
				style: t.accentBold,
			});
			screen.fill(x + 2, y + 2, w - 4, 1, t.field);
			overlay.input.render(
				screen,
				x + 3,
				y + 2,
				w - 6,
				1,
				t.text,
				t.muted,
				true,
			);
			const runs = this.switcherRuns(overlay.input);
			overlay.index = Math.max(0, Math.min(overlay.index, runs.length - 1));
			const count = h - 6;
			const first = Math.max(0, overlay.index - count + 1);
			if (!runs.length) screen.put(x + 3, y + 4, "No matching runs", t.muted);
			runs.slice(first, first + count).forEach((run, index) => {
				const row = y + 4 + index;
				if (first + index === overlay.index)
					screen.fill(x + 2, row, w - 4, 1, t.selection);
				screen.put(x + 3, row, run.title, t.bold, w - 28);
				screen.put(
					x + w - 23,
					row,
					`${repositoryName(this.config, run.repositoryId)} · ${run.status}`,
					t.muted,
					20,
				);
			});
			screen.put(
				x + 3,
				y + h - 2,
				"↑/↓ choose · enter open · esc close",
				t.muted,
				w - 6,
			);
			return;
		}
		if (
			overlay.kind === "launch" ||
			overlay.kind === "answer" ||
			overlay.kind === "prompt"
		) {
			overlay.form.render(screen, t);
			return;
		}
		if (overlay.kind === "confirm") {
			const w = Math.min(80, screen.w - 4);
			const lines = wrap(overlay.text, w - 6);
			const h = lines.length + 5;
			const x = Math.floor((screen.w - w) / 2);
			const y = Math.floor((screen.h - h) / 2);
			screen.fill(x, y, w, h, t.raised);
			screen.box(x, y, w, h, t.focus, { text: "Confirm", style: t.accentBold });
			lines.forEach((line, i) => {
				screen.put(x + 3, y + 2 + i, line, t.text);
			});
			screen.put(x + 3, y + h - 2, "y confirm · n / esc cancel", t.muted);
			return;
		}
		const rows: [string, string][] = [
			["j k ↑ ↓", "move · scroll the conversation"],
			["enter", "open the selected run"],
			["esc", "back to Today"],
			["[ ]", "previous / next run (run view)"],
			["ctrl-k", "find and switch to any run"],
			["n", "start a new run (the draft is kept)"],
			["a", "answer a question · approve a review"],
			["y", "accept all of Bob’s recommendations"],
			["r", "request changes on a review"],
			[
				"c",
				"resume an enabled blocked run · retry a stuck step · continue (+4 passes)",
			],
			["m", "message Bob · follow-up for finished runs"],
			["s", "settle a finished run · bring a settled run back"],
			["S", "show or hide Settled"],
			["x", "stop a run"],
			["o", "open in the browser (guided review, media)"],
			["t", "switch light / dark"],
			["ctrl-r", "refresh"],
			["q · ctrl-c", "quit"],
		];
		const w = Math.min(70, screen.w - 4);
		const h = Math.min(screen.h - 2, rows.length + 4);
		const x = Math.floor((screen.w - w) / 2);
		const y = Math.floor((screen.h - h) / 2);
		screen.fill(x, y, w, h, t.raised);
		screen.box(x, y, w, h, t.focus, { text: "Keys", style: t.accentBold });
		rows.slice(0, h - 4).forEach(([key, text], i) => {
			screen.put(x + 3, y + 2 + i, pad(key, 12), t.accentBold);
			screen.put(x + 16, y + 2 + i, text, t.text, w - 19);
		});
	}
}
