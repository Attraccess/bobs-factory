import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ordinarySettings } from "./ExecutionSettings.js";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const mode = z.enum(["share", "overlay", "factory-only"]);
const path = z.string().min(1).max(4096);
const endpoint = z
	.string()
	.url()
	.refine((value) => {
		const url = new URL(value);
		return !url.username && !url.password && !url.search && !url.hash;
	}, "Endpoint URLs must not embed credentials or query parameters; use credential references");
const person = z
	.object({ name: z.string().min(1).max(200), email: z.string().email() })
	.strict();
export const CredentialReferenceSchema = z.discriminatedUnion("source", [
	z
		.object({
			source: z.literal("github-app"),
			appId: z.number().int().positive(),
			installationId: z.number().int().positive(),
			privateKeyFile: path,
			version: id,
			owner: z.string().min(1).max(200),
		})
		.strict(),
	z
		.object({
			source: z.literal("env"),
			name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
			version: id,
			owner: z.string().min(1).max(200),
		})
		.strict(),
	z
		.object({
			source: z.literal("file"),
			path,
			version: id,
			owner: z.string().min(1).max(200),
		})
		.strict(),
	z
		.object({
			source: z.enum(["gh", "glab"]),
			host: z.string().regex(/^[a-zA-Z0-9.-]+$/),
			account: z
				.string()
				.regex(/^[a-zA-Z0-9_-]+$/)
				.optional(),
			configDirectory: path.optional(),
			version: id,
			owner: z.string().min(1).max(200),
		})
		.strict(),
]);
export type CredentialReference = z.infer<typeof CredentialReferenceSchema>;
const identity = z
	.object({ mode, value: person.optional() })
	.strict()
	.refine(
		(v) => v.mode === "share" || !!v.value,
		"Explicit Git identity is required",
	);
const signing = z.discriminatedUnion("format", [
	z.object({ format: z.literal("share") }).strict(),
	z.object({ format: z.literal("disabled") }).strict(),
	z
		.object({
			format: z.literal("ssh"),
			key: path,
			agent: path.optional(),
			allowedSigners: path.optional(),
			commits: z.boolean(),
			tags: z.boolean(),
		})
		.strict(),
	z
		.object({
			format: z.literal("openpgp"),
			home: path,
			fingerprint: z.string().regex(/^[A-Fa-f0-9]{40,64}$/),
			commits: z.boolean(),
			tags: z.boolean(),
		})
		.strict(),
]);
export const IdentityProfileSchema = z
	.object({
		id,
		revision: z.number().int().positive(),
		name: z.string().min(1).max(120),
		author: identity,
		committer: identity,
		signing,
		repositories: z
			.array(
				z
					.object({
						host: z.string().regex(/^[a-zA-Z0-9.-]+$/),
						provider: z.enum(["github", "gitlab"]),
						mode,
						apiUrl: endpoint.optional(),
						account: z.string().min(1).max(200),
						credential: CredentialReferenceSchema,
						ssh: z
							.object({
								alias: z.string().regex(/^[a-zA-Z0-9.-]+$/),
								hostname: z.string().regex(/^[a-zA-Z0-9.-]+$/),
								user: z
									.string()
									.regex(/^[a-zA-Z0-9_-]+$/)
									.default("git"),
								key: path,
								knownHosts: path,
								agent: path.optional(),
								port: z.number().int().min(1).max(65535).default(22),
							})
							.strict()
							.optional(),
					})
					.strict(),
			)
			.max(20),
		runners: z.partialRecord(
			z.enum(["claude", "codex", "gemini", "cursor", "opencode"]),
			z
				.object({
					mode,
					credential: CredentialReferenceSchema.optional(),
					configDirectory: path.optional(),
					account: z.string().email().optional(),
					provider: z.enum(["anthropic", "openai", "google", "cursor"]),
					kind: z.enum(["api-key", "setup-token", "native-login"]).optional(),
				})
				.strict()
				.superRefine((auth, context) => {
					if (auth.kind === "native-login") {
						if (
							auth.mode !== "share" ||
							!auth.configDirectory ||
							!auth.account ||
							auth.credential
						)
							context.addIssue({
								code: "custom",
								message:
									"Native login requires Share mode, an existing configuration directory and account email; no credential copying",
							});
					} else if (!auth.credential || auth.configDirectory || auth.account)
						context.addIssue({
							code: "custom",
							message: "API authentication requires a credential reference",
						});
				}),
		),
	})
	.strict();
export type IdentityProfile = z.infer<typeof IdentityProfileSchema>;
const envValue = z.union([
	z.object({ literal: z.string().max(4096) }).strict(),
	CredentialReferenceSchema,
]);
const server = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("stdio"),
			command: path,
			args: z.array(z.string()).default([]),
			env: z.record(z.string(), envValue).default({}),
		})
		.strict(),
	z
		.object({
			type: z.enum(["http", "sse"]),
			url: endpoint,
			headers: z.record(z.string(), CredentialReferenceSchema).default({}),
		})
		.strict(),
]);
export const ToolProfileSchema = z
	.object({
		id,
		revision: z.number().int().positive(),
		name: z.string().min(1).max(120),
		mode,
		runnerSettingsSources: z
			.partialRecord(
				z.enum(["claude", "codex", "gemini", "cursor", "opencode"]),
				z.array(path),
			)
			.optional(),
		runnerSettings: z
			.partialRecord(
				z.enum(["claude", "codex", "gemini", "cursor", "opencode"]),
				z.record(z.string(), z.unknown()),
			)
			.optional(),
		// Sources remain references: secret-bearing host definitions never enter run JSON.
		sources: z.array(path).default([]),
		mcp: z.record(id, server).default({}),
		remove: z.array(id).default([]),
		denyTools: z.array(z.string().min(1)).default([]),
	})
	.strict()
	.superRefine((value, context) => {
		for (const [runner, settings] of Object.entries(
			value.runnerSettings ?? {},
		)) {
			try {
				ordinarySettings(
					runner as import("bobs-factory-core").RunnerType,
					settings,
				);
			} catch (error) {
				context.addIssue({ code: "custom", message: (error as Error).message });
			}
		}
		if (
			value.mode === "factory-only" &&
			(value.sources.length ||
				Object.values(value.runnerSettingsSources ?? {}).some(
					(paths) => paths.length,
				))
		)
			context.addIssue({
				code: "custom",
				message: "Factory-only tools cannot import automatic host sources",
			});
		if (
			Object.hasOwn(value.mcp, "factory-context") ||
			value.remove.includes("factory-context")
		)
			context.addIssue({
				code: "custom",
				message: "factory-context is reserved infrastructure",
			});
		for (const config of Object.values(value.mcp))
			if ("env" in config)
				for (const [name, val] of Object.entries(config.env)) {
					if (
						"literal" in val &&
						/TOKEN|SECRET|PASSWORD|KEY|AUTH|COOKIE|CREDENTIAL/i.test(name)
					)
						context.addIssue({
							code: "custom",
							message: `MCP ${name} requires a credential reference`,
						});
				}
	});
export type ToolProfile = z.infer<typeof ToolProfileSchema>;
export const ExecutionSelectionSchema = z
	.object({ identityProfile: id.optional(), toolProfile: id.optional() })
	.strict();
export type ExecutionSelection = z.infer<typeof ExecutionSelectionSchema>;
export const ExecutionProfilesSchema = z
	.object({
		schemaVersion: z.literal(1),
		revision: z.number().int().nonnegative(),
		identities: z.array(IdentityProfileSchema),
		tools: z.array(ToolProfileSchema),
		defaults: ExecutionSelectionSchema,
		repositories: z.record(z.string(), ExecutionSelectionSchema),
	})
	.strict()
	.superRefine((value, context) => {
		for (const list of [value.identities, value.tools]) {
			if (new Set(list.map((p) => p.id)).size !== list.length)
				context.addIssue({
					code: "custom",
					message: "Duplicate execution profile ID",
				});
		}
		for (const selected of [
			value.defaults,
			...Object.values(value.repositories),
		]) {
			if (
				selected.identityProfile &&
				!value.identities.some((p) => p.id === selected.identityProfile)
			)
				context.addIssue({
					code: "custom",
					message: "Unknown default identity profile",
				});
			if (
				selected.toolProfile &&
				!value.tools.some((p) => p.id === selected.toolProfile)
			)
				context.addIssue({
					code: "custom",
					message: "Unknown default tool profile",
				});
		}
	});
export type ExecutionProfiles = z.infer<typeof ExecutionProfilesSchema>;
export interface ExecutionSnapshot {
	schemaVersion: 1;
	identity?: IdentityProfile;
	tools?: ToolProfile;
	sources: {
		identity: "manual" | "repository" | "factory" | "legacy";
		tools: "manual" | "repository" | "factory" | "legacy";
	};
}

/** Synchronous compare-and-swap against disk avoids stale editor and service writes. */
export class ExecutionProfileStore {
	private file: string;
	constructor(directory: string) {
		this.file = join(directory, "execution-profiles.json");
	}
	read(): ExecutionProfiles {
		return existsSync(this.file)
			? ExecutionProfilesSchema.parse(
					JSON.parse(readFileSync(this.file, "utf8")),
				)
			: {
					schemaVersion: 1,
					revision: 0,
					identities: [],
					tools: [],
					defaults: {},
					repositories: {},
				};
	}
	save(input: unknown, expectedRevision: number): ExecutionProfiles {
		mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
		const lock = `${this.file}.lock`;
		try {
			writeFileSync(lock, String(process.pid), { mode: 0o600, flag: "wx" });
		} catch {
			throw new Error(
				"Execution profile store is busy. Retry after the current save finishes; inspect a stale lock before removing it.",
			);
		}
		const temp = `${this.file}.${randomUUID()}.tmp`;
		try {
			const current = this.read();
			if (current.revision !== expectedRevision)
				throw new Error(
					"Execution profiles changed. Refresh and review your saved draft.",
				);
			const next = ExecutionProfilesSchema.parse(input);
			for (const key of ["identities", "tools"] as const)
				for (const profile of next[key]) {
					const previous = current[key].find((p) => p.id === profile.id);
					profile.revision = previous ? previous.revision + 1 : 1;
				}
			next.revision = current.revision + 1;
			writeFileSync(temp, JSON.stringify(next, null, 2), {
				mode: 0o600,
				flag: "wx",
			});
			renameSync(temp, this.file);
			return next;
		} finally {
			if (existsSync(temp)) unlinkSync(temp);
			unlinkSync(lock);
		}
	}

	select(
		repositoryId: string,
		manual: ExecutionSelection = {},
	): ExecutionSnapshot | undefined {
		const config = this.read();
		const local = config.repositories[repositoryId] ?? {};
		const pick = (key: keyof ExecutionSelection) =>
			manual[key]
				? "manual"
				: local[key]
					? "repository"
					: config.defaults[key]
						? "factory"
						: "legacy";
		const defined = (value: ExecutionSelection) =>
			Object.fromEntries(
				Object.entries(value).filter(([, entry]) => entry !== undefined),
			);
		const selected = {
			...defined(config.defaults),
			...defined(local),
			...defined(manual),
		};
		const identity = config.identities.find(
			(p) => p.id === selected.identityProfile,
		);
		const tools = config.tools.find((p) => p.id === selected.toolProfile);
		if (selected.identityProfile && !identity)
			throw new Error("Identity profile unavailable");
		if (selected.toolProfile && !tools)
			throw new Error("Tool profile unavailable");
		return identity || tools
			? structuredClone({
					schemaVersion: 1,
					identity,
					tools,
					sources: {
						identity: pick("identityProfile"),
						tools: pick("toolProfile"),
					},
				})
			: undefined;
	}
}

export const ExecutionSnapshotSchema = z
	.object({
		schemaVersion: z.literal(1),
		identity: IdentityProfileSchema.optional(),
		tools: ToolProfileSchema.optional(),
		sources: z
			.object({
				identity: z.enum(["manual", "repository", "factory", "legacy"]),
				tools: z.enum(["manual", "repository", "factory", "legacy"]),
			})
			.strict(),
	})
	.strict();
