import { afterEach, expect, it, vi } from "vitest";
import { resolveClaudeExecutable } from "../src/executable.js";

const { resolve, prepared, packaged } = vi.hoisted(() => ({
	resolve: vi.fn((id: string) => id),
	prepared: vi.fn((command: string) => `/prepared/${command}`),
	packaged: { value: false },
}));
vi.mock("node:module", () => ({ createRequire: () => ({ resolve }) }));
vi.mock("bobs-factory-core", () => ({
	get isPackagedExecutable() {
		return packaged.value;
	},
	preparedExecutable: prepared,
}));
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const excludeNetwork = process.report.excludeNetwork;
afterEach(() => {
	Object.defineProperty(process, "platform", platform);
	process.report.excludeNetwork = excludeNetwork;
	vi.restoreAllMocks();
	vi.clearAllMocks();
	packaged.value = false;
});

it.each([
	"darwin",
	"win32",
])("inspects Claude on %s without generating a network diagnostic report", (platform) => {
	Object.defineProperty(process, "platform", { value: platform });
	const report = vi
		.spyOn(process.report, "getReport")
		.mockImplementation(() => {
			throw new Error("Diagnostic report would block on DNS");
		});
	resolveClaudeExecutable();
	expect(report).not.toHaveBeenCalled();
});

it.each([
	{ header: { glibcVersionRuntime: "2.39" }, suffix: "" },
	{ header: {}, suffix: "-musl" },
])("selects Linux libc with networking excluded: $suffix", ({
	header,
	suffix,
}) => {
	Object.defineProperty(process, "platform", { value: "linux" });
	process.report.excludeNetwork = false;
	vi.spyOn(process.report, "getReport").mockImplementation(() => {
		expect(process.report.excludeNetwork).toBe(true);
		return { header };
	});
	resolveClaudeExecutable();
	expect(resolve).toHaveBeenCalledWith(
		`@anthropic-ai/claude-agent-sdk-linux-${process.arch}${suffix}/claude`,
	);
	expect(process.report.excludeNetwork).toBe(false);
});

it("restores report settings when libc inspection fails", () => {
	Object.defineProperty(process, "platform", { value: "linux" });
	process.report.excludeNetwork = false;
	vi.spyOn(process.report, "getReport").mockImplementation(() => {
		throw new Error("Report unavailable");
	});
	expect(() => resolveClaudeExecutable()).toThrow("Report unavailable");
	expect(process.report.excludeNetwork).toBe(false);
});

it("uses the prepared launcher in a binary without resolving checkout packages", () => {
	packaged.value = true;
	expect(resolveClaudeExecutable()).toBe("/prepared/claude");
	expect(resolve).not.toHaveBeenCalled();
});
it("uses an explicit launcher for both checkout and packaged execution", () => {
	expect(resolveClaudeExecutable("custom-claude")).toBe(
		"/prepared/custom-claude",
	);
	expect(resolve).not.toHaveBeenCalled();
});
