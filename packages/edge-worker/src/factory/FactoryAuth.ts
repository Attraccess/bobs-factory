import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
	type AuthenticationResponseJSON,
	generateAuthenticationOptions,
	generateRegistrationOptions,
	type RegistrationResponseJSON,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { z } from "zod";
import {
	atomicPrivateFile,
	FactoryAuthStore,
	privateFile,
} from "./FactoryAuthStore.js";

const secret = () => randomBytes(32).toString("base64url");
const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const grantSchema = z.object({
	token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
	expires: z.number(),
});
const maxPending = 100;
export interface FactoryAccess {
	origins: string[];
	sessionHours?: number;
}
export function factoryAccess(
	port: number,
	remoteOrigin?: string,
	sessionHours = 12,
): FactoryAccess {
	const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
	if (remoteOrigin) {
		const url = new URL(remoteOrigin);
		if (
			url.protocol !== "https:" ||
			url.origin !== remoteOrigin ||
			url.username ||
			url.password ||
			url.hostname.includes("*") ||
			url.hostname === "localhost"
		)
			throw new Error("Factory public origin must be an exact HTTPS origin");
		origins.push(remoteOrigin);
	}
	return { origins, sessionHours };
}
type Ceremony = {
	challenge: string;
	purpose: "login" | "register";
	origin: string;
	expires: number;
	binding: string;
	session?: string;
	label?: string;
	epoch: number;
};
export class FactoryAuth {
	readonly store: FactoryAuthStore;
	private ceremonies = new Map<string, Ceremony>();
	private epoch = 0;
	private listeners = new Set<() => void>();
	private attempts = 0;
	private window = Date.now();
	private recoveryTimer: ReturnType<typeof setInterval>;
	readonly sessionMs: number;
	constructor(
		directory: string,
		readonly access: FactoryAccess,
	) {
		const hours = access.sessionHours ?? 12;
		if (!Number.isFinite(hours) || hours < 1 || hours > 24)
			throw new Error(
				"Factory session lifetime must be between 1 and 24 hours",
			);
		for (const origin of access.origins) {
			const url = new URL(origin);
			if (
				url.origin !== origin ||
				url.username ||
				url.password ||
				url.hostname.includes("*") ||
				!(
					url.protocol === "https:" ||
					(url.protocol === "http:" &&
						["localhost", "127.0.0.1"].includes(url.hostname))
				)
			)
				throw new Error("Invalid Factory authentication origin");
		}
		if (
			!access.origins.length ||
			new Set(access.origins).size !== access.origins.length
		)
			throw new Error("Invalid Factory authentication origins");
		this.sessionMs = hours * 3600000;
		this.store = new FactoryAuthStore(directory, access.origins);
		// An enrollment authorization never survives a server restart.
		if (existsSync(this.grantPath)) unlinkSync(this.grantPath);
		if (!this.store.state.credentials.length) this.createGrant();
		this.recoveryTimer = setInterval(() => this.checkRecovery(), 1000);
		this.recoveryTimer.unref();
	}
	get grantPath() {
		return join(this.store.directory, "enroll.json");
	}
	private createGrant() {
		atomicPrivateFile(
			this.grantPath,
			JSON.stringify({ token: secret(), expires: Date.now() + 600000 }),
		);
	}
	checkRecovery() {
		const path = join(this.store.directory, "recover");
		if (!existsSync(path)) return;
		if (privateFile(path).trim() !== "RESET FACTORY AUTHENTICATION") return;
		this.store.update((state) => {
			state.credentials = [];
			state.sessions = [];
			state.user = secret();
		});
		unlinkSync(path);
		this.epoch++;
		this.ceremonies.clear();
		this.createGrant();
		this.changed();
	}
	subscribe(listener: () => void) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	private changed() {
		for (const listener of this.listeners) listener();
	}
	close() {
		clearInterval(this.recoveryTimer);
		this.ceremonies.clear();
		this.listeners.clear();
	}
	session(token: string | undefined, origin: string) {
		if (!token || token.length > 100) return undefined;
		return this.store.state.sessions.find(
			(s) =>
				s.hash === hash(token) && s.origin === origin && s.expires > Date.now(),
		);
	}
	recent(token: string | undefined, origin: string) {
		const session = this.session(token, origin);
		if (!session || Date.now() - session.verifiedAt > 300000)
			throw new Error("Verify your passkey again before managing credentials");
		return session;
	}
	private limit() {
		const now = Date.now();
		for (const [id, c] of this.ceremonies)
			if (c.expires <= now) this.ceremonies.delete(id);
		if (now - this.window > 60000) {
			this.window = now;
			this.attempts = 0;
		}
		// Global resource bound, independent of untrusted proxy IP/forwarded headers.
		if (++this.attempts > 60 || this.ceremonies.size >= maxPending)
			throw new Error("Too many passkey attempts. Try again in a minute.");
	}
	async options(
		purpose: "login" | "register",
		origin: string,
		binding: string,
		token?: string,
		grant?: string,
		label = "Passkey",
	) {
		this.limit();
		const epoch = this.epoch;
		let session: string | undefined;
		if (purpose === "register") {
			if (token && this.session(token, origin))
				session = this.recent(token, origin).hash;
			else {
				if (!grant || !existsSync(this.grantPath))
					throw new Error("A local operator setup code is required");
				const authorization = grantSchema.parse(
					JSON.parse(privateFile(this.grantPath)),
				);
				if (
					authorization.expires < Date.now() ||
					authorization.expires > Date.now() + 600000 ||
					!timingSafeEqual(
						Buffer.from(hash(grant)),
						Buffer.from(hash(authorization.token)),
					)
				)
					throw new Error("Invalid or expired setup code");
				// Consume before any asynchronous work, including generation/verification.
				unlinkSync(this.grantPath);
			}
		}
		const rpID = new URL(origin).hostname;
		const options =
			purpose === "login"
				? await generateAuthenticationOptions({
						rpID,
						userVerification: "required",
					})
				: await generateRegistrationOptions({
						rpName: "Bob's Factory",
						rpID,
						userName: "Factory operator",
						userID: new Uint8Array(
							Buffer.from(this.store.state.user, "base64url"),
						),
						attestationType: "none",
						authenticatorSelection: {
							residentKey: "required",
							userVerification: "required",
						},
						excludeCredentials: this.store.state.credentials
							.filter((c) => c.origin === origin)
							.map((c) => ({ id: c.id, transports: c.transports })),
					});
		if (epoch !== this.epoch) throw new Error("Authentication was reset");
		const transaction = secret();
		this.ceremonies.set(transaction, {
			challenge: options.challenge,
			purpose,
			origin,
			binding: hash(binding),
			expires: Date.now() + 300000,
			session,
			label: label.trim().slice(0, 80) || "Passkey",
			epoch,
		});
		return { transaction, options };
	}
	async verify(
		purpose: "login" | "register",
		transaction: string,
		origin: string,
		binding: string,
		response: AuthenticationResponseJSON | RegistrationResponseJSON,
	) {
		const c = this.ceremonies.get(transaction);
		this.ceremonies.delete(transaction);
		if (
			!c ||
			c.purpose !== purpose ||
			c.origin !== origin ||
			c.binding !== hash(binding) ||
			c.expires <= Date.now() ||
			c.epoch !== this.epoch
		)
			throw new Error("Invalid, expired or already used passkey challenge");
		const expected = {
			expectedChallenge: c.challenge,
			expectedOrigin: origin,
			expectedRPID: new URL(origin).hostname,
			requireUserVerification: true,
		};
		let credentialId: string;
		if (purpose === "register") {
			const result = await verifyRegistrationResponse({
				...expected,
				response: response as RegistrationResponseJSON,
			});
			if (!result.verified || !result.registrationInfo)
				throw new Error("Passkey verification failed");
			const info = result.registrationInfo;
			credentialId = info.credential.id;
			if (c.epoch !== this.epoch) throw new Error("Authentication was reset");
			this.store.update((state) => {
				if (
					c.session &&
					!state.sessions.some(
						(s) =>
							s.hash === c.session &&
							s.expires > Date.now() &&
							Date.now() - s.verifiedAt <= 300000,
					)
				)
					throw new Error("Verification expired");
				if (state.credentials.some((key) => key.id === credentialId))
					throw new Error("Passkey already registered");
				state.credentials.push({
					...info.credential,
					origin,
					publicKey: Buffer.from(info.credential.publicKey).toString(
						"base64url",
					),
					deviceType: info.credentialDeviceType,
					backedUp: info.credentialBackedUp,
					label: c.label!,
					createdAt: Date.now(),
					lastUsedAt: Date.now(),
				});
			});
		} else {
			const key = this.store.state.credentials.find(
				(key) => key.id === response.id && key.origin === origin,
			);
			if (!key) throw new Error("Unknown passkey");
			const counter = key.counter;
			const result = await verifyAuthenticationResponse({
				...expected,
				response: response as AuthenticationResponseJSON,
				credential: {
					...key,
					publicKey: new Uint8Array(Buffer.from(key.publicKey, "base64url")),
				},
			});
			if (!result.verified || c.epoch !== this.epoch)
				throw new Error("Passkey verification failed");
			credentialId = key.id;
			this.store.update((state) => {
				const current = state.credentials.find(
					(key) => key.id === credentialId,
				);
				if (!current || current.counter !== counter)
					throw new Error("Passkey changed during verification. Try again.");
				current.counter = result.authenticationInfo.newCounter;
				current.backedUp = result.authenticationInfo.credentialBackedUp;
				current.lastUsedAt = Date.now();
			});
		}
		const token = secret(),
			now = Date.now();
		this.store.update((state) => {
			// Rotate the browser's existing session; cap durable sessions to bound the store.
			if (c.session)
				state.sessions = state.sessions.filter((s) => s.hash !== c.session);
			state.sessions = state.sessions.slice(-199);
			state.sessions.push({
				hash: hash(token),
				credential: credentialId,
				origin,
				verifiedAt: now,
				expires: now + this.sessionMs,
			});
		});
		this.changed();
		return { token, expires: now + this.sessionMs };
	}
	logout(token: string | undefined, origin: string) {
		const session = this.session(token, origin);
		if (session)
			this.store.update((state) => {
				state.sessions = state.sessions.filter((s) => s.hash !== session.hash);
			});
		this.changed();
	}
	credentials(token: string | undefined, origin: string) {
		this.recent(token, origin);
		return this.store.state.credentials.map(
			({ id, label, origin, createdAt, lastUsedAt, deviceType, backedUp }) => ({
				id,
				label,
				origin,
				createdAt,
				lastUsedAt,
				deviceType,
				backedUp,
			}),
		);
	}
	remove(token: string | undefined, origin: string, id: string) {
		this.recent(token, origin);
		this.store.update((state) => {
			const key = state.credentials.find((key) => key.id === id);
			if (!key) throw new Error("Unknown passkey");
			if (state.credentials.filter((c) => c.origin === key.origin).length <= 1)
				throw new Error(
					"Keep at least one passkey for each address. Use local recovery if the last key is lost.",
				);
			state.credentials = state.credentials.filter((c) => c.id !== id);
			state.sessions = state.sessions.filter((s) => s.credential !== id);
		});
		this.changed();
	}
}
