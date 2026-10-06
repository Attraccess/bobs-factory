import {
	browserSupportsWebAuthn,
	startAuthentication,
	startRegistration,
	WebAuthnAbortService,
} from "@simplewebauthn/browser";
import { type ReactNode, useEffect, useState } from "react";
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
	await checkAccess();
}
export function AccessBoundary({ children }: { children: ReactNode }) {
	const access = useAccess();
	const pwa = usePwa();
	const [grant, setGrant] = useState("");
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
	if (access.status === "authenticated") return <>{children}</>;
	const enroll = access.setupRequired || Boolean(grant);
	const submit = async () => {
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
					Passkeys protect your Factory on every address, including localhost.
				</p>
				<ConnectionNotice hasData={false} signedOut />
				{access.status !== "checking" && (
					<>
						<p>{access.error}</p>
						{access.setupRequired && (
							<p>
								Get a single-use setup code from the operator on the Factory
								machine. Create this passkey at the address where you will use
								it. Phone and security-key passkeys are supported.
							</p>
						)}
						<label>
							Operator setup code (for a new passkey)
							<input
								autoComplete="off"
								type="password"
								value={grant}
								onChange={(e) => setGrant(e.target.value.trim())}
							/>
						</label>
						{enroll && (
							<label>
								Passkey name
								<input
									maxLength={80}
									value={label}
									onChange={(e) => setLabel(e.target.value)}
									placeholder="My phone"
								/>
							</label>
						)}
						{!browserSupportsWebAuthn() && (
							<p role="alert">
								This browser cannot use passkeys. Open Factory in a current
								browser at HTTPS or localhost.
							</p>
						)}
						{error && <p role="alert">{error}</p>}
						<Button
							disabled={
								busy ||
								updateRequired ||
								!browserSupportsWebAuthn() ||
								(Boolean(access.setupRequired) && !grant)
							}
							onClick={() => void submit()}
						>
							{busy
								? "Waiting for your passkey…"
								: enroll
									? "Create passkey"
									: "Sign in with passkey"}
						</Button>
						<Button onClick={() => void checkAccess()} disabled={busy}>
							Check connection
						</Button>
					</>
				)}
			</section>
		</main>
	);
}
export function PasskeyControls() {
	const [open, setOpen] = useState(false),
		[keys, setKeys] = useState<any[]>([]),
		[error, setError] = useState<string>(),
		[busy, setBusy] = useState(false);
	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		setError(undefined);
		try {
			await action();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Passkey action failed");
		} finally {
			setBusy(false);
		}
	};
	const load = async () =>
		setKeys(await authRequest("credentials", undefined, "GET"));
	return (
		<div className="auth-controls">
			<Button
				onClick={() => {
					setOpen(!open);
					if (!open) void run(load);
				}}
			>
				Passkeys
			</Button>
			<Button
				disabled={busy}
				onClick={() => {
					if (
						!window.confirm(
							"Sign out? Unsent edits, review comments and saved drafts will be discarded in every Factory tab.",
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
			{open && (
				<section className="auth-card">
					<h2>Your passkeys</h2>
					<p>
						Passkeys belong to the address where they were created. Verify again
						before managing keys.
					</p>
					<Button
						disabled={busy}
						onClick={() =>
							void run(async () => {
								await ceremony("login");
								await load();
							})
						}
					>
						Verify passkey again
					</Button>
					<Button
						disabled={busy}
						onClick={() =>
							void run(async () => {
								const label = window.prompt("Name this passkey", "My phone");
								if (label === null) return;
								await ceremony("register", undefined, label);
								await load();
							})
						}
					>
						Add passkey
					</Button>
					{keys.map((key) => (
						<div key={key.id}>
							<strong>{key.label}</strong>
							<p>{key.origin}</p>
							<Button
								disabled={busy}
								onClick={() =>
									void run(async () => {
										if (
											!window.confirm(
												`Remove ${key.label} and revoke its sessions?`,
											)
										)
											return;
										await authRequest(
											`credentials/${encodeURIComponent(key.id)}`,
											{},
											"DELETE",
										);
										await load();
									})
								}
							>
								Remove
							</Button>
						</div>
					))}
					{error && <p role="alert">{error}</p>}
				</section>
			)}
		</div>
	);
}
