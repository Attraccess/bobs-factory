import { afterEach, expect, it, vi } from "vitest";
import { executionCapabilities } from "../src/factory/ExecutionCapabilities.js";

const { resolve, exec } = vi.hoisted(() => ({
	resolve: vi.fn((id: string) => id),
	exec: vi.fn(() => "2.1.281"),
}));
vi.mock("node:module", () => ({ createRequire: () => ({ resolve }) }));
vi.mock("node:child_process", () => ({ execFileSync: exec }));
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const excludeNetwork = process.report.excludeNetwork;
afterEach(() => {
	Object.defineProperty(process, "platform", platform);
	process.report.excludeNetwork = excludeNetwork;
	vi.restoreAllMocks();
	vi.clearAllMocks();
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
	expect(executionCapabilities("claude").version).toBe("2.1.281");
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
	expect(executionCapabilities("claude").version).toBe("2.1.281");
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
	expect(() => executionCapabilities("claude")).toThrow("Report unavailable");
	expect(process.report.excludeNetwork).toBe(false);
});
