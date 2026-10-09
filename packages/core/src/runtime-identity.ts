import packageJson from "../package.json" with { type: "json" };

export interface RuntimeIdentity {
	version: string;
	commit: string | null;
	dirty: boolean | null;
	target: string | null;
	resourceDigest: string | null;
	packaged: boolean;
}

// Compiled into the executable from the same values used for build.json.
// A checkout or an older binary never claims the identity of its current directory.
declare const BOBS_FACTORY_BUILD_IDENTITY: RuntimeIdentity;

export const factoryRuntimeIdentity: Readonly<RuntimeIdentity> = Object.freeze(
	typeof BOBS_FACTORY_BUILD_IDENTITY === "undefined"
		? {
				version: packageJson.version,
				commit: null,
				dirty: null,
				target: null,
				resourceDigest: null,
				packaged: false,
			}
		: { ...BOBS_FACTORY_BUILD_IDENTITY },
);
