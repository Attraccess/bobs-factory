import { Navigate, NavLink, useNavigate, useParams } from "react-router-dom";
import { AccessSettings } from "./auth";
import { useAction, useConfig } from "./client";
import { ExecutionEditor } from "./execution";
import { useFormState } from "./form-state";
import { AgentSettings } from "./forms";
import { Onboarding } from "./onboarding";
import { revisionOf } from "./restoration";
import { Button, useToast } from "./ui";
import { UpdateSettings } from "./updates";

const pages = [
	{
		id: "updates",
		name: "Updates",
		description: "Release channel, policy and pending installation",
	},
	{
		id: "setup",
		name: "Project setup",
		description: "Project, coding agent and GitHub",
	},
	{ id: "access", name: "Access", description: "Passkeys and sign-out" },
	{
		id: "execution",
		name: "Execution defaults",
		description: "Factory and repository choices",
	},
	{
		id: "identities",
		name: "Identity profiles",
		description: "Git, accounts and authentication",
	},
	{
		id: "tools",
		name: "Tool profiles",
		description: "MCP servers and permissions",
	},
	{
		id: "capacity",
		name: "Instance capacity",
		description: "Instance execution slot limit",
	},
	{
		id: "titles",
		name: "Run titles",
		description: "Agent for naming new runs",
	},
] as const;

export function Settings() {
	const navigate = useNavigate();
	const { "*": requestedPage } = useParams();
	const page =
		pages.find((entry) => entry.id === requestedPage)?.id ?? "execution";
	const config = useConfig().data;
	if (!config) return <p>Loading settings…</p>;
	return (
		<>
			{requestedPage !== page && <Navigate to="/settings/execution" replace />}
			<h1>Settings</h1>
			<p className="intro">
				Configure how the factory runs. Choose a section to manage its settings.
			</p>
			<div className="settings-layout">
				<nav className="settings-nav" aria-label="Settings sections">
					{pages
						.filter(
							(entry) => entry.id !== "setup" || config.onboarding?.available,
						)
						.map((entry) => (
							<NavLink key={entry.id} to={`/settings/${entry.id}`}>
								<strong>{entry.name}</strong>
								<small>{entry.description}</small>
							</NavLink>
						))}
				</nav>
				<div className="settings-content">
					{page === "setup" && config.onboarding?.available && (
						<Onboarding
							embedded
							initial={config.onboarding}
							onComplete={() => navigate("/")}
						/>
					)}
					<ExecutionEditor key={page} config={config} page={page} />
					{page === "access" && <AccessSettings />}
					{page === "updates" && <UpdateSettings />}
					{page === "capacity" && <MachineCapacitySettings config={config} />}
					{page === "titles" && <RunTitleSettings config={config} />}
				</div>
			</div>
		</>
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
							body: { concurrency: Number(limit) },
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
