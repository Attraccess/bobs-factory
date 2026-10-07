import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolvePath } from "bobs-factory-core";
import type { Command } from "commander";
import {
	applyMigration,
	inspectMigration,
	type MigrationManifest,
	restoreMigration,
	writePreview,
} from "./migration.js";
import { PreservationPlanSchema } from "./preservation.js";
export function addMigrationCommands(program: Command) {
	const migration = program
		.command("migration")
		.description(
			"Read-only discovery, preview, verified backup, staged migration and recovery",
		);
	for (const name of ["inspect", "preview"] as const) {
		migration
			.command(name)
			.option("--source <path>", "Cyrus state home", join(homedir(), ".cyrus"))
			.option(
				"--destination <path>",
				"New state home",
				join(homedir(), ".bobs-factory"),
			)
			.option("--output <path>", "Write private manifest to an absent file")
			.option(
				"--preservation-plan <path>",
				"Verified native continuations and external service/store backups",
			)
			.action((options) => {
				const manifest = inspectMigration(
					resolvePath(options.source),
					resolvePath(options.destination),
					options.preservationPlan
						? PreservationPlanSchema.parse(
								JSON.parse(
									readFileSync(resolvePath(options.preservationPlan), "utf8"),
								),
							)
						: undefined,
				);
				if (options.output) writePreview(manifest, resolvePath(options.output));
				console.log(JSON.stringify(manifest, null, 2));
			});
	}
	migration
		.command("apply")
		.requiredOption("--manifest <path>", "Reviewed preview manifest")
		.requiredOption(
			"--backup <path>",
			"Absent private backup directory, outside both homes",
		)
		.action((options) => {
			const manifest: MigrationManifest = JSON.parse(
				readFileSync(resolvePath(options.manifest), "utf8"),
			);
			console.log(
				JSON.stringify(applyMigration(manifest, resolvePath(options.backup))),
			);
		});
	migration
		.command("restore")
		.requiredOption("--backup <path>", "Verified backup directory")
		.action((options) =>
			console.log(
				JSON.stringify(restoreMigration(resolvePath(options.backup))),
			),
		);
}
