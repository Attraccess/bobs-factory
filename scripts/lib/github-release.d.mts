export interface ReleaseAsset {
	name: string;
	size: number;
	state: string;
	digest: string;
	browser_download_url: string;
}
export interface ReleaseClient {
	api(
		path: string,
		options?: { method?: string; body?: unknown; allow404?: boolean },
	): Promise<any>;
	pages(path: string, key?: string): Promise<any[]>;
	bytes(asset: ReleaseAsset): Promise<Buffer>;
}
export interface VerifiedRelease {
	release: {
		id: number;
		tag_name: string;
		published_at: string;
		assets: ReleaseAsset[];
	};
	manifest: {
		version: string;
		commit: string;
		channel?: string;
		tag: string;
		verifier: { file: string; sha256: string; size: number };
		targets: Record<
			string,
			{
				archive: string;
				archiveSha256: string;
				archiveSize: number;
				manifest: string;
				manifestSha256: string;
				manifestSize: number;
			}
		>;
	};
	manifestSha256: string;
}
export function githubClient(
	token?: string,
	transport?: typeof fetch,
): ReleaseClient;
export function discoverReleases(
	client: ReleaseClient,
	keys: Record<string, unknown>,
	options?: { selectedOnly?: boolean; allowBetaFallback?: boolean },
): Promise<{
	stable: VerifiedRelease | null;
	nightly: VerifiedRelease | null;
	verified: VerifiedRelease[];
}>;
export function verifyPublishedRelease(
	client: ReleaseClient,
	release: unknown,
	keys: Record<string, unknown>,
): Promise<VerifiedRelease>;
