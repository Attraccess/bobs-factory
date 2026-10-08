import { afterEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
	request: vi.fn(),
	close: vi.fn(async () => {}),
	start: vi.fn(),
	options: undefined as any,
}));
vi.mock("../src/backend/appServerClient.js", () => ({
	AppServerClient: class {
		constructor(options: any) {
			mock.options = options;
		}
		on() {}
		setServerRequestHandler() {}
		start = mock.start;
		request = mock.request;
		close = mock.close;
	},
}));

import { inspectCodexNativeLogin } from "../src/inspectNativeLogin.js";

afterEach(() => vi.clearAllMocks());
function responses(
	account: any = { type: "chatgpt", email: "native@example.test" },
	config: any = {},
) {
	mock.request.mockImplementation(async (method: string) =>
		method === "account/read"
			? { account }
			: method === "config/read"
				? { config }
				: {},
	);
}
it("inspects the named store and returns only principal and native MCP names without a thread or model turn", async () => {
	responses(undefined, {
		notify: [],
		chatgpt_base_url: "https://chatgpt.com/backend-api/",
		mcp_servers: {
			inherited: { headers: { Authorization: "private-canary" } },
		},
	});
	const env = {
		HOME: "/private/job/home",
		CODEX_HOME: "/selected/native/root",
	};
	expect(await inspectCodexNativeLogin(env)).toEqual({
		account: "native@example.test",
		mcp: ["inherited"],
	});
	expect(mock.options.env).toBe(env);
	expect(mock.request.mock.calls.map(([method]) => method)).toEqual([
		"initialize",
		"account/read",
		"config/read",
	]);
	expect(mock.request).toHaveBeenCalledWith("account/read", {
		refreshToken: false,
	});
	expect(mock.close).toHaveBeenCalledOnce();
});
it.each([
	[null, {}],
	[{ type: "apiKey" }, {}],
	[
		{ type: "chatgpt", email: "native@example.test" },
		{ model_providers: { custom: {} } },
	],
	[
		{ type: "chatgpt", email: "native@example.test" },
		{ chatgpt_base_url: "https://other.test" },
	],
	[
		{ type: "chatgpt", email: "native@example.test" },
		{ forced_login_method: "api" },
	],
	[
		{ type: "chatgpt", email: "native@example.test" },
		{ hooks: { SessionStart: [] } },
	],
	[
		{ type: "chatgpt", email: "native@example.test" },
		{ plugins: { automatic: { enabled: true } } },
	],
	[
		{ type: "chatgpt", email: "native@example.test" },
		{ notify: ["/private/notification-canary", "private-canary-secret"] },
	],
	[
		{ type: "chatgpt", email: "native@example.test" },
		{ notify: "unexpected-command-shape" },
	],
])("rejects missing/competing native sources and closes inspection", async (account, config) => {
	responses(account, config);
	await expect(
		inspectCodexNativeLogin({ CODEX_HOME: "/selected" }),
	).rejects.toThrow("Native Codex login inspection failed");
	expect(mock.close).toHaveBeenCalledOnce();
});
it("does not expose native errors containing credentials", async () => {
	mock.request.mockRejectedValue(new Error("private-canary-secret"));
	await expect(inspectCodexNativeLogin({})).rejects.toThrow(
		/^Native Codex login inspection failed\./,
	);
	expect(mock.close).toHaveBeenCalledOnce();
});
