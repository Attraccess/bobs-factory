import metadata from "../public/releases/latest.json";

export const REPO = "https://github.com/jappyjan/bobs-factory";
export const INSTALL_COMMAND =
	"curl -fsSL https://jappyjan.github.io/bobs-factory/install.sh | sh";
// This also works in the installing terminal, before its PATH is reloaded.
export const LAUNCH_COMMAND = "~/.local/bin/bobs-factory";

export const release: {
	status: string;
	message?: string;
	version?: string;
	channel?: "stable" | "prerelease";
} = metadata;
export const releaseAvailable = release.status === "available";
