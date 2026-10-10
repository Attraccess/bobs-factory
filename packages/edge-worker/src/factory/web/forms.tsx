import { useEffect, useId, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { passiveTools } from "../CapacityPolicy";
import type { ExecutionSelection } from "../ExecutionProfiles";
import { api, useAction, useConfig } from "./client";
import { ExecutionSelectors } from "./execution";
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
		config.workflows.map(
			({
				enabled: _enabled,
				unavailable: _unavailable,
				ownership: _ownership,
				provenance: _provenance,
				...definition
			}: any) => definition,
		),
		config.defaultWorkflow,
		config.defaultRunner,
		config.reasoningLevels,
		config.serviceTierRunners,
		config.executionProfiles,
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
		[execution, setExecution] = useFormState<ExecutionSelection>(
			inputContext,
			{},
		),
		[agentOpen, setAgentOpen] = useFormState(inputContext, false);
	const workflows = config.workflows.filter(
			(w: any) =>
				w.enabled !== false &&
				!w.unavailable?.length &&
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
					repositoryIds: config.repositories.find(
						(item: any) => item.id === repo,
					)?.repositoryIds,
					workflow: workflow.id,
					inputs,
					...settings,
					execution,
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
				<ExecutionSelectors
					key={inputContext}
					config={config}
					repositoryId={repo}
					workflow={workflow?.id}
					model={(settings as any).model}
					value={execution}
					onChange={setExecution}
					runner={(settings as any).runner}
				/>
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
	path: (string | number)[] = [],
): { step: any; path: (string | number)[] }[] {
	return steps.flatMap((step, i) =>
		step.type === "agent"
			? [{ step, path: [...path, i] }]
			: step.type === "fanout"
				? (step.groups ?? []).flatMap((group: any[], j: number) =>
						ownRoles(group, [...path, i, "groups", j]),
					)
				: [],
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
export function Recipes() {
	const configQuery = useConfig(),
		toast = useToast();
	const config = configQuery.data;
	const definitions = revisionOf(config?.workflows);
	const [disabling, setDisabling] = useFormState<any>(definitions, undefined),
		[editing, setEditing] = useFormState<any>(definitions, undefined),
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
				recipe is used when nothing else matches. Bundled behavior comes from
				the installed runtime. Fork Factory or Takeover to edit their graph.
				Launch methods apply to new runs; existing runs retain their
				definitions.
			</p>
			<p className="muted">
				Factory-wide profiles, defaults, capacity and run titles are in{" "}
				<Link to="/settings">Settings</Link>.
			</p>
			{Object.entries(
				config.workflowConfiguration?.migration?.conflicts ?? {},
			).map(([id, message]) => (
				<div key={id} className="error" role="alert">
					<p>
						{id === "simple" ? "Simple" : id}: {String(message)}
					</p>
					{id === "simple" && (
						<Button
							requiresConnection
							type="button"
							disabled={action.isPending}
							onClick={() =>
								void action
									.mutateAsync({
										path: "/api/workflows/simple/resolve-migration",
										method: "POST",
										body: { useBundledSimple: true },
									})
									.catch(() => {})
							}
						>
							Use bundled native Simple
						</Button>
					)}
				</div>
			))}
			{config.workflowConfiguration?.migration && (
				<p className="muted">
					Original configuration backup:{" "}
					{config.workflowConfiguration.migration.backup}. Preserved custom IDs:{" "}
					{JSON.stringify(config.workflowConfiguration.migration.mappings)}.
					Update external ticket selectors to use the preserved custom IDs.
				</p>
			)}
			{(config.workflowConfiguration?.inactive ?? []).map(
				(item: any, index: number) => (
					<InactivePreference
						key={`${item.workflow}/${item.role}`}
						item={item}
						index={index}
						config={config}
					/>
				),
			)}
			<div className="recipes">
				{config.workflows.map((workflow: any) => (
					<article className="recipe" key={workflow.id}>
						<header>
							<button
								type="button"
								className="recipe-emoji"
								aria-label={`${workflow.ownership === "bundled" ? "Inspect" : "Edit"} ${workflow.name}`}
								onClick={() => {
									setEditing({
										id: workflow.id,
										name: workflow.name,
										readonly: workflow.ownership === "bundled",
									});
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
								<small>
									{workflow.ownership === "bundled"
										? "Bundled · behavior read-only"
										: "Local · editable"}
									{workflow.provenance &&
										` · ${workflow.provenance.kind} of ${workflow.provenance.source}`}
								</small>
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
						<div className="actions">
							<Button
								requiresConnection
								disabled={action.isPending}
								onClick={() => {
									if (workflow.enabled === false)
										void action
											.mutateAsync({
												path: `/api/workflows/${workflow.id}/availability`,
												method: "PUT",
												body: { enabled: true },
											})
											.catch(() => {});
									else
										void api<any>(`/api/workflows/${workflow.id}/availability`)
											.then((impact) => setDisabling({ workflow, impact }))
											.catch((error) => setError(error.message));
								}}
							>
								{workflow.enabled === false ? "Enable" : "Disable"}
							</Button>
							{["factory", "takeover"].includes(workflow.id) && (
								<Button
									requiresConnection
									disabled={action.isPending}
									onClick={() =>
										void action
											.mutateAsync({
												path: `/api/workflows/${workflow.id}/fork`,
											})
											.then(() =>
												toast({ text: "Private editable fork created" }),
											)
											.catch(() => {})
									}
								>
									Fork
								</Button>
							)}
							{workflow.id === "simple" && (
								<Button
									onClick={() =>
										setRole({
											workflowId: "simple",
											stepId: "native",
											path: [],
											value: {
												name: "Simple agent",
												...(config.workflowConfiguration?.preferences?.simple
													?.native ?? {}),
											},
										})
									}
								>
									Agent settings
								</Button>
							)}
						</div>
						{!!workflow.unavailable?.length && (
							<p className="error">
								Unavailable: {workflow.unavailable.join(", ")}. Enable the
								dependency or edit a local graph. A disabled default rejects
								launches; choose another default to route new work.
							</p>
						)}
						<RecipeLabels
							workflow={workflow}
							pending={action.isPending}
							onSave={(labels) =>
								save(
									config.workflows.map((w: any) =>
										w.id === workflow.id ? { ...w, labels } : w,
									),
								)
							}
						/>

						<label className="recipe-chat">
							<input
								type="checkbox"
								checked={workflow.chat ?? false}
								disabled={
									workflow.ownership === "bundled" ||
									action.isPending ||
									action.isBlocked
								}
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
									Simple uses native conversations and cannot be forked or
									called by another workflow.
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
									{workflow.steps.map((step: any, stepIndex: number) => (
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
															path: [stepIndex],
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
												ownRoles([step]).map(({ step: child, path }) => (
													<Button
														key={child.id}
														variant="agent-pill"
														onClick={() =>
															setRole({
																workflowId: workflow.id,
																stepId: child.id,
																path: [stepIndex, ...path.slice(1)],
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
						{workflow.ownership !== "bundled" && (
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
						)}
						<RecipeDetails workflow={workflow}>
							<RecipeEditor
								workflow={workflow}
								pending={action.isPending}
								readonly={workflow.ownership === "bundled"}
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
				open={!!disabling}
				onOpenChange={(open) => {
					if (!open) setDisabling(undefined);
				}}
				title="Disable workflow"
				description="Executing work will be interrupted. Saved progress and native conversations are retained. Actions already performed cannot be undone. Re-enabling permits new launches; each blocked run requires its own Resume action."
			>
				<div className="modal-body">
					<p>
						{disabling?.workflow.name}: {disabling?.impact.runs.length ?? 0}{" "}
						unfinished runs may be interrupted.
					</p>
					<ul>
						{disabling?.impact.runs.map((id: string) => (
							<li key={id}>
								<Link to={`/runs/${id}`}>{id}</Link>
							</li>
						))}
					</ul>
					{action.error && (
						<p role="alert" className="error">
							{action.error.message}
						</p>
					)}
					<Button
						requiresConnection
						busy={action.isPending}
						onClick={() =>
							void action
								.mutateAsync({
									path: `/api/workflows/${disabling.workflow.id}/availability`,
									method: "PUT",
									body: {
										enabled: false,
										confirm: true,
										token: disabling.impact.token,
									},
								})
								.then(() => setDisabling(undefined))
								.catch(() => {})
						}
					>
						Interrupt work and disable
					</Button>
				</div>
			</Modal>

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
					{!editing?.readonly && (
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
					)}
					<label>
						Workflow JSON
						<textarea
							className="code-editor"
							rows={18}
							value={json}
							readOnly={editing?.readonly}
							onChange={(e) => setJson(e.target.value)}
						/>
					</label>
					<p role="alert">{error || action.error?.message}</p>
					<Button
						type="submit"
						requiresConnection
						disabled={editing?.readonly || action.isPending}
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
					{role &&
						config.workflows.find((w: any) => w.id === role.workflowId)
							?.ownership !== "bundled" && (
							<>
								<label>
									Role prompt
									<textarea
										value={role.value.prompt ?? ""}
										onChange={(e) =>
											setRole({
												...role,
												value: { ...role.value, prompt: e.target.value },
											})
										}
										rows={8}
									/>
								</label>
								<label>
									Output contract
									<select
										value={role.value.reviewContract ?? ""}
										onChange={(e) =>
											setRole({
												...role,
												value: {
													...role.value,
													reviewContract: e.target.value || undefined,
												},
											})
										}
									>
										<option value="">Legacy / custom output</option>
										<option value="inventory-v1">Requirement inventory</option>
										<option value="specialist-v1">Specialist findings</option>
										<option value="coverage-v1">
											Findings and complete requirement coverage
										</option>
									</select>
								</label>
								{role.value.id === "guide" && (
									<label>
										Review format
										<select
											value={role.value.guideContract ?? ""}
											onChange={(e) =>
												setRole({
													...role,
													value: {
														...role.value,
														guideContract: e.target.value || undefined,
													},
												})
											}
										>
											<option value="brief-v1">
												Review brief (requirement-first)
											</option>
											<option value="">Chapter guide (legacy)</option>
										</select>
									</label>
								)}
								{role.value.id === "guide" && (
									<p className="muted">
										The role prompt must ask for the selected format. Saved runs
										keep the format they started with.
									</p>
								)}
								<label>
									<input
										type="checkbox"
										checked={role.value.json !== false}
										onChange={(e) =>
											setRole({
												...role,
												value: { ...role.value, json: e.target.checked },
											})
										}
									/>{" "}
									Structured JSON output
								</label>
								{role.value.reviewContract && (
									<p className="muted">
										Review contracts require structured JSON. Replace the
										coverage supplier before removing it. Add or remove
										reviewers in the recipe JSON; up to eight fanout groups.
									</p>
								)}
							</>
						)}
					{role &&
						config.workflows.find((w: any) => w.id === role.workflowId)
							?.ownership === "bundled" &&
						role.value.prompt && (
							<label>
								Bundled role prompt
								<textarea readOnly rows={8} value={role.value.prompt} />
							</label>
						)}
					{action.error && (
						<p className="error" role="alert">
							{action.error.message}
						</p>
					)}
					<Button
						requiresConnection
						disabled={action.isPending}
						busy={action.isPending}
						onClick={() => {
							if (action.isPending || !role?.path) return;
							if (role.stepId === "native") {
								const keys = [
									"runner",
									"model",
									"reasoningEffort",
									"modelVariant",
									"serviceTier",
								];
								const settings = Object.fromEntries(
									keys
										.filter((k) => role.value[k] !== undefined)
										.map((k) => [k, role.value[k]]),
								);
								void action
									.mutateAsync({
										path: "/api/workflows/simple/preferences",
										method: "PUT",
										body: { native: settings },
									})
									.then(() => setRole(undefined))
									.catch(() => {});
								return;
							}
							const definitions = structuredClone(config.workflows);
							const workflow = definitions.find(
								(w: any) => w.id === role.workflowId,
							);
							let node = workflow.steps;
							for (const part of role.path.slice(0, -1)) node = node[part];
							node[role.path.at(-1)] = role.value;
							void save(definitions).then((ok) => {
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
			<summary>
				{workflow.ownership === "bundled" ? "Inspect JSON" : "Edit as JSON"}
			</summary>
			{open ? children : null}
		</details>
	);
}
function RecipeEditor({
	workflow,
	onSave,
	pending,
	readonly = false,
}: {
	readonly?: boolean;
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
					if (readonly || busy || pending) return;
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
				readOnly={readonly}
				rows={12}
				value={text}
				onChange={(e) => setText(e.target.value)}
			/>
			<p role="alert">{error}</p>
			<Button
				type="submit"
				requiresConnection
				disabled={readonly || pending || busy}
				busy={pending || busy}
			>
				Save
			</Button>
		</form>
	);
}

function RecipeLabels({
	workflow,
	pending,
	onSave,
}: {
	workflow: any;
	pending: boolean;
	onSave: (labels: string[]) => Promise<boolean>;
}) {
	const [value, setValue] = useFormState(
		revisionOf(workflow),
		workflow.labels.join(", "),
	);
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				void onSave(
					value
						.split(",")
						.map((v: string) => v.trim())
						.filter(Boolean),
				);
			}}
		>
			<label>
				Routing labels
				<input
					value={value}
					onChange={(event) => setValue(event.target.value)}
				/>
			</label>
			<Button type="submit" requiresConnection disabled={pending}>
				Save labels
			</Button>
		</form>
	);
}
function InactivePreference({
	item,
	index,
	config,
}: {
	item: any;
	index: number;
	config: any;
}) {
	const action = useAction("workflows"),
		[target, setTarget] = useFormState(revisionOf(config), "");
	const roles = config.workflows
		.filter((w: any) => w.ownership === "bundled")
		.flatMap((w: any) =>
			w.id === "simple"
				? [{ value: "simple/native", name: "Simple agent" }]
				: ownRoles(w.steps).map(({ step }: any) => ({
						value: `${w.id}/${semanticRole(w.steps, step.id)}`,
						name: `${w.name}: ${step.name}`,
					})),
		);
	return (
		<div className="recipe">
			<p>
				Inactive preference: {item.workflow}/{item.role}. {item.reason}
			</p>
			<pre>{JSON.stringify(item.settings)}</pre>
			<label>
				Reassign to
				<select value={target} onChange={(e) => setTarget(e.target.value)}>
					<option value="">Choose a role</option>
					{roles.map((r: any) => (
						<option key={r.value} value={r.value}>
							{r.name}
						</option>
					))}
				</select>
			</label>
			<Button
				requiresConnection
				disabled={!target || action.isPending}
				onClick={() => {
					const [workflow, ...role] = target.split("/");
					void action
						.mutateAsync({
							path: `/api/workflow-preferences/inactive/${index}`,
							body: { target: { workflow, role: role.join("/") } },
						})
						.catch(() => {});
				}}
			>
				Reassign
			</Button>
			<Button
				requiresConnection
				disabled={action.isPending}
				onClick={() =>
					void action
						.mutateAsync({
							path: `/api/workflow-preferences/inactive/${index}`,
						})
						.catch(() => {})
				}
			>
				Remove
			</Button>
			{action.error && <p role="alert">{action.error.message}</p>}
		</div>
	);
}
function semanticRole(steps: any[], id: string, parent = ""): string {
	for (const step of steps) {
		const key = `${parent}${step.id}`;
		if (step.id === id) return key;
		for (const group of step.groups ?? []) {
			const role = semanticRole(group, id, `${key}/`);
			if (role) return role;
		}
	}
	return "";
}
