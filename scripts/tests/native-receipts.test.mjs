import assert from "node:assert/strict";
import test from "node:test";
import {
	TARGETS,
	validateNativeHelpers,
	validatePreparedAgentBoundaries,
} from "../lib/binary-release.mjs";

const identity = { version: "1.0.0-beta", commit: "a".repeat(40) };
const build = (target) => ({
	...identity,
	target,
	dirty: false,
	resourceDigest: "b".repeat(64),
	executable: { sha256: "c".repeat(64) },
});
const fixture = (target, validation = "native-helpers") => ({
	...identity,
	schemaVersion: 1,
	product: "bobs-factory",
	status: "passed",
	validation,
	target,
	dirty: false,
	resourceDigest: "b".repeat(64),
	executableSha256: "c".repeat(64),
	platform: {
		os: target.split("-")[0],
		arch: target.split("-")[1],
		release: "fixture",
		systemVersion: "fixture",
		cpuModel: "fixture",
		libc: target.startsWith("linux") ? "glibc 2.39" : "not-applicable",
	},
	scope: {
		transport: "controlled-local-https",
		credentials: "synthetic-scoped",
		agentInference: "none",
	},
	requestCount: 4,
	checks: Object.fromEntries(
		[
			"gitCredentialScoped",
			"gitCredentialForeignRejected",
			"restApiScoped",
			"graphqlApiScoped",
			"apiForeignRejected",
			"missingCredentialNoFallback",
			"http201CiRetry",
			"helperWithoutPath",
			"cursorPermission",
		].map((key) => [key, "passed"]),
	),
});
test("requires candidate-bound native helper evidence for each actual target", () => {
	for (const target of TARGETS) {
		assert.equal(
			validateNativeHelpers(fixture(target), identity, target, build(target))
				.target,
			target,
		);
		for (const mutate of [
			(receipt) => {
				receipt.commit = "d".repeat(40);
			},
			(receipt) => {
				receipt.executableSha256 = "d".repeat(64);
			},
			(receipt) => {
				receipt.dirty = true;
			},
			(receipt) => {
				receipt.platform.arch = "foreign";
			},
			(receipt) => {
				receipt.platform.cpuModel = "";
			},
			(receipt) => {
				receipt.platform.libc = "unknown";
			},
			(receipt) => {
				delete receipt.checks.http201CiRetry;
			},
			(receipt) => {
				receipt.scope.agentInference = "live";
			},
		]) {
			const receipt = fixture(target);
			mutate(receipt);
			assert.throws(() =>
				validateNativeHelpers(receipt, identity, target, build(target)),
			);
		}
	}
});
test("separates scripted agent boundaries from authenticated provider execution", () => {
	const target = "darwin-arm64";
	const receipt = {
		...fixture(target, "prepared-agent-boundaries"),
		scope: {
			agents: "synthetic-sdk-and-mocked-adapters",
			authenticatedProviders: false,
			agentInference: "none",
		},
		compiledCursorIpcCreateResume: "passed",
		adapterCheckout: { commit: identity.commit, dirty: false },
		adapters: Object.fromEntries(
			["claude", "codex", "gemini", "opencode", "cursor"].map((runner) => [
				runner,
				{
					status: "passed",
					passed: 1,
					skipped: 0,
					files: ["fixture.test.ts"],
					reportSha256: "e".repeat(64),
				},
			]),
		),
	};
	assert.equal(
		validatePreparedAgentBoundaries(receipt, identity, target, build(target)),
		receipt,
	);
	for (const mutate of [
		(value) => {
			value.scope.authenticatedProviders = true;
		},
		(value) => {
			value.commit = "d".repeat(40);
		},
		(value) => {
			delete value.adapters.cursor;
		},
		(value) => {
			value.adapters.codex.passed = 0;
		},
		(value) => {
			value.compiledCursorIpcCreateResume = "pending";
		},
		(value) => {
			value.adapterCheckout.commit = "d".repeat(40);
		},
		(value) => {
			value.adapterCheckout.dirty = true;
		},
	]) {
		const changed = structuredClone(receipt);
		mutate(changed);
		assert.throws(() =>
			validatePreparedAgentBoundaries(changed, identity, target, build(target)),
		);
	}
});
