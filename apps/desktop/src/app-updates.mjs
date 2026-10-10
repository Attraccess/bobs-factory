import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { processStamp, read, save } from "./app-lifecycle.mjs";
import { DesktopAppSource, installationKind } from "./app-source.mjs";
export async function appUpdates({
	home,
	install,
	target,
	identity,
	port,
	sourceDirectory,
	services,
}) {
	const directory = join(home, "desktop", "updates"),
		receipt = join(directory, "installation.json");
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const source = new DesktopAppSource(directory, install, target, services);
	const manager = new services.UpdateManager(
		join(home, "desktop"),
		source,
		undefined,
		identity,
	);
	await manager.observeInstalled(identity);
	const options = {
		home,
		install,
		target,
		identity,
		port,
		directory,
		uiPid: process.pid,
		uiStamp: processStamp(process.pid),
	};
	save(join(directory, "ui-session.json"), {
		pid: process.pid,
		stamp: options.uiStamp,
		install,
		identity,
	});
	const handoff = () => ({
		owner: installationKind(install, target),
		message:
			installationKind(install, target) === "external"
				? "This desktop app is externally managed. Update through Homebrew/DEB/AUR or your installation owner."
				: existsSync(receipt)
					? "Verified Bob-owned app; shell upgrades preserve the local worker."
					: "Verify this installed app against its signed release to enable self-updates.",
	});
	let busy = false;
	async function helper(recover = false) {
		if (busy) return;
		const state = manager.status();
		if (state.operationOwner && !recover)
			throw Error("An app helper owns the operation; wait or inspect recovery");
		if (
			!existsSync(receipt) ||
			(!recover && installationKind(install, target) !== "bob-owned")
		)
			return;
		if (!recover && (!state.pending?.staged || !manager.activationEligible()))
			return;
		// Retain helper JS outside the bundle that will be renamed. Electron starts it
		// in Node mode BEFORE exit; it waits for this precise UI process to finish.
		const retained = join(directory, "helper");
		mkdirSync(retained, { recursive: true, mode: 0o700 });
		for (const file of [
			"app-helper.mjs",
			"app-lifecycle.mjs",
			"app-source.mjs",
			"app-archive.mjs",
			"update-services.mjs",
		])
			cpSync(join(sourceDirectory, file), join(retained, file));
		const request = join(directory, "helper-request.json");
		const recoveryInstall =
			recover && state.transaction?.snapshot
				? read(state.transaction.snapshot).install
				: install;
		save(request, { ...options, install: recoveryInstall });
		busy = true;
		const child = spawn(
			process.execPath,
			[
				join(retained, "app-helper.mjs"),
				request,
				...(recover ? ["recover"] : []),
			],
			{
				detached: true,
				stdio: "ignore",
				env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
			},
		);
		child.once("error", () => {
			busy = false;
		});
		child.once("exit", () => {
			busy = false;
		});
		child.unref();
	}
	return {
		status: () => ({ ...manager.status(), ...handoff() }),
		async action(action, input, revision) {
			if (action === "configure") manager.configure(input, revision);
			else if (action === "cancel")
				manager.configure({ paused: true }, revision);
			else if (action === "check") await manager.check();
			else if (action === "verify-installation")
				save(receipt, await source.enroll(identity));
			else if (action === "install" || action === "retry") {
				if (
					installationKind(install, target) !== "bob-owned" ||
					!existsSync(receipt)
				)
					throw Error(handoff().message);
				const s = manager.status();
				manager.requestInstall(input, revision, action === "retry");
				if (!s.pending?.staged) await manager.stage();
				await helper();
			} else if (action === "recover") await helper(true);
			else throw Error("Unknown app update action");
			return this.status();
		},
		async tick() {
			if (busy || manager.status().operationOwner) return;
			if (
				installationKind(install, target) !== "bob-owned" ||
				!existsSync(receipt)
			) {
				if (Date.now() >= manager.status().nextCheckAt) await manager.check();
				return;
			}
			await manager.tick();
			await helper();
		},
		quitRequested() {
			const path = join(directory, "quit.json");
			if (!existsSync(path)) return false;
			const q = read(path),
				t = manager.status().transaction;
			return (
				q.pid === process.pid &&
				q.stamp === options.uiStamp &&
				q.transactionId === t?.id &&
				["stopping", "rollback"].includes(t.phase)
			);
		},
		health(token) {
			if (!/^[a-f0-9-]{36}$/.test(token))
				throw Error("Invalid shell health token");
			const t = manager.status().transaction;
			if (!t?.snapshot) throw Error("No shell health transaction");
			const s = read(t.snapshot);
			const expected =
				t.phase === "rollback" || t.release?.outcome === "rolled-back"
					? t.previous
					: t.candidate;
			if (
				s.healthToken !== token ||
				expected.version !== identity.version ||
				expected.commit !== identity.commit ||
				expected.target !== target
			)
				throw Error("Shell does not match health transaction");
			save(join(directory, `health-${token}.json`), {
				token,
				pid: process.pid,
				stamp: processStamp(process.pid),
				install,
				version: identity.version,
				commit: identity.commit,
				target,
			});
		},
	};
}
