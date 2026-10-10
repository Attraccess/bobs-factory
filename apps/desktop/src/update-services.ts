// Bundle only these shared primitives, never the worker or a provider runner.

export { requestFactoryTerminalSession } from "../../../packages/edge-worker/src/factory/FactoryAuthOperator.js";
export {
	candidateKey,
	effectiveUpdatePolicy,
	UpdateManager,
} from "../../../packages/edge-worker/src/updates/UpdateManager.js";
export { validateReleaseManifest } from "../../../scripts/lib/binary-release.mjs";
export {
	discoverReleases,
	githubClient,
	verifyPublishedRelease,
} from "../../../scripts/lib/github-release.mjs";
export {
	trustedKeys,
	verifyManifestSignature,
} from "../../../scripts/lib/release-signature.mjs";
export {
	desktopStopped,
	lifecycleGuard,
} from "../../cli/src/services/DesktopLifecycle.js";
export {
	ownerAlive,
	workerOwner,
} from "../../cli/src/services/InstanceLock.js";
export { FactoryClient } from "../../cli/src/tui/client.js";
