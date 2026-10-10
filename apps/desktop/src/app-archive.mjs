import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, posix } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
export const digest = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
const safe = (name) =>
	typeof name === "string" &&
	name.length > 0 &&
	!name.startsWith("/") &&
	!name.includes("\\") &&
	!name.includes("\0") &&
	name.split("/").every((p) => p && p !== "." && p !== "..");
export function tree(directory) {
	const entries = [];
	function visit(name) {
		const path = join(directory, name),
			stat = lstatSync(path);
		if (stat.isSymbolicLink())
			entries.push({ path: name, kind: "link", link: readlinkSync(path) });
		else if (stat.isDirectory()) {
			entries.push({ path: name, kind: "directory" });
			for (const child of readdirSync(path).sort()) visit(`${name}/${child}`);
		} else if (stat.isFile())
			entries.push({
				path: name,
				kind: "file",
				mode: stat.mode & 0o777,
				size: stat.size,
				sha256: digest(readFileSync(path)),
			});
		else throw Error("App contains a special file");
	}
	for (const name of readdirSync(directory).sort()) visit(name);
	validateEntries(entries);
	return entries;
}
export function validateEntries(entries) {
	if (!Array.isArray(entries) || !entries.length || entries.length > 100000)
		throw Error("Invalid app inventory");
	const names = new Set();
	const byPath = new Map(entries.map((entry) => [entry.path, entry]));
	for (const e of entries) {
		if (
			!safe(e.path) ||
			names.has(e.path) ||
			!["file", "link", "directory"].includes(e.kind)
		)
			throw Error("Unsafe/duplicate app entry");
		names.add(e.path);
		if (
			e.kind === "file" &&
			(!Number.isSafeInteger(e.size) ||
				e.size < 0 ||
				!Number.isInteger(e.mode) ||
				e.mode < 0 ||
				e.mode > 0o777 ||
				!/^[a-f0-9]{64}$/.test(e.sha256))
		)
			throw Error("Invalid app file");
		if (
			e.kind === "link" &&
			(typeof e.link !== "string" ||
				e.link.startsWith("/") ||
				e.link.includes("\\") ||
				!safe(posix.normalize(posix.join(posix.dirname(e.path), e.link))))
		)
			throw Error("App link escapes archive");
	}
	for (const e of entries)
		for (let p = posix.dirname(e.path); p !== "."; p = posix.dirname(p))
			if (byPath.get(p)?.kind !== "directory")
				throw Error("App entry beneath link or missing directory");
	function resolveTarget(target) {
		// Framework links often target Versions/Current/foo, where Current is
		// itself a directory link. Resolve entirely within the signed inventory.
		for (let hop = 0; hop < 100; hop++) {
			if (!safe(target)) throw Error("App link escapes archive");
			const parts = target.split("/");
			let followed = false;
			for (let index = 0; index < parts.length; index++) {
				const path = parts.slice(0, index + 1).join("/"),
					entry = byPath.get(path);
				if (!entry) throw Error("App link target absent");
				if (entry.kind === "link") {
					target = posix.normalize(
						posix.join(
							posix.dirname(path),
							entry.link,
							...parts.slice(index + 1),
						),
					);
					followed = true;
					break;
				}
				if (index < parts.length - 1 && entry.kind !== "directory")
					throw Error("App link traverses a file");
			}
			if (!followed) return;
		}
		throw Error("App link cycle or excessive chain");
	}
	for (const e of entries.filter((x) => x.kind === "link"))
		resolveTarget(posix.normalize(posix.join(posix.dirname(e.path), e.link)));
}
// Bob's framed gzip archive retains complete signed app bytes, Unix modes and internal
// framework symlinks. No external tar/zip extraction, headers or path interpretation.
export function packApp(directory) {
	const entries = tree(directory),
		index = Buffer.from(JSON.stringify(entries)),
		chunks = [Buffer.from("BOBSAPP1"), Buffer.alloc(4), index];
	chunks[1].writeUInt32BE(index.length);
	for (const e of entries)
		if (e.kind === "file") chunks.push(readFileSync(join(directory, e.path)));
	return gzipSync(Buffer.concat(chunks));
}
export function unpackApp(bytes, directory) {
	const raw = gunzipSync(bytes, { maxOutputLength: 2 * 1024 * 1024 * 1024 });
	if (raw.subarray(0, 8).toString() !== "BOBSAPP1")
		throw Error("Unknown app archive");
	const length = raw.readUInt32BE(8);
	if (length > 16 * 1024 * 1024 || length + 12 > raw.length)
		throw Error("Invalid app archive index");
	const entries = JSON.parse(raw.subarray(12, 12 + length));
	validateEntries(entries);
	let offset = 12 + length;
	for (const e of entries)
		if (e.kind === "file") {
			const b = raw.subarray(offset, offset + e.size);
			if (b.length !== e.size || digest(b) !== e.sha256)
				throw Error("App file digest mismatch");
			offset += e.size;
		}
	if (offset !== raw.length) throw Error("Unexpected app archive bytes");
	if (existsSync(directory))
		throw Error("App extraction requires absent destination");
	mkdirSync(directory, { mode: 0o700 });
	offset = 12 + length;
	for (const e of entries.filter((e) => e.kind !== "link")) {
		const path = join(directory, e.path);
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		if (e.kind === "directory") mkdirSync(path, { recursive: true });
		else {
			writeFileSync(path, raw.subarray(offset, offset + e.size), {
				flag: "wx",
				mode: e.mode,
			});
			offset += e.size;
		}
	}
	for (const e of entries.filter((e) => e.kind === "link"))
		symlinkSync(e.link, join(directory, e.path));
	return entries;
}
