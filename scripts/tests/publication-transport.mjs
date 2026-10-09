// Preloaded only by tests. Every request remains in a local simulated provider.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const path = process.env.BOBS_FACTORY_TEST_PROVIDER;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
globalThis.fetch = async (url, options = {}) => {
	const s = JSON.parse(readFileSync(path, "utf8"));
	const u = new URL(url),
		method = options.method ?? "GET";
	s.operations.push({ method, path: u.pathname });
	const save = () => writeFileSync(path, JSON.stringify(s));
	const response = (value, status = 200) => {
		save();
		return new Response(status === 204 ? null : JSON.stringify(value), {
			status,
		});
	};
	const api = "/repos/jappyjan/bobs-factory";
	if (
		!["api.github.com", "uploads.github.com", "github.com"].includes(u.hostname)
	)
		throw Error("Unexpected test host");
	const p = u.pathname.slice(api.length);
	const body =
		options.body && typeof options.body === "string"
			? JSON.parse(options.body)
			: null;
	const fault = (key) => {
		if (s.fault === key) {
			delete s.fault;
			save();
			throw Error(`Simulated timeout: ${key}`);
		}
	};
	if (u.hostname === "github.com") {
		const name = u.pathname.split("/").at(-1);
		const tag = u.pathname.split("/").at(-2);
		const assets =
			s.history?.find((r) => r.tag_name === tag)?.assets ?? s.assets;
		const asset = assets.find((a) => a.name === name);
		if (!asset) return response({}, 404);
		save();
		return new Response(Buffer.from(asset.bytes, "base64"));
	}
	if (p === "/actions/runs/123") return response(s.buildProvenance.run);
	if (p === "/actions/runs/123/jobs")
		return response({ jobs: s.buildProvenance.jobs });
	if (p === "/actions/runs/123/artifacts")
		return response({ artifacts: Object.values(s.buildProvenance.artifacts) });
	if (p.startsWith("/contents/")) {
		const content = s.contents[p.slice("/contents/".length)];
		if (!content) throw Error("Unexpected content request");
		return response({ content, encoding: "base64" });
	}
	if (p === "")
		return response({
			full_name: "jappyjan/bobs-factory",
			private: false,
			visibility: "public",
		});
	if (p === "/git/ref/heads/main")
		return response({ object: { type: "commit", sha: s.mainSha } });
	if (p.startsWith("/compare/"))
		return response({ status: s.relation ?? "ahead" });
	if (p.startsWith("/git/ref/tags/"))
		return response(s.tag ?? {}, s.tag ? 200 : 404);
	if (p.startsWith("/git/tags/") && method === "GET")
		return response(s.annotation);
	if (p === "/git/tags" && method === "POST") {
		s.annotation = {
			...body,
			object: { type: "commit", sha: body.object },
			sha: "c".repeat(40),
		};
		return response(s.annotation);
	}
	if (p === "/git/refs" && method === "POST") {
		s.tag = { object: { type: "tag", sha: body.sha } };
		fault("tag-after");
		return response(s.tag, 201);
	}
	if (p === "/releases" && method === "GET")
		return response([
			...(s.history ?? []),
			...(s.release ? [{ ...s.release, assets: s.assets }] : []),
		]);
	const historicalAssets = /^\/releases\/(\d+)\/assets$/.exec(p);
	const historical = s.history?.find(
		(r) => r.id === Number(historicalAssets?.[1]),
	);
	if (historicalAssets && historical && method === "GET")
		return response(historical.assets);
	if (p === "/releases" && method === "POST") {
		s.release = { ...body, id: 99 };
		fault("draft-after");
		return response(s.release, 201);
	}
	if (p === "/releases/99/assets" && method === "GET")
		return response(s.assets);
	if (p === "/releases/99/assets" && method === "POST") {
		const name = u.searchParams.get("name");
		fault(`upload-before:${name}`);
		const chunks = [];
		for await (const b of options.body) chunks.push(b);
		const bytes = Buffer.concat(chunks);
		const a = {
			id: s.assets.length + 1,
			name,
			state: "uploaded",
			size: bytes.length,
			digest: `sha256:${hash(bytes)}`,
			bytes: bytes.toString("base64"),
			browser_download_url: `https://github.com/jappyjan/bobs-factory/releases/download/${s.release.tag_name}/${name}`,
		};
		s.assets.push(a);
		fault(`upload-after:${name}`);
		return response(a, 201);
	}
	if (p === "/releases/99" && method === "PATCH") {
		s.release = { ...s.release, ...body, published_at: "2026-10-09T00:00:00Z" };
		fault("publish-after");
		return response(s.release);
	}
	if (p === "/actions/workflows/website.yml/dispatches" && method === "POST") {
		fault("pages");
		return response(null, 204);
	}
	throw Error(`Unexpected simulated provider request: ${method} ${u}`);
};
