import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { requireValue } from "./binary-release.mjs";
// Canonical USTAR headers avoid host UID, timestamps, filesystem order and gzip
// metadata changing the immutable upload identity during recovery on another host.
export function receiptArchive(directory, files) {
	const blocks = [];
	const octal = (value, length) =>
		`${value.toString(8).padStart(length - 1, "0")}\0`;
	for (const file of [...files].sort()) {
		requireValue(
			/^[A-Za-z0-9_./-]+$/.test(file) &&
				!file.startsWith("/") &&
				!file.split("/").some((part) => part === "." || part === ".."),
			"Unsafe receipt filename",
		);
		const header = Buffer.alloc(512);
		let name = file,
			prefix = "";
		if (Buffer.byteLength(name) > 100) {
			const split = file.lastIndexOf("/");
			prefix = file.slice(0, split);
			name = file.slice(split + 1);
			requireValue(
				split > 0 &&
					Buffer.byteLength(name) <= 100 &&
					Buffer.byteLength(prefix) <= 155,
				"Receipt path exceeds USTAR limits",
			);
		}
		const bytes = readFileSync(join(directory, file));
		requireValue(
			bytes.length < 64 * 1024 * 1024,
			"Receipt exceeds archive size limit",
		);
		header.write(name, 0, 100);
		header.write(octal(0o644, 8), 100);
		header.write(octal(0, 8), 108);
		header.write(octal(0, 8), 116);
		header.write(octal(bytes.length, 12), 124);
		header.write(octal(0, 12), 136);
		header.fill(32, 148, 156);
		header.write("0", 156);
		header.write("ustar\0", 257);
		header.write("00", 263);
		header.write(prefix, 345, 155);
		const checksum = header.reduce((sum, byte) => sum + byte, 0);
		header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
		blocks.push(
			header,
			bytes,
			Buffer.alloc((512 - (bytes.length % 512)) % 512),
		);
	}
	blocks.push(Buffer.alloc(1024));
	requireValue(
		blocks.reduce((sum, bytes) => sum + bytes.length, 0) <= 64 * 1024 * 1024,
		"Receipt archive exceeds size limit",
	);
	return gzipSync(Buffer.concat(blocks));
}
