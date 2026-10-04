import { formatActivities, renderContent } from "./activity.js";

const $ = (selector) => document.querySelector(selector);
const htmlEscape = (text) =>
	String(text ?? "").replace(
		/[&<>"']/g,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				char
			],
	);
const json = (value) => htmlEscape(JSON.stringify(value, null, 2));
let config = { repositories: [], workflows: [] },
	runs = [],
	selected,
	filter = "all",
	tab = "overview",
	detailSignature = "";
const detailStates = new Map(),
	activityLimits = new Map();
function rememberDetail() {
	const detail = $("#detail");
	if (!detail.dataset.view) return;
	const state = detailStates.get(detail.dataset.view) ?? new Map();
	for (const element of detail.querySelectorAll("[data-detail-key]")) {
		state.set(element.dataset.detailKey, {
			open: element.open,
			scroll: [...element.querySelectorAll("pre")].map((pre) => [
				pre.scrollTop,
				pre.scrollLeft,
			]),
		});
	}
	detailStates.set(detail.dataset.view, state);
}
function restoreDetail(run) {
	const detail = $("#detail");
	detail.dataset.view = JSON.stringify([run.id, tab]);
	const state = detailStates.get(detail.dataset.view);
	for (const element of detail.querySelectorAll("[data-detail-key]")) {
		const saved = state?.get(element.dataset.detailKey);
		if (!saved) continue;
		if (typeof saved.open === "boolean") element.open = saved.open;
		[...element.querySelectorAll("pre")].forEach((pre, index) => {
			pre.scrollTop = saved.scroll[index]?.[0] ?? 0;
			pre.scrollLeft = saved.scroll[index]?.[1] ?? 0;
		});
	}
}
function renderActivity(run) {
	const activities = formatActivities(run),
		limit = activityLimits.get(run.id) ?? 120;
	if (!activities.length)
		return '<p class="muted">Waiting for the first activity…</p>';
	return `${activities.length > limit ? `<button type="button" class="secondary" id="older-activity">Show earlier activity (${activities.length - limit})</button>` : ""}<p class="muted">${Math.min(limit, activities.length)} of ${activities.length} activities · oldest to newest</p>${activities
		.slice(-limit)
		.map((item) => {
			const key = htmlEscape(item.key);
			const title = item.name?.startsWith("mcp__")
				? item.title.replace(
						item.name,
						item.name.slice(5).replaceAll("__", " · ").replaceAll("_", " "),
					)
				: item.title;
			return `<article class="event ${htmlEscape(item.type)} ${item.status === "error" ? "activity-error" : ""}"><small>${htmlEscape(date(item.at))} · ${htmlEscape(item.step)}</small><div class="activity-heading"><strong>${htmlEscape(title)}</strong>${item.status ? badge(item.status) : ""}</div>${item.parameter ? `<div class="activity-parameter">${htmlEscape(item.parameter)}</div>` : ""}${item.body ? `<div class="activity-text">${renderContent(item.body)}</div>` : ""}${item.result !== undefined ? `<details data-detail-key="result/${key}"><summary>${item.status === "error" ? "Error details" : "Result"}</summary><div class="activity-text">${renderContent(item.result)}</div></details>` : ""}${item.raw ? `<details class="raw-activity" data-detail-key="raw/${key}"><summary>Raw data</summary><pre>${json(item.rawResult ? { call: item.raw, result: item.rawResult } : item.raw)}</pre></details>` : ""}</article>`;
		})
		.join("")}`;
}
async function api(path, options = {}) {
	const response = await fetch(path, {
		...options,
		headers: {
			"Content-Type": "application/json",
			"X-Factory-Request": "1",
			...options.headers,
		},
	});
	const body = await response.json();
	if (!response.ok)
		throw new Error(body.error ?? `Request failed (${response.status})`);
	return body;
}
function fail(error) {
	$("#error").textContent = error.message;
	$("#error").hidden = false;
}
const active = (status) => ["running", "waiting", "active"].includes(status);
const completed = (status) => ["completed", "complete"].includes(status);
const badge = (status) =>
	`<span class="badge ${htmlEscape(status)}">${htmlEscape(status)}</span>`;
const date = (value) =>
	new Date(value).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
function renderRuns() {
	$("#run-count").textContent = runs.length;
	$("#metric-running").textContent = runs.filter((run) =>
		["running", "active"].includes(run.status),
	).length;
	$("#metric-waiting").textContent = runs.filter(
		(run) => run.status === "waiting",
	).length;
	$("#metric-completed").textContent = runs.filter((run) =>
		completed(run.status),
	).length;
	$("#metric-total").textContent = runs.length;
	const search = $("#search").value.toLowerCase();
	const visible = runs.filter(
		(run) =>
			(!search || `${run.title} ${run.id}`.toLowerCase().includes(search)) &&
			(filter === "all" ||
				(filter === "running"
					? ["running", "active"].includes(run.status)
					: filter === "completed"
						? completed(run.status)
						: run.status === filter)),
	);
	$("#run-list").innerHTML = visible.length
		? visible
				.map(
					(run) =>
						`<button class="run-row ${selected === run.id ? "selected" : ""}" data-run="${htmlEscape(run.id)}"><span class="run-title">${htmlEscape(run.title)}</span><span class="run-meta">${badge(run.status)}<span>${htmlEscape(date(run.createdAt))}</span></span><span class="run-meta" style="margin-top:9px">${htmlEscape(run.workflow)}${run.step ? ` · ${htmlEscape(run.step)}` : ""}</span></button>`,
				)
				.join("")
		: '<div class="empty-list">No runs here yet.<br>Start with a task you want to build.</div>';
	document.querySelectorAll("[data-run]").forEach((button) => {
		button.onclick = () => {
			selected = button.dataset.run;
			tab = "overview";
			detailSignature = "";
			renderRuns();
			refreshDetail().catch(fail);
		};
	});
}
function renderGuide(run) {
	const guide = run.outputs?.guide;
	if (!guide)
		return '<p class="muted">The human review guide appears after review and CI are complete.</p>';
	const textList = (items) =>
		`<ul>${(items ?? []).map((item) => `<li>${htmlEscape(typeof item === "string" ? item : JSON.stringify(item))}</li>`).join("")}</ul>`;
	const shots = run.outputs.capture?.screenshots ?? [];
	return `<section class="guide-section"><span class="eyebrow">GOAL</span><h2>${htmlEscape(guide.goal)}</h2><p>${htmlEscape(guide.summary)}</p>${badge(guide.decision?.status ?? "needs-attention")}<p>${htmlEscape(guide.decision?.summary)}</p></section>
  <section class="guide-section"><h3>Before & after</h3>${(guide.behavior ?? []).map((item) => `<div class="guide-card"><strong>${htmlEscape(item.scenario)}</strong><p><b>Before:</b> ${htmlEscape(item.before)}</p><p><b>After:</b> ${htmlEscape(item.after)}</p></div>`).join("")}</section>
  ${shots.length ? `<section class="guide-section screenshots"><h3>Visual evidence</h3>${shots.map((shot, index) => `<figure><a href="/api/runs/${encodeURIComponent(run.id)}/screenshots/${index}" target="_blank" rel="noopener"><img src="/api/runs/${encodeURIComponent(run.id)}/screenshots/${index}" alt="${htmlEscape(shot.caption)}" loading="lazy"></a><figcaption>${htmlEscape(shot.caption)}</figcaption></figure>`).join("")}</section>` : ""}
  <section class="guide-section"><h3>Requirements</h3>${(guide.requirements ?? []).map((item) => `<div class="guide-card"><strong>${htmlEscape(item.criterion)}</strong> ${badge(item.status)}${textList(item.evidence)}</div>`).join("")}</section>
  <section class="guide-section"><h3>Checks & risks</h3>${textList(guide.checks)}${textList(guide.risks)}</section>
  <section class="guide-section"><h3>Your review</h3>${textList(guide.reviewInstructions)}</section><p class="muted">Revision: ${htmlEscape(run.outputs.handoff?.headSha ?? run.outputs.ci?.headSha)}</p>`;
}
function expandSteps(steps, definitions, prefix = "", ancestors = []) {
	return steps.flatMap((step) => {
		const key = prefix + step.id;
		if (step.type === "workflow") {
			if (ancestors.includes(step.workflow)) return [];
			const definition = definitions.find((item) => item.id === step.workflow);
			return expandSteps(definition?.steps ?? [], definitions, `${key}/`, [
				...ancestors,
				step.workflow,
			]);
		}
		return [
			{ ...step, key },
			...(step.groups ?? []).flatMap((group, index) =>
				expandSteps(group, definitions, `${key}/${index}/`, ancestors),
			),
		];
	});
}
function renderDetail(run) {
	rememberDetail();
	const scroll = [window.scrollX, window.scrollY];
	const outputs = run.outputs ?? {},
		steps = expandSteps(
			run.workflow?.steps ?? [],
			run.workflowDefinitions ?? config.workflows,
		),
		visited = new Set((run.history ?? []).map((item) => item.step));
	const repo =
		config.repositories.find((item) => item.id === run.repositoryId)?.name ??
		run.repositoryId ??
		"Workspace";
	const pr = outputs["draft-pr"]?.url;
	const safePr =
		typeof pr === "string" && /^https:\/\/(github\.com|gitlab\.com)\//.test(pr)
			? `<a href="${htmlEscape(pr)}" target="_blank" rel="noopener">Open draft PR ↗</a>`
			: "";
	let content;
	if (tab === "activity") {
		content = renderActivity(run);
	} else if (tab === "decisions") {
		content = `<h3>Decision records</h3><pre>${json(outputs.decisions ?? outputs.clarify ?? {})}</pre><h3>Questions & answers</h3>${(run.answers ?? []).map((answer) => `<div class="guide-card"><p>${answer.questions.map(htmlEscape).join("<br>")}</p><p><b>Answer:</b> ${htmlEscape(answer.answer)}</p></div>`).join("")}`;
	} else if (tab === "artifacts") {
		content = Object.keys(outputs).length
			? Object.entries(outputs)
					.map(
						([name, output]) =>
							`<details data-detail-key="artifact/${htmlEscape(name)}"><summary>${htmlEscape(name)}</summary><pre>${json(output)}</pre></details>`,
					)
					.join("")
			: '<p class="muted">Step results appear here as the run progresses.</p>';
	} else if (tab === "guide") content = renderGuide(run);
	else
		content = `${run.error ? `<div class="callout">${htmlEscape(run.error)}</div>` : ""}<h3>${steps.length ? "Workflow progress" : "Cyrus run"}</h3>${steps.length ? `<ol class="step-list">${steps.map((step, index) => `<li class="${run.step === step.key && active(run.status) ? "current" : visited.has(step.key) ? "done" : ""}"><span class="step-circle">${visited.has(step.key) ? "✓" : index + 1}</span><span>${htmlEscape(step.name)}</span></li>`).join("")}</ol>` : '<p class="muted">The original Cyrus workflow is running. See Activity for agent progress.</p>'}<details data-detail-key="workspace"><summary>Workspace and input</summary><p class="muted">${htmlEscape(run.workspace || "Preparing workspace…")}</p><pre>${htmlEscape(run.input ?? "")}</pre></details>`;
	$("#detail").innerHTML =
		`<div class="detail-header"><div>${badge(run.status)}<h2>${htmlEscape(run.title)}</h2><div class="detail-meta">${htmlEscape(repo)} · ${htmlEscape(run.workflow?.name ?? "Simple / Cyrus")}<br>${htmlEscape(date(run.createdAt))} ${safePr}</div></div>${active(run.status) ? '<button class="danger" id="stop-run">Terminate</button>' : ""}</div><nav class="tabs" aria-label="Run views">${[
			["overview", "Overview"],
			["activity", "Activity"],
			["decisions", "Decisions"],
			["artifacts", "Artifacts"],
			["guide", "Review guide"],
		]
			.map(
				([id, name]) =>
					`<button data-tab="${id}" class="${tab === id ? "selected" : ""}">${name}</button>`,
			)
			.join(
				"",
			)}</nav><div class="detail-body">${run.status === "waiting" ? `<form id="answer-form" class="callout"><h3>Your input is needed</h3>${run.questions.map((question) => `<p>${htmlEscape(question)}</p>`).join("")}<label for="answer-text">Your answers</label><textarea id="answer-text" name="answer" required rows="4" placeholder="Answer the questions above…"></textarea><div class="form-error" role="alert"></div><button class="primary" type="submit">Send answers & continue →</button></form>` : ""}${content}</div>`;
	restoreDetail(run);
	window.scrollTo(...scroll);
	if ($("#older-activity"))
		$("#older-activity").onclick = () => {
			activityLimits.set(run.id, (activityLimits.get(run.id) ?? 120) + 120);
			detailSignature = "";
			refreshDetail().catch(fail);
		};
	document.querySelectorAll("[data-tab]").forEach((button) => {
		button.onclick = () => {
			tab = button.dataset.tab;
			detailSignature = "";
			refreshDetail().catch(fail);
		};
	});
	if ($("#stop-run"))
		$("#stop-run").onclick = async () => {
			try {
				await api(`/api/runs/${encodeURIComponent(run.id)}/stop`, {
					method: "POST",
					body: "{}",
				});
				detailSignature = "";
				await refresh();
			} catch (error) {
				fail(error);
			}
		};
	if ($("#answer-form"))
		$("#answer-form").onsubmit = async (event) => {
			event.preventDefault();
			const form = event.currentTarget;
			try {
				await api(`/api/runs/${encodeURIComponent(run.id)}/answer`, {
					method: "POST",
					body: JSON.stringify({ answer: form.elements.answer.value }),
				});
				detailSignature = "";
				await refresh();
			} catch (error) {
				form.querySelector(".form-error").textContent = error.message;
			}
		};
}
async function refreshDetail() {
	if (!selected) return;
	const id = selected,
		run = await api(`/api/runs/${encodeURIComponent(id)}`);
	if (id !== selected) return;
	const signature = JSON.stringify(run) + tab;
	if (
		signature === detailSignature ||
		$("#answer-form")?.contains(document.activeElement)
	)
		return;
	detailSignature = signature;
	renderDetail(run);
}
async function refresh() {
	runs = await api("/api/runs");
	renderRuns();
	await refreshDetail();
	$("#error").hidden = true;
}
async function loadConfig() {
	config = await api("/api/config");
}
async function openStart() {
	try {
		await loadConfig();
		$("#repository-select").innerHTML = config.repositories.length
			? config.repositories
					.map(
						(repo) =>
							`<option value="${htmlEscape(repo.id)}">${htmlEscape(repo.name)}</option>`,
					)
					.join("")
			: '<option value="">No active repositories configured</option>';
		$("#workflow-select").innerHTML = config.workflows
			.filter((workflow) => !workflow.internal)
			.map(
				(workflow) =>
					`<option value="${htmlEscape(workflow.id)}">${htmlEscape(workflow.name)}</option>`,
			)
			.join("");
		$("#workflow-select").value = config.defaultWorkflow;
		$("#workflow-select").onchange = renderLaunchFields;
		$("#workflow-select").onchange();
		renderRunReasoning();
		$("#start-dialog").showModal();
	} catch (error) {
		fail(error);
	}
}

function renderLaunchFields() {
	const workflow = config.workflows.find(
		(item) => item.id === $("#workflow-select").value,
	);
	$("#workflow-description").textContent = workflow?.description ?? "";
	const previous = Object.fromEntries(
		[...document.querySelectorAll("[data-launch-field]")].map((input) => [
			input.name,
			input.value,
		]),
	);
	$("#launch-fields").innerHTML = (workflow?.launchFields ?? [])
		.map((field) => {
			const value = previous[field.name] ?? field.defaultValue ?? "";
			const attributes = `id="launch-${htmlEscape(field.name)}" name="${htmlEscape(field.name)}" data-launch-field ${field.required ? "required" : ""}`;
			const placeholder = htmlEscape(field.placeholder ?? "");
			const control =
				field.type === "textarea"
					? `<textarea ${attributes} rows="4" maxlength="100000" placeholder="${placeholder}">${htmlEscape(value)}</textarea>`
					: field.type === "select"
						? `<select ${attributes}><option value="">${placeholder || "Choose…"}</option>${field.options.map((option) => `<option value="${htmlEscape(option.value)}" ${option.value === value ? "selected" : ""}>${htmlEscape(option.label)}</option>`).join("")}</select>`
						: `<input ${attributes} maxlength="${field.name === "title" ? 300 : field.name === "source" ? 1000 : 100000}" placeholder="${placeholder}" value="${htmlEscape(value)}">`;
			return `<label>${htmlEscape(field.label)}${field.required ? "" : " (optional)"}${control}</label>${field.description ? `<p class="hint">${htmlEscape(field.description)}</p>` : ""}`;
		})
		.join("");
}
$("#new-run").onclick = openStart;
$("#empty-start").onclick = openStart;
function reasoningOptions(runner, selected, label) {
	return (
		`<option value="">${label}</option>` +
		(config.reasoningLevels?.[runner] ?? [])
			.map(
				(level) =>
					`<option value="${level}" ${selected === level ? "selected" : ""}>${level}</option>`,
			)
			.join("")
	);
}
function renderRunReasoning(reset = false) {
	const runner = $("#start-form [name=runner]").value || config.defaultRunner;
	const reasoning = $("#run-reasoning");
	const variant = $("#run-variant");
	const supported = Boolean(config.reasoningLevels?.[runner]);
	reasoning.innerHTML = reasoningOptions(
		runner,
		reset ? "" : reasoning.value,
		"Model default",
	);
	reasoning.disabled = !supported;
	$("#run-reasoning-label").hidden = !supported;
	variant.disabled = runner !== "opencode";
	$("#run-variant-label").hidden = variant.disabled;
	if (reset) variant.value = "";
	$("#run-reasoning-hint").textContent =
		runner === "opencode"
			? "Use a variant supported by this provider/model, or enter a custom variant."
			: supported
				? "Available effort levels depend on the selected model. Empty uses its default."
				: "This runner uses the model’s native reasoning settings.";
}
$("#start-form [name=runner]").onchange = () => renderRunReasoning(true);
document.querySelectorAll("[data-close]").forEach((button) => {
	button.onclick = () => document.getElementById(button.dataset.close).close();
});
document.querySelectorAll("[data-filter]").forEach((button) => {
	button.onclick = () => {
		filter = button.dataset.filter;
		document.querySelectorAll("[data-filter]").forEach((item) => {
			item.classList.toggle("selected", item === button);
		});
		renderRuns();
	};
});
$("#search").oninput = renderRuns;
$("#runs-nav").onclick = () => {
	filter = "all";
	$("#search").value = "";
	document.querySelector('[data-filter="all"]').click();
};
$("#start-form").onsubmit = async (event) => {
	event.preventDefault();
	const form = event.currentTarget,
		button = form.querySelector('[type="submit"]');
	button.disabled = true;
	form.querySelector(".form-error").textContent = "";
	try {
		const values = Object.fromEntries(new FormData(form));
		values.inputs = Object.fromEntries(
			[...form.querySelectorAll("[data-launch-field]")].map((input) => [
				input.name,
				input.value,
			]),
		);
		for (const name of Object.keys(values.inputs)) delete values[name];
		if (!values.runner) delete values.runner;
		if (!values.model) delete values.model;
		if (!values.reasoningEffort) delete values.reasoningEffort;
		if (!values.modelVariant) delete values.modelVariant;
		const run = await api("/api/runs", {
			method: "POST",
			body: JSON.stringify(values),
		});
		selected = run.id;
		tab = "overview";
		detailSignature = "";
		$("#start-dialog").close();
		form.reset();
		await refresh();
	} catch (error) {
		form.querySelector(".form-error").textContent = error.message;
	} finally {
		button.disabled = false;
	}
};
$("#workflows-button").onclick = async () => {
	try {
		await loadConfig();
		$("#workflow-json").value = JSON.stringify(config.workflows, null, 2);
		renderDefaultWorkflowOptions(config.workflows, config.defaultWorkflow);
		$("#workflows-form .form-error").textContent = "";
		$("#roles-workflow").innerHTML = config.workflows
			.map(
				(workflow) =>
					`<option value="${htmlEscape(workflow.id)}">${htmlEscape(workflow.name)}</option>`,
			)
			.join("");
		$("#roles-workflow").value = "factory";
		renderRoleSettings();
		$("#workflows-dialog").showModal();
	} catch (error) {
		fail(error);
	}
};
function renderDefaultWorkflowOptions(
	definitions,
	selected = $("#default-workflow").value,
) {
	$("#default-workflow").innerHTML =
		'<option value="">Choose a default workflow</option>' +
		definitions
			.filter((workflow) => !workflow.internal)
			.map(
				(workflow) =>
					`<option value="${htmlEscape(workflow.id)}">${htmlEscape(workflow.name)}</option>`,
			)
			.join("");
	$("#default-workflow").value = selected;
}
function renderRoleSettings() {
	try {
		const definitions = JSON.parse($("#workflow-json").value);
		renderDefaultWorkflowOptions(definitions);
		const workflow = definitions.find(
			(item) => item.id === $("#roles-workflow").value,
		);
		const collect = (steps, prefix = "steps") =>
			steps.flatMap((step, index) => {
				const path = `${prefix}.${index}`;
				if (step.type === "agent") return [{ step, path }];
				if (step.type === "workflow") return [];
				return (step.groups ?? []).flatMap((group, groupIndex) =>
					collect(group, `${path}.groups.${groupIndex}`),
				);
			});
		const roles = collect(workflow.steps);
		$("#role-settings").innerHTML = roles.length
			? roles
					.map(({ step, path }) => {
						const runner = step.runner || config.defaultRunner;
						const advanced =
							runner === "opencode"
								? `<label><span class="sr-only">${htmlEscape(step.name)} model variant</span><input data-workflow="${htmlEscape(workflow.id)}" data-role="${path}" data-field="modelVariant" value="${htmlEscape(step.modelVariant ?? "")}" placeholder="Default variant" list="variant-suggestions"></label>`
								: `<label><span class="sr-only">${htmlEscape(step.name)} reasoning effort</span><select data-workflow="${htmlEscape(workflow.id)}" data-role="${path}" data-field="reasoningEffort" ${config.reasoningLevels?.[runner] ? "" : "disabled"}>${reasoningOptions(runner, step.reasoningEffort, config.reasoningLevels?.[runner] ? "Run/model effort" : "Native settings")}</select></label>`;
						return `<div class="role-row"><strong>${htmlEscape(step.name)}</strong><label><span class="sr-only">${htmlEscape(step.name)} agent</span><select data-workflow="${htmlEscape(workflow.id)}" data-role="${path}" data-field="runner"><option value="">Run default</option>${["claude", "codex", "gemini", "cursor", "opencode"].map((runner) => `<option value="${runner}" ${step.runner === runner ? "selected" : ""}>${runner}</option>`).join("")}</select></label><label><span class="sr-only">${htmlEscape(step.name)} model</span><input data-workflow="${htmlEscape(workflow.id)}" data-role="${path}" data-field="model" value="${htmlEscape(step.model ?? "")}" placeholder="Default model"></label>${advanced}</div>`;
					})
					.join("")
			: `<p class="hint">${workflow.id === "simple" ? "Simple uses the run’s agent and model with Cyrus’s existing behavior." : "This workflow has no own agent steps. Select a shared workflow above to configure its roles."}</p>`;
		document.querySelectorAll("[data-role]").forEach((input) => {
			input.onchange = () => {
				if (!input.isConnected) return; // Ignore blur/change from fields removed by a provider switch.
				const current = JSON.parse($("#workflow-json").value);
				const currentWorkflow = current.find(
					(item) => item.id === input.dataset.workflow,
				);
				const step = input.dataset.role
					.split(".")
					.reduce((value, key) => value[key], currentWorkflow);
				if (
					input.dataset.field === "modelVariant" &&
					(step.runner || config.defaultRunner) !== "opencode"
				)
					return;
				if (input.value.trim()) step[input.dataset.field] = input.value.trim();
				else delete step[input.dataset.field];
				if (input.dataset.field === "runner") {
					delete step.reasoningEffort;
					delete step.modelVariant;
				}
				$("#workflow-json").value = JSON.stringify(current, null, 2);
				if (input.dataset.field === "runner") renderRoleSettings();
			};
		});
	} catch (error) {
		$("#workflows-form .form-error").textContent = error.message;
	}
}
$("#roles-workflow").onchange = renderRoleSettings;
$("#workflow-json").onchange = renderRoleSettings;
$("#workflows-form").onsubmit = async (event) => {
	event.preventDefault();
	try {
		const saved = await api("/api/workflows", {
			method: "PUT",
			body: JSON.stringify({
				workflows: JSON.parse($("#workflow-json").value),
				defaultWorkflow: $("#default-workflow").value,
			}),
		});
		config.workflows = saved.workflows;
		config.defaultWorkflow = saved.defaultWorkflow;
		$("#workflows-dialog").close();
	} catch (error) {
		$("#workflows-form .form-error").textContent = error.message;
	}
};
let refreshing = false;
async function poll() {
	if (refreshing) return;
	refreshing = true;
	try {
		await refresh();
	} catch (error) {
		fail(error);
	} finally {
		refreshing = false;
	}
}
loadConfig().then(poll).catch(fail);
setInterval(poll, 2000);
