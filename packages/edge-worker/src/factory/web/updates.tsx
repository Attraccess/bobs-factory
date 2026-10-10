import { useQuery } from "@tanstack/react-query";
import type {
	UpdateManager,
	UpdateSettingsPatch,
} from "../../updates/UpdateManager.js";
import { api, useAction } from "./client";
import { useFormState } from "./form-state";
import { Button } from "./ui";

type Status = ReturnType<UpdateManager["status"]>;
const keyOf = (status: Status) =>
	status.pending
		? [
				status.pending.candidate.channel,
				status.pending.candidate.version,
				status.pending.candidate.commit,
				status.pending.candidate.target,
				status.pending.candidate.manifestSha256,
			].join(":")
		: "";

export function UpdateSettings() {
	const query = useQuery({
		queryKey: ["updates"],
		queryFn: ({ signal }) => api<Status>("/api/updates", { signal }),
		refetchInterval: 5000,
	});
	const status = query.data;
	const action = useAction("updates", String(status?.revision));
	const [draft, setDraft] = useFormState<UpdateSettingsPatch | undefined>(
		String(status?.revision),
		undefined,
	);
	if (!status)
		return (
			<p role="status">
				{query.error ? query.error.message : "Loading update settings…"}
			</p>
		);
	const settings = status.settings;
	const channel = draft?.channel ?? settings.channel;
	const policy = draft?.policy ?? settings.overrides[channel] ?? "default";
	const perform = async (path: string, body: unknown = {}, method = "POST") => {
		try {
			await action.mutateAsync({ path, body, method });
			return true;
		} catch {
			return false;
		}
	};
	return (
		<section className="recipe" aria-labelledby="instance-updates">
			<h2 id="instance-updates">Instance updates</h2>
			<p>
				These controls apply to this connected Factory backend. Desktop and
				other hosts keep their own settings.
			</p>
			<p>
				Installed: {status.installed.version} ·{" "}
				{status.installed.commit ?? "source unknown"} ·{" "}
				{status.installed.target ?? "checkout"}
			</p>
			<p role="status">
				Channel: {settings.channel} ·{" "}
				{status.effectivePolicy === "idle-auto"
					? "Automatic when idle"
					: "Notify / manual Install"}
				{settings.paused ? " · Paused" : ""}
				{settings.pin ? ` · Pinned to ${settings.pin}` : ""}
			</p>
			<p>
				Automatic installation waits for executing work and descendant leases to
				drain. Saved review and answer gates survive restart. Returning to
				stable may select an older version; state compatibility must pass before
				any switch.
			</p>
			{!status.activationSupported && (
				<p>
					Activation requires the installation’s external lifecycle supervisor.
					Checkout, Nix and system packages use their owning upgrade process.
				</p>
			)}
			<form
				onSubmit={(event) => {
					event.preventDefault();
					void perform(
						"/api/updates/settings",
						{ revision: status.revision, settings: draft ?? {} },
						"PUT",
					).then((saved) => {
						if (saved) setDraft(undefined);
					});
				}}
			>
				<label>
					Release channel{" "}
					<select
						value={channel}
						disabled={action.isPending}
						onChange={(event) =>
							setDraft({
								...draft,
								channel: event.target.value as "stable" | "nightly",
								policy: undefined,
							})
						}
					>
						<option value="stable">Stable</option>
						<option value="nightly">Nightly</option>
					</select>
				</label>
				<label>
					Update policy{" "}
					<select
						value={policy}
						disabled={action.isPending}
						onChange={(event) =>
							setDraft({
								...draft,
								policy: event.target.value as UpdateSettingsPatch["policy"],
							})
						}
					>
						<option value="default">
							Channel default (
							{channel === "nightly"
								? "Automatic when idle"
								: "Notify / manual Install"}
							)
						</option>
						<option value="manual">Notify / manual Install</option>
						<option value="idle-auto">Automatic when idle</option>
					</select>
				</label>
				<label>
					<input
						type="checkbox"
						checked={draft?.paused ?? settings.paused}
						disabled={action.isPending}
						onChange={(event) =>
							setDraft({ ...draft, paused: event.target.checked })
						}
					/>
					Pause updates
				</label>
				<label>
					Exact version pin{" "}
					<input
						value={
							draft?.pin !== undefined
								? (draft.pin ?? "")
								: (settings.pin ?? "")
						}
						placeholder="Unpinned"
						disabled={action.isPending}
						onChange={(event) =>
							setDraft({ ...draft, pin: event.target.value || null })
						}
					/>
				</label>
				<p>
					Pinning prevents automatic activation. Resume or clear the pin
					explicitly; saved channel overrides are retained.
				</p>
				<Button
					type="submit"
					requiresConnection
					disabled={!draft || action.isPending}
				>
					Save update settings
				</Button>
			</form>
			<Button
				requiresConnection
				disabled={action.isPending}
				onClick={() => void perform("/api/updates/check")}
			>
				Check for updates
			</Button>
			{status.pending && (
				<div>
					<p>
						Pending since {status.pending.since}:{" "}
						{status.pending.candidate.version} ·{" "}
						{status.pending.candidate.commit} ·{" "}
						{status.pending.candidate.target}
					</p>
					<p>
						{status.pending.staged ? "Verified and staged" : "Download pending"}{" "}
						·{" "}
						{status.pending.consentRevision === status.revision
							? "Install requested; waiting for safe idle activation"
							: "Awaiting effective policy / Install"}
					</p>
					<Button
						requiresConnection
						disabled={action.isPending}
						onClick={() => void perform("/api/updates/stage")}
					>
						Download and stage
					</Button>
					<Button
						requiresConnection
						disabled={action.isPending || settings.paused}
						onClick={() =>
							void perform("/api/updates/install", {
								revision: status.revision,
								candidate: keyOf(status),
							})
						}
					>
						Install when idle
					</Button>
					{status.badCandidates.includes(keyOf(status)) && (
						<Button
							requiresConnection
							disabled={action.isPending || settings.paused}
							onClick={() =>
								void perform("/api/updates/retry", {
									revision: status.revision,
									candidate: keyOf(status),
								})
							}
						>
							Retry failed candidate
						</Button>
					)}
				</div>
			)}
			{status.transaction && (
				<p role="status">
					Last operation: {status.transaction.phase} ·{" "}
					{status.transaction.error ?? status.transaction.startedAt}
				</p>
			)}
			{status.error && <p role="alert">{status.error}</p>}
			{action.error && <p role="alert">{action.error.message}</p>}
			{status.operationOwner && (
				<p>
					Update operation is owned. Interrupted operations require the
					lifecycle supervisor’s recovery command; never remove its lock while
					it is running.
				</p>
			)}
		</section>
	);
}
