import { useState } from "react";
import { useAction } from "./client";
import { Button } from "./ui";

const runners = ["claude", "codex", "gemini", "cursor", "opencode"];
function Text({
	label,
	value = "",
	change,
	placeholder,
}: {
	label: string;
	value?: string;
	change: (v: string) => void;
	placeholder?: string;
}) {
	return (
		<label>
			{label}
			<input
				value={value}
				placeholder={placeholder}
				onChange={(e) => change(e.target.value)}
			/>
		</label>
	);
}
function Choice({
	label,
	value,
	choices,
	change,
}: {
	label: string;
	value: string;
	choices: string[];
	change: (v: string) => void;
}) {
	return (
		<label>
			{label}
			<select value={value} onChange={(e) => change(e.target.value)}>
				{choices.map((v) => (
					<option key={v}>{v}</option>
				))}
			</select>
		</label>
	);
}
function Credential({
	value,
	change,
	repository = false,
}: {
	value: any;
	change: (v: any) => void;
	repository?: boolean;
}) {
	const set = (key: string, v: string) => change({ ...value, [key]: v });
	return (
		<fieldset>
			<legend>Credential reference</legend>
			<Choice
				label="Read credential from"
				value={value.source}
				choices={
					repository
						? ["env", "file", "gh", "glab", "github-app"]
						: ["env", "file"]
				}
				change={(source) =>
					change({
						source,
						version: value.version,
						owner: value.owner,
						...(source === "env"
							? { name: "" }
							: source === "file"
								? { path: "" }
								: source === "github-app"
									? { appId: 1, installationId: 1, privateKeyFile: "" }
									: {
											host: source === "gh" ? "github.com" : "gitlab.com",
											account: "",
										}),
					})
				}
			/>
			{value.source === "env" ? (
				<Text
					label="Environment variable name"
					value={value.name}
					change={(v) => set("name", v)}
					placeholder="BOB_API_KEY"
				/>
			) : value.source === "file" ? (
				<Text
					label="Protected file path"
					value={value.path}
					change={(v) => set("path", v)}
				/>
			) : value.source === "github-app" ? (
				<>
					{["appId", "installationId"].map((key) => (
						<Text
							key={key}
							label={key === "appId" ? "App ID" : "Installation ID"}
							value={String(value[key])}
							change={(v) => change({ ...value, [key]: Number(v) })}
						/>
					))}
					<Text
						label="Protected private key file"
						value={value.privateKeyFile}
						change={(v) => set("privateKeyFile", v)}
					/>
				</>
			) : (
				<>
					<Text
						label="Provider host"
						value={value.host}
						change={(v) => set("host", v)}
					/>
					<Text
						label="Stored account"
						value={value.account}
						change={(v) => set("account", v)}
					/>
					<Text
						label="CLI configuration directory (optional)"
						value={value.configDirectory}
						change={(v) => set("configDirectory", v || (undefined as any))}
					/>
				</>
			)}
			<Text
				label="Declared owner (runner API owner is unverified)"
				value={value.owner}
				change={(v) => set("owner", v)}
			/>
			<Text
				label="Credential version"
				value={value.version}
				change={(v) => set("version", v)}
			/>
			<small>
				Use names and paths only. Never enter a token or password. Changing a
				version requires a new admission.
			</small>
		</fieldset>
	);
}
const newCredential = () => ({
	source: "env",
	name: "",
	version: "v1",
	owner: "",
});
const person = () => ({ mode: "share" });
const newIdentity = () => ({
	id: "",
	revision: 1,
	name: "",
	author: person(),
	committer: person(),
	signing: { format: "share" },
	repositories: [],
	runners: {},
});
const newTools = () => ({
	id: "",
	revision: 1,
	name: "",
	mode: "factory-only",
	sources: [],
	mcp: {},
	remove: [],
	denyTools: [],
});
function IdentityFields({
	value,
	change,
}: {
	value: any;
	change: (v: any) => void;
}) {
	const set = (key: string, v: any) => change({ ...value, [key]: v });
	return (
		<>
			{["author", "committer"].map((kind) => (
				<fieldset key={kind}>
					<legend>Git {kind}</legend>
					<Choice
						label="Identity source"
						value={value[kind].mode}
						choices={["share", "overlay", "factory-only"]}
						change={(mode) =>
							set(
								kind,
								mode === "share"
									? { mode }
									: { mode, value: { name: "", email: "" } },
							)
						}
					/>
					{value[kind].mode !== "share" && (
						<>
							<Text
								label="Name"
								value={value[kind].value.name}
								change={(name) =>
									set(kind, {
										...value[kind],
										value: { ...value[kind].value, name },
									})
								}
							/>
							<Text
								label="Email"
								value={value[kind].value.email}
								change={(email) =>
									set(kind, {
										...value[kind],
										value: { ...value[kind].value, email },
									})
								}
							/>
						</>
					)}
				</fieldset>
			))}
			<fieldset>
				<legend>Commit and tag signing</legend>
				<Choice
					label="Signing policy"
					value={value.signing.format}
					choices={["share", "disabled", "ssh", "openpgp"]}
					change={(format) =>
						set(
							"signing",
							["share", "disabled"].includes(format)
								? { format }
								: {
										format,
										commits: true,
										tags: true,
										...(format === "ssh"
											? { key: "" }
											: { home: "", fingerprint: "" }),
									},
						)
					}
				/>
				{["ssh", "openpgp"].includes(value.signing.format) && (
					<>
						{(value.signing.format === "ssh"
							? ["key", "agent", "allowedSigners"]
							: ["home", "fingerprint"]
						).map((key) => (
							<Text
								key={key}
								label={key}
								value={value.signing[key]}
								change={(v) =>
									set("signing", { ...value.signing, [key]: v || undefined })
								}
							/>
						))}
						{["commits", "tags"].map((key) => (
							<label key={key}>
								<input
									type="checkbox"
									checked={value.signing[key]}
									onChange={(e) =>
										set("signing", {
											...value.signing,
											[key]: e.target.checked,
										})
									}
								/>
								Sign {key}
							</label>
						))}
					</>
				)}
			</fieldset>
			<fieldset>
				<legend>Repository accounts</legend>
				{value.repositories.map((repo: any, index: number) => {
					const update = (next: any) =>
						set(
							"repositories",
							value.repositories.map((r: any, i: number) =>
								i === index ? next : r,
							),
						);
					return (
						<fieldset key={index}>
							<legend>Account {index + 1}</legend>
							<Choice
								label="Provider"
								value={repo.provider}
								choices={["github", "gitlab"]}
								change={(provider) => update({ ...repo, provider })}
							/>
							<Choice
								label="Source policy"
								value={repo.mode}
								choices={["share", "overlay", "factory-only"]}
								change={(mode) => update({ ...repo, mode })}
							/>
							{["host", "account", "apiUrl"].map((key) => (
								<Text
									key={key}
									label={key === "apiUrl" ? "API URL (optional)" : key}
									value={repo[key]}
									change={(v) => update({ ...repo, [key]: v || undefined })}
								/>
							))}
							<Credential
								repository
								value={repo.credential}
								change={(credential) => update({ ...repo, credential })}
							/>
							<label>
								<input
									type="checkbox"
									checked={!!repo.ssh}
									onChange={(e) =>
										update({
											...repo,
											ssh: e.target.checked
												? {
														alias: repo.host,
														hostname: repo.host,
														user: "git",
														key: "",
														knownHosts: "",
														port: 22,
													}
												: undefined,
										})
									}
								/>
								Use an explicit SSH key or agent for Git
							</label>
							{repo.ssh &&
								[
									"alias",
									"hostname",
									"user",
									"key",
									"knownHosts",
									"agent",
									"port",
								].map((key) => (
									<Text
										key={key}
										label={key}
										value={String(repo.ssh[key] ?? "")}
										change={(v) =>
											update({
												...repo,
												ssh: {
													...repo.ssh,
													[key]: key === "port" ? Number(v) : v || undefined,
												},
											})
										}
									/>
								))}
							<Button
								onClick={() =>
									set(
										"repositories",
										value.repositories.filter(
											(_: any, i: number) => i !== index,
										),
									)
								}
							>
								Remove account
							</Button>
						</fieldset>
					);
				})}
				<Button
					onClick={() =>
						set("repositories", [
							...value.repositories,
							{
								host: "github.com",
								provider: "github",
								mode: "factory-only",
								account: "",
								credential: newCredential(),
							},
						])
					}
				>
					Add repository account
				</Button>
			</fieldset>
			<fieldset>
				<legend>Runner authentication</legend>
				{runners.map((runner) => (
					<fieldset key={runner}>
						<legend>{runner}</legend>
						<label>
							<input
								type="checkbox"
								checked={!!value.runners[runner]}
								onChange={(e) => {
									const next = { ...value.runners };
									if (e.target.checked)
										next[runner] = {
											mode: "factory-only",
											provider: {
												claude: "anthropic",
												codex: "openai",
												gemini: "google",
												cursor: "cursor",
												opencode: "openai",
											}[runner],
											credential: newCredential(),
										};
									else delete next[runner];
									set("runners", next);
								}}
							/>
							Enable authentication binding
						</label>
						{value.runners[runner] && (
							<>
								<Choice
									label="Authentication source"
									value={value.runners[runner].mode}
									choices={["share", "overlay", "factory-only"]}
									change={(mode) =>
										set("runners", {
											...value.runners,
											[runner]: { ...value.runners[runner], mode },
										})
									}
								/>
								{["claude", "codex"].includes(runner) && (
									<Choice
										label="Credential kind"
										value={value.runners[runner].kind ?? "api-key"}
										choices={
											runner === "claude"
												? ["api-key", "setup-token", "native-login"]
												: ["api-key", "native-login"]
										}
										change={(kind) =>
											set("runners", {
												...value.runners,
												[runner]:
													kind === "native-login"
														? {
																mode: "share",
																provider: value.runners[runner].provider,
																kind,
																configDirectory: "",
																account: "",
															}
														: {
																mode: value.runners[runner].mode,
																provider: value.runners[runner].provider,
																kind,
																credential: newCredential(),
															},
											})
										}
									/>
								)}
								{runner === "opencode" && (
									<Choice
										label="API provider"
										value={value.runners[runner].provider}
										choices={["openai", "anthropic", "google"]}
										change={(provider) =>
											set("runners", {
												...value.runners,
												[runner]: { ...value.runners[runner], provider },
											})
										}
									/>
								)}
								{value.runners[runner].kind === "native-login" ? (
									<>
										<Text
											label="Existing login configuration directory"
											value={value.runners[runner].configDirectory}
											change={(configDirectory) =>
												set("runners", {
													...value.runners,
													[runner]: {
														...value.runners[runner],
														configDirectory,
													},
												})
											}
										/>
										<Text
											label="Expected native account email"
											value={value.runners[runner].account}
											change={(account) =>
												set("runners", {
													...value.runners,
													[runner]: { ...value.runners[runner], account },
												})
											}
										/>
										<small>
											Requires Share tools. Reuses the existing login store;
											native credentials stay there. Codex roots with automatic
											hooks, enabled plugins or app connectors are unsupported.
										</small>
									</>
								) : (
									<Credential
										value={value.runners[runner].credential}
										change={(credential) =>
											set("runners", {
												...value.runners,
												[runner]: { ...value.runners[runner], credential },
											})
										}
									/>
								)}
							</>
						)}
					</fieldset>
				))}
			</fieldset>
		</>
	);
}
function ToolFields({
	value,
	change,
}: {
	value: any;
	change: (v: any) => void;
}) {
	const set = (key: string, v: any) => change({ ...value, [key]: v });
	const [serverName, setServerName] = useState("");
	return (
		<>
			<Choice
				label="Tool configuration source"
				value={value.mode}
				choices={["share", "overlay", "factory-only"]}
				change={(v) => set("mode", v)}
			/>
			<label>
				Declared MCP source files (one per line)
				<textarea
					value={value.sources.join("\n")}
					onChange={(e) =>
						set("sources", e.target.value.split("\n").filter(Boolean))
					}
				/>
			</label>
			<Text
				label="Remove MCP servers (comma separated)"
				value={value.remove.join(", ")}
				change={(v) =>
					set(
						"remove",
						v
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean),
					)
				}
			/>
			<Text
				label="Deny tools (comma separated)"
				value={value.denyTools.join(", ")}
				change={(v) =>
					set(
						"denyTools",
						v
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean),
					)
				}
			/>
			<fieldset>
				<legend>Ordinary runner settings</legend>
				<p>
					Only presentation settings are accepted here. Use the identity and MCP
					fields for credentials and tools.
				</p>
				{runners.map((runner) => (
					<details key={runner}>
						<summary>{runner}</summary>
						<label>
							Declared JSON setting files (one per line)
							<textarea
								value={(value.runnerSettingsSources?.[runner] ?? []).join("\n")}
								onChange={(e) =>
									set("runnerSettingsSources", {
										...value.runnerSettingsSources,
										[runner]: e.target.value.split("\n").filter(Boolean),
									})
								}
							/>
						</label>
						<SettingsJson
							value={value.runnerSettings?.[runner] ?? {}}
							change={(v) =>
								set("runnerSettings", { ...value.runnerSettings, [runner]: v })
							}
						/>
					</details>
				))}
			</fieldset>
			{Object.entries(value.mcp).map(([name, def]: [string, any]) => {
				const update = (v: any) => set("mcp", { ...value.mcp, [name]: v });
				return (
					<fieldset key={name}>
						<legend>MCP: {name}</legend>
						<Choice
							label="Transport"
							value={def.type}
							choices={["stdio", "http", "sse"]}
							change={(type) =>
								update(
									type === "stdio"
										? { type, command: "", args: [], env: {} }
										: { type, url: "", headers: {} },
								)
							}
						/>
						{def.type === "stdio" ? (
							<>
								<Text
									label="Command"
									value={def.command}
									change={(command) => update({ ...def, command })}
								/>
								<label>
									Arguments (one per line)
									<textarea
										value={def.args.join("\n")}
										onChange={(e) =>
											update({
												...def,
												args: e.target.value.split("\n").filter(Boolean),
											})
										}
									/>
								</label>
							</>
						) : (
							<Text
								label="Endpoint URL"
								value={def.url}
								change={(url) => update({ ...def, url })}
							/>
						)}
						{Object.entries(def.type === "stdio" ? def.env : def.headers).map(
							([key, ref]: [string, any]) => (
								<fieldset key={key}>
									<legend>{key}</legend>
									{"literal" in ref ? (
										<Text
											label="Nonsecret value"
											value={ref.literal}
											change={(literal) =>
												update({
													...def,
													env: { ...def.env, [key]: { literal } },
												})
											}
										/>
									) : (
										<Credential
											value={ref}
											change={(credential) => {
												const field = def.type === "stdio" ? "env" : "headers";
												update({
													...def,
													[field]: { ...def[field], [key]: credential },
												});
											}}
										/>
									)}
								</fieldset>
							),
						)}
						<ServerCredential def={def} update={update} />
						<Button
							onClick={() => {
								const next = { ...value.mcp };
								delete next[name];
								set("mcp", next);
							}}
						>
							Remove server
						</Button>
					</fieldset>
				);
			})}
			<Text label="New server name" value={serverName} change={setServerName} />
			<Button
				disabled={!serverName || !!value.mcp[serverName]}
				onClick={() => {
					set("mcp", {
						...value.mcp,
						[serverName]: { type: "stdio", command: "", args: [], env: {} },
					});
					setServerName("");
				}}
			>
				Add MCP server
			</Button>
		</>
	);
}
function SettingsJson({
	value,
	change,
}: {
	value: any;
	change: (value: any) => void;
}) {
	const [text, setText] = useState(JSON.stringify(value, null, 2));
	const [error, setError] = useState("");
	return (
		<label>
			Settings overlay (JSON)
			<textarea
				value={text}
				onChange={(e) => {
					setText(e.target.value);
					try {
						const next = JSON.parse(e.target.value);
						if (!next || typeof next !== "object" || Array.isArray(next))
							throw new Error("Use a JSON object");
						change(next);
						setError("");
					} catch {
						change(e.target.value);
						setError("Enter a valid JSON object before saving.");
					}
				}}
			/>
			{error && <small role="alert">{error}</small>}
		</label>
	);
}
function ServerCredential({
	def,
	update,
}: {
	def: any;
	update: (v: any) => void;
}) {
	const [name, setName] = useState("");
	const field = def.type === "stdio" ? "env" : "headers";
	return (
		<>
			<Text
				label={
					field === "env"
						? "New credential environment variable"
						: "New credential header"
				}
				value={name}
				change={setName}
			/>
			<Button
				disabled={!name}
				onClick={() => {
					update({
						...def,
						[field]: { ...def[field], [name]: newCredential() },
					});
					setName("");
				}}
			>
				Add credential reference
			</Button>
		</>
	);
}
export function ExecutionSelectors({
	config,
	repositoryId,
	value,
	onChange,
	runner,
	workflow,
	model,
}: {
	config: any;
	repositoryId: string;
	value: any;
	onChange: (v: any) => void;
	runner?: string;
	workflow?: string;
	model?: string;
}) {
	const action = useAction();
	const [savedPreview, setPreview] = useState<any>();
	const profiles = config.executionProfiles;
	const previewKey = JSON.stringify([
		repositoryId,
		runner,
		workflow,
		model,
		profiles?.revision,
		value.identityProfile,
		value.toolProfile,
	]);
	const preview =
		savedPreview?.key === previewKey ? savedPreview.result : undefined;
	if (!profiles) return null;
	const inherited = {
		...profiles.defaults,
		...profiles.repositories[repositoryId],
	};
	return (
		<details className="composer-details">
			<summary>Execution identity and tools</summary>
			<div>
				{[
					["identityProfile", "Identity profile", profiles.identities],
					["toolProfile", "Tool profile", profiles.tools],
				].map(([key, label, list]: any) => (
					<label key={key}>
						{label}
						<select
							value={value[key] ?? ""}
							onChange={(e) => {
								onChange({ ...value, [key]: e.target.value || undefined });
								setPreview(undefined);
							}}
						>
							<option value="">Default ({inherited[key] ?? "Legacy"})</option>
							{list.map((p: any) => (
								<option key={p.id} value={p.id}>
									{p.name} · revision {p.revision}
								</option>
							))}
						</select>
					</label>
				))}
				<p>
					Profiles are independent. Runs keep the accepted definitions through
					retries and restarts. Native subscription login remains available with
					Legacy execution.
				</p>
				<Button
					disabled={action.isPending}
					onClick={() => {
						void action
							.mutateAsync({
								path: "/api/execution-preview",
								body: {
									repositoryId,
									selection: value,
									runner,
									workflow,
									model,
								},
							})
							.then((result) => setPreview({ key: previewKey, result }))
							.catch(() => {});
					}}
				>
					Check effective configuration
				</Button>
				{action.error && <p role="alert">{action.error.message}</p>}
				{preview && (
					<div role="status">
						<p>{preview.validation}</p>
						{preview.snapshot && (
							<ExecutionDetails
								run={{
									executionSnapshot: preview.snapshot,
									executionDiagnostics: preview.diagnostics,
									runner,
								}}
							/>
						)}
						<p>
							{preview.accounts
								?.map(
									(a: any) =>
										`${a.host}: ${a.account}${a.verified ? " (verified)" : " (unverified)"}`,
								)
								.join("; ")}
						</p>
						<p>MCP: {preview.mcp?.join(", ") || "None selected"}</p>
					</div>
				)}
			</div>
		</details>
	);
}
export function ExecutionEditor({
	config,
	page,
}: {
	config: any;
	page?: string;
}) {
	const action = useAction();
	const [draft, setDraft] = useState<any>();
	const [editing, setEditing] = useState<{
		kind: "identities" | "tools";
		index: number;
	}>();
	const profiles = draft ?? config.executionProfiles;
	if (!profiles || !["execution", "identities", "tools"].includes(page ?? ""))
		return null;
	const update = (next: any) => setDraft(next);
	const selected = editing && profiles[editing.kind][editing.index];
	return (
		<section
			className="execution-editor recipe"
			aria-labelledby="execution-settings-heading"
		>
			<h2 id="execution-settings-heading">
				{page === "execution"
					? "Execution defaults"
					: page === "identities"
						? "Identity profiles"
						: "Tool profiles"}
			</h2>
			<p>
				Select Git identity, repository accounts and runner authentication
				independently from MCP tools. Credentials stay in protected files or
				named stores. This controls normal configuration discovery; existing
				sandbox controls still apply.
			</p>
			{config.executionConsumers?.length > 0 && (
				<p>
					Active or resumable consumers:{" "}
					{config.executionConsumers
						.map(
							(r: any) =>
								`${r.id}: ${r.identity ?? "Legacy identity"} / ${r.tools ?? "Legacy tools"}`,
						)
						.join("; ")}
					. Removing a profile keeps their snapshots. Clear or replace its
					defaults before saving the removal. Keep referenced credentials
					available for recovery.
				</p>
			)}
			{(["identities", "tools"] as const)
				.filter((kind) => kind === page)
				.map((kind) => (
					<fieldset key={kind}>
						<legend>
							{kind === "identities" ? "Identity profiles" : "Tool profiles"}
						</legend>
						{profiles[kind].map((p: any, index: number) => (
							<div className="profile-row" key={index}>
								<Button
									aria-pressed={
										editing?.kind === kind && editing.index === index
									}
									onClick={() => setEditing({ kind, index })}
								>
									{p.name || "New profile"} ({p.id || "choose an ID"})
								</Button>
								<Button
									onClick={() => {
										update({
											...profiles,
											[kind]: profiles[kind].filter(
												(_: any, i: number) => i !== index,
											),
										});
										setEditing(undefined);
									}}
								>
									Remove
								</Button>
							</div>
						))}
						<Button
							onClick={() => {
								update({
									...profiles,
									[kind]: [
										...profiles[kind],
										kind === "identities" ? newIdentity() : newTools(),
									],
								});
								setEditing({ kind, index: profiles[kind].length });
							}}
						>
							Add {kind === "identities" ? "identity" : "tool"} profile
						</Button>
					</fieldset>
				))}
			{selected && editing && editing.kind === page && (
				<fieldset>
					<legend>Edit profile</legend>
					<Text
						label="Stable profile ID"
						value={selected.id}
						change={(id) =>
							update({
								...profiles,
								[editing.kind]: profiles[editing.kind].map(
									(p: any, i: number) =>
										i === editing.index ? { ...p, id } : p,
								),
							})
						}
					/>
					<Text
						label="Display name"
						value={selected.name}
						change={(name) =>
							update({
								...profiles,
								[editing.kind]: profiles[editing.kind].map(
									(p: any, i: number) =>
										i === editing.index ? { ...p, name } : p,
								),
							})
						}
					/>
					{editing.kind === "identities" ? (
						<IdentityFields
							value={selected}
							change={(v) =>
								update({
									...profiles,
									identities: profiles.identities.map((p: any, i: number) =>
										i === editing.index ? v : p,
									),
								})
							}
						/>
					) : (
						<ToolFields
							value={selected}
							change={(v) =>
								update({
									...profiles,
									tools: profiles.tools.map((p: any, i: number) =>
										i === editing.index ? v : p,
									),
								})
							}
						/>
					)}
				</fieldset>
			)}
			{page === "execution" && (
				<>
					<p>
						Choose identity and tools independently. Repository choices override
						factory defaults; Legacy preserves existing host configuration.
					</p>
					{[{ id: "", name: "Factory defaults" }, ...config.repositories].map(
						(repo: any) => (
							<fieldset key={repo.id}>
								<legend>{repo.name}</legend>
								{[
									["identityProfile", "Identity", profiles.identities],
									["toolProfile", "Tools", profiles.tools],
								].map(([key, label, list]: any) => {
									const selection = repo.id
										? (profiles.repositories[repo.id] ?? {})
										: profiles.defaults;
									return (
										<label key={key}>
											{label}
											<select
												value={selection[key] ?? ""}
												onChange={(e) => {
													const next = {
														...selection,
														[key]: e.target.value || undefined,
													};
													update(
														repo.id
															? {
																	...profiles,
																	repositories: {
																		...profiles.repositories,
																		[repo.id]: next,
																	},
																}
															: { ...profiles, defaults: next },
													);
												}}
											>
												<option value="">
													{repo.id ? "Factory default" : "Legacy"}
												</option>
												{list.map((p: any, i: number) => (
													<option value={p.id} key={i}>
														{p.name}
													</option>
												))}
											</select>
										</label>
									);
								})}
							</fieldset>
						),
					)}
				</>
			)}
			<div className="settings-save">
				{draft && (
					<p role="status">
						Unsaved execution changes. Saving applies your edits across
						defaults, identity profiles and tool profiles.
					</p>
				)}
				{action.error && <p role="alert">{action.error.message}</p>}
				<Button
					disabled={!draft || action.isPending}
					onClick={() => {
						void action
							.mutateAsync({
								path: "/api/execution-profiles",
								method: "PUT",
								body: { profiles, expectedRevision: profiles.revision },
							})
							.then(() => {
								setDraft(undefined);
								setEditing(undefined);
							})
							.catch(() => {});
					}}
				>
					Save execution settings
				</Button>
				<Button
					disabled={!draft || action.isPending}
					onClick={() => {
						setDraft(undefined);
						setEditing(undefined);
						action.reset();
					}}
				>
					Discard draft
				</Button>
			</div>
		</section>
	);
}

export function ExecutionDetails({ run }: { run: any }) {
	const snapshot = run.executionSnapshot;
	if (!snapshot) return null;
	const diagnostics = run.executionDiagnostics;
	const binding = snapshot.identity?.runners[diagnostics?.runner ?? run.runner];
	return (
		<details>
			<summary>Accepted execution configuration</summary>
			<p>
				Identity: {snapshot.identity?.name ?? "Legacy"} · revision{" "}
				{snapshot.identity?.revision ?? "—"}. Tools:{" "}
				{snapshot.tools?.name ?? "Legacy"} · revision{" "}
				{snapshot.tools?.revision ?? "—"}.
			</p>
			<p>
				Selected from: identity {snapshot.sources.identity}, tools{" "}
				{snapshot.sources.tools}. Author policy:{" "}
				{snapshot.identity?.author.mode ?? "Legacy"}; committer policy:{" "}
				{snapshot.identity?.committer.mode ?? "Legacy"}; tools policy:{" "}
				{snapshot.tools?.mode ?? "Legacy"}.
			</p>
			<p>
				Author:{" "}
				{diagnostics?.git?.author ??
					(snapshot.identity?.author.value
						? `${snapshot.identity.author.value.name} <${snapshot.identity.author.value.email}>`
						: "Shared host source")}
				. Committer:{" "}
				{diagnostics?.git?.committer ??
					(snapshot.identity?.committer.value
						? `${snapshot.identity.committer.value.name} <${snapshot.identity.committer.value.email}>`
						: "Shared host source")}
				.
			</p>
			<p>
				Signing:{" "}
				{diagnostics?.git?.signing ??
					snapshot.identity?.signing.format ??
					"Legacy"}{" "}
				· commits {diagnostics?.git?.commits ? "signed" : "unsigned"}, tags{" "}
				{diagnostics?.git?.tags ? "signed" : "unsigned"}
				{diagnostics?.git?.fingerprint
					? ` · ${diagnostics.git.fingerprint}`
					: ""}
				.
			</p>
			<p>
				Repository accounts:{" "}
				{diagnostics?.accounts
					?.map(
						(a: any) =>
							`${a.host}: ${a.account} (${a.verified ? "verified" : "unverified"})`,
					)
					.join("; ") || "Not checked yet"}
				.
			</p>
			<p>
				Runner: {diagnostics?.runner ?? run.runner}. Version:{" "}
				{diagnostics?.version ?? "Not checked yet"}. Tracking:{" "}
				{diagnostics?.tracking ?? "Not checked yet"}.
			</p>
			{binding && (
				<p>
					Runner authentication: {binding.provider}, {binding.mode}. Declared
					{binding.kind === "native-login" ? (
						<>
							native account: {binding.account}, existing root:{" "}
							{binding.configDirectory}.
						</>
					) : (
						<>API owner: {binding.credential.owner} (unverified).</>
					)}
				</p>
			)}
			<p>
				MCP: {diagnostics?.mcp?.join(", ") || "None"}. Profile denials:{" "}
				{snapshot.tools?.denyTools?.join(", ") || "None"}; role and repository
				safety restrictions still apply.
			</p>
			<p>
				Runner API owners are declared, unverified owners. Accepted profiles
				persist through edits or deletion. Missing credentials block recovery.
			</p>
		</details>
	);
}
