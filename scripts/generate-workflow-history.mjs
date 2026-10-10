// Generate conservative full-behavior fingerprints from historical installed catalogs.
// Unknown behavior remains a local migration; never classify by IDs alone.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const cwd = process.cwd();
const dir = mkdtempSync(join(tmpdir(), "factory-stock-"));
symlinkSync(
	join(cwd, "packages/edge-worker/node_modules"),
	join(dir, "node_modules"),
);
const canonical = (v) =>
	Array.isArray(v)
		? v.map(canonical)
		: v && typeof v === "object"
			? Object.fromEntries(
					Object.entries(v)
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([k, x]) => [k, canonical(x)]),
				)
			: v;
function behavior(w) {
	w = structuredClone(w);
	w.labels = [];
	w.allowedTriggers = [];
	const scan = (ss) => {
		for (const s of ss) {
			if (s.tool === "handoff") delete s.computeIntensive;
			if (s.type === "agent")
				for (const k of [
					"runner",
					"model",
					"reasoningEffort",
					"modelVariant",
					"serviceTier",
				])
					delete s[k];
			for (const g of s.groups ?? []) scan(g);
		}
	};
	scan(w.steps);
	return w;
}
const revs = execFileSync(
	"git",
	[
		"log",
		"-50",
		"--format=%H",
		"HEAD",
		...process.argv.slice(2),
		"--",
		"packages/edge-worker/src/factory/defaultWorkflows.ts",
	],
	{ encoding: "utf8" },
)
	.trim()
	.split("\n");
const schemaBundle = join(dir, "schema.mjs");
const esbuildSchema = await import(
	pathToFileURL(
		join(cwd, "packages/edge-worker/node_modules/esbuild/lib/main.js"),
	)
);
await esbuildSchema.build({
	entryPoints: [join(cwd, "packages/edge-worker/src/factory/Workflow.ts")],
	outfile: schemaBundle,
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	logLevel: "silent",
});
const { WorkflowSchema } = await import(pathToFileURL(schemaBundle));
const historyPath = join(
	cwd,
	"packages/edge-worker/src/factory/historicalWorkflowDigests.json",
);
const map = JSON.parse(readFileSync(historyPath, "utf8"));
try {
	for (const revision of revs) {
		try {
			const archive = execFileSync(
				"git",
				["archive", revision, "packages/edge-worker/src"],
				{ maxBuffer: 64 * 1024 * 1024 },
			);
			execFileSync("tar", ["-xf", "-", "-C", dir], { input: archive });
			const source = join(
				dir,
				"packages/edge-worker/src/factory/defaultWorkflows.ts",
			);
			// Resolve installed dependencies from the isolated archive.
			try {
				symlinkSync(
					join(cwd, "packages/edge-worker/node_modules"),
					join(dir, "packages/edge-worker/node_modules"),
				);
			} catch {}
			const out = join(dir, `${revision}.mjs`);
			const esbuild = await import(
				pathToFileURL(
					join(cwd, "packages/edge-worker/node_modules/esbuild/lib/main.js"),
				)
			);
			await esbuild.build({
				entryPoints: [source],
				outfile: out,
				bundle: true,
				platform: "node",
				format: "esm",
				packages: "external",
				logLevel: "silent",
			});
			const { defaultWorkflows } = await import(pathToFileURL(out));
			for (const w of defaultWorkflows) {
				const hash = createHash("sha256")
					.update(JSON.stringify(canonical(behavior(WorkflowSchema.parse(w)))))
					.digest("hex");
				map[w.id] ??= {};
				map[w.id][hash] ??= revision;
			}
			console.log(revision.slice(0, 8), "recorded");
		} catch (e) {
			console.log(
				revision.slice(0, 8),
				"unsupported:",
				String(e.message).slice(0, 200),
			);
		}
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}
writeFileSync(
	join(cwd, "packages/edge-worker/src/factory/historicalWorkflowDigests.json"),
	`${JSON.stringify(map, null, "\t")}\n`,
);
