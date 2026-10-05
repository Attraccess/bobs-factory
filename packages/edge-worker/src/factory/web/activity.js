import { ClaudeMessageFormatter } from "../../../../claude-runner/dist/formatter.js";
import { CodexMessageFormatter } from "../../../../codex-runner/dist/formatter.js";
import { CursorMessageFormatter } from "../../../../cursor-runner/dist/formatter.js";
import { GeminiMessageFormatter } from "../../../../gemini-runner/dist/formatter.js";
import { OpenCodeMessageFormatter } from "../../../../opencode-runner/dist/formatter.js";

const formatters = {
	claude: new ClaudeMessageFormatter(),
	codex: new CodexMessageFormatter(),
	cursor: new CursorMessageFormatter(),
	gemini: new GeminiMessageFormatter(),
	opencode: new OpenCodeMessageFormatter(),
};
export const escapeHtml = (value) =>
	String(value ?? "").replace(
		/[&<>"']/g,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				char
			],
	);
const parse = (value) => {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
};
const text = (value) =>
	typeof value === "string"
		? value
		: Array.isArray(value)
			? value.map((block) => block.text ?? block.content ?? "").join("\n")
			: (JSON.stringify(value, null, 2) ?? "");

// A small, escaped Markdown subset for conversations; raw HTML is never rendered.
export function markdown(value) {
	const inline = (line) =>
		escapeHtml(line).replace(
			/`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
			(_match, code, bold, label, url) =>
				code
					? `<code>${code}</code>`
					: bold
						? `<strong>${bold}</strong>`
						: `<a href="${url}" target="_blank" rel="noopener">${label}</a>`,
		);
	let code = null,
		output = [],
		list = false;
	const closeList = () => {
		if (list) output.push("</ul>");
		list = false;
	};
	for (const line of String(value ?? "").split("\n")) {
		if (/^\s*```/.test(line)) {
			closeList();
			if (code !== null) {
				output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
				code = null;
			} else code = [];
		} else if (code !== null) code.push(line);
		else if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
			if (!list) output.push("<ul>");
			list = true;
			const item = line
				.replace(/^\s*(?:[-*]|\d+\.)\s+/, "")
				.replace(/^\[([ xX])\]\s*/, (_m, done) =>
					done.toLowerCase() === "x" ? "✓ " : "☐ ",
				);
			output.push(`<li>${inline(item)}</li>`);
		} else {
			closeList();
			const heading = line.match(/^#{1,6}\s+(.+)/);
			if (heading) output.push(`<h4>${inline(heading[1])}</h4>`);
			else if (line.trim()) output.push(`<p>${inline(line)}</p>`);
		}
	}
	closeList();
	if (code !== null)
		output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
	return output.join("");
}

export function renderContent(value) {
	const parsed = parse(value);
	if (!parsed || typeof parsed !== "object") return markdown(text(value));
	const render = (item, depth) => {
		if (item === null) return '<span class="muted">None</span>';
		if (typeof item === "string") return markdown(item);
		if (typeof item !== "object") return escapeHtml(item);
		if (depth > 4)
			return `<pre>${escapeHtml(JSON.stringify(item, null, 2))}</pre>`;
		if (Array.isArray(item))
			return `<ul>${item.map((child) => `<li>${render(child, depth + 1)}</li>`).join("")}</ul>`;
		return `<dl class="activity-record">${Object.entries(item)
			.map(
				([key, child]) =>
					`<dt>${escapeHtml(key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " "))}</dt><dd>${render(child, depth + 1)}</dd>`,
			)
			.join("")}</dl>`;
	};
	return render(parsed, 0);
}

export function formatActivities(run) {
	const activities = [],
		tools = new Map(),
		events = run.events ?? [];
	const steps = (run.stepEvents ?? events).filter(
		(event) => !["run", "prepare"].includes(event.step),
	);
	let stepIndex = 0;
	const entries = run.entries ?? [];
	const stepAt = (at) => {
		while (
			stepIndex + 1 < steps.length &&
			Date.parse(steps[stepIndex + 1].at) <= Date.parse(at)
		)
			stepIndex++;
		return steps[stepIndex]?.step ?? run.step ?? "Cyrus";
	};
	const add = (entry, at, step, key) => {
		const runner =
			["codex", "gemini", "cursor", "opencode"].find(
				(name) => entry[`${name}SessionId`],
			) ??
			run.runner ??
			"claude";
		const formatter = formatters[runner] ?? formatters.claude;
		const metadata = entry.metadata ?? {};
		const raw = entry;
		const blocks = entry.message?.content;
		if (Array.isArray(blocks)) {
			blocks.forEach((block, index) => {
				if (block.type === "tool_use")
					add(
						{
							type: "assistant",
							content: "",
							metadata: {
								toolUseId: block.id,
								toolName: block.name,
								toolInput: block.input,
							},
						},
						at,
						step,
						`${key}/${index}`,
					);
				else if (block.type === "tool_result")
					add(
						{
							type: "user",
							content: text(block.content),
							metadata: {
								toolUseId: block.tool_use_id,
								toolResultError: block.is_error,
							},
						},
						at,
						step,
						`${key}/${index}`,
					);
				else if (block.type === "text" || block.type === "thinking")
					add(
						{
							type: block.type === "thinking" ? "thought" : entry.type,
							content: block.text ?? block.thinking,
						},
						at,
						step,
						`${key}/${index}`,
					);
			});
			return;
		}
		if (metadata.toolUseId && entry.type === "assistant") {
			const name = metadata.toolName ?? "Tool",
				input = metadata.toolInput ?? parse(entry.content) ?? {};
			const item = {
				key,
				at,
				step,
				type: "action",
				title: formatter.formatToolActionName(name, input, false),
				parameter: formatter.formatToolParameter(name, input),
				name,
				input,
				formatter,
				status: "running",
				raw,
			};
			activities.push(item);
			tools.set(metadata.toolUseId, item);
			return;
		}
		if (metadata.toolUseId && entry.type === "user") {
			const item = tools.get(metadata.toolUseId) ?? {
				key,
				at,
				step,
				type: "action",
				title: "Tool result",
				name: "Tool",
				input: {},
				formatter,
				raw,
			};
			if (!tools.has(metadata.toolUseId)) activities.push(item);
			const error = Boolean(metadata.toolResultError);
			item.status = error ? "error" : "completed";
			item.finishedAt = at;
			item.title = item.formatter.formatToolActionName(
				item.name,
				item.input,
				error,
			);
			// Context MCP returns a transport envelope; show the actual document/page.
			const result = parse(entry.content);
			const context =
				/factory[-_]context/.test(item.name) &&
				result &&
				typeof result === "object";
			const body =
				context && typeof result.text === "string"
					? result.text
					: text(entry.content);
			item.result = item.formatter.formatToolResult(
				item.name,
				item.input,
				body,
				error,
			);
			item.rawResult = raw;
			tools.delete(metadata.toolUseId);
			return;
		}
		let body = text(entry.content ?? entry.result ?? entry.errors ?? "");
		const error = entry.is_error || metadata.isError;
		if (error && !body) body = "Agent failed";
		if (!body) return;
		const type =
			entry.type === "result"
				? "response"
				: entry.type === "assistant"
					? "thought"
					: entry.type === "user"
						? "user"
						: entry.type === "thought"
							? "thought"
							: "system";
		const previous = activities.at(-1);
		if (
			type === "response" &&
			previous?.body === body &&
			previous.step === step
		) {
			previous.type = "response";
			previous.title = "Response";
			return;
		}
		activities.push({
			key,
			at,
			step,
			type,
			title: error
				? "Agent error"
				: {
						response: "Response",
						thought: "Agent",
						user: "You",
						system: "Workflow",
					}[type],
			body,
			status: error ? "error" : undefined,
			raw,
		});
	};
	if (entries.length) {
		entries.forEach((entry, index) => {
			const stamp =
				entry.metadata?.timestamp ??
				entry.timestamp ??
				entry.createdAt ??
				run.createdAt;
			const at = new Date(stamp).toISOString();
			add(
				entry,
				at,
				entry.activityStep ?? stepAt(at),
				`entry/${entry.activityIndex ?? index}`,
			);
		});
		for (let index = 0; index < events.length; index++) {
			const event = events[index],
				message = parse(event.message);
			// Session entries retain the complete agent conversation, even when the
			// runtime's size-capped event copy is truncated. Keep only workflow logs.
			if (
				event.source === "agent" ||
				["assistant", "user", "result"].includes(message?.type) ||
				/^\s*\{\s*"type"\s*:\s*"(?:assistant|user|result)"/.test(
					event.message,
				) ||
				(event.source !== "workflow" && event.message.length === 20000)
			)
				continue;
			activities.push({
				key: `event/${event.at}/${event.activityIndex ?? index}`,
				at: event.at,
				step: event.step,
				type: "system",
				title: "Workflow",
				body: text(message),
			});
		}
	} else
		events.forEach((event, index) => {
			const message = parse(event.message);
			if (message && typeof message === "object" && message.type)
				add(
					message,
					event.at,
					event.step,
					`event/${event.at}/${event.activityIndex ?? index}`,
				);
			else
				activities.push({
					key: `event/${event.at}/${event.activityIndex ?? index}`,
					at: event.at,
					step: event.step,
					type: "system",
					title: event.source === "agent" ? "Agent activity" : "Workflow",
					body:
						event.source === "agent"
							? "Recorded agent activity (details available in Raw data)"
							: typeof message === "string" && message.length < 20000
								? message
								: "Recorded activity",
					raw: message,
				});
		});
	for (let i = activities.length - 1; i >= 0; i--)
		if (
			activities[i].type === "user" &&
			(run.chatMessages ?? []).some((m) => m.text === activities[i].body)
		)
			activities.splice(i, 1);
	for (const message of run.chatMessages ?? []) {
		activities.push({
			key: `chat/${message.id}`,
			at: message.at,
			step: message.step,
			type: "user",
			title: "You",
			body: message.text,
		});
	}
	for (const [index, answer] of (run.answers ?? []).entries()) {
		if (
			!activities.some(
				(item) =>
					item.type === "user" &&
					item.body === answer.answer &&
					item.at === answer.at,
			)
		)
			activities.push({
				key: `answer/${index}`,
				at: answer.at,
				step:
					steps.findLast(
						(event) => Date.parse(event.at) <= Date.parse(answer.at),
					)?.step ??
					steps[0]?.step ??
					run.step ??
					"clarify",
				type: "user",
				title: "You",
				body: answer.answer,
			});
	}
	return compactCiActivity(run, activities)
		.filter(
			(item) =>
				!(
					item.type === "system" &&
					(run.answers ?? []).some(
						(answer) => item.body === `Human answer: ${answer.answer}`,
					)
				),
		)
		.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// CI command output arrives in arbitrary chunks, including repeated watch tables.
// Retain it on the run, but represent each configured CI tool as one chat status.
function compactCiActivity(run, activities) {
	const ci = new Set();
	const visit = (steps, prefix = "", ancestors = []) => {
		for (const step of steps ?? []) {
			const key = prefix + step.id;
			if (step.type === "tool" && step.tool === "ci") ci.add(key);
			if (step.type === "workflow" && !ancestors.includes(step.workflow)) {
				const definition = run.workflowDefinitions?.find(
					(item) => item.id === step.workflow,
				);
				visit(definition?.steps, `${key}/`, [...ancestors, step.workflow]);
			}
			(step.groups ?? []).forEach((group, index) => {
				visit(group, `${key}/${index}/`, ancestors);
			});
		}
	};
	visit(run.workflow?.steps);
	const summaries = new Map();
	const visible = activities.filter((item) => {
		if (item.type !== "system" || !ci.has(item.step)) return true;
		if (!summaries.has(item.step)) summaries.set(item.step, item);
		return false;
	});
	for (const [step, first] of summaries) {
		const receipt = (run.history ?? [])
			.filter((item) => item.step === step)
			.at(-1);
		const current = run.step === step;
		const waiting =
			current && ["running", "active", "waiting"].includes(run.status);
		const failed = current && ["failed", "error"].includes(run.status);
		const stopped = current && ["stopped", "interrupted"].includes(run.status);
		const output = receipt?.output;
		const body = waiting
			? "Waiting for PR checks…"
			: failed
				? "PR checks could not finish."
				: stopped
					? "PR check monitoring stopped."
					: output?.approved === true
						? "PR checks passed."
						: output?.approved === false
							? "PR checks need attention."
							: "PR check monitoring finished.";
		visible.push({
			key: `ci/${step}`,
			at: first.at,
			step,
			type: "system",
			title: "PR checks",
			body,
			status:
				failed || (!waiting && output?.approved === false)
					? "error"
					: undefined,
			raw: failed
				? { error: run.error }
				: !waiting && output
					? {
							headSha: output.headSha,
							checks: output.checks,
							error: output.error,
						}
					: undefined,
		});
	}
	return visible;
}

const timeLabel = (at) =>
	new Date(at).toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	});
const toolKind = (item) => {
	const name = item.name?.toLowerCase() ?? "";
	if (/^(bash|shell|exec_command|command_execution)$/.test(name))
		return "command";
	if (/^(edit|write|apply_patch|file_change|multiedit)$/.test(name))
		return "file";
	return "tool";
};
export function conversationGroups(activities) {
	const groups = [];
	for (const item of activities) {
		const previous = groups.at(-1);
		if (
			item.type === "action" &&
			previous?.type === "tools" &&
			previous.step === item.step
		)
			previous.items.push(item);
		else
			groups.push({
				key: item.key,
				step: item.step,
				type: item.type === "action" ? "tools" : item.type,
				items: [item],
			});
	}
	return groups;
}
function toolSummary(items) {
	const count = (kind) =>
		items.filter((item) => toolKind(item) === kind).length;
	const parts = [];
	for (const [kind, singular, plural, verb] of [
		["tool", "tool", "tools", "Used"],
		["command", "command", "commands", "Ran"],
		["file", "edit", "edits", "Made"],
	]) {
		const total = count(kind);
		if (total)
			parts.push(`${verb} ${total} ${total === 1 ? singular : plural}`);
	}
	const running = items.filter((item) => item.status === "running").length;
	const errors = items.filter((item) => item.status === "error").length;
	return `${parts.join(" · ")}${running ? ` · ${running} running` : ""}${errors ? ` · ${errors} failed` : ""}`;
}
function rawDetails(item) {
	return item.raw
		? `<details class="raw-activity" data-detail-key="raw/${escapeHtml(item.key)}"><summary>Raw data</summary><pre>${escapeHtml(JSON.stringify(item.rawResult ? { call: item.raw, result: item.rawResult } : item.raw, null, 2))}</pre></details>`
		: "";
}
function toolRow(item) {
	const title = item.name?.startsWith("mcp__")
		? item.name.slice(5).replaceAll("__", " · ").replaceAll("_", " ")
		: item.title;
	const kind = toolKind(item);
	return `<details class="chat-tool ${item.status === "error" ? "activity-error" : ""}" data-detail-key="tool/${escapeHtml(item.key)}"><summary><span class="tool-icon" aria-hidden="true">${kind === "command" ? "›_" : kind === "file" ? "✎" : "⚒"}</span><span class="tool-label">${escapeHtml(title)}${item.parameter ? `<span class="tool-preview">${escapeHtml(item.parameter.replace(/\s+/g, " "))}</span>` : ""}</span><span class="tool-state ${escapeHtml(item.status)}">${item.status === "error" ? "Failed" : item.status === "running" ? "Running…" : "✓"}</span></summary><div class="tool-content">${item.parameter ? `<pre>${escapeHtml(item.parameter)}</pre>` : ""}${item.result !== undefined ? `<div class="activity-text">${renderContent(item.result)}</div>` : ""}${rawDetails(item)}</div></details>`;
}
export function renderConversation(activities) {
	return conversationGroups(activities)
		.map((group) => {
			const item = group.items[0];
			const meta = `<time datetime="${escapeHtml(item.at)}" title="${escapeHtml(new Date(item.at).toLocaleString())}">${escapeHtml(timeLabel(item.at))}</time>`;
			const key = escapeHtml(group.key);
			if (group.type === "tools") {
				return `<details class="chat-tools" data-chat-key="${key}" data-detail-key="tools/${key}"><summary><span aria-hidden="true">⚒</span><span>${escapeHtml(toolSummary(group.items))}</span>${meta}</summary><div class="tool-list">${group.items.map(toolRow).join("")}</div></details>`;
			}
			if (group.type === "system") {
				const body = String(item.body ?? "");
				return `<details class="chat-system ${item.status === "error" ? "activity-error" : ""}" data-chat-key="${key}" data-detail-key="system/${key}"><summary><span class="system-preview">${escapeHtml(body.split("\n")[0].slice(0, 160) || "Workflow update")}</span>${meta}</summary><div class="activity-text">${renderContent(body)}</div>${rawDetails(item)}</details>`;
			}
			return `<article class="chat-message ${group.type === "user" ? "chat-user" : "chat-assistant"} ${item.status === "error" ? "activity-error" : ""}" data-chat-key="${key}"><div class="chat-meta"><span>${group.type === "user" ? "You" : `Agent · ${escapeHtml(item.stepLabel || item.step || "Cyrus")}`}${item.status === "error" ? " · Error" : ""}</span>${meta}</div><div class="activity-text">${renderContent(item.body)}</div>${rawDetails(item)}</article>`;
		})
		.join("");
}
