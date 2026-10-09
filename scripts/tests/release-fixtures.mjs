import { generateKeyPairSync } from "node:crypto";
import { installerWithKeys } from "../lib/installer-pins.mjs";
import { signManifest } from "../lib/release-signature.mjs";

const pair = generateKeyPairSync("rsa", {
	modulusLength: 3072,
	publicKeyEncoding: { type: "spki", format: "pem" },
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
export const privateKey = pair.privateKey;
export const keys = {
	fixture: { algorithm: "rsa-sha256", status: "active", pem: pair.publicKey },
};
export const signBytes = (bytes) =>
	signManifest(bytes, privateKey, "fixture", keys);
export const testInstaller = (source) => installerWithKeys(source, keys);
