import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

test("open launcher refreshes automatic candidates/results without discarding edits or changing captured consent", async () => {
	const elements = new Map(),
		calls = [],
		timers = [];
	const element = (id) => {
		if (!elements.has(id))
			elements.set(id, {
				value: "",
				checked: false,
				textContent: "",
				disabled: false,
				events: {},
				addEventListener(event, listener) {
					this.events[event] = listener;
				},
			});
		return elements.get(id);
	};
	let state = {
		revision: 1,
		settings: { channel: "stable", overrides: {}, paused: false },
		installed: {
			version: "1.0.0",
			commit: "a".repeat(40),
			target: "linux-x64",
		},
		effectivePolicy: "manual",
		activationSupported: true,
		message: "Verified app",
	};
	let releaseInstall;
	runInNewContext(
		readFileSync(new URL("../src/launcher.js", import.meta.url), "utf8"),
		{
			document: {
				querySelector: element,
				hidden: false,
				addEventListener() {},
			},
			window: {
				addEventListener() {},
				factoryLauncher: {
					async updates(action, input, revision) {
						calls.push({ action, input, revision });
						if (action === "install")
							await new Promise((resolve) => {
								releaseInstall = resolve;
							});
						if (action === "configure" && revision !== state.revision)
							throw Error("Settings revision changed");
						return structuredClone(state);
					},
				},
			},
			setInterval(refresh) {
				timers.push(refresh);
				return 1;
			},
			clearInterval() {},
		},
	);
	const settle = () => new Promise((resolve) => setImmediate(resolve));
	await settle();
	assert.match(element("#app-update-status").textContent, /No pending/);
	element("#app-pin").value = "2.0.0";
	element("#app-pin").events.input();
	const candidate = {
		channel: "stable",
		version: "1.1.0",
		commit: "b".repeat(40),
		target: "linux-x64",
		manifestSha256: "c".repeat(64),
	};
	state = { ...state, revision: 2, pending: { candidate } };
	timers[0]();
	await settle();
	assert.match(
		element("#app-update-status").textContent,
		/Candidate: stable 1.1.0/,
	);
	assert.equal(element("#app-pin").value, "2.0.0");
	element("#app-save").events.click();
	await settle();
	assert.equal(
		calls.at(-1).revision,
		1,
		"dirty form uses its original settings revision",
	);
	assert.match(
		element("#app-update-status").textContent,
		/Settings revision changed/,
	);
	element("#app-install").events.click();
	assert.deepEqual(calls.at(-1), {
		action: "install",
		input: Object.values(candidate).join(":"),
		revision: 2,
	});
	state = {
		...state,
		revision: 3,
		pending: { candidate: { ...candidate, version: "1.2.0" } },
	};
	timers[0]();
	assert.equal(
		calls.at(-1).action,
		"install",
		"poll cannot overlap consent mutation",
	);
	releaseInstall();
	await settle();
	state = {
		...state,
		pending: undefined,
		transaction: { phase: "rolled-back", release: { outcome: "rolled-back" } },
	};
	timers[0]();
	await settle();
	assert.match(
		element("#app-update-status").textContent,
		/result: rolled-back/,
	);
	assert.equal(element("#app-pin").value, "2.0.0");
	element("#app-reset").events.click();
	await settle();
	assert.equal(element("#app-pin").value, "");
});
