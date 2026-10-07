import { Navigate, NavLink, useParams } from "react-router-dom";
import { useAction, useConfig } from "./client";
import { ExecutionEditor } from "./execution";
import { AgentSettings } from "./forms";
import { DraftNotice } from "./pwa-ui";
import { forgetDraft, revisionOf, useRestorableState } from "./restoration";
import { Button, useToast } from "./ui";

const pages = [
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
		name: "Machine capacity",
		description: "Shared execution slot limit",
	},
	{
		id: "titles",
		name: "Run titles",
		description: "Agent for naming new runs",
	},
] as const;

export function Settings() {
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
					{pages.map((entry) => (
						<NavLink key={entry.id} to={`/settings/${entry.id}`}>
							<strong>{entry.name}</strong>
							<small>{entry.description}</small>
						</NavLink>
					))}
				</nav>
				<div className="settings-content">
					{/* Keep the execution draft mounted while navigating between sections. */}
					<ExecutionEditor config={config} page={page} />
					{page === "capacity" && <MachineCapacitySettings config={config} />}
					{page === "titles" && <RunTitleSettings config={config} />}
				</div>
			</div>
		</>
	);
}

function MachineCapacitySettings({ config }: { config: any }) {
	const capacity = config.capacity;
	const action = useAction();
	const draftKey = "recipe/machine-capacity";
	const [draft, setDraft, stale] = useRestorableState<
		{ limit: string } | undefined
	>(draftKey, undefined, revisionOf(capacity?.limit));
	const limit = draft?.limit ?? String(capacity?.limit ?? 4);
	if (!capacity) return null;
	return (
		<section className="recipe" aria-labelledby="machine-capacity">
			<h2 id="machine-capacity">Machine capacity</h2>
			<DraftNotice conflict={stale} draftKey={draftKey} />
			<p>
				One shared pool for agents and intensive workflow steps. Default:{" "}
				{capacity.defaultLimit} slots.
			</p>
			<p role="status">
				Shared limit: {capacity.limit} {capacity.limit === 1 ? "slot" : "slots"}
				. {capacity.active} executing · {capacity.stopping} stopping ·{" "}
				{capacity.queued} waiting for capacity
			</p>
			{capacity.error && <p role="alert">{capacity.error}</p>}
			{capacity.conflict && <p role="alert">{capacity.conflict}</p>}
			<form
				onSubmit={async (event) => {
					event.preventDefault();
					if (stale || action.isPending) return;
					try {
						await action.mutateAsync({
							path: "/api/capacity",
							method: "PUT",
							body: { limit: Number(limit) },
						});
						setDraft(undefined);
						forgetDraft(draftKey);
					} catch {}
				}}
			>
				<label>
					Shared slot limit{" "}
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
					disabled={draft === undefined || stale || action.isPending}
				>
					Save machine limit
				</Button>
				{action.error && <p role="alert">{action.error.message}</p>}
			</form>
		</section>
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
