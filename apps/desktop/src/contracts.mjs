import { createHash } from "node:crypto";
export function connectionOrigin(value) {
	const url = new URL(value);
	if (
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		(url.pathname !== "/" && url.pathname !== "")
	)
		throw new Error(
			"Enter an origin without credentials, path, query or fragment",
		);
	const local = url.protocol === "http:" && url.hostname === "localhost";
	if (url.protocol !== "https:" && !local)
		throw new Error(
			"Remote Factory requires HTTPS; local Factory uses http://localhost",
		);
	return url.origin;
}
export function connectionPartition(origin) {
	return `persist:factory-${createHash("sha256").update(connectionOrigin(origin)).digest("hex")}`;
}
export function allowedNavigation(value, origin) {
	try {
		return new URL(value).origin === origin;
	} catch {
		return false;
	}
}
export function externalLink(value) {
	try {
		const url = new URL(value);
		return (
			["https:", "http:"].includes(url.protocol) &&
			!url.username &&
			!url.password
		);
	} catch {
		return false;
	}
}
