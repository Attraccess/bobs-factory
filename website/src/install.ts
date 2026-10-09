import stable from "../public/releases/latest.json";
import nightly from "../public/releases/nightly.json";
export const REPO = "https://github.com/jappyjan/bobs-factory";
export const INSTALL_COMMAND =
	"curl -fsSL https://jappyjan.github.io/bobs-factory/install.sh | sh";
export const LAUNCH_COMMAND = "~/.local/bin/bobs-factory";
export type InstallChannel = "stable" | "nightly";
export type PublicRelease = {
	status: string;
	message?: string;
	version?: string;
	tag?: string;
	channel?: string;
	targets?: Record<string, { archive: string }>;
};
export const channels: Record<InstallChannel, PublicRelease> = {
	stable,
	nightly,
};
export const release = channels.stable;
export const releaseAvailable = release.status === "available";
export const installCommand = (channel: InstallChannel) =>
	channel === "stable"
		? INSTALL_COMMAND
		: `${INSTALL_COMMAND} -s -- --channel nightly`;
