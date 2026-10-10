// Bounded tar/gzip intake. Never invokes tar or creates links from submitted bytes.
import { execFileSync } from "node:child_process";
import {
	closeSync,
	createReadStream,
	mkdirSync,
	openSync,
	readFileSync,
	statSync,
	writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";

export const ARCHIVE_LIMITS = Object.freeze({
	maxMembers: 500_000,
	maxMemberBytes: 4 * 1024 ** 3,
	maxExpandedBytes: 16 * 1024 ** 3,
	maxCompressedBytes: 8 * 1024 ** 3,
	maxControlBytes: 1024 ** 2,
	maxTextBytes: 16 * 1024 ** 2,
	timeoutMs: 120_000,
});
const worker = fileURLToPath(import.meta.url);
const hasControl = (value) =>
	Array.from(value).some(
		(c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
	);
const check = (condition, message) => {
	if (!condition) throw new Error(message);
};
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
// Conservative portable identity: canonical Unicode decomposition, caseless
// comparison (including multi-character case mappings), and ignored format marks.
// Reject aliases rather than guessing which spelling a later extraction retains.
const pathKey = (value) =>
	value
		.normalize("NFD")
		.toLowerCase()
		.toUpperCase()
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{Default_Ignorable_Code_Point}/gu, "");
function validPathText(value) {
	return (
		!value.includes("\\") &&
		!hasControl(value) &&
		!/\p{Default_Ignorable_Code_Point}/u.test(value) &&
		Buffer.byteLength(value.normalize("NFD")) <= 4096 &&
		value.split("/").every((p) => Buffer.byteLength(p.normalize("NFD")) <= 255)
	);
}
function memberName(name, type, prefix) {
	// GNU tar may emit one './' root record and one exact './' root prefix.
	// Remove only that prefix, before collection, duplicates, or control matching.
	if (name === "./" && type === "5") return null;
	if (name.startsWith("./")) name = name.slice(2);
	const path = name.replace(/\/$/, "");
	check(
		validPathText(name) &&
			(type === "5" || !name.endsWith("/")) &&
			(path === prefix.slice(0, -1) || path.startsWith(prefix)) &&
			path.split("/").every((p) => p && p !== "." && p !== "..") &&
			(path !== prefix.slice(0, -1) || type === "5"),
		`Unsafe/duplicate source archive inventory: ${JSON.stringify(name)}`,
	);
	return type === "5" ? `${path}/` : path;
}

// Overrides are trusted caller policy, never archive metadata. A single worker has
// no descendants; execFileSync's deadline kills it and closes all owned streams/fds.
export function inspectArchive(archive, options = {}) {
	const limits = { ...ARCHIVE_LIMITS, ...options.limits };
	for (const [key, value] of Object.entries(limits))
		check(
			Object.hasOwn(ARCHIVE_LIMITS, key) &&
				Number.isSafeInteger(value) &&
				value > 0,
			`Invalid archive limit: ${key}`,
		);
	try {
		return JSON.parse(
			execFileSync(process.execPath, [worker, "--worker"], {
				input: JSON.stringify({ ...options, archive, limits }),
				encoding: "utf8",
				stdio: ["pipe", "pipe", "pipe"],
				timeout: limits.timeoutMs,
				killSignal: "SIGKILL",
				maxBuffer: 128 * 1024 ** 2,
			}),
		);
	} catch (error) {
		if (error.code === "ETIMEDOUT")
			throw new Error("Archive intake timeout", { cause: error });
		throw new Error(error.stderr?.trim() || error.message, { cause: error });
	}
}

// Resolve a virtual archive tree as the filesystem does: expand each intermediate
// link BEFORE consuming '..'. A link may never leave its root, even transiently.
function validateLinks(entries, prefix) {
	const root = prefix.replace(/\/$/, "");
	// Include implicit directories so aliases in directory prefixes and collisions
	// between a file/link and a directory are independent of archive member order.
	const tree = new Map();
	for (const entry of entries) {
		const parts = entry.name.replace(/\/$/, "").split("/");
		for (let i = 1; i <= parts.length; i++) {
			const name = parts.slice(0, i).join("/");
			const key = pathKey(name);
			const type = i === parts.length ? entry.type : "5";
			const prior = tree.get(key);
			check(
				!prior || (prior.name === name && prior.type === "5" && type === "5"),
				`Ambiguous filesystem alias or directory/file collision: ${name}`,
			);
			tree.set(key, { name, type });
		}
	}
	const links = new Map(
		entries
			.filter((e) => e.type === "2")
			.map((e) => [e.name.replace(/\/$/, ""), e.link]),
	);
	const resolve = (name) => {
		const pending = name.split("/");
		const parts = [];
		let hops = 0;
		while (pending.length) {
			const part = pending.shift();
			if (!part || part === ".") continue;
			if (part === "..") {
				check(
					parts.length > 1,
					"Source archive contains external link targets",
				);
				parts.pop();
				continue;
			}
			parts.push(part);
			check(parts[0] === root, "Source archive contains external link targets");
			const path = parts.join("/");
			const alias = tree.get(pathKey(path));
			check(
				!alias || alias.name === path,
				`Ambiguous filesystem alias in link target: ${path}`,
			);
			check(
				!pending.length || !alias || alias.type !== "0",
				"Source archive traverses a non-directory member",
			);
			const link = links.get(path);
			if (link !== undefined) {
				check(
					++hops <= 40,
					"Source archive contains a symlink cycle or excessive link chain",
				);
				check(
					link && !link.startsWith("/") && validPathText(link),
					"Source archive contains external link targets",
				);
				parts.pop();
				pending.unshift(...link.split("/"));
			}
		}
	};
	for (const entry of entries) resolve(entry.name);
}
const string = (b) =>
	utf8.decode(b.subarray(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0)));
function number(b) {
	// GNU base-256 permits large sizes; reject negative or imprecise values.
	if (b[0] & 0x80) {
		let value = BigInt(b[0] & 0x7f);
		for (const byte of b.subarray(1)) value = value * 256n + BigInt(byte);
		check(
			value <= BigInt(Number.MAX_SAFE_INTEGER),
			"Invalid tar numeric field",
		);
		return Number(value);
	}
	const value = string(b).trim();
	check(/^[0-7]*$/.test(value), "Invalid tar numeric field");
	const parsed = Number.parseInt(value || "0", 8);
	check(Number.isSafeInteger(parsed), "Invalid tar numeric field");
	return parsed;
}
function pax(bytes) {
	const fields = {};
	let offset = 0;
	while (offset < bytes.length) {
		const space = bytes.indexOf(32, offset);
		check(space > offset, "Invalid PAX header");
		const length = Number(bytes.subarray(offset, space).toString());
		check(
			Number.isSafeInteger(length) &&
				length > space - offset + 1 &&
				offset + length <= bytes.length &&
				bytes[offset + length - 1] === 10,
			"Invalid PAX record length",
		);
		const record = bytes.subarray(space + 1, offset + length - 1);
		const equal = record.indexOf(61);
		check(equal > 0, "Invalid PAX record");
		const key = utf8.decode(record.subarray(0, equal));
		check(
			!key.startsWith("GNU.sparse") && key !== "SCHILY.filetype",
			"Unsupported sparse/special tar entry",
		);
		// Ignored xattrs can legitimately be binary (macOS SCHILY provenance).
		// Path overrides must never acquire replacement-character aliases.
		const value = record.subarray(equal + 1);
		fields[key] = ["path", "linkpath"].includes(key)
			? utf8.decode(value)
			: value.toString("utf8");
		offset += length;
	}
	return fields;
}

async function readArchive(options) {
	const {
		archive,
		prefix,
		regularOnly = false,
		flat = false,
		collect = [],
		expected,
		output,
		limits,
	} = options;
	check(
		typeof prefix === "string" && /^[A-Za-z0-9_.-]+\/$/.test(prefix),
		"Invalid archive prefix",
	);
	check(
		statSync(archive).isFile() &&
			statSync(archive).size <= limits.maxCompressedBytes,
		"Archive compressed byte limit exceeded",
	);
	const input = createReadStream(archive, { highWaterMark: 64 * 1024 });
	const unzip = createGunzip({ chunkSize: 64 * 1024 });
	input.on("error", (error) => unzip.destroy(error));
	let compressed = 0;
	input.on("data", (chunk) => {
		compressed += chunk.length;
		if (compressed > limits.maxCompressedBytes) {
			input.destroy();
			unzip.destroy(new Error("Archive compressed byte limit exceeded"));
		}
	});
	input.pipe(unzip);
	let buffer = Buffer.alloc(0),
		remaining = 0,
		padding = 0,
		active = null,
		fd;
	let expanded = 0,
		written = 0,
		headers = 0,
		ended = false,
		zeroHeaders = 0,
		controlTotal = 0;
	let global = {},
		local = {},
		longName,
		longLink;
	const entries = [],
		names = new Set(),
		texts = {};
	const wanted = new Set(collect);
	const controls = new Map(collect.map((name) => [pathKey(name), name]));
	const finish = () => {
		if (fd !== undefined) {
			closeSync(fd);
			fd = undefined;
		}
		if (active?.chunks) {
			const bytes = Buffer.concat(active.chunks);
			if (active.type === "x") local = { ...local, ...pax(bytes) };
			else if (active.type === "g") global = { ...global, ...pax(bytes) };
			else if (active.type === "L") longName = string(bytes);
			else if (active.type === "K") longLink = string(bytes);
			else texts[active.name] = bytes.toString("utf8");
		}
		active = null;
	};
	try {
		for await (const chunk of unzip) {
			expanded += chunk.length;
			check(
				expanded <= limits.maxExpandedBytes,
				"Archive expanded byte limit exceeded",
			);
			buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
			while (buffer.length) {
				if (remaining) {
					const count = Math.min(remaining, buffer.length),
						bytes = buffer.subarray(0, count);
					if (active.chunks) active.chunks.push(Buffer.from(bytes));
					if (fd !== undefined) {
						writeSync(fd, bytes);
						written += bytes.length;
					}
					remaining -= count;
					buffer = buffer.subarray(count);
					if (!remaining) finish();
					continue;
				}
				if (padding) {
					const count = Math.min(padding, buffer.length);
					padding -= count;
					buffer = buffer.subarray(count);
					continue;
				}
				if (ended) {
					check(
						buffer.every((b) => b === 0),
						"Trailing/concatenated tar data",
					);
					buffer = Buffer.alloc(0);
					continue;
				}
				if (buffer.length < 512) break;
				const header = buffer.subarray(0, 512);
				buffer = buffer.subarray(512);
				if (header.every((b) => b === 0)) {
					if (++zeroHeaders === 2) ended = true;
					continue;
				}
				check(!zeroHeaders, "Invalid tar end marker");
				check(
					++headers <= limits.maxMembers,
					"Archive member count limit exceeded",
				);
				let checksum = 0;
				for (let i = 0; i < 512; i++)
					checksum += i >= 148 && i < 156 ? 32 : header[i];
				check(
					checksum === number(header.subarray(148, 156)),
					"Invalid tar header checksum",
				);
				const type = String.fromCharCode(header[156] || 48);
				let size = number(header.subarray(124, 136));
				const special = ["x", "g", "L", "K"].includes(type);
				const fields = { ...global, ...local };
				let name = string(header.subarray(0, 100));
				const ustarPrefix = string(header.subarray(345, 500));
				if (string(header.subarray(257, 263)) === "ustar" && ustarPrefix)
					name = `${ustarPrefix}/${name}`;
				let link = string(header.subarray(157, 257));
				if (!special) {
					name = fields.path ?? longName ?? name;
					link = fields.linkpath ?? longLink ?? link;
					if (fields.size !== undefined) {
						check(/^\d+$/.test(fields.size), "Invalid PAX size");
						size = Number(fields.size);
					}
					local = {};
					longName = undefined;
					longLink = undefined;
				}
				if (!special) name = memberName(name, type, prefix);
				check(name !== null || size === 0, "Non-regular tar entry has payload");
				if (!special && name !== null) {
					const control = controls.get(pathKey(name));
					check(
						control === undefined || control === name,
						"Ambiguous filesystem alias for archive control",
					);
				}
				check(
					Number.isSafeInteger(size) &&
						size >= 0 &&
						size <= limits.maxMemberBytes,
					"Archive member byte limit exceeded",
				);
				const capture = special || wanted.has(name);
				if (capture) {
					check(
						size <= limits.maxControlBytes,
						"Archive control file byte limit exceeded",
					);
					controlTotal += size;
					check(
						controlTotal <= limits.maxControlBytes * 8,
						"Archive control bytes limit exceeded",
					);
				}
				if (!special && name !== null) {
					check(
						!names.has(name.replace(/\/$/, "")),
						"Unsafe/duplicate source archive inventory",
					);
					names.add(name.replace(/\/$/, ""));
					check(
						type === "0" || type === "5" || (!regularOnly && type === "2"),
						"Archive contains links/special files",
					);
					check(
						type === "0" || size === 0,
						"Non-regular tar entry has payload",
					);
					if (flat)
						check(
							name === prefix ||
								/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(
									name.slice(prefix.length),
								),
							"Unsafe source bundle path",
						);
					if (expected && type === "0")
						check(
							Object.hasOwn(expected, name) && expected[name] === size,
							"Missing/uninventoried source bundle bytes or size mismatch",
						);
					entries.push({ name, size, type, ...(type === "2" ? { link } : {}) });
					if (output && type === "0") {
						const destination = join(output, name.slice(prefix.length));
						mkdirSync(dirname(destination), { recursive: true });
						fd = openSync(destination, "wx");
					}
				}
				active = { name, type, ...(capture ? { chunks: [] } : {}) };
				remaining = size;
				padding = (512 - (size % 512)) % 512;
				if (!remaining) finish();
			}
		}
		check(
			ended &&
				!remaining &&
				!padding &&
				buffer.length === 0 &&
				Object.keys(local).length === 0 &&
				!longName &&
				!longLink,
			"Truncated tar archive",
		);
		if (expected)
			check(
				Object.keys(expected).every((name) => names.has(name)),
				"Missing/uninventoried source bundle bytes",
			);
		validateLinks(entries, prefix);
		return { entries, texts, expandedBytes: expanded };
	} catch (error) {
		throw new Error(
			`${error.message} (expandedBytes=${expanded}, writtenBytes=${written})`,
			{ cause: error },
		);
	} finally {
		if (fd !== undefined) closeSync(fd);
		input.destroy();
		unzip.destroy();
	}
}
if (process.argv[1] === worker && process.argv[2] === "--worker") {
	try {
		process.stdout.write(
			JSON.stringify(await readArchive(JSON.parse(readFileSync(0, "utf8")))),
		);
	} catch (error) {
		process.stderr.write(error.message);
		process.exitCode = 1;
	}
}
