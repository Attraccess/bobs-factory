import { useEffect, useId, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { passiveTools } from "../CapacityPolicy";
import { useAction, useConfig } from "./client";
import { useCurrentForm, useFormState } from "./form-state";
import { revisionOf } from "./restoration";
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
		navigate = useNavigate();
	const launchConfig = revisionOf([
		config.repositories,
		config.workflows,
		config.defaultWorkflow,
		config.defaultRunner,
		config.reasoningLevels,
		config.serviceTierRunners,
	]);
	const [workflowId, setWorkflow] = useFormState(
			launchConfig,
			config.defaultWorkflow,
		),
		[repo, setRepo] = useFormState(
			launchConfig,
			config.repositories[0]?.id ?? "",
		);
	const inputContext = `${launchConfig}/${repo}/${workflowId}`;
	const action = useAction("launch", inputContext);
	const isCurrent = useCurrentForm(inputContext);
	const [values, setValues] = useFormState<Record<string, string>>(
			inputContext,
			{},
		),
		[settings, setSettings] = useFormState(inputContext, {}),
		[agentOpen, setAgentOpen] = useFormState(inputContext, false);
	const workflows = config.workflows.filter((w: any) =>
			w.allowedTriggers.includes("manual"),
		),
		workflow = workflows.find((w: any) => w.id === workflowId),
		fields = workflow?.launchFields ?? [];
	const submit = async () => {
		if (action.isPending || !workflow) return;
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
			if (!isCurrent()) return;
			setValues((current) =>
				JSON.stringify(current) === JSON.stringify(values) ? {} : current,
			);
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
function MachineCapacitySettings({ config }: { config: any }) {
	const capacity = config.capacity;
	const action = useAction("capacity", revisionOf(capacity?.limit));
	const [draft, setDraft] = useFormState<{ limit: string } | undefined>(
		revisionOf(capacity?.limit),
		undefined,
	);
	const limit = draft?.limit ?? String(capacity?.limit ?? 4);
	if (!capacity) return null;
	return (
		<section className="recipe" aria-labelledby="machine-capacity">
			<h2 id="machine-capacity">Instance capacity</h2>
			<p>
				One pool for this Bob’s Factory instance’s agents and intensive workflow
				steps. Default: {capacity.defaultLimit} slots.
			</p>
			<p role="status">
				Instance limit: {capacity.limit}{" "}
				{capacity.limit === 1 ? "slot" : "slots"}. {capacity.active} executing ·{" "}
				{capacity.stopping} stopping · {capacity.queued} waiting for capacity
			</p>
			{capacity.error && <p role="alert">{capacity.error}</p>}
			{capacity.conflict && <p role="alert">{capacity.conflict}</p>}
			<form
				onSubmit={async (event) => {
					event.preventDefault();
					if (action.isPending) return;
					try {
						await action.mutateAsync({
							path: "/api/capacity",
							method: "PUT",
							body: { limit: Number(limit) },
						});
						setDraft(undefined);
					} catch {}
				}}
			>
				<label>
					Instance slot limit{" "}
					<input
						type="number"
						min="1"
						step="1"
						required
						disabled={action.isPending}
						value={limit}
						onChange={(event) => {
							setDraft({ limit: event.target.value });
						}}
					/>
				</label>
				<Button
					type="submit"
					requiresConnection
					disabled={draft === undefined || action.isPending}
				>
					Save instance limit
				</Button>
				{action.error && <p role="alert">{action.error.message}</p>}
			</form>
		</section>
	);
}
function CapacityClassification({
	disabled,
	steps,
	onSave,
	path = "",
}: {
	disabled: boolean;
	steps: any[];
	onSave: (path: string, value: boolean | undefined) => Promise<unknown>;
	path?: string;
}) {
	return (
		<div className="capacity-classification">
			{steps.map((step: any, index: number) => {
				const key = `${path}${index}`;
				const heavy = step.type === "script" || step.tool === "exec";
				return (
					<div key={key}>
						{["script", "tool"].includes(step.type) && (
							<label>
								{step.name} capacity{" "}
								<select
									aria-label={`${step.name} capacity`}
									disabled={disabled}
									value={
										step.computeIntensive === undefined
											? "default"
											: String(step.computeIntensive)
									}
									onChange={(event) => {
										void onSave(
											key,
											event.target.value === "default"
												? undefined
												: event.target.value === "true",
										);
									}}
								>
									<option value="default">
										Default ({heavy ? "one slot" : "lightweight"})
									</option>
									<option
										value="true"
										disabled={passiveTools.includes(step.tool ?? "")}
									>
										Intensive (one slot)
									</option>
									<option value="false">Lightweight (no slot)</option>
								</select>
							</label>
						)}
						{(step.groups ?? []).map((group: any[], branch: number) => (
							<CapacityClassification
								disabled={disabled}
								key={branch}
								steps={group}
								path={`${key}/groups/${branch}/`}
								onSave={onSave}
							/>
						))}
					</div>
				);
			})}
		</div>
	);
}
function RunTitleSettings({ config }: { config: any }) {
	const [draft, setDraft] = useFormState<{ value: any } | undefined>(
		revisionOf(config.titleGeneration ?? {}),
		undefined,
	);
	const value = draft?.value ?? config.titleGeneration ?? {};
	const dirty = draft !== undefined;
	const action = useAction(
			"title-settings",
			revisionOf(config.titleGeneration ?? {}),
		),
		toast = useToast();
	return (
		<section className="recipe" aria-labelledby="run-title-settings">
			<h2 id="run-title-settings">Run titles</h2>
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
				disabled={!dirty || action.isPending}
				onClick={() =>
					void action
						.mutateAsync({
							path: "/api/title-settings",
							method: "PUT",
							body: value,
						})
						.then(() => {
							setDraft(undefined);
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
		toast = useToast();
	const config = configQuery.data;
	const definitions = revisionOf(config?.workflows);
	const [editing, setEditing] = useFormState<any>(definitions, undefined),
		[json, setJson] = useFormState(definitions, ""),
		[role, setRole] = useFormState<any>(definitions, undefined),
		[error, setError] = useFormState(
			`${definitions}/${editing?.id ?? "closed"}/${role?.stepId ?? "closed"}`,
			"",
		),
		[permissionTarget, setPermissionTarget] = useFormState<string | undefined>(
			definitions,
			undefined,
		);
	const modalContext = `${definitions}/${editing?.id ?? "closed"}/${role?.workflowId ?? ""}/${role?.stepId ?? "closed"}`;
	const action = useAction("workflows", modalContext);
	const isCurrent = useCurrentForm(modalContext);

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
			<p className="intro">
				How Bob cooks each kind of run. Tune the agent per step; the default
				recipe is used when nothing else matches. Launch methods apply to new
				runs; existing runs retain their definitions.
			</p>
			<div className="recipe-settings">
				<MachineCapacitySettings config={config} />
				<RunTitleSettings config={config} />
			</div>
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
						<CapacityClassification
							disabled={action.isPending}
							steps={workflow.steps}
							onSave={async (path, computeIntensive) => {
								const definitions = structuredClone(config.workflows);
								let node: any = definitions.find(
									(item: any) => item.id === workflow.id,
								).steps;
								for (const part of path.split("/")) node = node[part];
								node.computeIntensive = computeIntensive;
								await save(definitions);
							}}
						/>
						<RecipeDetails workflow={workflow}>
							<RecipeEditor
								workflow={workflow}
								pending={action.isPending}
								onSave={async (value: any) => {
									const definitions = config.workflows.map((w: any) =>
										w.id === workflow.id ? value : w,
									);
									const ok = await save(definitions);
									if (ok) toast({ text: "Recipe saved" });
									return ok;
								}}
							/>
						</RecipeDetails>
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
						setJson("");
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
							if (action.isPending) return;
							const value = JSON.parse(json),
								exists = config.workflows.some((w: any) => w.id === editing.id);
							void save(
								exists
									? config.workflows.map((w: any) =>
											w.id === editing.id ? value : w,
										)
									: [...config.workflows, value],
							).then((ok) => {
								if (ok && isCurrent()) {
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
						disabled={action.isPending}
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
					{role && (
						<AgentSettings
							config={config}
							value={role.value}
							onChange={(value) => setRole({ ...role, value })}
						/>
					)}
					<Button
						requiresConnection
						disabled={action.isPending}
						busy={action.isPending}
						onClick={() => {
							if (action.isPending || !role) return;
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
								if (ok && isCurrent()) {
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
function RecipeDetails({
	workflow,
	children,
}: {
	workflow: any;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useFormState(revisionOf(workflow), false);
	return (
		<details
			open={open}
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			<summary>Edit as JSON</summary>
			{open ? children : null}
		</details>
	);
}
function RecipeEditor({
	workflow,
	onSave,
	pending,
}: {
	workflow: any;
	onSave: (v: any) => Promise<boolean>;
	pending: boolean;
}) {
	const context = revisionOf(workflow);
	const [text, setText] = useFormState(
			context,
			JSON.stringify(workflow, null, 2),
		),
		[error, setError] = useFormState(context, ""),
		[busy, setBusy] = useFormState(context, false);
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				try {
					if (busy || pending) return;
					const value = JSON.parse(text);
					setBusy(true);
					void onSave(value).finally(() => setBusy(false));
					setError("");
				} catch (err) {
					setError((err as Error).message);
				}
			}}
		>
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
			<Button
				type="submit"
				requiresConnection
				disabled={pending || busy}
				busy={pending || busy}
			>
				Save
			</Button>
		</form>
	);
}
