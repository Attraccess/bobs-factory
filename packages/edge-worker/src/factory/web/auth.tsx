import {
	browserSupportsWebAuthn,
	startAuthentication,
	startRegistration,
	WebAuthnAbortService,
} from "@simplewebauthn/browser";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
	accessGeneration,
	accessRequired,
	accessSignal,
	checkAccess,
	onAccessLost,
	useAccess,
} from "./auth-state";
import { uiBuild, usePwa, versionMismatch } from "./pwa";
import { ConnectionNotice } from "./pwa-ui";
import { Bob, Button } from "./ui";

onAccessLost(() => WebAuthnAbortService.cancelCeremony());
async function authRequest(path: string, body: unknown = {}, method = "POST") {
	const epoch = accessGeneration();
	const response = await fetch(`/api/auth/${path}`, {
		signal: accessSignal(),
		method,
		cache: "no-store",
		headers: {
			"Content-Type": "application/json",
			"X-Factory-Request": "1",
			"X-Factory-Build": uiBuild,
		},
		...(method !== "GET" ? { body: JSON.stringify(body) } : {}),
	});
	if (response.status === 401)
		accessRequired("Your session expired. Sign in again.");
	const result = await response.json();
	if (epoch !== accessGeneration()) throw new Error("Session changed");
	if (result.code === "FACTORY_VERSION_MISMATCH") versionMismatch();
	if (!response.ok) throw new Error(result.error ?? "Passkey request failed");
	return result;
}
async function ceremony(
	purpose: "login" | "register",
	grant?: string,
	label?: string,
) {
	const { transaction, options } = await authRequest(`${purpose}/options`, {
		grant,
		label,
	});
	const response =
		purpose === "login"
			? await startAuthentication({ optionsJSON: options })
			: await startRegistration({ optionsJSON: options });
	await authRequest(`${purpose}/verify`, { transaction, response });
	// The verified ceremony rotated the session. Refresh its deadline without
	// unmounting an in-progress credential management action. Failed checks
	// still clear access through the normal boundary.
	await checkAccess(true);
}
// Local-launch fragments never reach HTTP logs. Consume before the router or browser
// history can retain the one-time grant, and keep it only in this component's memory.
const launchedGrant = (() => {
	if (
		location.protocol !== "http:" ||
		!["localhost", "127.0.0.1"].includes(location.hostname)
	)
		return "";
	const match = /^#setup=([A-Za-z0-9_-]{43})$/.exec(location.hash);
	if (!match) return "";
	history.replaceState(
		history.state,
		"",
		`${location.pathname}${location.search}#/`,
	);
	return match[1]!;
})();
export function AccessBoundary({ children }: { children: ReactNode }) {
	const access = useAccess();
	const pwa = usePwa();
	const [grant, setGrant] = useState(launchedGrant);
	const [label, setLabel] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const updateRequired = pwa.status === "mismatch" || pwa.updating;
	useEffect(() => {
		if (location.hostname === "127.0.0.1") {
			const canonical = new URL(location.href);
			canonical.hostname = "localhost";
			location.replace(canonical.href);
			return;
		}
		void checkAccess();
		const visible = () => {
			if (document.visibilityState === "visible") void checkAccess();
		};
		const page = () => {
			void checkAccess();
		};
		window.addEventListener("pageshow", page);
		document.addEventListener("visibilitychange", visible);
		window.addEventListener("online", page);
		const offline = () =>
			accessRequired("Factory is offline. Reconnect to sign in.");
		window.addEventListener("offline", offline);
		return () => {
			window.removeEventListener("pageshow", page);
			document.removeEventListener("visibilitychange", visible);
			window.removeEventListener("online", page);
			window.removeEventListener("offline", offline);
		};
	}, []);
	useEffect(() => {
		if (access.status === "authenticated") {
			setGrant("");
			setLabel("");
			setError(undefined);
		}
	}, [access.status]);
	if (access.status === "authenticated") return <>{children}</>;

	const submit = async (enroll: boolean) => {
		setBusy(true);
		setError(undefined);
		try {
			await ceremony(enroll ? "register" : "login", grant || undefined, label);
			setGrant("");
		} catch (error) {
			setError(
				error instanceof Error
					? error.message
					: "Passkey cancelled. Try again.",
			);
		} finally {
			setBusy(false);
		}
	};
	return (
		<main className="auth-screen">
			<section className="auth-card">
				<Bob mood="busy" size={90} />
				<h1>
					{access.status === "checking"
						? "Checking Factory access…"
						: access.setupRequired
							? "Set up your first passkey"
							: "Sign in to Bob’s Factory"}
				</h1>
				<p>
					Use your device’s fingerprint, face recognition or security key to
					protect your Factory.
				</p>
				<ConnectionNotice hasData={false} signedOut />
				{access.status !== "checking" && (
					<>
						<p>{access.error}</p>
						{!browserSupportsWebAuthn() && (
							<p role="alert">
								This browser cannot use passkeys. Open Factory in a current
								browser at HTTPS or localhost.
							</p>
						)}
						{error && <p role="alert">{error}</p>}
						{!access.setupRequired && (
							<Button
								className="auth-sign-in"
								disabled={busy || updateRequired || !browserSupportsWebAuthn()}
								onClick={() => void submit(false)}
							>
								{busy ? "Waiting for your passkey…" : "Sign in with passkey"}
							</Button>
						)}
						<details
							className="auth-setup"
							open={access.setupRequired || undefined}
						>
							<summary>
								{access.setupRequired
									? "First passkey setup"
									: "Set up a new passkey"}
							</summary>
							<p>
								{launchedGrant && grant
									? "Your local launcher authorized setup. Choose a name and create your passkey."
									: "The terminal that launched Bob shows your private setup code. Paste it here to create your first passkey."}{" "}
								Phone and security-key passkeys are supported.
							</p>
							<label>
								Setup code
								<input
									autoComplete="off"
									type="password"
									value={grant}
									onChange={(e) => setGrant(e.target.value.trim())}
								/>
							</label>
							<label>
								Passkey name
								<input
									maxLength={80}
									value={label}
									onChange={(e) => setLabel(e.target.value)}
									placeholder="My phone"
								/>
							</label>
							<Button
								disabled={
									busy || updateRequired || !browserSupportsWebAuthn() || !grant
								}
								onClick={() => void submit(true)}
							>
								{busy ? "Waiting for your passkey…" : "Create passkey"}
							</Button>
						</details>
					</>
				)}
			</section>
		</main>
	);
}
type Passkey = { id: string; label: string; origin: string; createdAt: number };

export function AccessSettings() {
	const [keys, setKeys] = useState<Passkey[]>(),
		[error, setError] = useState<string>(),
		[busy, setBusy] = useState(false),
		[adding, setAdding] = useState(false),
		[label, setLabel] = useState("");
	const run = useCallback(async (action: () => Promise<void>) => {
		setBusy(true);
		setError(undefined);
		try {
			await action();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Passkey action failed");
		} finally {
			setBusy(false);
		}
	}, []);
	const load = useCallback(
		async () => setKeys(await authRequest("credentials", undefined, "GET")),
		[],
	);
	useEffect(() => {
		void run(load);
	}, [run, load]);
	return (
		<div className="access-settings">
			<h2>Access</h2>
			<p className="intro">Manage access to your Factory.</p>
			<section className="settings-card" aria-labelledby="passkeys-heading">
				<div className="settings-heading">
					<div>
						<h2 id="passkeys-heading">Passkeys</h2>
						<p>Use a saved passkey to sign in on your devices.</p>
					</div>
					<Button
						variant="secondary"
						disabled={busy}
						onClick={() => {
							setAdding(!adding);
							setLabel("");
							setError(undefined);
						}}
						aria-expanded={adding}
					>
						Add passkey
					</Button>
				</div>
				{error && (
					<p className="settings-error" role="alert">
						{error}
					</p>
				)}
				{!keys && (
					<Button
						disabled={busy}
						variant="secondary"
						onClick={() =>
							void run(async () => {
								await ceremony("login");
								await load();
							})
						}
					>
						{busy ? "Loading passkeys…" : "Verify to view passkeys"}
					</Button>
				)}
				{adding && (
					<form
						className="passkey-add"
						onSubmit={(event) => {
							event.preventDefault();
							void run(async () => {
								await ceremony("login");
								await ceremony("register", undefined, label);
								await load();
								setAdding(false);
								setLabel("");
							});
						}}
					>
						<label>
							Passkey name
							<input
								maxLength={80}
								required
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								placeholder="My phone"
							/>
						</label>
						<p>You’ll verify an existing passkey, then create the new one.</p>
						<div className="settings-actions">
							<Button type="submit" disabled={busy || !label.trim()}>
								Continue
							</Button>
							<Button
								variant="secondary"
								disabled={busy}
								onClick={() => {
									setAdding(false);
									setLabel("");
									setError(undefined);
								}}
							>
								Cancel
							</Button>
						</div>
					</form>
				)}
				<ul className="passkey-list">
					{keys?.map((key) => (
						<li key={key.id}>
							<div>
								<strong>{key.label}</strong>
								<span>
									Added {new Date(key.createdAt).toLocaleDateString()}
								</span>
								<span>{key.origin}</span>
							</div>
							<Button
								variant="secondary"
								disabled={busy}
								aria-label={`Remove ${key.label}`}
								onClick={() => {
									if (
										!window.confirm(
											`Remove ${key.label} and revoke its sessions?`,
										)
									)
										return;
									void run(async () => {
										await ceremony("login");
										await authRequest(
											`credentials/${encodeURIComponent(key.id)}`,
											{},
											"DELETE",
										);
										await load();
									});
								}}
							>
								Remove
							</Button>
						</li>
					))}
				</ul>
				<p className="settings-hint">
					Passkeys work at the address where they were created. Keep at least
					one for each address.
				</p>
			</section>
			<section className="settings-card" aria-labelledby="session-heading">
				<h2 id="session-heading">This session</h2>
				<p>
					Signing out discards unsent edits and review comments in every Factory
					tab.
				</p>
				<Button
					variant="secondary"
					disabled={busy}
					onClick={() => {
						if (
							!window.confirm(
								"Sign out? Unsent edits and review comments will be discarded in every Factory tab.",
							)
						)
							return;
						void run(async () => {
							await authRequest("logout");
							accessRequired("Signed out", true);
						});
					}}
				>
					Sign out
				</Button>
			</section>
		</div>
	);
}
