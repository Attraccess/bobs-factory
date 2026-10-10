import { spawn } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
	allowDesktopStart,
	lifecycleGuard,
	stopDesktop,
} from "./DesktopLifecycle.js";
import { ownerAlive, workerOwner } from "./InstanceLock.js";

it("rechecks maintenance after confirmation, proves the live native executable, and retains Stop intent", async () => {
	const home = realpathSync(
		mkdtempSync(join(tmpdir(), "factory-desktop-stop-test-")),
	);
	const script = `import {mkdirSync,symlinkSync,unlinkSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {join} from 'node:path';
 const home=process.argv[1],lock=join(home,'runtime','worker.lock');mkdirSync(join(home,'runtime'),{recursive:true});
 symlinkSync(JSON.stringify({schema:1,pid:process.pid,nonce:'confirmed-owner',home,owner:'desktop',executable:process.execPath,processStamp:execFileSync('/bin/ps',['-p',String(process.pid),'-o','lstart='],{encoding:'utf8'}).trim()}),lock);
 process.on('SIGTERM',()=>{unlinkSync(lock);process.exit(0)});setInterval(()=>{},1000);`;
	const child = spawn(
		process.execPath,
		["--input-type=module", "-e", script, home],
		{ stdio: "ignore" },
	);
	try {
		for (let n = 0; !workerOwner(home) && n < 100; n++)
			await new Promise((r) => setTimeout(r, 20));
		expect(workerOwner(home)?.pid).toBe(child.pid);
		// The UI has confirmed this nonce, but maintenance wins final admission.
		const release = await lifecycleGuard(home);
		writeFileSync(
			join(home, "runtime", "update-owner.json"),
			JSON.stringify({ transactionId: "update-won" }),
		);
		release();
		await expect(
			stopDesktop(home, "confirmed-owner", process.execPath),
		).rejects.toThrow("maintenance");
		expect(ownerAlive(workerOwner(home)!)).toBe(true);
		expect(existsSync(join(home, "runtime", "desktop-stopped.json"))).toBe(
			false,
		);
		rmSync(join(home, "runtime", "update-owner.json"));
		await expect(
			stopDesktop(home, "wrong-nonce", process.execPath),
		).rejects.toThrow("identity");
		await stopDesktop(home, "confirmed-owner", process.execPath);
		expect(workerOwner(home)).toBeUndefined();
		expect(existsSync(join(home, "runtime", "desktop-stopped.json"))).toBe(
			true,
		);
		writeFileSync(join(home, "runtime", "update-owner.json"), "{}");
		await expect(allowDesktopStart(home)).rejects.toThrow("maintenance");
		expect(existsSync(join(home, "runtime", "desktop-stopped.json"))).toBe(
			true,
		);
		rmSync(join(home, "runtime", "update-owner.json"));
		await allowDesktopStart(home);
		expect(existsSync(join(home, "runtime", "desktop-stopped.json"))).toBe(
			false,
		);
	} finally {
		if (child.exitCode === null) child.kill("SIGKILL");
	}
});
