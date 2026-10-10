import assert from "node:assert/strict";
import { test } from "node:test";
import {
	allowedNavigation,
	connectionOrigin,
	connectionPartition,
	externalLink,
} from "../src/contracts.mjs";

test("remote origins cannot become local filesystem or insecure bridge targets", () => {
	for (const value of [
		"http://example.com",
		"file:///etc/passwd",
		"javascript:alert(1)",
		"https://user:secret@example.com",
		"https://example.com/path",
		"https://example.com/?token=1",
	])
		assert.throws(() => connectionOrigin(value));
	assert.equal(
		connectionOrigin("http://localhost:3457/"),
		"http://localhost:3457",
	);
	assert.equal(
		connectionOrigin("https://factory.example.com"),
		"https://factory.example.com",
	);
	assert.notEqual(
		connectionPartition("https://a.example"),
		connectionPartition("https://b.example"),
	);
	assert.equal(
		allowedNavigation("https://evil.example", "https://a.example"),
		false,
	);
	assert.equal(
		allowedNavigation("https://a.example/api", "https://a.example"),
		true,
	);
	assert.equal(externalLink("file:///etc/passwd"), false);
	assert.equal(externalLink("https://user:secret@example.com"), false);
});
