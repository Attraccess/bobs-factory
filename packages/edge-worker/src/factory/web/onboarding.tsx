import { type ReactNode, useEffect, useState } from "react";
import { api, refreshFactory, useConfig } from "./client";
import { Bob, Button, External } from "./ui";

interface SetupStatus {
	available: boolean;
	required: boolean;
	gitInstalled: boolean;
	project?: { name: string; path: string; githubUrl?: string };
	runner?: string;
	agents: {
		id: string;
		label: string;
		installed: boolean;
		login: string;
		install: string;
		note?: string;
	}[];
	github: { connected: boolean; account?: string };
}
export function SetupBoundary({ children }: { children: ReactNode }) {
	const { data: config } = useConfig();
	const [finished, setFinished] = useState(false);
	const [started, setStarted] = useState(false);
	useEffect(() => {
		if (config?.onboarding?.available && config.onboarding.required)
			setStarted(true);
	}, [config?.onboarding?.available, config?.onboarding?.required]);
	if (
		!finished &&
		config?.onboarding?.available &&
		(started || config.onboarding.required)
	)
		return (
			<Onboarding
				initial={config.onboarding}
				onComplete={() => setFinished(true)}
			/>
		);
	return <>{children}</>;
}

export function Onboarding({
	initial,
	onComplete,
	embedded = false,
}: {
	initial: SetupStatus;
	onComplete: () => void;
	embedded?: boolean;
}) {
	const [status, setStatus] = useState(initial);
	const [step, setStep] = useState(1);
	const [path, setPath] = useState(initial.project?.path ?? "");
	const installed = status.agents.filter((agent) => agent.installed);
	const [runner, setRunner] = useState(
		initial.runner ?? (installed.length === 1 ? installed[0]!.id : ""),
	);
	const [token, setToken] = useState("");
	const [reconnecting, setReconnecting] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const selected = status.agents.find((agent) => agent.id === runner);
	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		setError(undefined);
		try {
			await action();
		} catch (error) {
			setError(
				error instanceof Error ? error.message : "Setup failed. Try again.",
			);
		} finally {
			setBusy(false);
		}
	};
	const finish = () =>
		void run(async () => {
			await refreshFactory();
			onComplete();
		});
	const Frame = embedded ? "section" : "main";
	return (
		<Frame className={embedded ? undefined : "onboarding-page"}>
			<section className="onboarding-card">
				<header>
					<Bob mood="happy" size={76} />
					<div>
						<p className="eyebrow">Welcome to Bob’s Factory</p>
						<h1>
							{step === 1
								? "Choose your project"
								: step === 2
									? "Connect GitHub"
									: "You’re ready to build"}
						</h1>
					</div>
				</header>
				<ol className="onboarding-progress" aria-label="Setup progress">
					{["Project & agent", "GitHub", "Ready"].map((label, index) => (
						<li
							key={label}
							aria-current={step === index + 1 ? "step" : undefined}
						>
							{index + 1}. {label}
						</li>
					))}
				</ol>
				{error && (
					<p className="settings-error" role="alert">
						{error}
					</p>
				)}
				{step === 1 && (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void run(async () => {
								const next = await api("/api/onboarding/project", {
									method: "POST",
									body: JSON.stringify({ repositoryPath: path, runner }),
								});
								setStatus(next);
								setStep(2);
							});
						}}
					>
						<p>
							Bob works in a separate worktree of your existing project. Choose
							its folder on this machine.
						</p>
						<label>
							Project folder
							<input
								required
								value={path}
								onChange={(event) => setPath(event.target.value)}
								placeholder="~/code/my-project"
								autoComplete="off"
							/>
						</label>
						{!status.gitInstalled && (
							<p role="alert">
								Install{" "}
								<External href="https://git-scm.com/downloads">Git</External>,
								then refresh. Bob will keep this setup page open.
							</p>
						)}
						<label>
							Coding agent
							<select
								required
								value={runner}
								onChange={(event) => setRunner(event.target.value)}
							>
								<option value="">Choose an installed agent</option>
								{status.agents.map((agent) => (
									<option
										key={agent.id}
										value={agent.id}
										disabled={!agent.installed}
									>
										{agent.label}
										{!agent.installed ? " — install first" : ""}
									</option>
								))}
							</select>
						</label>
						{selected && (
							<div className="onboarding-note">
								<strong>Use your existing {selected.label} account</strong>
								<p>
									If you already signed in, you can continue. Otherwise run{" "}
									<code>{selected.login}</code> in a terminal and finish that
									agent’s sign-in. Your credentials stay in its native store.
								</p>
								{selected.note && <p>{selected.note}</p>}
							</div>
						)}
						{!installed.length && (
							<p>
								Install a coding agent to continue:{" "}
								{status.agents.map((agent, index) => (
									<span key={agent.id}>
										{index > 0 ? " · " : ""}
										<External href={agent.install}>{agent.label}</External>
									</span>
								))}
								.
							</p>
						)}
						{status.agents
							.filter((agent) => !agent.installed && agent.note)
							.map((agent) => (
								<p className="settings-hint" key={agent.id}>
									{agent.note}{" "}
									<External href="https://github.com/jappyjan/bobs-factory/blob/main/docs/distribution/README.md#prepared-cursor-installation">
										Cursor setup guide
									</External>
								</p>
							))}
						<div className="onboarding-actions">
							<Button
								type="submit"
								busy={busy}
								disabled={
									!path.trim() ||
									!runner ||
									!selected?.installed ||
									!status.gitInstalled
								}
							>
								Continue
							</Button>
							<Button
								variant="secondary"
								disabled={busy}
								onClick={() =>
									void run(async () => setStatus(await api("/api/onboarding")))
								}
							>
								Refresh tools
							</Button>
						</div>
					</form>
				)}
				{step === 2 && (
					<>
						<p>
							Bob uses the GitHub API directly to create and review pull
							requests. GitHub CLI is optional.
						</p>
						{status.github.connected && !reconnecting ? (
							<div className="onboarding-note">
								<strong>
									GitHub connected
									{status.github.account ? ` as ${status.github.account}` : ""}
								</strong>
								<p>
									A connection is configured. Reconnect if its token expired or
									access changed.
								</p>
								<Button
									variant="secondary"
									onClick={() => setReconnecting(true)}
								>
									Replace GitHub token
								</Button>
							</div>
						) : (
							<form
								onSubmit={(event) => {
									event.preventDefault();
									void run(async () => {
										setStatus(
											await api("/api/onboarding/github", {
												method: "POST",
												body: JSON.stringify({ token }),
											}),
										);
										setToken("");
										setStep(3);
									});
								}}
							>
								<p>
									<External href="https://github.com/settings/tokens/new?scopes=repo">
										Create a classic GitHub token
									</External>{" "}
									for{" "}
									{status.project?.githubUrl ? (
										<External href={status.project.githubUrl}>
											{status.project.name}
										</External>
									) : (
										"your repository"
									)}
									.
								</p>
								<p>
									Select the <strong>repo</strong> scope and an expiration.
									Classic tokens cover repositories your account can access.
									Fine-grained tokens can lack the CI check access Bob needs.
								</p>
								<label>
									GitHub token
									<input
										type="password"
										required
										autoComplete="off"
										value={token}
										onChange={(event) => setToken(event.target.value.trim())}
										placeholder="ghp_…"
									/>
								</label>
								<p className="settings-hint">
									Bob checks project and CI access before saving the token
									privately on this machine. Your native Git and agent sign-in
									stay unchanged.
								</p>
								<Button type="submit" busy={busy} disabled={!token}>
									Connect GitHub
								</Button>
							</form>
						)}
						<div className="onboarding-actions">
							<Button
								variant="secondary"
								disabled={busy}
								onClick={() => setStep(1)}
							>
								Back
							</Button>
							<Button disabled={busy} onClick={() => setStep(3)}>
								{status.github.connected ? "Continue" : "Connect later"}
							</Button>
						</div>
					</>
				)}
				{step === 3 && (
					<>
						<p>
							<strong>{status.project?.name}</strong> is ready with{" "}
							<strong>{selected?.label ?? status.runner}</strong>. Describe your
							first task on the dashboard.
						</p>
						{!status.github.connected && (
							<p>
								You can connect GitHub later in Settings → Project setup to
								deliver pull requests. Keep Bob running while you work.
							</p>
						)}
						<Button busy={busy} onClick={finish}>
							Open my Factory
						</Button>
					</>
				)}
			</section>
		</Frame>
	);
}
