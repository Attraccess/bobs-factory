import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { requireValue } from "./binary-release.mjs";
export const trustedKeys = JSON.parse(
	readFileSync(
		new URL("../../docs/distribution/release-keys.json", import.meta.url),
		"utf8",
	),
).keys;
export function verifyManifestSignature(
	bytes,
	signature,
	keyId,
	keys = trustedKeys,
) {
	requireValue(
		/^[a-z0-9][a-z0-9-]{0,63}$/.test(keyId),
		"Malformed publisher key identifier",
	);
	const record = keys[keyId];
	requireValue(
		record?.algorithm === "rsa-sha256" && record.status === "active",
		"Unknown or retired publisher key; obtain a fresh trusted bootstrap",
	);
	const key = createPublicKey(record.pem);
	requireValue(
		key.asymmetricKeyType === "rsa" &&
			key.asymmetricKeyDetails.modulusLength >= 3072,
		"Unsupported publisher key",
	);
	requireValue(
		signature.length ===
			Math.ceil(key.asymmetricKeyDetails.modulusLength / 8) &&
			verify("RSA-SHA256", bytes, key, signature),
		"Invalid publisher manifest signature",
	);
}
export function signManifest(bytes, privatePem, keyId, keys = trustedKeys) {
	const key = createPrivateKey(privatePem);
	const signature = sign("RSA-SHA256", bytes, key);
	verifyManifestSignature(bytes, signature, keyId, keys);
	return signature;
}
