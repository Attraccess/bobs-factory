import { mkdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
export const publicationLockDirectory = join(
	tmpdir(),
	"bobs-factory-jappyjan-publication-lock",
);
export async function withPublicationLock(callback) {
	try {
		mkdirSync(publicationLockDirectory, { mode: 0o700 });
	} catch (error) {
		if (error.code === "EEXIST")
			throw new Error(
				`Another publication or interrupted publisher owns ${publicationLockDirectory}; inspect its owner before retrying`,
			);
		throw error;
	}
	try {
		writeFileSync(
			join(publicationLockDirectory, "owner.json"),
			JSON.stringify({
				pid: process.pid,
				host: hostname(),
				startedAt: new Date().toISOString(),
			}),
			{ flag: "wx", mode: 0o600 },
		);
		return await callback();
	} finally {
		unlinkSync(join(publicationLockDirectory, "owner.json"));
		rmdirSync(publicationLockDirectory);
	}
}
