import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	HashRouter,
	Link,
	Route,
	Routes,
	useLocation,
	useNavigate,
	useParams,
} from "react-router-dom";
import { ArtifactCard, Inspector } from "./artifacts";
import { AccessBoundary } from "./auth";
import {
	active,
	ago,
	api,
	artifactsOf,
	attention,
	capacityPhaseLabel,
	client,
	finished,
	icons,
	phase,
	refreshFactory,
	settleReason,
	stepsOf,
	useAction,
	useConfig,
	useLiveUpdates,
	useRun,
	useRuns,
	workingLabel,
} from "./client";
import { RunConversation } from "./conversation";
import { ExecutionDetails } from "./execution";
import {
	FocusCard,
	originLabel,
	ReviewEntry,
	RunMeta,
	RunOrigin,
	RunTitleStatus,
	WorkingRow,
} from "./focus";
import { Composer, Recipes } from "./forms";
import { NotificationsControl } from "./notifications-ui";
import { pwaState, startPwa, usePwa } from "./pwa";
import { ConnectionNotice, InstallControl } from "./pwa-ui";
import { useReadingPosition } from "./reading-position";
import {
	completeRestoration,
	forgetView,
	restoredView,
	useRestorableState,
} from "./restoration";
import { ReviewPage } from "./review-page";
import {
	readStored,
	readTextStored,
	todayContext,
	writeStored,
	writeTextStored,
} from "./review-state";
import { Settings } from "./settings";
import {
	applyTheme,
	readThemeChoice,
	resolveTheme,
	themeChoice,
	themeQuery,
} from "./theme";
import {
	Bob,
	Button,
	ConfirmStop,
	External,
	Modal,
	ToastProvider,
	useToast,
} from "./ui";

function useSettle() {
	const action = useAction(),
		toast = useToast();
	return {
		busy: action.isPending,
		change: async (run: any, mode: "settle" | "back" | "seen") => {
			const old = run.viewState ?? {};
			const next =
				mode === "back"
					? { keptOpen: true }
					: mode === "seen"
						? { ...old, seenAt: new Date().toISOString() }
						: { settledAt: new Date().toISOString() };
			try {
				await action.mutateAsync({
					path: `/api/runs/${run.id}/view`,
					method: "PUT",
					body: next,
				});
				client.setQueryData<any[]>(["runs"], (previous) =>
					previous?.map((item) =>
						item.id === run.id ? { ...item, viewState: next } : item,
					),
				);
				client.setQueryData<any>(["run", run.id], (previous: any) =>
					previous ? { ...previous, viewState: next } : previous,
				);

				if (mode !== "seen")
					toast({
						text:
							mode === "back"
								? "Brought back — it stays open until you settle it"
								: `Settled “${run.title}”`,
						action: "Undo",
						onAction: () =>
							void action
								.mutateAsync({
									path: `/api/runs/${run.id}/view`,
									method: "PUT",
									body: old,
								})
								.catch(() => {}),
					});
			} catch (error) {
				toast({ text: (error as Error).message });
			}
		},
	};
}
function useTheme() {
	const [choice, setChoice] = useState(readThemeChoice),
		[systemDark, setSystemDark] = useState(
			() => matchMedia(themeQuery).matches,
		);
	useLayoutEffect(() => {
		const media = matchMedia(themeQuery),
			changed = (event: MediaQueryListEvent) => setSystemDark(event.matches);
		media.addEventListener("change", changed);
		setSystemDark(media.matches);
		return () => media.removeEventListener("change", changed);
	}, []);
	useLayoutEffect(() => {
		applyTheme(resolveTheme(choice, systemDark));
		writeTextStored("factory-theme", choice);
	}, [systemDark, choice]);
	return {
		choice,
		setChoice: (value: string) => setChoice(themeChoice(value)),
	};
}
function Header({
	count,
	mood,
	onShortcuts,
}: {
	count: number;
	mood: string;
	onShortcuts: () => void;
}) {
	const location = useLocation(),
		theme = useTheme();
	return (
		<header className="site-header">
			<div>
				<Link
					to="/"
					state={todayContext(location.pathname, location.state)}
					className="brand"
				>
					<Bob mood={mood} />
					<strong>Bob's Factory</strong>
				</Link>
				<nav className="nav-pill" aria-label="Main navigation">
					<Link
						aria-current={
							location.pathname === "/" ||
							location.pathname.startsWith("/runs/")
								? "page"
								: undefined
						}
						to="/"
						state={todayContext(location.pathname, location.state)}
					>
						Today{" "}
						{count > 0 && <span className="attention-count">{count}</span>}
					</Link>
					<Link
						aria-current={location.pathname === "/recipes" ? "page" : undefined}
						to="/recipes"
					>
						Recipes
					</Link>
					<Link
						aria-current={
							location.pathname.startsWith("/settings") ? "page" : undefined
						}
						to="/settings"
					>
						Settings
					</Link>
				</nav>
				<div className="header-actions">
					<InstallControl />
					<NotificationsControl />
					<Dropdown.Root>
						<Dropdown.Trigger asChild>
							<Button variant="icon" aria-label={`Theme: ${theme.choice}`}>
								{theme.choice === "system"
									? "🖥️"
									: theme.choice === "light"
										? "☀️"
										: "🌙"}
							</Button>
						</Dropdown.Trigger>
						<Dropdown.Portal>
							<Dropdown.Content className="theme-menu" sideOffset={8}>
								<Dropdown.RadioGroup
									value={theme.choice}
									onValueChange={theme.setChoice}
								>
									{["system", "light", "dark"].map((value) => (
										<Dropdown.RadioItem
											key={value}
											value={value}
											className="theme-option"
										>
											<span>
												{value === "system"
													? "🖥️ System"
													: value === "light"
														? "☀️ Light"
														: "🌙 Dark"}
												{value === "system" && (
													<small>Follows your device</small>
												)}
											</span>
											<Dropdown.ItemIndicator>✓</Dropdown.ItemIndicator>
										</Dropdown.RadioItem>
									))}
								</Dropdown.RadioGroup>
							</Dropdown.Content>
						</Dropdown.Portal>
					</Dropdown.Root>
					<Button
						variant="icon"
						className="keyboard-hint"
						aria-label="Keyboard shortcuts"
						onClick={onShortcuts}
					>
						⌨
					</Button>
				</div>
			</div>
		</header>
	);
}
function Settled({ runs, all }: { runs: any[]; all: any[] }) {
	const [view, setView] = useState(() =>
			readTextStored("factory-settled-view", "pebbles"),
		),
		settle = useSettle();
	const groups: Record<string, any[]> = {
		Today: [],
		Yesterday: [],
		"This week": [],
		Earlier: [],
	};
	for (const run of runs) {
		const date = Date.parse(
				run.viewState?.settledAt ?? run.updatedAt ?? run.createdAt,
			),
			start = new Date().setHours(0, 0, 0, 0),
			days = Math.floor((start - date) / 86400000);
		groups[
			date >= start
				? "Today"
				: days < 1
					? "Yesterday"
					: days < 7
						? "This week"
						: "Earlier"
		]!.push(run);
	}
	return (
		<section className="settled-section">
			<div className="section-heading">
				<h2>
					Settled <span className="count">{runs.length}</span>
				</h2>
				<div className="toggle">
					{["pebbles", "list"].map((value) => (
						<button
							type="button"
							aria-pressed={view === value}
							key={value}
							onClick={() => {
								setView(value);
								writeTextStored("factory-settled-view", value);
							}}
						>
							{value === "pebbles" ? "Pebbles" : "List"}
						</button>
					))}
				</div>
			</div>
			{!runs.length ? (
				<p className="dashed">Finished work settles here, out of your way.</p>
			) : view === "pebbles" ? (
				<div className="pebble-box">
					{Object.entries(groups)
						.filter(([, items]) => items.length)
						.map(([name, items]) => (
							<div className="pebble-group" key={name}>
								<strong>{name}</strong>
								<div>
									{items.map((run, i) => (
										<Link
											className={`pebble pebble-${i % 3}`}
											to={`/runs/${run.id}`}
											key={run.id}
										>
											<span aria-hidden="true">
												{settleReason(run, all)?.split(" ")[0]}
											</span>
											<span className="pebble-tooltip">
												<strong>{run.title}</strong>
												{settleReason(run, all)} ·{" "}
												{ago(run.updatedAt ?? run.createdAt)}
											</span>
											<span className="sr-only">
												{run.title} — {settleReason(run, all)}
											</span>
										</Link>
									))}
								</div>
							</div>
						))}
				</div>
			) : (
				<ul className="settled-list">
					{runs.map((run) => (
						<li key={run.id}>
							<span>{settleReason(run, all)?.split(" ")[0]}</span>
							<Link to={`/runs/${run.id}`}>{run.title}</Link>
							<small>
								{settleReason(run, all)} · {ago(run.updatedAt ?? run.createdAt)}
								<span> · {originLabel(run)}</span>
							</small>
							<Button
								variant="ghost"
								busy={settle.busy}
								onClick={() => void settle.change(run, "back")}
							>
								Bring back
							</Button>
						</li>
					))}
				</ul>
			)}
			<details className="settling-help">
				<summary>How settling works</summary>
				<p>
					Runs settle when you settle them, when they're stopped, when a newer
					follow-up run replaces them, when you've seen a finished run that has
					no review guide, or after 48 quiet hours. “Bring back” keeps a run
					open until you settle it.
				</p>
			</details>
		</section>
	);
}
function Today({
	runs,
	config,
	onInspect,
}: {
	runs: any[];
	config: any;
	onInspect: (run: any, name: string, image?: number) => void;
}) {
	const settle = useSettle(),
		navigate = useNavigate(),
		location = useLocation(),
		requestedFocus = useRef<string | undefined>(location.state?.focusRunId),
		[selected, setSelected] = useRestorableState<string | undefined>(
			"today/selected",
			() =>
				location.state?.focusRunId ??
				(readTextStored("bob-selected", "", true) || undefined),
		),
		[skipped, setSkipped] = useRestorableState<string[]>(
			"today/skipped",
			() => {
				const saved = readStored<unknown>("bob-skipped", [], true);
				return Array.isArray(saved)
					? saved.filter((id) => typeof id === "string")
					: [];
			},
		),
		[expanded, setExpanded] = useRestorableState<string | undefined>(
			"today/expanded",
			undefined,
		),
		[showAllAttention, setShowAllAttention] = useRestorableState(
			"today/all-attention",
			false,
		),
		[highlight, setHighlight] = useState<string>();
	const [swipe, setSwipe] = useState(0);
	useReadingPosition("bob-today-position");
	useEffect(() => {
		if (selected) writeTextStored("bob-selected", selected, true);
		writeStored("bob-skipped", skipped, true);
	}, [selected, skipped]);
	const available = runs.filter((run) => !settleReason(run, runs)),
		rank: Record<string, number> = { question: 0, stuck: 1, review: 2 },
		deck = available
			.filter((run) => attention(run))
			.sort((a, b) => {
				const skipA = skipped.indexOf(a.id),
					skipB = skipped.indexOf(b.id);
				if (skipA >= 0 || skipB >= 0)
					return skipA < 0 ? -1 : skipB < 0 ? 1 : skipA - skipB;
				return (
					rank[attention(a)!]! - rank[attention(b)!]! ||
					(b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt)
				);
			}),
		current =
			deck.find((run) => run.id === (requestedFocus.current ?? selected)) ??
			deck[0],
		index = deck.indexOf(current),
		working = available
			.filter((run) => active(run.status) && !attention(run))
			.sort(
				(a, b) =>
					b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
			);
	const initial = useRef(true),
		priorCount = useRef(deck.length),
		[confetti, setConfetti] = useState(false),
		touch = useRef<number | undefined>(undefined);
	useEffect(() => {
		if (current && selected !== current.id) setSelected(current.id);
		requestedFocus.current = undefined;
		if (current && location.state?.focusRunId !== current.id)
			navigate("/", { replace: true, state: { focusRunId: current.id } });
		if (!initial.current && priorCount.current > 0 && deck.length === 0) {
			setConfetti(true);
			priorCount.current = deck.length;
			const timer = setTimeout(() => setConfetti(false), 1600);
			return () => clearTimeout(timer);
		}
		priorCount.current = deck.length;
		initial.current = false;
		return undefined;
	}, [
		current,
		deck.length,
		selected,
		setSelected,
		location.state?.focusRunId,
		navigate,
	]);
	useEffect(() => {
		if (!highlight) return;
		const timer = setTimeout(() => setHighlight(undefined), 1600);
		return () => clearTimeout(timer);
	}, [highlight]);
	const choose = (id: string) => {
		if (
			current?.id !== id &&
			current &&
			["completed", "complete"].includes(current.status) &&
			!current.hasGuide &&
			!current.viewState?.keptOpen
		) {
			void api(`/api/runs/${current.id}/view`, {
				method: "PUT",
				body: JSON.stringify({
					...current.viewState,
					seenAt: new Date().toISOString(),
				}),
			})
				.then(() => client.invalidateQueries({ queryKey: ["runs"] }))
				.catch(() => {});
		}
		setSelected(id);
	};
	const move = (direction: number) => {
		if (deck.length)
			choose(
				deck[(Math.max(0, index) + direction + deck.length) % deck.length]!.id,
			);
	};
	const skip = () => {
		if (!current) return;
		setSkipped([...skipped.filter((id) => id !== current.id), current.id]);
		setSelected(deck[(index + 1) % deck.length]?.id);
	};
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.defaultPrevented) return;
			if (
				(e.target instanceof Element &&
					e.target.closest(
						"input,textarea,select,[contenteditable=true],[role=dialog],[role=menu]",
					)) ||
				document.querySelector('[role="dialog"],[role="menu"]')
			)
				return;
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			switch (e.key) {
				case "j":
					move(1);
					break;
				case "k":
					move(-1);
					break;
				case "s":
					skip();
					break;
				case "o":
					if (current) navigate(`/runs/${current.id}`);
					break;
				case "a":
					document
						.querySelector<HTMLTextAreaElement>(".question-form textarea")
						?.focus();
					break;
				case "r":
					if (attention(current ?? {}) === "stuck")
						document
							.querySelector<HTMLButtonElement>(".focus-card .primary")
							?.click();
					break;
				case "e":
					if (current && finished(current.status))
						void settle.change(current, "settle");
					else if (current?.reviewGate?.status === "pending")
						document
							.querySelector<HTMLButtonElement>(".focus-card .rainbow")
							?.click();
					break;
				default:
					return;
			}
			e.preventDefault();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	});
	return (
		<>
			<Composer
				config={config}
				onStarted={(id) => {
					setExpanded(id);
					setHighlight(id);
				}}
			/>
			<section className="for-you">
				<div className="section-heading">
					<h2>
						For you <span className="count dark-count">{deck.length}</span>
					</h2>
					{deck.length > 0 && (
						<small>
							{["question", "stuck", "review"]
								.map((kind) => {
									const n = deck.filter(
										(run) => attention(run) === kind,
									).length;
									return n
										? `${n} ${kind === "review" ? "to review" : kind === "question" ? `question${n === 1 ? "" : "s"}` : "stuck"}`
										: "";
								})
								.filter(Boolean)
								.join(" · ")}
						</small>
					)}
				</div>
				{current ? (
					<div
						className={`focus-deck ${deck.length > 1 ? "stacked" : ""}`}
						style={{
							transform: swipe
								? `translateX(${swipe}px) rotate(${swipe / 35}deg)`
								: undefined,
							transition: swipe ? "none" : undefined,
						}}
						onTouchMove={(e) => {
							if (touch.current !== undefined)
								setSwipe(
									Math.max(
										-150,
										Math.min(
											150,
											(e.touches[0]?.clientX ?? touch.current) - touch.current,
										),
									),
								);
						}}
						onTouchCancel={() => {
							touch.current = undefined;
							setSwipe(0);
						}}
						onTouchStart={(e) => {
							if ((e.target as Element).closest("input,textarea,button,a"))
								return;
							touch.current = e.touches[0]?.clientX;
						}}
						onTouchEnd={(e) => {
							if (touch.current !== undefined) {
								const delta =
									(e.changedTouches[0]?.clientX ?? touch.current) -
									touch.current;
								if (Math.abs(delta) > 60) move(delta < 0 ? 1 : -1);
								touch.current = undefined;
								setSwipe(0);
							}
						}}
					>
						<FocusCard
							key={current.id}
							summary={current}
							config={config}
							onInspect={onInspect}
							onSettled={() => void settle.change(current, "settle")}
							settling={settle.busy}
							onSkip={skip}
							navigation={
								<div className="deck-nav" aria-live="polite">
									<Button
										variant="icon"
										aria-label="Previous item"
										onClick={() => move(-1)}
									>
										‹
									</Button>
									<strong>
										{index + 1} of {deck.length}
									</strong>
									<Button
										variant="icon"
										aria-label="Next item"
										onClick={() => move(1)}
									>
										›
									</Button>
								</div>
							}
						/>
					</div>
				) : (
					<div className={`inbox-zero ${confetti ? "celebrate" : ""}`}>
						<Bob mood={runs.length ? "party" : "sleepy"} size={110} />
						<div>
							<h2>Inbox zero!</h2>
							<p>
								{working.length
									? `Nothing needs you. Bob has ${working.length} runs in the oven.`
									: "Nothing needs you. Start something above when you're ready."}
							</p>
						</div>
						{confetti && (
							<div className="confetti" aria-hidden="true">
								{Array.from({ length: 16 }, (_, i) => (
									<i key={i} style={{ "--i": i } as any} />
								))}
							</div>
						)}
					</div>
				)}
				{deck.length > 1 && (
					<>
						<div className={`up-next ${showAllAttention ? "expanded" : ""}`}>
							<strong>Up next</strong>
							{deck
								.filter((run) => run.id !== current?.id)
								.slice(0, showAllAttention ? deck.length : 3)
								.map((run) => (
									<button
										type="button"
										className={`next-${attention(run)}`}
										key={run.id}
										onClick={() => choose(run.id)}
									>
										<span>●</span>
										{run.title}
									</button>
								))}
						</div>
						{deck.length > 4 && (
							<Button
								className="attention-toggle"
								variant="secondary"
								aria-expanded={showAllAttention}
								onClick={() => setShowAllAttention(!showAllAttention)}
							>
								{showAllAttention
									? "Show fewer"
									: `Show all ${deck.length} items`}
							</Button>
						)}
					</>
				)}
			</section>
			<section className="humming">
				<div className="section-heading">
					<h2>
						Humming along <span className="count">{working.length}</span>
					</h2>
				</div>
				{working.length ? (
					<div className="working-list">
						{working.map((run) => (
							<div
								className={run.id === highlight ? "new-run-glow" : ""}
								key={run.id}
							>
								<WorkingRow
									run={run}
									config={config}
									expanded={expanded === run.id}
									onExpand={() =>
										setExpanded(expanded === run.id ? undefined : run.id)
									}
								/>
							</div>
						))}
					</div>
				) : (
					<p className="dashed">Nothing running. Start something above ↑</p>
				)}
			</section>
			<Settled
				runs={runs.filter((run) => settleReason(run, runs))}
				all={runs}
			/>
		</>
	);
}
function RunPage({
	runs,
	config,
	onInspect,
}: {
	runs: any[];
	config: any;
	onInspect: (run: any, name: string, image?: number) => void;
}) {
	const { id } = useParams(),
		query = useRun(id),
		run = query.data,
		action = useAction(),
		toast = useToast(),
		settle = useSettle(),
		title = useRef<HTMLHeadingElement>(null),
		[open, setOpen] = useRestorableState<Record<string, boolean>>(
			`panels/${id}`,
			{},
		),
		panelsEdited = useRef(Boolean(restoredView(`panels/${id}`)));
	// Auto-opened steps belong to this mounted page. Retain historical panel
	// state only when the user changed it or it was restored from an update.
	useEffect(
		() => () => {
			if (!panelsEdited.current) forgetView(`panels/${id}`);
		},
		[id],
	);

	const current = run?.step;
	const hasRun = Boolean(run);
	useEffect(() => {
		if (id && hasRun) title.current?.focus();
	}, [id, hasRun]);
	useEffect(() => {
		if (current)
			setOpen((previous) =>
				Object.hasOwn(previous, current)
					? previous
					: { ...previous, [current]: true },
			);
	}, [current, setOpen]);
	useEffect(
		() => () => {
			const data = client.getQueryData<any>(["run", id]);
			if (
				data &&
				["complete", "completed"].includes(data.status) &&
				!data.outputs?.guide &&
				!data.viewState?.keptOpen
			)
				void api(`/api/runs/${id}/view`, {
					method: "PUT",
					body: JSON.stringify({
						...data.viewState,
						seenAt: new Date().toISOString(),
					}),
				})
					.then(() => client.invalidateQueries({ queryKey: ["runs"] }))
					.catch(() => {});
		},
		[id],
	);
	if (query.isLoading && pwaState().status === "offline")
		return <p role="status">Reconnect to load this run.</p>;
	if (query.isLoading) return <Loading />;
	if (!run)
		return (
			<>
				<h1>Run not found</h1>
				<Link to="/">← Today</Link>
			</>
		);
	const reason = settleReason(run, runs),
		kind = attention(run),
		artifacts = artifactsOf(run),
		steps = stepsOf(run, config),
		visited = new Set(run.history?.map((h: any) => h.step));
	const graphRows = steps.length
			? steps
			: [{ id: "simple", key: "simple", name: "Bob’s Factory session" }],
		rows = [
			...graphRows,
			...Object.keys(run.capacityLeaves ?? {})
				.filter((key) => !graphRows.some((step) => step.key === key))
				.map((key) => ({
					id: key,
					key,
					name: key === "setup" ? "Prepare workspace" : key.split("/").at(-1),
				})),
		],
		pr = run.outputs?.["draft-pr"]?.url;
	return (
		<>
			<Link className="back-link" to="/">
				← Today
			</Link>
			<header className="run-header">
				<div>
					<h1 ref={title} tabIndex={-1}>
						{run.title}
					</h1>
					<div className="run-page-meta">
						<span className={`chip ${reason ? "quiet" : (kind ?? "working")}`}>
							{reason ??
								(kind === "question"
									? `${run.questions?.length ?? 0} question(s) for you`
									: kind === "stuck"
										? "Stuck — retry?"
										: kind === "review"
											? run.outputs?.guide
												? "Ready for your review"
												: "Done — take a look"
											: workingLabel(run))}
						</span>
						<RunMeta run={run} config={config} />
						<span>started {ago(run.createdAt)}</span>
						{pr && <External href={pr}>PR #{pr.split("/").at(-1)} ↗</External>}
					</div>
					<RunTitleStatus run={run} />
				</div>
				<div className="actions">
					{run.status === "capacity-waiting" && (
						<p role="status">Waiting for instance capacity</p>
					)}
					{active(run.status) ? (
						<ConfirmStop
							requiresConnection
							busy={action.isPending}
							onStop={() =>
								void action
									.mutateAsync({ path: `/api/runs/${run.id}/stop` })
									.then(() => toast({ text: "Run stopped" }))
									.catch(() => {})
							}
						/>
					) : reason ? (
						<Button
							variant="ghost"
							onClick={() => void settle.change(run, "back")}
						>
							↩ Bring back
						</Button>
					) : (
						finished(run.status) && (
							<Button
								variant="ghost"
								onClick={() => void settle.change(run, "settle")}
							>
								✓ Settle
							</Button>
						)
					)}
				</div>
			</header>
			<ExecutionDetails run={run} />
			<RunOrigin run={run} />
			{kind && !reason && (
				<FocusCard
					summary={run}
					config={config}
					full
					onInspect={onInspect}
					onSettled={() => void settle.change(run, "settle")}
					settling={settle.busy}
				/>
			)}
			{run.outputs?.guide && (!kind || reason) && (
				<section className="review-surface">
					<ReviewEntry run={run} />
				</section>
			)}
			<section className="artifacts-section">
				<div className="section-heading">
					<h2>
						Artifacts <span className="count">{artifacts.length}</span>
					</h2>
				</div>
				<div className="artifact-grid">
					{artifacts.map((artifact) => (
						<ArtifactCard
							key={artifact.name}
							artifact={artifact}
							run={run}
							onOpen={(name, image) => onInspect(run, name, image)}
						/>
					))}
				</div>
				{!artifacts.length && (
					<p className="muted">Step results appear here as Bob works.</p>
				)}
			</section>
			<section className="steps-section">
				<div className="section-heading">
					<h2>
						Steps{" "}
						<small>
							{steps.length
								? `${rows.filter((step) => visited.has(step.key)).length} of ${steps.length} done`
								: "single session"}
						</small>
					</h2>
				</div>
				<ol className="step-accordion">
					{rows.map((step, i) => {
						const count = (run.history ?? []).filter(
								(h: any) => h.step === step.key,
							).length,
							started =
								visited.has(step.key) ||
								Boolean(run.capacityLeaves?.[step.key]) ||
								current === step.key ||
								!steps.length,
							artifact = artifacts.find((a) => a.name === step.id),
							isOpen = open[step.key] ?? (!current && i === rows.length - 1);
						return (
							<li
								key={step.key}
								className={`step phase-${phase(step.id)} ${current === step.key ? (run.status === "waiting" ? "waiting" : ["failed", "error"].includes(run.status) ? "failed" : "current") : ""} ${!started ? "not-started" : ""}`}
							>
								<button
									type="button"
									className="step-row"
									disabled={!started}
									aria-expanded={isOpen}
									onClick={() => {
										panelsEdited.current = true;
										setOpen({ ...open, [step.key]: !isOpen });
									}}
								>
									<span className="step-dot">{icons[step.id] ?? "⚙️"}</span>
									<strong>{step.name}</strong>
									{run.capacityLeaves?.[step.key] && (
										<span className="chip">
											{capacityPhaseLabel(run.capacityLeaves[step.key].phase)}
										</span>
									)}
									{count > 1 && <span className="chip">↺ {count}</span>}
									{artifact && (
										<span role="img" aria-label="Has artifact">
											📄
										</span>
									)}

									<span>{isOpen ? "⌄" : "›"}</span>
								</button>
								{started && isOpen && (
									<div className="step-body">
										{artifact && (
											<ArtifactCard
												artifact={artifact}
												run={run}
												onOpen={(name, image) => onInspect(run, name, image)}
											/>
										)}
										<RunConversation
											run={run}
											step={steps.length ? step.key : undefined}
										/>
									</div>
								)}
							</li>
						);
					})}
				</ol>
				<details>
					<summary>Workspace and input</summary>
					<p>
						<code>{run.workspace}</code>
					</p>
					<pre>{run.input}</pre>
				</details>
			</section>
		</>
	);
}
function Loading() {
	return (
		<div className="loading">
			<Bob mood="busy" size={90} />
			<p>Bob is checking the factory floor…</p>
		</div>
	);
}
function App() {
	const pwa = usePwa();
	useLiveUpdates();
	const settle = useSettle();
	const runsQuery = useRuns(),
		configQuery = useConfig(),
		runs = runsQuery.data ?? [],
		config = configQuery.data,
		location = useLocation(),
		navigate = useNavigate(),
		[shortcuts, setShortcuts] = useState(false),
		[inspection, setInspection] = useRestorableState<
			{ runId: string; name: string; image?: number } | undefined
		>("inspector/selection", undefined);
	const inspectionRun = useRun(inspection?.runId);

	const count = runs.filter(
			(run) => !settleReason(run, runs) && attention(run),
		).length,
		mood = runs.some((run) => attention(run) === "question")
			? "alert"
			: runs.some((run) => attention(run) === "stuck")
				? "oops"
				: count
					? "alert"
					: runs.some((run) => active(run.status))
						? "busy"
						: runs.length
							? "party"
							: "sleepy";
	useEffect(() => {
		if (config && runsQuery.data && pwa.status === "ready") {
			requestAnimationFrame(completeRestoration);
		}
	}, [config, runsQuery.data, pwa.status]);
	useEffect(() => {
		document.title = `${count ? `(${count}) ` : ""}Bob's Factory`;
	}, [count]);
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.defaultPrevented) return;
			if (
				(e.target instanceof Element &&
					e.target.closest("input,textarea,select,[contenteditable=true]")) ||
				inspection ||
				shortcuts ||
				document.querySelector('[role="dialog"],[role="menu"]')
			)
				return;
			if (e.key === "?") {
				e.preventDefault();
				setShortcuts(true);
			}
			if (e.key === "n") {
				e.preventDefault();
				navigate("/");
				requestAnimationFrame(() =>
					document.getElementById("composer-input")?.focus(),
				);
			}
			if (e.key === "Escape" && location.pathname !== "/")
				navigate("/", {
					state: todayContext(location.pathname, location.state),
				});
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [navigate, location.pathname, location.state, inspection, shortcuts]);
	useLayoutEffect(() => {
		if (
			location.pathname !== "/" &&
			!/^\/runs\/[^/]+\/review$/.test(location.pathname)
		)
			window.scrollTo(0, 0);
	}, [location.pathname]);
	useEffect(() => {
		const previous = history.scrollRestoration;
		history.scrollRestoration = "manual";
		return () => {
			history.scrollRestoration = previous;
		};
	}, []);
	const inspect = (run: any, name: string, image?: number) =>
		setInspection({ runId: run.id, name, image });
	return (
		<>
			<a className="skip-link" href="#main-content">
				Skip to content
			</a>
			<Header
				count={count}
				mood={mood}
				onShortcuts={() => setShortcuts(true)}
			/>
			<main id="main-content" className="page">
				<ConnectionNotice hasData={Boolean(config || runs.length)} />
				<div inert={pwa.updating}>
					{!config || (runsQuery.isLoading && !runsQuery.data) ? (
						pwa.status === "offline" || pwa.status === "mismatch" ? (
							<p className="intro">
								The app shell is available. Reconnect to load your Today queue
								and runs.
							</p>
						) : (
							<Loading />
						)
					) : (
						<Routes>
							<Route
								path="/"
								element={
									<Today runs={runs} config={config} onInspect={inspect} />
								}
							/>
							<Route path="/recipes" element={<Recipes />} />
							<Route path="/settings/*" element={<Settings />} />
							<Route
								path="/runs/:id/review"
								element={
									<ReviewPage
										key={location.pathname}
										config={config}
										onSettled={(run) => void settle.change(run, "settle")}
										settling={settle.busy}
									/>
								}
							/>

							<Route
								path="/runs/:id"
								element={
									<RunPage
										key={location.pathname}
										runs={runs}
										config={config}
										onInspect={inspect}
									/>
								}
							/>
							<Route
								path="*"
								element={
									<>
										<h1>Page not found</h1>
										<Link to="/">← Today</Link>
									</>
								}
							/>
						</Routes>
					)}
				</div>
			</main>
			<Modal
				open={shortcuts}
				onOpenChange={setShortcuts}
				title="Keyboard shortcuts"
			>
				<div className="modal-body">
					<dl className="shortcuts">
						{[
							["n", "Start a new run"],
							["j / k", "Next / previous item"],
							["a", "Answer the current question"],
							["r", "Retry the current run"],
							["e", "Settle the current item"],
							["s", "Skip for now"],
							["o", "Open the current run"],
							["⌘ / Ctrl ⏎", "Send answers"],
							["esc", "Back to Today"],
							["?", "Show shortcuts"],
						].map(([key, description]) => (
							<div key={key}>
								<dt>
									<kbd>{key}</kbd>
								</dt>
								<dd>{description}</dd>
							</div>
						))}
					</dl>
					<Button onClick={() => setShortcuts(false)}>Got it</Button>
				</div>
			</Modal>
			{inspection && inspectionRun.data && (
				<Inspector
					key={`${inspection.runId}/${inspection.name}`}
					run={inspectionRun.data}
					selected={inspection}
					onClose={() => setInspection(undefined)}
					onChange={(name, image) =>
						setInspection({ ...inspection, name, image })
					}
				/>
			)}
		</>
	);
}
startPwa(refreshFactory);
createRoot(document.getElementById("root")!).render(
	<QueryClientProvider client={client}>
		<HashRouter>
			<ToastProvider>
				<AccessBoundary>
					<App />
				</AccessBoundary>
			</ToastProvider>
		</HashRouter>
	</QueryClientProvider>,
);
