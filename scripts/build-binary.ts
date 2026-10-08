import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
	options: {
		target: { type: "string", default: `${process.platform}-${process.arch}` },
		output: { type: "string", default: "artifacts" },
	},
});
const target = values.target!;
if (
	!["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"].includes(target)
)
	throw new Error("Unsupported distribution target");
if (Bun.version !== "1.4.2") throw new Error("Build with pinned Bun 1.4.2");
const root = resolve(import.meta.dir, "..");
const version = JSON.parse(
	readFileSync(join(root, "apps/cli/package.json"), "utf8"),
).version;
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
	cwd: root,
	encoding: "utf8",
}).trim();
const dirty =
	execFileSync("git", ["status", "--porcelain"], {
		cwd: root,
		encoding: "utf8",
	}).trim().length > 0;
const files: Record<string, { sha256: string; data: string }> = {};
const hash = (bytes: Buffer | string) =>
	createHash("sha256").update(bytes).digest("hex");
function collect(source: string, destination: string) {
	if (statSync(source).isDirectory()) {
		for (const name of readdirSync(source).sort())
			collect(join(source, name), `${destination}/${name}`);
	} else {
		const bytes = readFileSync(source);
		files[destination] = {
			sha256: hash(bytes),
			data: bytes.toString("base64"),
		};
	}
}
collect(join(root, "packages/edge-worker/prompts"), "edge-worker/prompts");
collect(
	join(root, "packages/edge-worker/label-prompt-template.md"),
	"edge-worker/label-prompt-template.md",
);
collect(
	join(root, "packages/edge-worker/dist/bobs-factory-skills-plugin"),
	"edge-worker/dist/bobs-factory-skills-plugin",
);
const web = join(root, "packages/edge-worker/dist/factory/web");
const { directory } = JSON.parse(
	readFileSync(join(web, "current.json"), "utf8"),
);
collect(join(web, "current.json"), "edge-worker/dist/factory/web/current.json");
collect(join(web, directory), `edge-worker/dist/factory/web/${directory}`);
collect(
	join(root, "packages/gemini-runner/src/prompts"),
	"gemini-runner/prompts",
);
collect(
	join(root, "packages/cursor-runner/src/sdk-host.mjs"),
	"cursor-runner/sdk-host.mjs",
);
collect(
	join(root, "packages/cursor-runner/src/permission-check.mjs"),
	"cursor-runner/permission-check.mjs",
);
const output = resolve(values.output!);
const name = `bobs-factory-${version}-${target}`;
const stage = join(output, name);
if (
	(await Bun.file(join(output, `${name}.manifest.json`)).exists()) ||
	(await Bun.file(join(stage, "bobs-factory")).exists())
)
	throw new Error(
		"Immutable candidate already exists; choose an empty output directory",
	);
mkdirSync(stage, { recursive: true });
// Only modules bundled into the executable belong in its license inventory.
const runtimePackages = new Set<string>();
const licensePlugins: Bun.BunPlugin[] = [
	{
		name: "license-inventory",
		setup(build) {
			build.onLoad({ filter: /node_modules/ }, (args) => {
				let directory = dirname(args.path);
				while (dirname(directory) !== directory) {
					if (
						existsSync(join(directory, "package.json")) &&
						JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))
							.name
					) {
						if (
							JSON.parse(
								readFileSync(join(directory, "package.json"), "utf8"),
							).name.startsWith("@cursor/")
						)
							throw new Error(
								"Cursor code must remain user-prepared, outside distribution",
							);
						runtimePackages.add(directory);
						break;
					}
					directory = dirname(directory);
				}
				return undefined;
			});
		},
	},
];
const executable = join(stage, "bobs-factory");
const result = await Bun.build({
	entrypoints: [join(root, "apps/cli/src/app.ts")],
	compile: {
		target: `bun-${target}` as Bun.Build.CompileTarget,
		outfile: executable,
	},
	external: ["@cursor/sdk"],
	plugins: licensePlugins,
	define: {
		BOBS_FACTORY_VERSION: JSON.stringify(version),
		BOBS_FACTORY_BUILD_IDENTITY: JSON.stringify({
			version,
			commit,
			dirty,
			target,
			resourceDigest: hash(JSON.stringify(files)),
			packaged: true,
		}),
		BOBS_FACTORY_ASSETS: JSON.stringify({
			digest: hash(JSON.stringify(files)),
			files,
		}),
	},
});
if (!result.success)
	throw new Error(result.logs.map((log) => log.message).join("\n"));
writeFileSync(join(stage, "LICENSE"), readFileSync(join(root, "LICENSE")));
writeFileSync(
	join(stage, "NOTICE"),
	"Bob’s Factory is derived from Cyrus by Ceedar.\nOriginal source and notices: https://github.com/cyrusagents/cyrus\nApache-2.0. Third-party components retain their licenses.\n",
);
// Include full notices from the installed production graph, including vendored notices.
// This is intentionally conservative: unused production components may also be listed.
const supplemental = JSON.parse(
	readFileSync(join(root, "docs/distribution/licenses/sources.json"), "utf8"),
) as Record<string, { source: string; sha256: string; packages: string[] }>;
const notices: string[] = [];
for (const directory of runtimePackages) {
	const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
	if (pkg.name?.startsWith("bobs-factory")) continue;
	const texts: string[] = [];
	const visit = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.name === "node_modules" || entry.name === ".git") continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) visit(path);
			else if (
				entry.isFile() &&
				/(?:license|licence|notice|copying)(?:[._-]|$)/i.test(entry.name)
			)
				texts.push(readFileSync(path, "utf8"));
			else if (/^readme\.md$/i.test(entry.name)) {
				const text = readFileSync(path, "utf8");
				if (
					text.includes("Permission is hereby granted") ||
					text.includes("Redistribution and use in source")
				)
					texts.push(text);
			} else if (entry.isFile() && /\.[cm]?[jt]s$/.test(entry.name)) {
				// Some upstream packages retain full BSD/MIT grants only in source headers.
				const text = readFileSync(path, "utf8");
				const header =
					/^(?:(?:\/\/[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/\s*))*/.exec(
						text,
					)?.[0] ?? "";
				if (
					header.includes("Permission is hereby granted") ||
					header.includes("Redistribution and use in source")
				)
					texts.push(header);
			}
		}
	};
	visit(directory);
	for (const [file, record] of Object.entries(supplemental)) {
		if (!record.packages.includes(pkg.name)) continue;
		const bytes = readFileSync(join(root, "docs/distribution/licenses", file));
		if (hash(bytes) !== record.sha256)
			throw new Error(`Supplemental notice integrity failure: ${file}`);
		texts.push(`Source: ${record.source}\n${bytes.toString("utf8")}`);
	}
	if (!texts.length)
		throw new Error(
			`Missing license notice for ${pkg.name}; add verified upstream text before distributing`,
		);
	notices.push(
		`${pkg.name}@${pkg.version} (${pkg.license ?? "See upstream notice"})\n${[...new Set(texts)].join("\n")}`,
	);
}
for (const [file, record] of Object.entries(supplemental)) {
	if (!record.packages.includes("bun-runtime")) continue;
	const bytes = readFileSync(join(root, "docs/distribution/licenses", file));
	if (hash(bytes) !== record.sha256)
		throw new Error(`Runtime notice integrity failure: ${file}`);
	notices.push(
		`Bun 1.4.2 runtime: ${file}\nSource: ${record.source}\n${bytes.toString("utf8")}`,
	);
}
writeFileSync(
	join(stage, "THIRD_PARTY_NOTICES.txt"),
	notices.sort().join("\n\n----------------------------------------\n\n"),
);
const binary = readFileSync(executable);
writeFileSync(
	join(stage, "build.json"),
	`${JSON.stringify(
		{
			schemaVersion: 1,
			product: "bobs-factory",
			version,
			commit,
			dirty,
			target,
			tooling: { bun: Bun.version },
			executable: {
				file: "bobs-factory",
				size: binary.length,
				sha256: hash(binary),
			},
			resourceDigest: hash(JSON.stringify(files)),
			validation: "pending runtime smoke",
			requirements: target.startsWith("linux")
				? "glibc; native target smoke required"
				: "macOS; native target smoke required",
		},
		null,
		2,
	)}\n`,
);
execFileSync(
	"tar",
	[
		"--no-xattrs",
		"--no-acls",
		"-czf",
		join(output, `${name}.tar.gz`),
		"-C",
		output,
		name,
	],
	{ env: { ...process.env, COPYFILE_DISABLE: "1" } },
);
const archive = readFileSync(join(output, `${name}.tar.gz`));
writeFileSync(
	join(output, `${name}.manifest.json`),
	`${JSON.stringify(
		{
			schemaVersion: 1,
			product: "bobs-factory",
			version,
			commit,
			dirty,
			target,
			file: `${name}.tar.gz`,
			size: archive.length,
			sha256: hash(archive),
		},
		null,
		2,
	)}\n`,
);
console.log(join(output, `${name}.tar.gz`));
