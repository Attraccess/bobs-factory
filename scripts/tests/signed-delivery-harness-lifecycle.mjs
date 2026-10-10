import { existsSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { jsonBytes } from "../lib/binary-release.mjs";

const temporaryPrefixes = [
	"bobs-signed-integration-",
	"bobs-startup-contention-",
];

// Only remove an explicit mkdtemp-owned harness directory after its receipt is
// written. A receipt stored inside the fixture takes precedence over cleanup.
export function cleanupFixtureTreeAfterReceipt({
	work,
	receiptPath,
	retainFixture = false,
	removeTree = rmSync,
}) {
	const root = existsSync(work) ? realpathSync(work) : resolve(work);
	const requestedReceipt = resolve(receiptPath);
	const receipt = existsSync(requestedReceipt)
		? realpathSync(requestedReceipt)
		: requestedReceipt;
	const prefix = temporaryPrefixes.find((value) =>
		root.split(sep).at(-1).startsWith(value),
	);
	if (!prefix) throw new Error(`Refusing to clean non-harness path: ${root}`);
	if (retainFixture) return { removed: false, reason: "retain-fixture" };
	const receiptRelative = relative(root, receipt);
	if (
		receiptRelative === "" ||
		(!isAbsolute(receiptRelative) &&
			receiptRelative !== ".." &&
			!receiptRelative.startsWith(`..${sep}`))
	) {
		return { removed: false, reason: "receipt-inside-fixture" };
	}
	removeTree(root, { recursive: true, force: true });
	return { removed: !existsSync(root), reason: "receipt-written" };
}

// Finalize only this run's receipt. Persist before deletion, then record any
// cleanup failure as failed evidence rather than leaving a provisional PASS.
export function finalizeFixtureReceipt({
	work,
	receiptPath,
	receipt,
	retainFixture = false,
	cleanupTree = cleanupFixtureTreeAfterReceipt,
}) {
	const errors = receipt.cleanupErrors;
	writeFileSync(receiptPath, jsonBytes(receipt));
	if (retainFixture || errors.length) {
		receipt.fixtureCleanup = {
			removed: false,
			reason: retainFixture ? "retain-fixture" : "active-owner-retained",
		};
	} else {
		try {
			receipt.fixtureCleanup = cleanupTree({ work, receiptPath });
			if (
				!receipt.fixtureCleanup.removed &&
				receipt.fixtureCleanup.reason !== "receipt-inside-fixture"
			)
				errors.push(
					`Temporary fixture was not removed: ${receipt.fixtureCleanup.reason}`,
				);
		} catch (error) {
			receipt.fixtureCleanup = { removed: false, reason: "cleanup-failed" };
			errors.push(
				`Temporary fixture cleanup failed${error.code ? ` (${error.code})` : ""}: ${error.stack ?? error}`,
			);
		}
	}
	if (errors.length) receipt.passed = false;
	writeFileSync(receiptPath, jsonBytes(receipt));
	return receipt.fixtureCleanup;
}

export async function terminateOwnedProcessGroup(
	pid,
	isAlive,
	{ termGraceMs = 1000, killWaitMs = 2000 } = {},
) {
	const send = (signal) => {
		try {
			process.kill(process.platform === "win32" ? pid : -pid, signal);
			return true;
		} catch (error) {
			if (error.code === "ESRCH") return false;
			throw error;
		}
	};
	const waitForExit = async (timeoutMs) => {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (!(await isAlive())) return true;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		return !(await isAlive());
	};

	if (!(await isAlive())) return { forcedKill: false, closeTimedOut: false };
	send("SIGTERM");
	if (await waitForExit(termGraceMs))
		return { forcedKill: false, closeTimedOut: false };
	const forcedKill = send("SIGKILL");
	const stopped = await waitForExit(killWaitMs);
	return { forcedKill, closeTimedOut: !stopped };
}
