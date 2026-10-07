import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isPackagedExecutable, runtimeAssetPath } from "bobs-factory-core";
import { z } from "zod";

const InventorySchema = z.object({
	build: z.string().regex(/^[a-f0-9]{24}$/),
	protocol: z.literal(1),
	resources: z
		.array(
			z.object({
				path: z.string(),
				file: z.string(),
				sha256: z.string().regex(/^[a-f0-9]{64}$/),
				type: z.enum([
					"text/html",
					"application/javascript",
					"text/css",
					"image/png",
					"application/manifest+json",
				]),
				immutable: z.boolean(),
			}),
		)
		.min(7)
		.max(16),
});
/** Read and validate one completed build into memory; routes and version cannot drift during a rebuild. */
export function factoryWebAssets(root?: URL) {
	root ??= isPackagedExecutable
		? pathToFileURL(`${runtimeAssetPath("edge-worker/dist/factory/web", "")}/`)
		: existsSync(new URL("./web/current.json", import.meta.url))
			? new URL("./web/", import.meta.url)
			: new URL("../../dist/factory/web/", import.meta.url);
	const { directory } = z
		.object({ directory: z.string().regex(/^build-[a-f0-9]{24}$/) })
		.parse(JSON.parse(readFileSync(new URL("current.json", root), "utf8")));
	const buildRoot = new URL(`${directory}/`, root);
	const inventory = InventorySchema.parse(
		JSON.parse(readFileSync(new URL("shell.json", buildRoot), "utf8")),
	);
	if (directory !== `build-${inventory.build}`)
		throw new Error("Factory build pointer mismatch");
	const paths = new Set<string>();
	const assets = inventory.resources.map((resource) => {
		const fixed = [
			"index.html",
			"sw.js",
			"manifest.webmanifest",
			"icons/icon-192.png",
			"icons/icon-512.png",
			"icons/maskable-512.png",
			"icons/apple-touch-icon.png",
		].includes(resource.file);
		const versioned =
			/^(app\.[a-f0-9]{24}\.js|styles\.[a-f0-9]{24}\.css)$/.test(resource.file);
		if (
			(!fixed && !versioned) ||
			resource.immutable !== versioned ||
			resource.path !==
				(resource.file === "index.html" ? "/" : `/${resource.file}`) ||
			paths.has(resource.path)
		)
			throw new Error("Invalid factory static inventory");
		paths.add(resource.path);
		const bytes = readFileSync(new URL(resource.file, buildRoot));
		if (createHash("sha256").update(bytes).digest("hex") !== resource.sha256)
			throw new Error(`Incomplete factory shell: ${resource.file}`);
		return { ...resource, bytes };
	});
	if (
		!paths.has("/") ||
		!paths.has("/sw.js") ||
		!paths.has("/manifest.webmanifest") ||
		!assets.some((a) => a.file.startsWith("app.")) ||
		!assets.some((a) => a.file.startsWith("styles."))
	)
		throw new Error("Incomplete factory shell inventory");
	return { build: inventory.build, protocol: inventory.protocol, assets };
}
