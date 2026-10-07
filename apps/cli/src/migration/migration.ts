import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { CapacityStateSchema, resolvePath } from "bobs-factory-core";
import { canonicalPath } from "./paths.js";
import {
	nativeSessions,
	type PreservationPlan,
	PreservationPlanSchema,
	verifyContinuations,
} from "./preservation.js";
import {
	transformEnvironment,
	transformMcpConfig,
	transformRun,
	transformState,
	transformWorkflow,
} from "./transform.js";
import {
	discoverWorktrees,
	type GitRepair,
	relocated,
	repairWorktrees,
} from "./worktrees.js";

const hash = (value: Buffer | string) =>
	createHash("sha256").update(value).digest("hex");
type Entry = {
	path: string;
	type: "file" | "link" | "directory";
	mode: number;
	sha256?: string;
};
export type MigrationManifest = {
	version: 1;
	gitRepairs?: GitRepair[];
	externalBackups?: {
		path: string;
		entries: Entry[];
		digest: string;
		restore?: boolean;
	}[];
	preservationPlan?: PreservationPlan;
	source: string;
	destination: string;
	sourceDigest: string;
	entries: Entry[];
	conflicts: string[];
	blockers: string[];
	operations: string[];
	preservedExternalPaths: string[];
};
function contained(parent: string, child: string) {
	const suffix = relative(parent, child);
	return (
		suffix === "" ||
		(suffix !== ".." && !suffix.startsWith("../") && !isAbsolute(suffix))
	);
}
/** Inventory hashes content; it never serializes credential values or link targets. */
function inventory(home: string): Entry[] {
	const entries: Entry[] = [];
	function visit(path: string) {
		const stat = lstatSync(path);
		const name = relative(home, path);
		if (stat.isSymbolicLink())
			entries.push({
				path: name,
				type: "link",
				mode: stat.mode & 0o777,
				sha256: hash(readlinkSync(path)),
			});
		else if (stat.isDirectory()) {
			entries.push({ path: name, type: "directory", mode: stat.mode & 0o777 });
			for (const child of readdirSync(path).sort()) visit(join(path, child));
		} else if (stat.isFile())
			entries.push({
				path: name,
				type: "file",
				mode: stat.mode & 0o777,
				sha256: hash(readFileSync(path)),
			});
		else throw new Error(`Unsupported state entry: ${name}`);
	}
	visit(home);
	return entries;
}
function readJson(path: string) {
	return JSON.parse(readFileSync(path, "utf8"));
}
function migrationMcpFiles(source: string, entries: Entry[]): Set<string> {
	const files = new Set(
		entries
			.filter(
				(entry) =>
					entry.type === "file" && /^mcp-configs\/.*\.json$/.test(entry.path),
			)
			.map((entry) => entry.path),
	);
	const configPath = join(source, "config.json");
	if (!existsSync(configPath)) return files;
	const config = readJson(configPath);
	const references = [
		config.linearMcpConfigs,
		config.slackMcpConfigs,
		config.githubMcpConfigs,
		...(config.repositories ?? []).map(
			(repo: { mcpConfigPath?: unknown }) => repo.mcpConfigPath,
		),
	]
		.flat()
		.filter((path) => path !== undefined);
	for (const reference of references) {
		if (
			typeof reference !== "string" ||
			(!isAbsolute(reference) && !reference.startsWith("~/"))
		)
			throw new Error("Relative MCP paths require explicit reconciliation");
		const path = resolvePath(
			transformState(reference, source, source, "path") as string,
		);
		const original = readJson(path);
		const transformed = transformMcpConfig(original);
		const name = relative(source, path);
		if (
			contained(source, canonicalPath(path)) &&
			entries.some((entry) => entry.path === name && entry.type === "file")
		) {
			files.add(name);
		} else if (JSON.stringify(original) !== JSON.stringify(transformed)) {
			throw new Error(
				"External or linked MCP references require explicit reconciliation",
			);
		}
	}
	return files;
}
function liveConsumers(source: string, destination: string): boolean {
	// No process details are returned to the caller or emitted into the manifest.
	const processes = execFileSync("ps", ["-axo", "pid=,command="], {
		encoding: "utf8",
	});
	return processes.split("\n").some((line) => {
		const match = /^\s*(\d+)\s+(.*)$/.exec(line);
		if (!match || Number(match[1]) === process.pid) return false;
		const command = match[2]!;
		if (/\bmigration\s+(inspect|preview|apply|restore)\b/.test(command))
			return false;
		const worker =
			/^(?:\S*\/)?(?:cyrus|bobs-factory)(?:\s|$)/.test(command) ||
			/^(?:\S*\/)?(?:bun|node)\s+(?:--\S+\s+)*\S*(?:scripts\/factory|apps\/cli\/(?:src|dist\/src)\/(?:app|cli))\.(?:ts|js)(?:\s|$)/.test(
				command,
			);
		const agent =
			/^(?:\S*\/)?(?:claude|codex|gemini|cursor|opencode)(?:\s|$)/.test(
				command,
			);
		// macOS exposes /tmp through /private/tmp; compare both spellings.
		const homes = [source, destination].flatMap((home) => [
			home,
			home.replace(/^\/private\/(tmp|var)(?=\/)/, "/$1"),
		]);
		const related = homes.some((home) => command.includes(home));
		if (related && (worker || agent)) return true;
		if (!worker) return false;
		const homeFlag = /(?:^|\s)--home(?:=|\s+)(\S+)(.*)$/.exec(command);
		if (homeFlag) {
			const flag = homeFlag[1]!;
			if (
				/["']/.test(flag) ||
				!isAbsolute(flag) ||
				!/^\s*(?:--|$)/.test(homeFlag[2]!)
			)
				return true;
			return homes.includes(canonicalPath(flag));
		}
		// Inspect relevant keys internally; process environments never enter logs.
		// Unreadable or ambiguous worker homes remain blockers.
		try {
			const environment = execFileSync(
				"ps",
				["eww", "-p", match[1]!, "-o", "command="],
				{ encoding: "utf8" },
			);
			const read = (key: string) =>
				new RegExp(
					`(?:^|\\s)${key}=(\\S+)(?=\\s+[A-Za-z_][A-Za-z0-9_]*=|$)`,
				).exec(environment.trim())?.[1];
			if (
				["BOBS_FACTORY_HOME", "CYRUS_HOME"].some(
					(key) =>
						new RegExp(`(?:^|\\s)${key}=`).test(environment) && !read(key),
				)
			)
				return true;
			const configured = read("BOBS_FACTORY_HOME") ?? read("CYRUS_HOME");
			const accountHome = read("HOME");
			const candidates = configured
				? [configured]
				: accountHome
					? [join(accountHome, ".cyrus"), join(accountHome, ".bobs-factory")]
					: [];
			if (!candidates.length || candidates.some((home) => !isAbsolute(home)))
				return true;
			return candidates.some((home) => homes.includes(canonicalPath(home)));
		} catch {
			return true;
		}
	});
}
export function inspectMigration(
	sourcePath: string,
	destinationPath: string,
	preservation?: PreservationPlan,
): MigrationManifest {
	const source = canonicalPath(sourcePath),
		destination = canonicalPath(destinationPath);
	if (
		!existsSync(source) ||
		!lstatSync(source).isDirectory() ||
		lstatSync(sourcePath).isSymbolicLink()
	)
		throw new Error("Source must be a real state directory");
	if (contained(source, destination) || contained(destination, source))
		throw new Error("Homes must be separate, non-nested directories");
	const entries = inventory(source);
	const blockers: string[] = [],
		conflicts: string[] = [];
	const external = new Set<string>();
	const preservationPlan = preservation
		? PreservationPlanSchema.parse(preservation)
		: undefined;
	const sessions: ReturnType<typeof nativeSessions> = [];
	let mcpFiles = new Set<string>();
	try {
		mcpFiles = migrationMcpFiles(source, entries);
	} catch {
		blockers.push(
			"Referenced MCP configuration requires explicit reconciliation before apply",
		);
	}
	if (existsSync(destination))
		conflicts.push(
			"Destination already exists; merge choices require an explicit agent-guided resolution before apply",
		);
	for (const entry of entries) {
		if (entry.type !== "file") continue;
		const path = join(source, entry.path);
		try {
			if (mcpFiles.has(entry.path)) transformMcpConfig(readJson(path));
			if (entry.path === "factory/workflows.json") {
				const stored = readJson(path);
				for (const workflow of Array.isArray(stored)
					? stored
					: stored.workflows)
					transformWorkflow(workflow);
			}
			if (entry.path === "cyrus-skills-plugin/.claude-plugin/plugin.json") {
				const plugin = readJson(path);
				if (plugin.name !== "cyrus-skills")
					blockers.push(
						"Unknown legacy stock plugin identity; inspect custom skill mappings before migration",
					);
				if (existsSync(join(source, "bobs-factory-skills-plugin")))
					conflicts.push(
						"Old and new stock plugin directories both exist; reconcile custom skills before apply",
					);
			}
			if (entry.path === "config.json") {
				const config = readJson(path);
				if (!Array.isArray(config.repositories))
					blockers.push("config.json must contain a repositories array");
				for (const repo of config.repositories ?? []) {
					for (const key of ["repositoryPath", "workspaceBaseDir"]) {
						const value = repo[key];
						if (
							typeof value === "string" &&
							isAbsolute(value) &&
							!contained(source, value)
						)
							external.add(value);
					}
				}
				transformState(config, source, destination);
			}
			if (entry.path === ".env") {
				const env = readFileSync(path, "utf8");
				transformEnvironment(env, source, destination);
				if (
					/^(?:export\s+)?(?:CYRUS_(?:API_KEY|TEAM_ID|APP_URL|CLOUD_RUNTIME)|CLOUDFLARE_TOKEN)=/m.test(
						env,
					)
				)
					blockers.push(
						"Hosted enrollment or control-plane configuration requires explicit self-host conversion; original credentials remain backed up",
					);
			}
			if (entry.path === "state/edge-worker-state.json") {
				const state = readJson(path);
				if (!["2.0", "3.0", "4.0"].includes(state.version))
					blockers.push("Unsupported worker persistence version");
				sessions.push(...nativeSessions(state));
			}
			if (
				entry.path === "machine-capacity/state.json" ||
				entry.path === "machine-capacity/capacity.json"
			) {
				const result = CapacityStateSchema.safeParse(readJson(path));
				if (!result.success) blockers.push("Unknown coordinator state format");
				else if (
					result.data.requests.some((request) => request.phase !== "queued")
				)
					blockers.push(
						"Coordinator contains executing or stopping leases; drain through the existing worker first",
					);
			}
			if (
				entry.path.startsWith("factory/runs/") &&
				entry.path.endsWith(".json")
			) {
				const run = readJson(path);
				transformRun(run, source, destination);
				sessions.push(...nativeSessions(run));
				if (!run.id || !run.workflow || !Array.isArray(run.history))
					blockers.push(`Unknown run format: ${entry.path}`);
			}
		} catch {
			blockers.push(`Invalid or conflicting structured state: ${entry.path}`);
		}
	}
	let gitRepairs: GitRepair[] = [];
	let externalBackups: NonNullable<MigrationManifest["externalBackups"]> = [];
	try {
		const discovered = discoverWorktrees(
			source,
			destination,
			entries
				.filter((entry) => entry.path.split("/").at(-1) === ".git")
				.map((entry) => entry.path),
		);
		gitRepairs = discovered.repairs;
		externalBackups = discovered.externalPaths.map((path) => {
			const entries = inventory(path);
			return {
				path,
				entries,
				digest: hash(JSON.stringify(entries)),
				restore: true,
			};
		});
	} catch {
		blockers.push(
			"Relocated repositories or worktrees need a separately verified Git metadata backup and repair mapping before apply",
		);
	}

	try {
		if (
			preservationPlan?.restorePaths.some(
				(path) => !preservationPlan.backupPaths.includes(path),
			)
		)
			throw new Error("Restore paths must be explicitly backed up");
		verifyContinuations(
			sessions,
			preservationPlan ?? PreservationPlanSchema.parse({ version: 1 }),
			(workspace) => relocated(workspace, source, destination),
		);
		for (const copy of preservationPlan?.nativeCopies ?? []) {
			if (
				!lstatSync(copy.source).isDirectory() ||
				lstatSync(copy.source).isSymbolicLink()
			)
				throw new Error("Native transcript source must be a real directory");
			if (existsSync(copy.destination))
				throw new Error("Native transcript destination already exists");
			if (
				[source, destination, copy.source].some((parent) =>
					contained(parent, copy.destination),
				) ||
				contained(copy.destination, copy.source)
			)
				throw new Error("Native transcript homes must be disjoint");
			if (
				inventory(copy.source).some((entry) =>
					entry.path
						.split("/")
						.some((name) =>
							/^(?:\.credentials\.json|auth\.json|credentials\.json|id_rsa|id_ed25519)$/.test(
								name,
							),
						),
				)
			)
				throw new Error(
					"Native transcript copy includes host credentials; select conversation data only",
				);
		}
		for (const path of new Set([
			...(preservationPlan?.backupPaths ?? []),
			...(preservationPlan?.nativeCopies ?? []).map((copy) => copy.source),
			...(preservationPlan?.continuations ?? []).map(
				(continuation) => continuation.evidencePath,
			),
		])) {
			if (contained(source, path) || contained(destination, path))
				throw new Error(
					"External preservation paths must be outside both state homes",
				);
			if (
				externalBackups.some(
					(entry) => contained(entry.path, path) || contained(path, entry.path),
				)
			)
				throw new Error(
					"Overlapping external backup paths require one parent backup",
				);
			const entries = inventory(path);
			externalBackups.push({
				path,
				entries,
				digest: hash(JSON.stringify(entries)),
				restore: preservationPlan?.restorePaths.includes(path) ?? false,
			});
		}
	} catch (error) {
		blockers.push(
			error instanceof Error
				? error.message
				: "Invalid native preservation plan",
		);
	}

	if (liveConsumers(source, destination))
		blockers.push(
			"A worker or agent may still be running; disable intake, drain and verify descendants before apply",
		);
	return {
		version: 1,
		gitRepairs,
		externalBackups,
		preservationPlan,
		source,
		destination,
		sourceDigest: hash(JSON.stringify(entries)),
		entries,
		conflicts,
		blockers: [...new Set(blockers)],
		operations: [
			"Copy verified source backup without changing source",
			"Stage structured product-field and environment-key transformations",
			"Back up external Git metadata and repair registered worktree links",
			"Commit only into an absent destination",
			"Leave service switch and native continuation verification to the migration assistant",
		],
		preservedExternalPaths: [...external],
	};
}
function save(path: string, value: unknown) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
function copyTree(source: string, destination: string, entries: Entry[]) {
	cpSync(source, destination, {
		recursive: true,
		verbatimSymlinks: true,
		preserveTimestamps: true,
	});
	// Node cp preserves files but creates directories with default permissions.
	for (const entry of [...entries].reverse())
		if (entry.type !== "link")
			chmodSync(join(destination, entry.path), entry.mode);
}
function verifyCopy(home: string, expected: Entry[]) {
	if (hash(JSON.stringify(inventory(home))) !== hash(JSON.stringify(expected)))
		throw new Error("Backup integrity verification failed");
}
/** Mutation never starts/stops services. A journal and verified backup precede staging. */
export function applyMigration(
	manifest: MigrationManifest,
	backupPath: string,
) {
	if (manifest.version !== 1) throw new Error("Unknown manifest version");
	const backup = resolve(backupPath);
	if (
		contained(manifest.source, backup) ||
		contained(manifest.destination, backup)
	)
		throw new Error("Backup must be outside both homes");
	if (existsSync(backup)) {
		const journal = readJson(join(backup, "journal.json"));
		if (
			journal.phase === "committed" &&
			journal.sourceDigest === manifest.sourceDigest &&
			journal.destination === manifest.destination &&
			existsSync(manifest.destination)
		) {
			if (
				hash(JSON.stringify(inventory(manifest.destination))) !==
				journal.destinationDigest
			)
				throw new Error("Committed destination changed; refusing replay");
			return { backup, status: "already-applied" };
		}
		throw new Error(
			"An existing backup journal needs explicit restore or recovery before another apply",
		);
	}
	const current = inspectMigration(
		manifest.source,
		manifest.destination,
		manifest.preservationPlan,
	);
	if (
		current.sourceDigest !== manifest.sourceDigest ||
		JSON.stringify(current.externalBackups) !==
			JSON.stringify(manifest.externalBackups ?? [])
	)
		throw new Error("Source changed since preview; regenerate the manifest");
	if (current.blockers.length || current.conflicts.length)
		throw new Error([...current.blockers, ...current.conflicts].join("; "));
	mkdirSync(backup, { recursive: true, mode: 0o700 });
	chmodSync(backup, 0o700);
	save(join(backup, "manifest.json"), manifest);
	save(join(backup, "journal.json"), {
		phase: "backing-up",
		sourceDigest: manifest.sourceDigest,
		destination: manifest.destination,
	});
	copyTree(manifest.source, join(backup, "source"), manifest.entries);
	verifyCopy(join(backup, "source"), manifest.entries);
	for (const [index, external] of (current.externalBackups ?? []).entries()) {
		if (contained(external.path, backup) || contained(backup, external.path))
			throw new Error("Backup overlaps external Git metadata");
		const path = join(backup, "external", String(index));
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		copyTree(external.path, path, external.entries);
		verifyCopy(path, external.entries);
	}

	const stage = join(backup, "staged");
	copyTree(join(backup, "source"), stage, manifest.entries);
	const mcpFiles = migrationMcpFiles(manifest.source, manifest.entries);
	for (const entry of manifest.entries) {
		const path = join(stage, entry.path);
		if (entry.type !== "file") continue;
		if (entry.path === ".env")
			writeFileSync(
				path,
				transformEnvironment(
					readFileSync(path, "utf8"),
					manifest.source,
					manifest.destination,
				),
			);
		else if (mcpFiles.has(entry.path))
			writeFileSync(
				path,
				`${JSON.stringify(transformMcpConfig(readJson(path)), null, 2)}\n`,
			);
		else if (
			entry.path === "config.json" ||
			entry.path.startsWith("state/") ||
			entry.path === "machine-capacity/state.json" ||
			entry.path === "machine-capacity/capacity.json" ||
			/^factory\/runs\/.*\.json$/.test(entry.path)
		) {
			if (!entry.path.endsWith(".json")) continue;
			writeFileSync(
				path,
				`${JSON.stringify(
					(entry.path.startsWith("factory/runs/")
						? transformRun
						: transformState)(
						readJson(path),
						manifest.source,
						manifest.destination,
					),
					null,
					2,
				)}\n`,
			);
		} else if (entry.path === "factory/workflows.json") {
			const stored = readJson(path);
			const workflows = (Array.isArray(stored) ? stored : stored.workflows).map(
				transformWorkflow,
			);
			for (const workflow of workflows) {
				if (workflow.id === "simple" && workflow.name === "Simple / Cyrus")
					workflow.name = "Simple / Bob’s Factory";
			}
			writeFileSync(
				path,
				`${JSON.stringify(Array.isArray(stored) ? workflows : { ...stored, workflows }, null, 2)}\n`,
			);
		}
		chmodSync(path, entry.mode);
	}
	const stockPlugin = join(stage, "cyrus-skills-plugin");
	if (existsSync(join(stockPlugin, ".claude-plugin/plugin.json"))) {
		const path = join(stockPlugin, ".claude-plugin/plugin.json");
		const plugin = readJson(path);
		if (plugin.name === "cyrus-skills") {
			plugin.name = "bobs-factory-skills";
			writeFileSync(path, `${JSON.stringify(plugin, null, 2)}\n`);
			renameSync(stockPlugin, join(stage, "bobs-factory-skills-plugin"));
		}
	}

	save(join(backup, "journal.json"), {
		phase: "staged",
		sourceDigest: manifest.sourceDigest,
		destination: manifest.destination,
	});
	const final = inspectMigration(
		manifest.source,
		manifest.destination,
		manifest.preservationPlan,
	);
	if (
		final.sourceDigest !== manifest.sourceDigest ||
		JSON.stringify(final.externalBackups) !==
			JSON.stringify(current.externalBackups) ||
		final.blockers.length ||
		final.conflicts.length
	)
		throw new Error("Migration preconditions changed before commit");
	mkdirSync(dirname(manifest.destination), { recursive: true });
	// Exclusively create the destination. Copy rather than rename supports a backup on another volume.
	mkdirSync(manifest.destination, { mode: 0o700 });
	save(join(backup, "journal.json"), {
		phase: "committing",
		sourceDigest: manifest.sourceDigest,
		destination: manifest.destination,
	});
	copyTree(stage, manifest.destination, inventory(stage));
	for (const copy of current.preservationPlan?.nativeCopies ?? []) {
		const external = current.externalBackups?.find(
			(entry) => entry.path === copy.source,
		);
		if (!external) throw new Error("Native source was not backed up");
		mkdirSync(dirname(copy.destination), { recursive: true, mode: 0o700 });
		mkdirSync(copy.destination, { mode: 0o700 });
		// Ownership marker enables safe recovery after a failed or interrupted copy.
		save(join(copy.destination, ".bobs-factory-migration"), {
			sourceDigest: manifest.sourceDigest,
			destination: manifest.destination,
		});
		copyTree(
			join(
				backup,
				"external",
				String(current.externalBackups!.indexOf(external)),
			),
			copy.destination,
			external.entries,
		);
		if (
			hash(
				JSON.stringify(
					inventory(copy.destination).filter(
						(entry) => entry.path !== ".bobs-factory-migration",
					),
				),
			) !== external.digest
		)
			throw new Error("Native transcript integrity failure");
	}
	repairWorktrees(
		current.gitRepairs ?? [],
		manifest.source,
		manifest.destination,
	);
	const configPath = join(manifest.destination, "config.json");
	if (existsSync(configPath))
		for (const repo of readJson(configPath).repositories ?? []) {
			if (!repo.repositoryPath || !existsSync(repo.repositoryPath))
				throw new Error(
					"A migrated repository path is unavailable; restore before starting",
				);
			execFileSync("git", ["worktree", "list", "--porcelain"], {
				cwd: repo.repositoryPath,
				stdio: "ignore",
			});
		}
	const destinationDigest = hash(
		JSON.stringify(inventory(manifest.destination)),
	);
	save(join(backup, "journal.json"), {
		phase: "committed",
		sourceDigest: manifest.sourceDigest,
		destination: manifest.destination,
		destinationDigest,
	});
	return {
		backup,
		status: "applied",
		services: "not started",
		source: "retained",
	};
}
export function restoreMigration(backupPath: string) {
	const backup = resolve(backupPath),
		manifest: MigrationManifest = readJson(join(backup, "manifest.json"));
	const journal = readJson(join(backup, "journal.json"));
	if (manifest.version !== 1 || journal.destination !== manifest.destination)
		throw new Error("Invalid backup journal");
	verifyCopy(join(backup, "source"), manifest.entries);
	if (liveConsumers(manifest.source, manifest.destination))
		throw new Error(
			"Stop all participating workers and descendants before recovery",
		);
	// Source preconditions are checked before any recovery mutation.
	if (
		!existsSync(manifest.source) ||
		hash(JSON.stringify(inventory(manifest.source))) !== manifest.sourceDigest
	)
		throw new Error(
			"Original source changed; verified backup remains available for agent-guided recovery",
		);
	for (const [index, external] of (manifest.externalBackups ?? []).entries()) {
		verifyCopy(join(backup, "external", String(index)), external.entries);
	}

	if (existsSync(manifest.destination)) {
		// Never erase destination changes made after the migration. Preserve them for reconciliation.
		const recovery = join(backup, "destination-recovery");
		if (existsSync(recovery))
			throw new Error(
				"A previous destination recovery exists; resolve it before restore",
			);
		const entries = inventory(manifest.destination);
		copyTree(manifest.destination, recovery, entries);
		verifyCopy(recovery, entries);
		verifyCopy(manifest.destination, entries);
		rmSync(manifest.destination, { recursive: true });
	}
	for (const [index, copy] of (
		manifest.preservationPlan?.nativeCopies ?? []
	).entries()) {
		if (!existsSync(copy.destination)) continue;
		const marker = readJson(join(copy.destination, ".bobs-factory-migration"));
		if (
			marker.sourceDigest !== manifest.sourceDigest ||
			marker.destination !== manifest.destination
		)
			throw new Error(
				"Native transcript destination is not owned by this migration",
			);
		const path = join(backup, "native-recovery", String(index));
		if (existsSync(path))
			throw new Error(
				"Native recovery already exists; reconcile before retrying",
			);
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		const entries = inventory(copy.destination);
		copyTree(copy.destination, path, entries);
		verifyCopy(path, entries);
		verifyCopy(copy.destination, entries);
		rmSync(copy.destination, { recursive: true });
	}

	if (["committing", "committed"].includes(journal.phase)) {
		for (const [index, external] of (
			manifest.externalBackups ?? []
		).entries()) {
			if (external.restore === false) continue;
			const path = join(backup, "external-recovery", String(index));
			mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
			if (existsSync(path))
				throw new Error(
					"External recovery already exists; resolve before retrying",
				);
			if (existsSync(external.path)) {
				const entries = inventory(external.path);
				copyTree(external.path, path, entries);
				verifyCopy(path, entries);
				verifyCopy(external.path, entries);
				rmSync(external.path, { recursive: true });
			}
			copyTree(
				join(backup, "external", String(index)),
				external.path,
				external.entries,
			);
			verifyCopy(external.path, external.entries);
		}
	}

	save(join(backup, "journal.json"), { ...journal, phase: "restored" });
	return { status: "restored", source: "retained", services: "not started" };
}
export function writePreview(manifest: MigrationManifest, path: string) {
	if (existsSync(path)) throw new Error("Preview output already exists");
	save(path, manifest);
}
