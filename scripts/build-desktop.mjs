import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { desktopRuntime } from "./lib/desktop-runtime.mjs";
import { validateCandidate } from "./lib/release-candidate.mjs";
import { prepareDesktopUpdate } from "./prepare-desktop-update.mjs";

const { values } = parseArgs({
	options: {
		runtime: { type: "string" },
		candidate: { type: "string" },
		output: { type: "string" },
		"source-root": { type: "string" },
	},
});
if (!values.runtime || !values.candidate)
	throw new Error(
		"--runtime native archive directory and --candidate frozen JSON required",
	);
const root = values["source-root"]
	? resolve(values["source-root"])
	: resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidate = validateCandidate(
	JSON.parse(readFileSync(values.candidate, "utf8")),
);
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
	cwd: root,
	encoding: "utf8",
}).trim();
if (
	commit !== candidate.candidate.commit ||
	execFileSync("git", ["status", "--porcelain"], {
		cwd: root,
		encoding: "utf8",
	}).trim()
)
	throw new Error("Desktop build requires clean frozen source");
const target = `${process.platform}-${process.arch}`;
const identity = desktopRuntime(resolve(values.runtime), {
	commit,
	version: candidate.candidate.version,
	target,
});
if (identity.dirty || identity.candidateDigest !== candidate.digest)
	throw new Error("Runtime must bind the same clean frozen candidate");
const app = join(root, "apps", "desktop"),
	runtime = join(app, "runtime"),
	output = resolve(values.output ?? join(root, "artifacts", "desktop"));
mkdirSync(output, { recursive: true });
cpSync(resolve(values.runtime), runtime, {
	recursive: true,
	errorOnExist: true,
});
try {
	execFileSync(
		"bun",
		[
			"build",
			join(app, "src", "update-services.ts"),
			"--target",
			"node",
			"--format",
			"esm",
			"--outfile",
			join(app, "src", "update-services.mjs"),
		],
		{ cwd: root, stdio: "inherit" },
	);
	writeFileSync(
		join(app, "desktop-identity.json"),
		JSON.stringify({
			version: candidate.candidate.version,
			commit,
			target,
			channel: candidate.candidate.channel,
		}),
	);
	execFileSync(
		"pnpm",
		[
			"exec",
			"electron-builder",
			"--publish",
			"never",
			process.platform === "darwin" ? "--mac" : "--linux",
			`--${process.arch}`,
			`--config.directories.output=${output}`,
			`--config.extraMetadata.version=${candidate.candidate.version}`,
			`--config.artifactName=bobs-factory-desktop-${candidate.candidate.version}-${process.platform === "darwin" ? "mac" : "linux"}-${process.arch}.\${ext}`,
		],
		{
			cwd: app,
			stdio: "inherit",
			env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
		},
	);

	const installedApp =
		process.platform === "darwin"
			? join(
					output,
					process.arch === "arm64" ? "mac-arm64" : "mac",
					"Bob's Factory.app",
				)
			: join(
					output,
					`bobs-factory-desktop-${candidate.candidate.version}-linux-${process.arch}.AppImage`,
				);
	const update = prepareDesktopUpdate({
		app: installedApp,
		output,
		candidate,
		target,
		unsigned: true,
	});
	const assets = readdirSync(output)
		.filter((name) => /\.(dmg|AppImage|deb)$/.test(name))
		.map((name) => {
			const bytes = readFileSync(join(output, name));
			return {
				file: name,
				size: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			};
		});
	if (assets.length !== (process.platform === "darwin" ? 1 : 2))
		throw new Error("Desktop installer inventory incomplete");
	const extensions =
		process.platform === "darwin" ? ["dmg"] : ["AppImage", "deb"];
	for (const ext of extensions) {
		const expected = `bobs-factory-desktop-${candidate.candidate.version}-${process.platform === "darwin" ? "mac" : "linux"}-${process.arch}.${ext}`;
		if (!assets.some((asset) => asset.file === expected))
			throw new Error(`Desktop asset contract mismatch: ${expected}`);
	}
	writeFileSync(
		join(output, "desktop-build.json"),
		`${JSON.stringify({ schemaVersion: 1, product: "bobs-factory-desktop", candidateDigest: candidate.digest, version: candidate.candidate.version, commit, target, runtime: identity, assets, update, signing: "unsigned preparation only", validation: "native install/auth/lifecycle receipts required", publication: false }, null, 2)}\n`,
	);
} finally {
	rmSync(runtime, { recursive: true, force: true });
	rmSync(join(app, "desktop-identity.json"), { force: true });
}
