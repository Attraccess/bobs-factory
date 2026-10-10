import { createPublicKey } from "node:crypto";
export function installerPins(keys) {
	const lines = ["# BEGIN PINNED RELEASE KEYS", 'case "$key_id" in'];
	for (const [id, record] of Object.entries(keys)) {
		if (
			!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) ||
			record.algorithm !== "rsa-sha256"
		)
			throw new Error("Invalid trusted key");
		if (record.status !== "active") continue;
		const key = createPublicKey(record.pem);
		if (
			key.asymmetricKeyType !== "rsa" ||
			key.asymmetricKeyDetails.modulusLength < 3072
		)
			throw new Error("Unsupported publisher key");
		const pem = key.export({ type: "spki", format: "pem" }).trimEnd();
		lines.push(
			`  ${id}) cat > "$work/publisher.pem" <<'BOBS_FACTORY_PUBLIC_KEY'`,
			pem,
			"BOBS_FACTORY_PUBLIC_KEY",
			"  ;;",
		);
	}
	lines.push(
		"  *) fail 'Unknown or retired publisher key. Obtain a fresh trusted installer; release rollout may still be pending.';;",
		"esac",
		"# END PINNED RELEASE KEYS",
	);
	return lines.join("\n");
}
export function installerWithKeys(source, keys) {
	if (!source.includes("# BEGIN PINNED RELEASE KEYS"))
		throw new Error("Installer pins marker missing");
	return source.replace(
		/# BEGIN PINNED RELEASE KEYS[\s\S]*?# END PINNED RELEASE KEYS/,
		installerPins(keys),
	);
}
