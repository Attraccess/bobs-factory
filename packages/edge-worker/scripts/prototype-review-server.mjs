// PROTOTYPE (throwaway) — bobs-factory#71. Serves an unminified (development) build of the
// factory web UI, so the review-guide variant switcher is enabled, and proxies /api to the
// already-running factory (default http://localhost:3457).
//   pnpm prototype:review   →  http://localhost:3458/#/runs/<id>/review?variant=B
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { context } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url)),
	source = `${root}/src/factory/web`,
	target = `${root}/.prototype-review-web`,
	upstream = new URL(process.env.FACTORY_URL ?? "http://localhost:3457"),
	port = Number(process.env.PORT ?? 3458);
mkdirSync(target, { recursive: true });
const css = () =>
	execFileSync(
		"pnpm",
		[
			"exec",
			"tailwindcss",
			"-i",
			`${source}/styles.css`,
			"-o",
			`${target}/styles.css`,
		],
		{
			cwd: root,
			stdio: "inherit",
		},
	);
css();
const ctx = await context({
	entryPoints: [`${source}/app.tsx`],
	outfile: `${target}/app.js`,
	bundle: true,
	nodePaths: [`${root}/node_modules`],
	format: "esm",
	platform: "browser",
	target: "es2022",
	jsx: "automatic",
	sourcemap: true,
	define: { "process.env.NODE_ENV": '"development"' },
	plugins: [
		{
			name: "log",
			setup: (b) =>
				b.onEnd((r) =>
					console.log(`[prototype] rebuilt (${r.errors.length} errors)`),
				),
		},
	],
});
await ctx.watch();

const assets = {
	"/": ["index.html", "text/html", source],
	"/app.js": ["app.js", "application/javascript", target],
	"/styles.css": ["styles.css", "text/css", target],
};
// PROTOTYPE-only: per-file PR patches via the gh CLI (the factory API has no diff endpoint).
const prCache = new Map();
const gh = (path) =>
	new Promise((ok, fail) =>
		execFile("gh", ["api", path], { maxBuffer: 64 << 20 }, (e, out) =>
			e ? fail(e) : ok(JSON.parse(out)),
		),
	);
async function prFiles(url) {
	const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url ?? "");
	if (!m) throw new Error("Not a GitHub PR URL");
	if (!prCache.has(url))
		prCache.set(
			url,
			(async () => {
				const files = [];
				for (let page = 1; ; page++) {
					const batch = await gh(
						`repos/${m[1]}/${m[2]}/pulls/${m[3]}/files?per_page=100&page=${page}`,
					);
					files.push(
						...batch.map((f) => ({
							path: f.filename,
							previous: f.previous_filename,
							status: f.status,
							additions: f.additions,
							deletions: f.deletions,
							patch: f.patch ?? null,
						})),
					);
					if (batch.length < 100) return files;
				}
			})().catch((e) => {
				prCache.delete(url);
				throw e;
			}),
		);
	return prCache.get(url);
}
http
	.createServer((req, res) => {
		const path = req.url.split("?")[0];
		if (path === "/prototype-api/pr-files") {
			const url = new URL(req.url, "http://x").searchParams.get("pr");
			prFiles(url)
				.then((files) => {
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify(files));
				})
				.catch((e) =>
					res
						.writeHead(502, { "content-type": "application/json" })
						.end(JSON.stringify({ error: String(e.message ?? e) })),
				);
			return;
		}
		if (assets[path]) {
			const [name, type, dir] = assets[path];
			res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
			return res.end(readFileSync(`${dir}/${name}`));
		}
		const proxied = http.request(
			{
				host: upstream.hostname,
				port: upstream.port,
				path: req.url,
				method: req.method,
				headers: {
					...req.headers,
					host: upstream.host,
					origin: upstream.origin,
				},
			},
			(up) => {
				res.writeHead(up.statusCode, up.headers);
				up.pipe(res);
			},
		);
		proxied.on("error", (e) => res.writeHead(502).end(String(e)));
		req.pipe(proxied);
	})
	.listen(port, () =>
		console.log(
			`[prototype] review guide variants → http://localhost:${port}/  (api → ${upstream.origin})`,
		),
	);
