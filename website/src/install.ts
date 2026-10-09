import metadata from "../public/releases/latest.json";
import nightlyMetadata from "../public/releases/nightly.json";
import stableMetadata from "../public/releases/stable.json";

export const REPO = "https://github.com/jappyjan/bobs-factory";
export const INSTALL_COMMAND =
	"curl -fsSL https://jappyjan.github.io/bobs-factory/install.sh | sh";
// This also works in the installing terminal, before its PATH is reloaded.
export const LAUNCH_COMMAND = "~/.local/bin/bobs-factory";

export const release: {
	status: string;
	message?: string;
	version?: string;
	channel?: "stable" | "nightly" | "prerelease";
} = {
	...metadata,
	channel:
		"channel" in metadata &&
		["stable", "nightly", "prerelease"].includes(String(metadata.channel))
			? (metadata.channel as "stable" | "nightly" | "prerelease")
			: undefined,
};
export const releaseAvailable = release.status === "available";

export type DownloadRelease = {
	status: string;
	message?: string;
	version?: string;
	commit?: string;
	tag?: string;
	channel?: string;
	targets?: Record<string, { archive: string }>;
};
export const channelDownloads: DownloadRelease[] = [
	stableMetadata,
	nightlyMetadata,
];
export function channelInstallCommand(channel: string, version?: string) {
	return `${INSTALL_COMMAND} -s -- --channel ${channel}${version ? ` --version ${version}` : ""}`;
}
