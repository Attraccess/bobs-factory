import {
	createHash,
	generateKeyPairSync,
	randomBytes,
	sign,
} from "node:crypto";
import type {
	AuthenticationResponseJSON,
	RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";

const sha = (data: string | Buffer) =>
	createHash("sha256").update(data).digest();
const b64 = (data: Uint8Array | string) =>
	Buffer.from(data).toString("base64url");
// Software authenticator fixture: real CBOR attestation and EC signatures, no verifier mocks.
export function authenticator() {
	const { privateKey, publicKey } = generateKeyPairSync("ec", {
		namedCurve: "prime256v1",
	});
	const jwk = publicKey.export({ format: "jwk" });
	const id = randomBytes(32);
	const cose = isoCBOR.encode(
		new Map<number, number | Uint8Array>([
			[1, 2],
			[3, -7],
			[-1, 1],
			[-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))],
			[-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
		]),
	);
	const data = (origin: string, flags: number, counter = 0) => {
		const number = Buffer.alloc(4);
		number.writeUInt32BE(counter);
		return Buffer.concat([
			sha(new URL(origin).hostname),
			Buffer.from([flags]),
			number,
		]);
	};
	const client = (type: string, challenge: string, origin: string) =>
		Buffer.from(
			JSON.stringify({ type, challenge, origin, crossOrigin: false }),
		);
	return {
		id: b64(id),
		register(
			challenge: string,
			origin: string,
			verified = true,
		): RegistrationResponseJSON {
			const length = Buffer.alloc(2);
			length.writeUInt16BE(id.length);
			const authData = Buffer.concat([
				data(origin, verified ? 0x45 : 0x41),
				Buffer.alloc(16),
				length,
				id,
				cose,
			]);
			return {
				id: b64(id),
				rawId: b64(id),
				type: "public-key",
				clientExtensionResults: {},
				response: {
					clientDataJSON: b64(client("webauthn.create", challenge, origin)),
					attestationObject: b64(
						isoCBOR.encode(
							new Map<string, any>([
								["fmt", "none"],
								["attStmt", new Map()],
								["authData", new Uint8Array(authData)],
							]),
						),
					),
					transports: ["internal"],
				},
			};
		},
		login(
			challenge: string,
			origin: string,
			counter = 1,
			verified = true,
		): AuthenticationResponseJSON {
			const clientData = client("webauthn.get", challenge, origin),
				authData = data(origin, verified ? 5 : 1, counter);
			return {
				id: b64(id),
				rawId: b64(id),
				type: "public-key",
				clientExtensionResults: {},
				response: {
					clientDataJSON: b64(clientData),
					authenticatorData: b64(authData),
					signature: b64(
						sign(
							"sha256",
							Buffer.concat([authData, sha(clientData)]),
							privateKey,
						),
					),
				},
			};
		},
	};
}
