import { createHash } from "node:crypto";
export function qaDigest(value: unknown): string {
	const canonical = (item: unknown): unknown =>
		Array.isArray(item)
			? item.map(canonical)
			: item && typeof item === "object"
				? Object.fromEntries(
						Object.entries(item)
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([key, v]) => [key, canonical(v)]),
					)
				: item;
	return createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex");
}
