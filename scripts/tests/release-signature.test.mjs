import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyManifestSignature } from "../lib/release-signature.mjs";
import { keys, signBytes } from "./release-fixtures.mjs";

test("RSA signatures interoperate with the system OpenSSL and reject tampered bytes", () => {
	const bytes = Buffer.from('{"source":"immutable","version":"1.0.0"}\n');
	const signature = signBytes(bytes);
	verifyManifestSignature(bytes, signature, "fixture", keys);
	const directory = mkdtempSync(join(tmpdir(), "factory-signature-"));
	try {
		for (const [name, data] of [
			["manifest.json", bytes],
			["signature", signature],
			["public.pem", keys.fixture.pem],
		])
			writeFileSync(join(directory, name), data);
		execFileSync("openssl", [
			"dgst",
			"-sha256",
			"-verify",
			join(directory, "public.pem"),
			"-signature",
			join(directory, "signature"),
			join(directory, "manifest.json"),
		]);
		assert.throws(
			() =>
				verifyManifestSignature(
					Buffer.concat([bytes, Buffer.from(" ")]),
					signature,
					"fixture",
					keys,
				),
			/Invalid publisher/,
		);
		assert.throws(
			() =>
				verifyManifestSignature(bytes, Buffer.from("invalid"), "fixture", keys),
			/Invalid publisher/,
		);
		assert.throws(
			() => verifyManifestSignature(bytes, signature, "unknown", keys),
			/Unknown or retired/,
		);
		assert.throws(
			() => verifyManifestSignature(bytes, signature, "../key", keys),
			/Malformed/,
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
test("overlapping pinned keys support rotation; retirement and wrong keys reject", () => {
	const next = generateKeyPairSync("rsa", {
		modulusLength: 3072,
		publicKeyEncoding: { type: "spki", format: "pem" },
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
	});
	const rotation = {
		...keys,
		next: { algorithm: "rsa-sha256", status: "active", pem: next.publicKey },
	};
	const bytes = Buffer.from("release");
	const signature = signBytes(bytes);
	verifyManifestSignature(bytes, signature, "fixture", rotation);
	assert.throws(
		() => verifyManifestSignature(bytes, signature, "next", rotation),
		/Invalid publisher/,
	);
	assert.throws(
		() =>
			verifyManifestSignature(bytes, signature, "fixture", {
				...rotation,
				fixture: { ...keys.fixture, status: "retired" },
			}),
		/retired/,
	);
});
