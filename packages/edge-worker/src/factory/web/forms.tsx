import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAction, useConfig } from "./client";
import { DraftNotice } from "./pwa-ui";
import { forgetDraft, revisionOf, useRestorableState } from "./restoration";
import { Button, Modal, useToast } from "./ui";

const triggerOptions = [
	["workflow", "Called by another workflow"],
	["manual", "Start manually"],
	["ticket-assignment", "Start from a Linear ticket"],
];
const runners = ["claude", "codex", "gemini", "cursor", "opencode"];
export function AgentSettings({
	value,
	onChange,
	config,
	label = "Run default",
	modelPlaceholder = "Repository default",
}: {
	value: any;
	onChange: (value: any) => void;
	config: any;
	label?: string;
	modelPlaceholder?: string;
}) {
	const runner = value.runner || config.defaultRunner;
	const set = (key: string, v: string) =>
		onChange({ ...value, [key]: v || undefined });
	return (
		<div className="agent-settings">
			<label>
				Agent
				<select
					value={value.runner ?? ""}
					onChange={(e) =>
						onChange({
							...value,
							runner: e.target.value || undefined,
							model: undefined,
							reasoningEffort: undefined,
							modelVariant: undefined,
							serviceTier: undefined,
						})
					}
				>
					<option value="">
						{label} ({config.defaultRunner})
					</option>
					{runners.map((r) => (
						<option key={r} value={r}>
							{r[0]!.toUpperCase() + r.slice(1)}
						</option>
					))}
				</select>
			</label>
			<label>
				Model
				<input
					value={value.model ?? ""}
					placeholder={modelPlaceholder}
					onChange={(e) => set("model", e.target.value)}
				/>
			</label>
			{runner === "opencode" ? (
				<label>
					Model variant
					<input
						value={value.modelVariant ?? ""}
						placeholder="Provider default"
						onChange={(e) => set("modelVariant", e.target.value)}
					/>
				</label>
			) : (
				<label>
					Reasoning
					<select
						value={value.reasoningEffort ?? ""}
						disabled={!config.reasoningLevels?.[runner]}
						onChange={(e) => set("reasoningEffort", e.target.value)}
					>
						<option value="">
							{config.reasoningLevels?.[runner]
								? "Model default"
								: "Native settings"}
						</option>
						{config.reasoningLevels?.[runner]?.map((level: string) => (
							<option key={level}>{level}</option>
						))}
					</select>
				</label>
			)}
			{config.serviceTierRunners?.includes(runner) && (
				<label>
					Service tier
					<select
						value={value.serviceTier ?? ""}
						onChange={(e) => set("serviceTier", e.target.value)}
					>
						<option value="">Default (native config)</option>
						<option value="standard">Standard</option>
						<option value="fast">Fast</option>
					</select>
					<small>
						Fast depends on model/account support and may cost more.
						{runner === "claude" ? " Requires compatible Opus." : ""}
					</small>
				</label>
			)}
		</div>
	);
}
function Field({
	field,
	value,
	onChange,
	main = false,
}: {
	field: any;
	value: string;
	onChange: (v: string) => void;
	main?: boolean;
}) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const fieldId = useId();
	useEffect(() => {
		if (main && ref.current) {
			void value;
			ref.current.style.height = "auto";
			ref.current.style.height = `${Math.min(220, ref.current.scrollHeight)}px`;
		}
	}, [value, main]);
	return (
		<label
			htmlFor={main ? "composer-input" : fieldId}
			className={main ? "composer-main" : ""}
		>
			<span className={main ? "sr-only" : ""}>
				{field.label}
				{!main && !field.required && " (optional)"}
			</span>
			{field.type === "select" ? (
				<select
					id={main ? "composer-input" : fieldId}
					required={field.required}
					value={value}
					onChange={(e) => onChange(e.target.value)}
				>
					<option value="">{field.placeholder ?? "Choose…"}</option>
					{field.options?.map((o: any) => (
						<option value={o.value} key={o.value}>
							{o.label}
						</option>
					))}
				</select>
			) : main || field.type === "textarea" ? (
				<textarea
					ref={ref}
					id={main ? "composer-input" : fieldId}
					rows={main ? 1 : 3}
					value={value}
					required={field.required}
					placeholder={
						main ? (field.placeholder ?? field.label) : field.placeholder
					}
					maxLength={field.name === "source" ? 1000 : 100000}
					onChange={(e) => onChange(e.target.value)}
				/>
			) : (
				<input
					id={fieldId}
					value={value}
					required={field.required}
					placeholder={field.placeholder}
					maxLength={field.name === "title" ? 300 : 100000}
					onChange={(e) => onChange(e.target.value)}
				/>
			)}
		</label>
	);
}
export function Composer({
	config,
	onStarted,
}: {
	config: any;
	onStarted: (id: string) => void;
}) {
	const toast = useToast(),
		navigate = useNavigate(),
		action = useAction();
	const [workflowId, setWorkflow] = useRestorableState(
			"composer/workflow",
			config.defaultWorkflow,
		),
		[repo, setRepo] = useRestorableState(
			"composer/repository",
			config.repositories[0]?.id ?? "",
		),
		[values, setValues, staleLaunch] = useRestorableState<
			Record<string, string>
		>(
			"composer/inputs",
			{},
			revisionOf([config.repositories, config.workflows]),
		),
		[settings, setSettings] = useRestorableState("composer/settings", {}),
		[agentOpen, setAgentOpen] = useRestorableState(
			"composer/agent-panel",
			false,
		);
	const workflows = config.workflows.filter((w: any) =>
			w.allowedTriggers.includes("manual"),
		),
		workflow = workflows.find((w: any) => w.id === workflowId),
		fields = workflow?.launchFields ?? [];
	const previousDefault = useRef(config.defaultWorkflow);
	useEffect(() => {
		if (config.defaultWorkflow !== previousDefault.current) {
			const oldDefault = previousDefault.current;
			setWorkflow((current: string) =>
				current === oldDefault ? config.defaultWorkflow : current,
			);
			previousDefault.current = config.defaultWorkflow;
		}
	}, [config.defaultWorkflow, setWorkflow]);
	const submit = async () => {
		if (action.isPending || !workflow || staleLaunch) return;
		try {
			const inputs = Object.fromEntries(
				fields.map((f: any) => [
					f.name,
					values[f.name] ?? f.defaultValue ?? "",
				]),
			);
			const run = await action.mutateAsync({
				path: "/api/runs",
				body: {
					repositoryId: repo,
					workflow: workflow.id,
					inputs,
					...settings,
				},
			});
			setValues({});
			onStarted(run.id);
			toast({
				text: "Bob's on it 🌈",
				action: "View",
				onAction: () => navigate(`/runs/${run.id}`),
			});
		} catch {
			/* mutation error is rendered inline */
		}
	};
	return (
		<section aria-label="Start a run">
			<DraftNotice conflict={staleLaunch} draftKey="composer/inputs" />
			<form
				className="composer"
				onSubmit={(e) => {
					e.preventDefault();
					void submit();
				}}
				onKeyDown={(e) => {
					if (
						e.key === "Enter" &&
						!e.shiftKey &&
						e.target === document.getElementById("composer-input")
					) {
						e.preventDefault();
						e.currentTarget.requestSubmit();
					}
				}}
			>
				{!workflow && (
					<p role="status" className="composer-hint">
						{workflows.length
							? "The selected recipe or saved default does not allow manual starts. Choose an eligible recipe below."
							: "No recipes allow manual starts."}{" "}
						<Link to="/recipes">Enable Start manually in Recipes</Link>.
					</p>
				)}
				{fields[0] && (
					<Field
						main
						field={fields[0]}
						value={values[fields[0].name] ?? fields[0].defaultValue ?? ""}
						onChange={(v) => setValues({ ...values, [fields[0].name]: v })}
					/>
				)}
				{fields.length > 1 && (
					<details className="composer-details" data-restore="composer-details">
						<summary>
							Add details{" "}
							<small>
								{fields
									.slice(1)
									.map((f: any) => f.label.toLowerCase())
									.join(", ")}
							</small>
						</summary>
						<div>
							{fields.slice(1).map((f: any) => (
								<Field
									key={f.name}
									field={f}
									value={values[f.name] ?? f.defaultValue ?? ""}
									onChange={(v) => setValues({ ...values, [f.name]: v })}
								/>
							))}
						</div>
					</details>
				)}
				{agentOpen && (
					<AgentSettings
						config={config}
						value={settings}
						onChange={setSettings}
						label="Default"
					/>
				)}
				<div className="composer-bar">
					<div
						className="workflow-chips"
						role="radiogroup"
						aria-label="Workflow"
						onKeyDown={(e) => {
							if (!["ArrowRight", "ArrowLeft"].includes(e.key)) return;
							e.preventDefault();
							if (!workflows.length) return;
							const index = Math.max(
									0,
									Array.from(e.currentTarget.children).indexOf(
										e.target as Element,
									),
								),
								next =
									(index +
										(e.key === "ArrowRight" ? 1 : -1) +
										workflows.length) %
									workflows.length;
							setWorkflow(workflows[next].id);
							(e.currentTarget.children[next] as HTMLElement).focus();
						}}
					>
						{workflows.map((w: any) => (
							// biome-ignore lint/a11y/useSemanticElements: button radio group implements arrow navigation and chip styling
							<button
								type="button"
								role="radio"
								aria-checked={w.id === workflow?.id}
								tabIndex={
									w.id === workflow?.id ||
									(!workflow && w.id === workflows[0]?.id)
										? 0
										: -1
								}
								key={w.id}
								onClick={() => setWorkflow(w.id)}
							>
								<span>{w.icon ?? "🧩"}</span>
								{w.name}
							</button>
						))}
					</div>
					<div className="composer-controls">
						<label className="repo-picker">
							<span className="sr-only">Repository</span>
							<span aria-hidden="true">📁</span>
							<select
								required
								value={repo}
								onChange={(e) => setRepo(e.target.value)}
							>
								{config.repositories.map((r: any) => (
									<option value={r.id} key={r.id}>
										{r.name}
									</option>
								))}
							</select>
						</label>
						<Button
							variant="icon"
							aria-label="Agent settings"
							aria-expanded={agentOpen}
							onClick={() => setAgentOpen(!agentOpen)}
						>
							⚙︎
						</Button>
						<Button
							type="submit"
							variant="start"
							aria-label="Start run"
							requiresConnection
							busy={action.isPending}
							disabled={
								staleLaunch ||
								!workflow ||
								!repo ||
								(fields[0]?.required &&
									(
										values[fields[0].name] ??
										fields[0].defaultValue ??
										""
									).trim() === "")
							}
						>
							↑
						</Button>
					</div>
				</div>
				{action.error && (
					<p className="error" role="alert">
						{action.error.message}
					</p>
				)}
			</form>
			<p className="composer-hint">
				{workflow?.description}
				<span className="keyboard-hint"> · ⏎ start · ⇧⏎ new line</span>
			</p>
		</section>
	);
}
function ownRoles(
	steps: any[],
	path: number[] = [],
): { step: any; path: number[] }[] {
	return steps.flatMap((step, i) =>
		step.type === "agent"
			? [{ step, path: [...path, i] }]
			: step.type === "fanout"
				? (step.groups ?? []).flatMap((group: any[], j: number) =>
						ownRoles(group, [...path, i, j]),
					)
				: [],
	);
}
function RunTitleSettings({ config }: { config: any }) {
	const draftKey = "recipe/title-settings";
	const [draft, setDraft, stale] = useRestorableState<
		{ value: any } | undefined
	>(draftKey, undefined, revisionOf(config.titleGeneration ?? {}));
	const value = draft?.value ?? config.titleGeneration ?? {};
	const dirty = draft !== undefined;
	const action = useAction(),
		toast = useToast();
	return (
		<section className="recipe" aria-labelledby="run-title-settings">
			<h2 id="run-title-settings">Run titles</h2>
			<DraftNotice conflict={stale} draftKey={draftKey} />
			<p>
				Choose a fast, inexpensive agent to name all new runs. Runs start with
				their ID while titles generate in the background. These settings are
				independent of execution agents.
			</p>
			<AgentSettings
				config={config}
				value={value}
				label="Global default"
				modelPlaceholder="Provider global default"
				onChange={(next) => {
					setDraft({ value: next });
				}}
			/>
			<Button
				requiresConnection
				disabled={!dirty || stale || action.isPending}
				onClick={() =>
					!stale &&
					void action
						.mutateAsync({
							path: "/api/title-settings",
							method: "PUT",
							body: value,
						})
						.then(() => {
							setDraft(undefined);
							forgetDraft(draftKey);
							toast({ text: "Run title settings saved" });
						})
						.catch(() => {})
				}
			>
				Save title settings
			</Button>
			{action.error && <p role="alert">{action.error.message}</p>}
		</section>
	);
}

export function Recipes() {
	const configQuery = useConfig(),
		toast = useToast(),
		action = useAction();
	const [editing, setEditing] = useRestorableState<any>(
			"recipe/editing",
			undefined,
		),
		[json, setJson, staleJson] = useRestorableState(
			"recipe/modal-json",
			"",
			configQuery.data ? revisionOf(configQuery.data.workflows) : undefined,
		),
		[role, setRole, staleRole] = useRestorableState<any>(
			"recipe/role",
			undefined,
			configQuery.data ? revisionOf(configQuery.data.workflows) : undefined,
		),
		[error, setError] = useState(""),
		[permissionTarget, setPermissionTarget] = useState<string>();
	const config = configQuery.data;
	async function save(
		definitions: any[],
		defaultWorkflow = config.defaultWorkflow,
		permissionId?: string,
	) {
		setPermissionTarget(permissionId);
		try {
			await action.mutateAsync({
				path: "/api/workflows",
				method: "PUT",
				body: { workflows: definitions, defaultWorkflow },
			});
			return true;
		} catch {
			return false;
		}
	}
	if (!config) return <p>Loading recipes…</p>;
	return (
		<>
			<h1>Recipes</h1>
			<DraftNotice conflict={staleJson} draftKey="recipe/modal-json" />
			<DraftNotice conflict={staleRole} draftKey="recipe/role" />
			<p className="intro">
				How Bob cooks each kind of run. Tune the agent per step; the default
				recipe is used when nothing else matches. Launch methods apply to new
				runs; existing runs retain their definitions.
			</p>
			<RunTitleSettings config={config} />
			<div className="recipes">
				{config.workflows.map((workflow: any) => (
					<article className="recipe" key={workflow.id}>
						<header>
							<button
								type="button"
								className="recipe-emoji"
								aria-label={`Edit ${workflow.name}`}
								onClick={() => {
									setEditing({ id: workflow.id, name: workflow.name });
									setJson(JSON.stringify(workflow, null, 2));
								}}
							>
								{workflow.icon ?? "🧩"}
							</button>
							<div>
								<h2>
									{workflow.name}
									{workflow.internal && (
										<small className="muted"> · shared</small>
									)}
								</h2>
								<p>{workflow.description}</p>
							</div>
							{
								<button
									type="button"
									className="default-pill"
									aria-pressed={config.defaultWorkflow === workflow.id}
									disabled={action.isPending || action.isBlocked}
									onClick={() =>
										void save(config.workflows, workflow.id).then((ok) => {
											if (ok)
												toast({
													text: `“${workflow.name}” is now the default`,
												});
										})
									}
								>
									{config.defaultWorkflow === workflow.id ? "●" : "○"} Default
								</button>
							}
						</header>
						<label className="recipe-chat">
							<input
								type="checkbox"
								checked={workflow.chat ?? false}
								disabled={action.isPending || action.isBlocked}
								onChange={(event) =>
									void save(
										config.workflows.map((w: any) =>
											w.id === workflow.id
												? { ...w, chat: event.target.checked }
												: w,
										),
									)
								}
							/>
							Enable chat steering
							{workflow.internal && workflow.chat === undefined && (
								<small>(inherits caller)</small>
							)}
						</label>
						<fieldset className="trigger-permissions">
							<legend>Launch methods</legend>
							{triggerOptions.map(([type, label]) => (
								<label key={type}>
									<input
										type="checkbox"
										checked={workflow.allowedTriggers.includes(type)}
										disabled={
											action.isPending ||
											(workflow.id === "simple" && type === "workflow")
										}
										onChange={(event) => {
											const allowedTriggers = event.target.checked
												? [...workflow.allowedTriggers, type]
												: workflow.allowedTriggers.filter(
														(t: string) => t !== type,
													);
											void save(
												config.workflows.map((w: any) =>
													w.id === workflow.id ? { ...w, allowedTriggers } : w,
												),
												config.defaultWorkflow,
												workflow.id,
											).then((ok) => {
												if (ok) toast({ text: "Launch methods saved" });
											});
										}}
									/>{" "}
									{label}
								</label>
							))}
							<small>
								Linear ticket starts cover assignments and @mentions.
							</small>
							{workflow.id === "simple" && (
								<small>
									Simple has no graph to call. Clone it under another ID with
									graph steps to customize.
								</small>
							)}
							{config.defaultWorkflow === workflow.id && (
								<small>
									Saved default:{" "}
									{workflow.allowedTriggers.includes("manual")
										? "manual starts allowed"
										: "manual starts rejected"}
									;{" "}
									{workflow.allowedTriggers.includes("ticket-assignment")
										? "ticket starts allowed"
										: "ticket starts rejected"}
									.
								</small>
							)}
							{permissionTarget === workflow.id && action.error && (
								<p className="error" role="alert">
									{action.error.message}
								</p>
							)}
						</fieldset>
						<div className="recipe-columns">
							<section>
								<small>INGREDIENTS</small>
								<ul>
									{workflow.launchFields?.map((f: any) => (
										<li key={f.name}>
											{f.label}
											{f.required && <span className="required"> *</span>}
										</li>
									))}
								</ul>
								{!workflow.launchFields?.length && (
									<p className="muted">Shared sequence</p>
								)}
							</section>
							<section>
								<small>METHOD</small>
								<div className="recipe-method">
									{workflow.steps.map((step: any) => (
										<div key={step.id}>
											<span>
												{step.type === "workflow"
													? "🧩"
													: step.type === "agent"
														? "✦"
														: "⚙️"}{" "}
												{step.name}
											</span>
											{step.type === "agent" ? (
												<Button
													variant="agent-pill"
													onClick={() =>
														setRole({
															workflowId: workflow.id,
															stepId: step.id,
															value: structuredClone(step),
														})
													}
												>
													{step.runner ?? "Run default"}
												</Button>
											) : (
												<small className="muted">
													{step.type === "workflow"
														? `shared: ${step.workflow}`
														: "auto"}
												</small>
											)}
											{step.type === "fanout" &&
												ownRoles([step]).map(({ step: child }) => (
													<Button
														key={child.id}
														variant="agent-pill"
														onClick={() =>
															setRole({
																workflowId: workflow.id,
																stepId: child.id,
																value: structuredClone(child),
															})
														}
													>
														{child.name}: {child.runner ?? "Run default"}
													</Button>
												))}
										</div>
									))}
								</div>
							</section>
						</div>
						<details data-restore={`recipe-${workflow.id}`}>
							<summary>Edit as JSON</summary>
							<RecipeEditor
								workflow={workflow}
								onSave={async (value: any) => {
									const definitions = config.workflows.map((w: any) =>
										w.id === workflow.id ? value : w,
									);
									const ok = await save(definitions);
									if (ok) toast({ text: "Recipe saved" });
									return ok;
								}}
							/>
						</details>
					</article>
				))}
			</div>
			{!permissionTarget && action.error && (
				<p className="error" role="alert">
					{action.error.message}
				</p>
			)}
			<Button
				variant="new-recipe"
				onClick={() => {
					const next = {
						id: `recipe-${Date.now()}`,
						icon: "🧩",
						name: "New recipe",
						description: "",
						labels: [],
						allowedTriggers: ["workflow", "manual", "ticket-assignment"],
						steps: [
							{
								id: "work",
								name: "Work",
								type: "agent",
								prompt:
									"Implement the requested task. Return JSON with summary and checks.",
							},
						],
					};
					setEditing({ id: next.id, name: next.name });
					setJson(JSON.stringify(next, null, 2));
				}}
			>
				＋ New recipe
			</Button>
			<Modal
				open={Boolean(editing)}
				onOpenChange={(o) => {
					if (!o) {
						setEditing(undefined);
						setError("");
					}
				}}
				title={editing?.name ?? "Edit recipe"}
			>
				<form
					className="modal-body"
					onSubmit={(e) => {
						e.preventDefault();
						try {
							if (staleJson) return;
							const value = JSON.parse(json),
								exists = config.workflows.some((w: any) => w.id === editing.id);
							void save(
								exists
									? config.workflows.map((w: any) =>
											w.id === editing.id ? value : w,
										)
									: [...config.workflows, value],
							).then((ok) => {
								if (ok) {
									setEditing(undefined);
									setJson("");
									toast({ text: "Recipe saved" });
								}
							});
						} catch (err) {
							setError((err as Error).message);
						}
					}}
				>
					<DraftNotice conflict={staleJson} draftKey="recipe/modal-json" />
					<label>
						Icon
						<input
							value={(() => {
								try {
									return JSON.parse(json).icon ?? "";
								} catch {
									return "";
								}
							})()}
							onChange={(e) => {
								try {
									setJson(
										JSON.stringify(
											{ ...JSON.parse(json), icon: e.target.value },
											null,
											2,
										),
									);
								} catch {
									setError("Fix JSON before editing the icon");
								}
							}}
						/>
					</label>
					<label>
						Workflow JSON
						<textarea
							className="code-editor"
							rows={18}
							value={json}
							onChange={(e) => setJson(e.target.value)}
						/>
					</label>
					<p role="alert">{error || action.error?.message}</p>
					<Button
						type="submit"
						requiresConnection
						disabled={staleJson}
						busy={action.isPending}
					>
						Save recipe
					</Button>
				</form>
			</Modal>
			<Modal
				open={Boolean(role)}
				onOpenChange={(o) => {
					if (!o) setRole(undefined);
				}}
				title={role?.value.name ?? "Agent settings"}
				description="Only this workflow owns these settings. Parents use the shared recipe's configuration."
			>
				<div className="modal-body">
					<DraftNotice conflict={staleRole} draftKey="recipe/role" />
					{role && (
						<AgentSettings
							config={config}
							value={role.value}
							onChange={(value) => setRole({ ...role, value })}
						/>
					)}
					<Button
						requiresConnection
						disabled={staleRole}
						busy={action.isPending}
						onClick={() => {
							if (staleRole) return;
							const replace = (steps: any[]): any[] =>
								steps.map((s) =>
									s.id === role.stepId
										? role.value
										: s.groups
											? { ...s, groups: s.groups.map(replace) }
											: s,
								);
							void save(
								config.workflows.map((w: any) =>
									w.id === role.workflowId
										? { ...w, steps: replace(w.steps) }
										: w,
								),
							).then((ok) => {
								if (ok) {
									setRole(undefined);
									toast({ text: "Step settings saved" });
								}
							});
						}}
					>
						Save step settings
					</Button>
				</div>
			</Modal>
		</>
	);
}
function RecipeEditor({
	workflow,
	onSave,
}: {
	workflow: any;
	onSave: (v: any) => Promise<boolean>;
}) {
	const [text, setText, stale] = useRestorableState(
			`recipe/json/${workflow.id}`,
			JSON.stringify(workflow, null, 2),
			revisionOf(workflow),
		),
		[error, setError] = useState(""),
		[busy, setBusy] = useState(false);
	const previous = useRef(workflow);
	useEffect(() => {
		const saved = previous.current;
		setText((current) => {
			try {
				const draft = JSON.parse(current);
				for (const key of ["allowedTriggers", "steps"]) {
					if (
						!stale &&
						JSON.stringify(draft[key]) === JSON.stringify(saved[key])
					)
						draft[key] = workflow[key];
				}
				return JSON.stringify(draft, null, 2);
			} catch {
				return current;
			}
		});
		previous.current = workflow;
	}, [workflow, stale, setText]);
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				try {
					if (stale) return;
					const value = JSON.parse(text);
					setBusy(true);
					void onSave(value)
						.then((ok) => {
							if (ok) forgetDraft(`recipe/json/${workflow.id}`);
						})
						.finally(() => setBusy(false));
					setError("");
				} catch (err) {
					setError((err as Error).message);
				}
			}}
		>
			<DraftNotice conflict={stale} draftKey={`recipe/json/${workflow.id}`} />
			<label className="sr-only" htmlFor={`json-${workflow.id}`}>
				Workflow JSON for {workflow.name}
			</label>
			<textarea
				id={`json-${workflow.id}`}
				className="code-editor"
				rows={12}
				value={text}
				onChange={(e) => setText(e.target.value)}
			/>
			<p role="alert">{error}</p>
			<Button type="submit" requiresConnection disabled={stale} busy={busy}>
				Save
			</Button>
		</form>
	);
}
