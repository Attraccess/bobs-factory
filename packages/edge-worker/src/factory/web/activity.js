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
	const steps = events.filter(
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
			add(entry, at, stepAt(at), `entry/${index}`);
		});
		for (let index = 0; index < events.length; index++) {
			const event = events[index],
				message = parse(event.message);
			// Session entries retain the complete agent conversation, even when the
			// runtime's size-capped event copy is truncated. Keep only workflow logs.
			if (
				["assistant", "user", "result"].includes(message?.type) ||
				event.message.length === 20000
			)
				continue;
			activities.push({
				key: `event/${event.at}/${index}`,
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
				add(message, event.at, event.step, `event/${event.at}/${index}`);
			else
				activities.push({
					key: `event/${event.at}/${index}`,
					at: event.at,
					step: event.step,
					type: "system",
					title: "Workflow",
					body:
						typeof message === "string" && message.length < 20000
							? message
							: "Recorded activity",
					raw: message,
				});
		});
	return activities.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
