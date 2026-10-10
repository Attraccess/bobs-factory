import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { EdgeConfigSchema, resolvePath } from "bobs-factory-core";
import { operatorConnectionSchema } from "bobs-factory-mcp-tools";
import { atomicPrivateFile, privateFile } from "./FactoryAuthStore.js";
import { OperatorError, operatorDigest } from "./OperatorService.js";
import type { FactoryRun, WorkflowRuntime } from "./WorkflowRuntime.js";

export class OperatorConfiguration {
	constructor(
		readonly home: string,
		readonly runtime: WorkflowRuntime,
		readonly configPath: () => string | undefined,
		readonly permissions: (
			run: FactoryRun,
		) => Promise<{ allowed?: string[]; denied?: string[] }>,
		readonly applied: (
			repositoryId: string,
			paths: string[],
			permissions: string[],
		) => boolean,
		readonly reload?: () => Promise<boolean>,
	) {}
	private owned(path: string) {
		const root = realpathSync(this.home),
			full = resolve(
				root,
				relative(resolve(this.home), resolve(resolvePath(path))),
			);
		let cursor = full;
		while (!existsSync(cursor)) cursor = dirname(cursor);
		const actual = realpathSync(cursor);
		if (
			relative(root, full).startsWith("..") ||
			relative(root, actual).startsWith("..") ||
			lstatSync(cursor).isSymbolicLink() ||
			(existsSync(full) && realpathSync(full) !== full)
		)
			throw new OperatorError(
				"unsupported_source",
				"Only regular configuration files inside this Factory home can be updated",
			);
		return full;
	}
	private read() {
		const configured = this.configPath();
		if (!configured)
			throw new OperatorError(
				"unsupported_source",
				"This worker has no writable configuration file",
			);
		const path = this.owned(configured),
			raw = privateFile(path),
			config = JSON.parse(raw);
		return { path, raw, config };
	}
	revision(run: FactoryRun) {
		const { raw, config } = this.read();
		const repo = config.repositories?.find(
			(r: any) => r.id === run.repositoryId,
		);
		if (!repo)
			throw new OperatorError(
				"unsupported_source",
				"Retained repository is absent from the configuration file",
			);
		const paths: string[] = repo.mcpConfigPath
			? Array.isArray(repo.mcpConfigPath)
				? repo.mcpConfigPath
				: [repo.mcpConfigPath]
			: [];
		return operatorDigest([
			raw,
			paths.map((path) => {
				const full = resolve(resolvePath(path));
				return [full, existsSync(full) ? readFileSync(full, "utf8") : null];
			}),
			this.runtime.executionProfiles.read(),
		]);
	}
	async update(run: FactoryRun, input: any) {
		const connection = operatorConnectionSchema.parse(input.connection);
		const current = this.read(),
			lock = `${current.path}.operator.lock`;
		try {
			writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
		} catch {
			throw new OperatorError(
				"stale_configuration",
				"Another configuration update is in progress",
			);
		}
		try {
			if (this.revision(run) !== input.expectedConfigRevision)
				throw new OperatorError(
					"stale_configuration",
					"Configuration changed. Inspect connections again before updating.",
				);
			const effective = await this.permissions(run);
			if (this.revision(run) !== input.expectedConfigRevision)
				throw new OperatorError(
					"stale_configuration",
					"Configuration changed during permission resolution",
				);
			const names = input.permissions.map(
				(tool: string) => `mcp__${input.server}__${tool}`,
			);
			const matches = (pattern: string, name: string) =>
				pattern === `mcp__${input.server}` ||
				new RegExp(
					"^" +
						pattern
							.split("*")
							.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
							.join(".*") +
						"$",
				).test(name);
			if (
				names.some((name: string) =>
					effective.denied?.some((pattern) => matches(pattern, name)),
				)
			)
				throw new OperatorError(
					"denied_tool",
					"A matching deny permission prevents this repair. Resolve it explicitly in the owning configuration.",
				);
			if (input.profileId) {
				const profileFile = this.owned(
					join(this.runtime.directory, "execution-profiles.json"),
				);
				if (existsSync(profileFile)) privateFile(profileFile);
				const store = this.runtime.executionProfiles,
					profiles = store.read(),
					profile = profiles.tools.find((p) => p.id === input.profileId);
				if (!profile)
					throw new OperatorError("not_found", "Saved tool profile not found");
				if (
					profile.remove.includes(input.server) ||
					names.some((name: string) =>
						profile.denyTools.some((pattern) => matches(pattern, name)),
					)
				)
					throw new OperatorError(
						"denied_tool",
						"The saved profile denies this connection or tool",
					);
				profile.allowTools = [
					...new Set([...(profile.allowTools ?? []), ...names]),
				];
				profile.mcp[input.server] = {
					...connection,
					headers: Object.fromEntries(
						Object.entries(connection.headers).map(([key, ref]) => [
							key,
							{
								source: "env" as const,
								name: ref.env,
								version: "operator-v1",
								owner: input.profileId,
							},
						]),
					),
				};
				const saved = store.save(profiles, profiles.revision);
				return {
					persisted: true,
					configRevision: this.revision(run),
					savedProfileRevision: saved.tools.find(
						(p) => p.id === input.profileId,
					)?.revision,
					applied: false,
					scope: "future_launches",
					limitation:
						"Existing runs retain their accepted tool profile and permissions. Select the updated profile in a new launch.",
					explicitPermissions: names,
				};
			}
			if (run.executionSnapshot?.tools)
				throw new OperatorError(
					"frozen_configuration",
					"This run retains an explicit tool profile. Update its saved profile for future launches; the accepted snapshot cannot be replaced.",
				);
			const repo = current.config.repositories.find(
				(r: any) => r.id === run.repositoryId,
			);
			const paths: string[] = repo.mcpConfigPath
				? Array.isArray(repo.mcpConfigPath)
					? [...repo.mcpConfigPath]
					: [repo.mcpConfigPath]
				: [];
			// Existing external sources remain read-only. A new owned overlay preserves their bytes.
			const managed = this.owned(
				join(
					this.home,
					"mcp-configs",
					`operator-${operatorDigest([run.repositoryId, input.server, connection])}.json`,
				),
			);
			mkdirSync(dirname(managed), { recursive: true, mode: 0o700 });
			const nextSource = JSON.stringify(
				{
					mcpServers: {
						[input.server]: {
							...connection,
							headers: Object.fromEntries(
								Object.entries(connection.headers).map(([key, ref]) => [
									key,
									`\${${ref.env}}`,
								]),
							),
						},
					},
				},
				null,
				2,
			);
			const nextPaths = [
				...paths.filter((path) => resolve(resolvePath(path)) !== managed),
				managed,
			];
			repo.mcpConfigPath = nextPaths;
			repo.allowedTools = [
				...new Set([
					...(repo.allowedTools?.length
						? repo.allowedTools
						: (effective.allowed ?? [])),
					...names,
				]),
			];
			// Validate the full proposal, but retain unknown unrelated fields in the persisted object.
			EdgeConfigSchema.parse(current.config);
			if (this.revision(run) !== input.expectedConfigRevision)
				throw new OperatorError(
					"stale_configuration",
					"Configuration changed while validating the repair",
				);
			// Commit point is the config rename: a crash before it leaves only an unreferenced immutable overlay.
			if (existsSync(managed) && privateFile(managed) !== nextSource)
				throw new OperatorError(
					"stale_configuration",
					"Managed connection overlay changed unexpectedly",
				);
			if (!existsSync(managed)) atomicPrivateFile(managed, nextSource);
			atomicPrivateFile(current.path, JSON.stringify(current.config, null, 2));
			const persistedRevision = this.revision(run);
			let reloadAccepted = true;
			try {
				if (this.reload) reloadAccepted = await this.reload();
			} catch {
				reloadAccepted = false;
			}
			const deadline = Date.now() + 5000;
			while (
				reloadAccepted &&
				Date.now() < deadline &&
				!this.applied(run.repositoryId, nextPaths, repo.allowedTools)
			)
				await new Promise((resolve) => setTimeout(resolve, 50));
			const applied =
				reloadAccepted &&
				this.applied(run.repositoryId, nextPaths, repo.allowedTools);
			return {
				persisted: true,
				configRevision: persistedRevision,
				applied,
				appliedRevision: applied ? persistedRevision : undefined,
				error: applied
					? undefined
					: {
							code: "reload_failure",
							message:
								"Configuration was saved but worker reload was not observed. Inspect again before retrying.",
						},
				explicitPermissions: names,
			};
		} finally {
			unlinkSync(lock);
		}
	}
}
