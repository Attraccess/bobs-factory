import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { digest, packApp } from "../apps/desktop/src/app-archive.mjs";
import { appFingerprint } from "../apps/desktop/src/app-source.mjs";
import { validateCandidate } from "./lib/release-candidate.mjs";
export function prepareDesktopUpdate({
	app,
	output,
	candidate,
	target,
	unsigned = false,
}) {
	candidate = validateCandidate(candidate);
	app = resolve(app);
	output = resolve(output);
	if (
		!["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].includes(target)
	)
		throw Error("Unsupported desktop update target");
	const c = candidate.candidate;
	mkdirSync(output, { recursive: true });
	let archive,
		format,
		osSigning = "not-applicable";
	if (target.startsWith("darwin")) {
		const identity = JSON.parse(
			readFileSync(join(app, "Contents", "Resources", "desktop-identity.json")),
		);
		if (
			identity.version !== c.version ||
			identity.commit !== c.commit ||
			identity.target !== target
		)
			throw Error("App differs from frozen desktop candidate");
		if (!unsigned) {
			execFileSync("/usr/bin/codesign", [
				"--verify",
				"--deep",
				"--strict",
				app,
			]);
			const result = execFileSync(
				"/usr/bin/codesign",
				["-dv", "--verbose=4", app],
				{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
			);
			// codesign emits certificate detail to stderr; Gatekeeper assessment below is
			// authoritative for notarized distribution, beyond an ad-hoc valid signature.
			void result;
			execFileSync("/usr/sbin/spctl", ["--assess", "--type", "execute", app]);
			osSigning = "developer-id-notarized";
		} else osSigning = "unsigned";
		const container = join(output, "app-update-container");
		if (existsSync(container))
			throw Error("Retained app update container requires inspection");
		mkdirSync(container);
		try {
			cpSync(app, join(container, "Bob's Factory.app"), {
				recursive: true,
				dereference: false,
				verbatimSymlinks: true,
			});
			archive = {
				file: `bobs-factory-desktop-${c.version}-mac-${target.split("-").at(-1)}.bobsapp.gz`,
			};
			writeFileSync(join(output, archive.file), packApp(container), {
				flag: "wx",
			});
		} finally {
			rmSync(container, { recursive: true, force: true });
		}
		format = "bobs-app-v1";
	} else {
		archive = {
			file: `bobs-factory-desktop-${c.version}-linux-${target.split("-").at(-1)}.AppImage`,
		};
		if (app !== join(output, archive.file))
			cpSync(app, join(output, archive.file), {
				errorOnExist: true,
				force: false,
			});
		format = "AppImage";
	}
	const bytes = readFileSync(join(output, archive.file));
	archive = { ...archive, size: bytes.length, sha256: digest(bytes) };
	const metadata = {
		schemaVersion: 1,
		product: "bobs-factory-desktop",
		version: c.version,
		commit: c.commit,
		target,
		channel: c.channel,
		candidateDigest: candidate.digest,
		workflowSha: c.workflowSha,
		format,
		archive,
		fingerprint: appFingerprint(app, target),
		osSigning,
	};
	const file = `desktop-update-${target}.json`;
	writeFileSync(join(output, file), JSON.stringify(metadata, null, 2));
	const mb = readFileSync(join(output, file));
	return {
		archive,
		metadata: { file, size: mb.length, sha256: digest(mb) },
		osSigning,
	};
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const { values } = parseArgs({
		options: {
			app: { type: "string" },
			output: { type: "string" },
			candidate: { type: "string" },
			target: { type: "string" },
			unsigned: { type: "boolean", default: false },
		},
	});
	if (!values.app || !values.output || !values.candidate || !values.target)
		throw Error(
			"--app --output --candidate --target required; this tool verifies, never signs",
		);
	console.log(
		JSON.stringify(
			prepareDesktopUpdate({
				...values,
				candidate: JSON.parse(readFileSync(values.candidate)),
			}),
		),
	);
}
