import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import {
	acquireRuntimeOperation,
	canonicalHome,
	ownerAlive,
	workerOwner,
} from "./InstanceLock.js";

export type ServiceAction =
	| "install"
	| "status"
	| "logs"
	| "start"
	| "stop"
	| "restart"
	| "enable"
	| "disable"
	| "remove"
	| "maintenance"
	| "resume";
export interface ServiceRecord {
	schema: 1;
	id: string;
	home: string;
	executable: string;
	platform: "darwin" | "linux";
	definition: string;
	startup: boolean;
	desired: "running" | "stopped" | "maintenance" | "resume";
	mode: "start" | "local";
	path: string;
}
export type ServiceExecutor = (
	command: string,
	args: string[],
) => { status: number; output: string };
const execute: ServiceExecutor = (command, args) => {
	try {
		return {
			status: 0,
			output: execFileSync(command, args, {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}),
		};
	} catch (error) {
		const e = error as { status?: number; stdout?: string; stderr?: string };
		return {
			status: e.status ?? 1,
			output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
		};
	}
};
const xml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
const systemd = (value: string) =>
	`"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%").replaceAll("$", "$$")}"`;
export function updateServiceRecord(record: ServiceRecord): ServiceRecord {
	return {
		...record,
		id: `${record.id}.updates`,
		definition: record.definition.replace(/\.(plist|service)$/, ".updates.$1"),
	};
}
function safe(value: string): string {
	if (/[\0\r\n]/.test(value))
		throw new Error("Service values cannot contain control characters");
	return value;
}

export function serviceDefinition(
	record: ServiceRecord,
	updater = false,
): string {
	const args = [
		record.executable,
		"--home",
		record.home,
		"--no-open",
		"service",
		updater ? "updates-run" : "run",
	];
	for (const value of [...args, record.path]) safe(value);
	if (record.platform === "darwin")
		return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${xml(record.id)}</string>
<key>ProgramArguments</key><array>${args.map((a) => `<string>${xml(a)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${xml(record.home)}</string>
<key>EnvironmentVariables</key><dict><key>BOBS_FACTORY_SERVICE_ID</key><string>${xml(record.id)}</string><key>PATH</key><string>${xml(record.path)}</string></dict>
<key>RunAtLoad</key><${record.startup ? "true" : "false"}/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>10</integer>
<key>ExitTimeOut</key><integer>0</integer>
<key>StandardOutPath</key><string>${xml(join(record.home, "runtime", "service.log"))}</string>
<key>StandardErrorPath</key><string>${xml(join(record.home, "runtime", "service-error.log"))}</string>
</dict></plist>\n`;
	return `[Unit]\nDescription=Bob's Factory (${record.id})\nStartLimitIntervalSec=120\nStartLimitBurst=3\n\n[Service]\nType=simple\nWorkingDirectory=${systemd(record.home)}\nExecStart=${args.map(systemd).join(" ")}\nEnvironment=${systemd(`BOBS_FACTORY_SERVICE_ID=${record.id}`)}\nEnvironment=${systemd(`PATH=${record.path}`)}\nRestart=on-failure\nRestartSec=10\nTimeoutStopSec=infinity\nSendSIGKILL=no\nKillMode=mixed\n\n[Install]\nWantedBy=default.target\n`;
}

/** User-account services only. No sudo, shell interpolation, or credential copying. */
export class ServiceLifecycle {
	readonly home: string;
	readonly recordPath: string;
	constructor(
		home: string,
		private readonly run: ServiceExecutor = execute,
		private readonly platform = process.platform,
		private readonly userHome = homedir(),
		private readonly uid = process.getuid?.() ?? -1,
	) {
		this.home = canonicalHome(home);
		this.recordPath = join(this.home, "runtime", "service.json");
	}
	record(): ServiceRecord | undefined {
		if (!existsSync(this.recordPath)) return undefined;
		const stat = lstatSync(this.recordPath);
		if (
			stat.isSymbolicLink() ||
			(process.getuid && stat.uid !== process.getuid())
		)
			throw new Error("Service record must be operator-owned and not linked");
		const r = JSON.parse(
			readFileSync(this.recordPath, "utf8"),
		) as ServiceRecord;
		const id = this.id();
		if (
			r.schema !== 1 ||
			r.home !== this.home ||
			r.id !== id ||
			r.platform !== this.platform ||
			r.definition !== this.definitionPath(id) ||
			!isAbsolute(r.executable) ||
			!["start", "local"].includes(r.mode) ||
			!["running", "stopped", "maintenance"].includes(r.desired) ||
			typeof r.startup !== "boolean" ||
			typeof r.path !== "string"
		)
			throw new Error(
				"Service ownership mismatch; use the original account/platform",
			);
		return r;
	}
	private id() {
		return `de.bobs-factory.${createHash("sha256").update(this.home).digest("hex").slice(0, 16)}`;
	}
	private definitionPath(id: string) {
		return this.platform === "darwin"
			? join(this.userHome, "Library", "LaunchAgents", `${id}.plist`)
			: join(this.userHome, ".config", "systemd", "user", `${id}.service`);
	}
	private save(r: ServiceRecord) {
		mkdirSync(dirname(this.recordPath), { recursive: true, mode: 0o700 });
		writeFileSync(`${this.recordPath}.tmp`, JSON.stringify(r, null, 2), {
			mode: 0o600,
		});
		renameSync(`${this.recordPath}.tmp`, this.recordPath);
	}
	private checked(command: string, args: string[]) {
		const result = this.run(command, args);
		if (result.status !== 0)
			throw new Error(`${command} ${args[0]} failed: ${result.output}`);
		return result.output;
	}
	private target(r: ServiceRecord) {
		return `gui/${this.uid}/${r.id}`;
	}
	private unit(r: ServiceRecord) {
		return `${r.id}.service`;
	}
	private assertDefinition(r: ServiceRecord, updater = false) {
		if (
			!existsSync(r.definition) ||
			lstatSync(r.definition).isSymbolicLink() ||
			readFileSync(r.definition, "utf8") !== serviceDefinition(r, updater)
		)
			throw new Error(
				"Service definition missing or changed externally; refusing to manage it",
			);
	}
	install(
		executable: string,
		mode: "start" | "local" = "start",
		path = process.env.PATH ?? "/usr/bin:/bin",
	) {
		if (!["darwin", "linux"].includes(this.platform) || this.uid < 0)
			throw new Error(
				"Only macOS launchd/Linux systemd user services are supported",
			);
		if (this.record())
			throw new Error("Service already installed; inspect status");
		const owner = workerOwner(this.home);
		if (owner || existsSync(join(this.home, "runtime", "worker.lock")))
			throw new Error(
				"Existing worker ownership: stop and reconcile the existing foreground/desktop/PM2/manual/Nix owner before installing a service",
			);
		if (!isAbsolute(executable) || !existsSync(executable))
			throw new Error("Supply an existing absolute packaged executable");
		if (executable.startsWith("/nix/store/"))
			throw new Error(
				"Nix owns this executable: manage its service through Nix, without installing a second owner",
			);
		const r: ServiceRecord = {
			schema: 1,
			id: this.id(),
			home: this.home,
			executable: safe(executable),
			platform: this.platform as "darwin" | "linux",
			definition: this.definitionPath(this.id()),
			startup: false,
			desired: "stopped",
			mode,
			path: safe(path),
		};
		mkdirSync(dirname(r.definition), { recursive: true, mode: 0o700 });
		// Never overwrite a manual/external definition. Partial setup is retained for inspection.
		writeFileSync(r.definition, serviceDefinition(r), {
			flag: "wx",
			mode: 0o600,
		});
		const updater = updateServiceRecord(r);
		writeFileSync(updater.definition, serviceDefinition(updater, true), {
			flag: "wx",
			mode: 0o600,
		});
		this.save(r);
		if (r.platform === "linux")
			this.checked("systemctl", ["--user", "daemon-reload"]);
		return this.status();
	}
	status() {
		const r = this.record();
		if (!r)
			return {
				installed: false,
				home: this.home,
				owner: workerOwner(this.home) ?? null,
			};
		const definitionMatches =
			existsSync(r.definition) &&
			!lstatSync(r.definition).isSymbolicLink() &&
			readFileSync(r.definition, "utf8") === serviceDefinition(r);
		const probe =
			r.platform === "darwin"
				? this.run("launchctl", ["print", this.target(r)])
				: this.run("systemctl", [
						"--user",
						"show",
						this.unit(r),
						"--property=LoadState,ActiveState,SubState,MainPID,UnitFileState,ExecMainStatus",
					]);
		const enabled =
			r.platform === "darwin"
				? this.run("launchctl", ["print-disabled", `gui/${this.uid}`])
				: this.run("systemctl", ["--user", "is-enabled", this.unit(r)]);
		const owner = workerOwner(this.home);
		return {
			installed: true,
			...r,
			definitionMatches,
			managerAvailable: probe.status === 0,
			manager: probe.output,
			startupActual: enabled.output,
			startupProbeSucceeded: enabled.status === 0,
			healthy: Boolean(
				definitionMatches &&
					owner &&
					ownerAlive(owner) &&
					owner.owner === "service" &&
					probe.status === 0,
			),
			owner: owner ?? null,
		};
	}
	async action(action: Exclude<ServiceAction, "install">) {
		const release = await acquireRuntimeOperation(
			this.home,
			"service-operation.lock",
		);
		try {
			return await this.perform(action);
		} finally {
			release();
		}
	}

	private async perform(action: Exclude<ServiceAction, "install">) {
		if (action === "status") return this.status();
		const r = this.record();
		if (!r) throw new Error("No service installed for this home");
		this.assertDefinition(r);
		const updater = updateServiceRecord(r);
		this.assertDefinition(updater, true);
		if (action === "resume") {
			if (r.desired !== "maintenance")
				throw new Error("Service is not in maintenance");
			r.desired = "stopped";
			this.save(r);
			action = "start";
		}
		if (
			r.desired === "maintenance" &&
			["start", "restart", "enable"].includes(action)
		)
			throw new Error("Service is in maintenance; verified resume required");
		if (action === "logs")
			return r.platform === "linux"
				? this.checked("journalctl", [
						"--user",
						"-u",
						this.unit(r),
						"--no-pager",
						"-n",
						"100",
					])
				: ["service.log", "service-error.log"]
						.map((name) => {
							const p = join(this.home, "runtime", name);
							return existsSync(p) ? readFileSync(p, "utf8").slice(-64000) : "";
						})
						.join("\n");
		if (
			["stop", "maintenance", "restart", "remove", "disable"].includes(action)
		) {
			// Save intent before unloading. Interrupted maintenance cannot silently start again.
			r.desired = action === "maintenance" ? "maintenance" : "stopped";
			this.save(r);
			if (r.platform === "darwin") {
				const loaded = this.run("launchctl", ["print", this.target(r)]);
				if (loaded.status === 0)
					this.checked("launchctl", ["bootout", this.target(r)]);
			} else this.checked("systemctl", ["--user", "stop", this.unit(r)]);
			if (action !== "maintenance") {
				if (r.platform === "linux")
					this.checked("systemctl", ["--user", "stop", this.unit(updater)]);
				else if (
					this.run("launchctl", ["print", this.target(updater)]).status === 0
				)
					this.checked("launchctl", ["bootout", this.target(updater)]);
			}
			// Do not transfer ownership until graceful shutdown completed.
			for (let attempt = 0; workerOwner(this.home) && attempt < 100; attempt++)
				await new Promise((resolve) => setTimeout(resolve, 100));
			if (workerOwner(this.home))
				throw new Error(
					"Worker shutdown still owns this home; wait for graceful drain and retry. Replacement is forbidden.",
				);
		}
		if (action === "enable" || action === "disable") {
			r.startup = action === "enable";
			if (r.startup) r.desired = "running";
			if (r.platform === "linux")
				this.checked("systemctl", [
					"--user",
					r.startup ? "enable" : "disable",
					this.unit(r),
				]);
			else {
				// Changing RunAtLoad requires unloading/reloading; enabling does not start now.
				if (this.run("launchctl", ["print", this.target(r)]).status === 0)
					throw new Error(
						"Stop this service before changing macOS login enrollment",
					);
				writeFileSync(r.definition, serviceDefinition(r), { mode: 0o600 });
				this.checked("launchctl", [
					r.startup ? "enable" : "disable",
					this.target(r),
				]);
			}
			if (r.platform === "linux")
				this.checked("systemctl", [
					"--user",
					r.startup ? "enable" : "disable",
					this.unit(updater),
				]);
			else {
				if (this.run("launchctl", ["print", this.target(updater)]).status === 0)
					throw new Error(
						"Stop updater before changing macOS login enrollment",
					);
				updater.startup = r.startup;
				writeFileSync(updater.definition, serviceDefinition(updater, true), {
					mode: 0o600,
				});
				this.checked("launchctl", [
					r.startup ? "enable" : "disable",
					this.target(updater),
				]);
			}
			this.save(r);
		}
		if (action === "start" || action === "restart") {
			if (r.desired === "maintenance")
				throw new Error(
					"Service is in update maintenance. Use service resume only after exact candidate/recovery verification.",
				);
			const owner = workerOwner(this.home);
			if (owner)
				throw new Error(
					"An existing worker owns this home; attach instead of starting another",
				);
			r.desired = "running";
			this.save(r);
			if (r.platform === "linux")
				this.checked("systemctl", ["--user", "start", this.unit(r)]);
			else {
				this.checked("launchctl", ["enable", this.target(r)]);
				this.checked("launchctl", [
					"bootstrap",
					`gui/${this.uid}`,
					r.definition,
				]);
				this.checked("launchctl", ["kickstart", this.target(r)]);
			}
			if (r.platform === "linux")
				this.checked("systemctl", ["--user", "start", this.unit(updater)]);
			else if (
				this.run("launchctl", ["print", this.target(updater)]).status !== 0
			) {
				this.checked("launchctl", ["enable", this.target(updater)]);
				this.checked("launchctl", [
					"bootstrap",
					`gui/${this.uid}`,
					updater.definition,
				]);
				this.checked("launchctl", ["kickstart", this.target(updater)]);
			}
		}
		if (action === "remove") {
			if (r.platform === "linux")
				this.checked("systemctl", ["--user", "disable", this.unit(r)]);
			// Retain definitions, service record, logs and all mutable/native state.
			const backup = `${r.definition}.removed-${Date.now()}`;
			if (r.platform === "linux")
				this.checked("systemctl", ["--user", "disable", this.unit(updater)]);
			renameSync(
				updater.definition,
				`${updater.definition}.removed-${Date.now()}`,
			);
			renameSync(r.definition, backup);
			renameSync(this.recordPath, `${this.recordPath}.removed-${Date.now()}`);
			if (r.platform === "linux")
				this.checked("systemctl", ["--user", "daemon-reload"]);
			return { removed: true, retainedDefinition: backup };
		}
		return this.status();
	}
	resume() {
		return this.action("resume");
	}
}

export function assertServiceLaunch(home: string) {
	const lifecycle = new ServiceLifecycle(home);
	const r = lifecycle.record();
	if (
		process.env.BOBS_FACTORY_SERVICE_ID &&
		(!r ||
			r.id !== process.env.BOBS_FACTORY_SERVICE_ID ||
			r.desired !== "running")
	)
		throw new Error(
			"Managed service is stopped or in maintenance; deliberate service start/resume required",
		);
	if (!process.env.BOBS_FACTORY_SERVICE_ID && r)
		throw new Error(
			"This home belongs to a managed service; use service start or attach to its dashboard",
		);
}
