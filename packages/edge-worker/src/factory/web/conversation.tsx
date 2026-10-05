import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatActivities } from "./activity.js";
import { Structure } from "./artifacts";
import { api, useAction } from "./client";
import { DraftNotice } from "./pwa-ui";
import {
	collectRestoration,
	rememberDraft,
	restoredDraft,
	revisionOf,
	useRestorableState,
} from "./restoration";
import { mergePage } from "./transcript";
import { Button, Markdown } from "./ui";
export function activitiesOf(run: any): any[] {
	return (formatActivities as (run: any) => any[])(run);
}
// Small reading-state cache survives collapsing a step or visiting another route.
const reading = new Map<
	string,
	{
		top: number;
		following: boolean;
		expanded: Set<string>;
		groups: Map<string, string>;
		anchor?: { key: string; offset: number; cursor?: string };
		restoring?: boolean;
	}
>();
function stateFor(id: string) {
	let state = reading.get(id);
	if (!state) {
		const saved = restoredDraft<any>(`reading/${id}`);
		state = {
			top: 0,
			following: saved?.following ?? true,
			expanded: new Set(saved?.expanded ?? []),
			groups: new Map(saved?.groups ?? []),
			anchor: saved?.anchor,
			restoring: Boolean(saved?.anchor),
		};
		if (reading.size >= 40) reading.delete(reading.keys().next().value!);
		reading.set(id, state);
	}
	return state;
}
collectRestoration(() => {
	for (const [id, state] of reading)
		rememberDraft(`reading/${id}`, {
			following: state.following,
			expanded: [...state.expanded],
			groups: [...state.groups],
			anchor: state.anchor,
		});
});
function LazyDetails({ id, state, children, summary, className }: any) {
	const [open, setOpen] = useState(state.expanded.has(id));
	return (
		<details
			className={className}
			open={open}
			onToggle={(event) => {
				const next = event.currentTarget.open;
				setOpen(next);
				if (next) state.expanded.add(id);
				else state.expanded.delete(id);
			}}
		>
			<summary>{summary}</summary>
			{open && (typeof children === "function" ? children() : children)}
		</details>
	);
}
function RawData({ value, runId }: any) {
	const index = value?.activityIndex;
	const full = useQuery({
		queryKey: ["raw-entry", runId, index],
		enabled: Boolean(
			runId && value?.activityTruncated && typeof index === "number",
		),
		queryFn: ({ signal }) =>
			api(`/api/runs/${encodeURIComponent(runId)}/activity/entries/${index}`, {
				signal,
			}),
		staleTime: 60000,
		gcTime: 60000,
	});
	return full.isLoading ? (
		<p role="status">Loading full raw data…</p>
	) : full.error ? (
		<p role="alert">{full.error.message}</p>
	) : (
		<pre>{JSON.stringify(full.data ?? value, null, 2)}</pre>
	);
}
function Tool({ item, state, runId }: any) {
	return (
		<LazyDetails
			id={item.key}
			state={state}
			className={`tool ${item.status === "error" ? "tool-error" : ""}`}
			summary={
				<>
					<span>{item.status === "error" ? "✕" : "⌁"}</span>
					<strong>{item.title ?? item.name}</strong>
					<code>{item.parameter}</code>
					<small>{item.status}</small>
				</>
			}
		>
			{() => (
				<>
					<Structure value={item.input} />
					{item.result && (
						<Markdown>
							{typeof item.result === "string"
								? item.result
								: JSON.stringify(item.result, null, 2)}
						</Markdown>
					)}
					<LazyDetails id={`${item.key}/raw`} state={state} summary="Raw data">
						{() => (
							<>
								<RawData value={item.raw} runId={runId} />
								{item.rawResult && (
									<RawData value={item.rawResult} runId={runId} />
								)}
							</>
						)}
					</LazyDetails>
				</>
			)}
		</LazyDetails>
	);
}
export function RunConversation({ run, step }: { run: any; step?: string }) {
	const cache = useQueryClient(),
		key = ["transcript", run.id, step ?? "all"],
		query = useQuery<any>({
			queryKey: key,
			queryFn: ({ signal }) => {
				const previous = cache.getQueryData<any>(key);
				if (previous && !stateFor(`${run.id}/${step ?? "all"}`).following)
					return Promise.resolve({ ...previous, paused: true });
				const params = new URLSearchParams({ limit: "120" });
				if (step) params.set("step", step);
				const reading = stateFor(`${run.id}/${step ?? "all"}`);
				if (!previous && !reading.following && reading.anchor?.cursor)
					params.set("after", reading.anchor.cursor);
				if (previous?.end !== undefined) params.set("after", previous.end);
				return api(
					`/api/runs/${encodeURIComponent(run.id)}/activity?${params}`,
					{ signal },
				).then((page) => mergePage(cache.getQueryData<any>(key), page));
			},
			refetchInterval: (data) =>
				stateFor(`${run.id}/${step ?? "all"}`).following &&
				data.state.data?.hasNewer
					? 500
					: false,
			gcTime: 300000,
		}),
		[loadingOlder, setLoadingOlder] = useState(false),
		[error, setError] = useState("");
	const loadOlder = async () => {
		setLoadingOlder(true);
		stateFor(`${run.id}/${step ?? "all"}`).following = false;
		await cache.cancelQueries({ queryKey: key });
		setError("");
		try {
			const params = new URLSearchParams({
				limit: "120",
				before: String(query.data.before),
			});
			if (step) params.set("step", step);
			const page = await api(
				`/api/runs/${encodeURIComponent(run.id)}/activity?${params}`,
			);
			cache.setQueryData(key, (previous: any) =>
				mergePage(previous, page, true),
			);
		} catch (error) {
			setError(
				error instanceof Error
					? error.message
					: "Could not load older messages",
			);
		} finally {
			setLoadingOlder(false);
		}
	};
	const {
		chatMessages,
		answers,
		workflow,
		workflowDefinitions,
		step: currentStep,
		runner,
		createdAt,
		status,
		outputs,
	} = run;
	const items = useMemo(
		() =>
			activitiesOf({
				chatMessages,
				answers,
				workflow,
				workflowDefinitions,
				step: currentStep,
				runner,
				createdAt,
				status,
				outputs,
				...query.data,
				entries: query.data?.entries ?? [],
				events: query.data?.events ?? [],
			}).filter((item) => !step || item.step === step),
		[
			step,
			query.data,
			chatMessages,
			answers,
			workflow,
			workflowDefinitions,
			currentStep,
			runner,
			createdAt,
			status,
			outputs,
		],
	);
	if (query.isLoading) return <p role="status">Loading conversation…</p>;
	if (query.error) return <p role="alert">{query.error.message}</p>;
	return (
		<>
			<Conversation
				items={items}
				cacheId={`${run.id}/${step ?? "all"}`}
				older={query.data?.hasOlder}
				loadOlder={loadOlder}
				loadingOlder={loadingOlder}
				hasUpdates={query.data?.paused || query.data?.hasNewer}
				onLatest={() => {
					stateFor(`${run.id}/${step ?? "all"}`).following = true;
					void cache.resetQueries({ queryKey: key });
				}}
			/>
			{error && <p role="alert">{error}</p>}
			{run.chat?.enabled &&
				(!step || !run.chat.step || run.chat.step === step) && (
					<ChatComposer run={run} />
				)}
		</>
	);
}

function ChatComposer({ run }: { run: any }) {
	const [text, setText, staleChat] = useRestorableState(
		`chat/${run.id}`,
		"",
		revisionOf([run.chat?.mode, run.chat?.step]),
	);
	const [notice, setNotice] = useState("");
	const action = useAction();
	const cache = useQueryClient();
	const send = async () => {
		if (!text.trim() || !run.chat.available || action.isPending || staleChat)
			return;
		setNotice("");
		try {
			const sent = await action.mutateAsync({
				path: `/api/runs/${encodeURIComponent(run.id)}/messages`,
				body: { text },
			});
			setText("");
			setNotice(
				sent.mode === "continue"
					? "Conversation resumed."
					: "Message sent to the agent.",
			);
			void cache.invalidateQueries({ queryKey: ["transcript", run.id] });
		} catch {
			/* Mutation exposes the delivery error and retains the draft. */
		}
	};
	return (
		<form
			className="chat-composer"
			onSubmit={(event) => {
				event.preventDefault();
				void send();
			}}
		>
			<DraftNotice conflict={staleChat} draftKey={`chat/${run.id}`} />
			<label htmlFor={`chat-${run.id}`}>Message Bob</label>
			<textarea
				id={`chat-${run.id}`}
				rows={3}
				maxLength={100000}
				value={text}
				placeholder="Ask a question or steer the work…"
				onChange={(event) => {
					setText(event.target.value);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						void send();
					}
				}}
			/>
			<div className="chat-composer-actions">
				<small>
					{run.chat.available
						? run.chat.mode === "continue"
							? "Continue the same conversation and worktree."
							: "Send instructions to the current agent. ⌘ / Ctrl + Enter to send."
						: run.chat.reason}
				</small>
				<Button
					type="submit"
					requiresConnection
					busy={action.isPending}
					disabled={!text.trim() || !run.chat.available || staleChat}
				>
					Send message
				</Button>
			</div>
			{action.error && <p role="alert">{action.error.message}</p>}
			{notice && <p role="status">{notice}</p>}
		</form>
	);
}

export function Conversation({
	items,
	cacheId = "preview",
	older,
	loadOlder,
	loadingOlder,
	onLatest,
	hasUpdates,
}: {
	items: any[];
	cacheId?: string;
	older?: boolean;
	loadOlder?: () => void;
	loadingOlder?: boolean;
	onLatest?: () => void;
	hasUpdates?: boolean;
}) {
	const box = useRef<HTMLDivElement>(null),
		state = stateFor(cacheId),
		[behind, setBehind] = useState(!state.following),
		[revision, setRevision] = useState(0);
	const rows = useMemo(() => {
		void revision; // Expansion cache changes require rebuilding the flattened virtual rows.
		const groups: any[] = [];
		for (const item of items) {
			const last = groups.at(-1);
			if (item.type === "action") {
				if (last?.tools) last.tools.push(item);
				else groups.push({ key: `group/${item.key}`, tools: [item] });
			} else groups.push(item);
		}
		for (const group of groups)
			if (group.tools) {
				const existing = group.tools
					.map((tool: any) => state.groups.get(tool.key))
					.find(Boolean);
				if (existing) group.key = existing;
				for (const tool of group.tools) state.groups.set(tool.key, group.key);
			}
		const visibleTools = new Set(
			items.filter((item) => item.type === "action").map((item) => item.key),
		);
		for (const key of state.groups.keys())
			if (!visibleTools.has(key)) state.groups.delete(key);
		return groups.flatMap((group) =>
			group.tools && state.expanded.has(group.key)
				? [group, ...group.tools]
				: [group],
		);
	}, [items, state, revision]);
	const virtual = useVirtualizer({
		count: rows.length,
		getScrollElement: () => box.current,
		estimateSize: (index) =>
			rows[index]?.tools ? 64 : rows[index]?.type === "action" ? 70 : 150,
		overscan: 4,
		getItemKey: (index) => rows[index]?.key ?? index,
	});
	const anchor = useRef(state.anchor);
	const previousFirst = useRef(rows[0]?.key);
	const totalSize = virtual.getTotalSize();
	useLayoutEffect(() => {
		const element = box.current!;
		if (state.following) element.scrollTop = totalSize;
		else if (
			(state.restoring || previousFirst.current !== rows[0]?.key) &&
			anchor.current
		) {
			const target = { ...anchor.current };
			const index = rows.findIndex((row) => row.key === target.key);
			if (index >= 0) {
				state.restoring = false;
				virtual.scrollToIndex(index, { align: "start" });
				element.scrollTop += target.offset;
				// Dynamic-height rows finish measuring after the prepend commit.
				requestAnimationFrame(() =>
					requestAnimationFrame(() => {
						const node = element.querySelector<HTMLElement>(
							`[data-index="${index}"]`,
						);
						if (node && !state.following)
							element.scrollTop +=
								node.getBoundingClientRect().top -
								element.getBoundingClientRect().top +
								target.offset;
					}),
				);
			}
		} else if (element.scrollTop === 0 && state.top > 0)
			element.scrollTop = state.top;
		previousFirst.current = rows[0]?.key;
		setBehind(!state.following);
	}, [rows, totalSize, state, virtual]);
	useEffect(
		() => () => {
			if (box.current) state.top = box.current.scrollTop;
		},
		[state],
	);
	const toggleGroup = (key: string) => {
		if (state.expanded.has(key)) state.expanded.delete(key);
		else state.expanded.add(key);
		setRevision((value) => value + 1);
	};
	return (
		<div className="conversation-wrap">
			{state.restoring && (
				<p role="status">
					Restoring your reading position. If the activity is no longer
					available, load older messages or follow the latest.
				</p>
			)}
			{older && (
				<Button variant="ghost" busy={loadingOlder} onClick={loadOlder}>
					↑ Load older messages
				</Button>
			)}
			<div
				ref={box}
				className="conversation-scroll"
				role="log"
				aria-label="Conversation activity"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: virtual log must support keyboard scrolling
				tabIndex={0}
				onWheel={(event) => {
					if (event.deltaY < 0) {
						state.following = false;
						setBehind(true);
					}
				}}
				onTouchMove={() => {
					state.following = false;
				}}
				onScroll={() => {
					const element = box.current!;
					state.top = element.scrollTop;
					const wasFollowing = state.following;
					state.following =
						element.scrollHeight - element.clientHeight - element.scrollTop <=
						8;
					const first = virtual
						.getVirtualItems()
						.find((item) => item.end >= element.scrollTop);
					if (first)
						anchor.current = {
							key: String(first.key),
							offset: element.scrollTop - first.start,
							cursor:
								(rows[first.index]?.tools?.[0] ?? rows[first.index])?.raw
									?.activityCursor ?? rows[first.index]?.cursor,
						};
					state.anchor = anchor.current;
					setBehind(!state.following);
					if (!wasFollowing && state.following && hasUpdates) onLatest?.();
				}}
			>
				<div
					className="chat virtual-chat"
					style={{ height: virtual.getTotalSize(), position: "relative" }}
				>
					{virtual.getVirtualItems().map((row) => {
						const item = rows[row.index];
						return (
							<div
								key={row.key}
								data-index={row.index}
								ref={virtual.measureElement}
								className="chat-row"
								style={{
									position: "absolute",
									top: 0,
									left: 0,
									width: "100%",
									transform: `translateY(${row.start}px)`,
								}}
							>
								{item.tools ? (
									<button
										type="button"
										className="tool-group tool-group-toggle"
										aria-expanded={state.expanded.has(item.key)}
										onClick={() => toggleGroup(item.key)}
									>
										🔧 {item.tools.length} tool call
										{item.tools.length === 1 ? "" : "s"} ·{" "}
										{[
											...new Set(item.tools.map((tool: any) => tool.name)),
										].join(" · ")}
										{item.tools.some((tool: any) => tool.status === "error") &&
											" · failed"}
									</button>
								) : item.type === "action" ? (
									<Tool
										item={item}
										state={state}
										runId={cacheId.split("/")[0]}
									/>
								) : (
									<article
										className={`bubble ${item.type === "user" ? "user" : item.status === "error" ? "error" : item.type === "system" ? "system" : "assistant"}`}
									>
										<small>
											{item.type === "user" ? "You" : (item.title ?? "Bob")} ·{" "}
											{new Date(item.at).toLocaleTimeString(undefined, {
												hour: "2-digit",
												minute: "2-digit",
											})}
										</small>
										<Markdown>{item.body}</Markdown>
										{item.raw && (
											<LazyDetails
												id={`${item.key}/raw`}
												state={state}
												className="raw-data"
												summary="Raw data"
											>
												{() => (
													<RawData
														value={item.raw}
														runId={cacheId.split("/")[0]}
													/>
												)}
											</LazyDetails>
										)}
									</article>
								)}
							</div>
						);
					})}
				</div>
			</div>
			{behind && (
				<Button
					variant="secondary"
					className="latest-button"
					onClick={() => {
						state.following = true;
						box.current!.scrollTop = virtual.getTotalSize();
						onLatest?.();
						setBehind(false);
					}}
				>
					↓ Scroll to latest
				</Button>
			)}
		</div>
	);
}
