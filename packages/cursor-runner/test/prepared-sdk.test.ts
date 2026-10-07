import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreparedCursorAgent } from "../src/sdk.js";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "factory-cursor-host-"));
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({
			name: "@cursor/sdk",
			version: "1.0.19",
			type: "commonjs",
			exports: "./index.js",
		}),
	);
	writeFileSync(
		join(root, "index.js"),
		`
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
let cancelled = false;
const create = async (options, id = 'native-id') => ({
  agentId: id,
  close() { writeFileSync(join(options.local.cwd[0], 'closed'), id); },
  async send(prompt, { onDelta }) {
    return {
      async cancel() { cancelled = true; },
      async *stream() {
        if (prompt === 'error') throw new Error('native failure');
        yield { type: 'assistant', text: prompt };
        if (prompt === 'cancel') {
          while (!cancelled) await new Promise(r => setTimeout(r, 10));
        }
        onDelta({ update: { type: 'turn-ended', usage: { inputTokens: 7 } } });
        yield { type: 'result', agent_id: id, mcp: options.mcpServers };
      }
    };
  }
});
exports.Agent = { create, resume: (id, options) => create(options, id) };
`,
	);
	vi.stubEnv("BOBS_FACTORY_CURSOR_SDK_PATH", root);
	vi.stubEnv("BOBS_FACTORY_CURSOR_NODE", process.execPath);
});
afterEach(async () => {
	// Host disposal may finish after stream completion.
	await new Promise((resolve) => setTimeout(resolve, 100));
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

const options = () => ({
	local: { cwd: [root], sandboxOptions: { enabled: false } },
	mcpServers: {
		context: {
			type: "stdio" as const,
			command: "/prepared/factory",
			args: ["internal", "factory-context"],
		},
	},
});
describe("user-prepared Cursor SDK host", () => {
	it("preserves native IDs, MCP options, stream ordering, usage and disposal", async () => {
		const agent = await createPreparedCursorAgent(
			options(),
			"existing-native-id",
		);
		expect(agent.agentId).toBe("existing-native-id");
		const deltas: unknown[] = [];
		const run = await agent.send("hello", {
			onDelta: (delta) => {
				deltas.push(delta);
			},
		});
		const events = [];
		for await (const event of run.stream()) events.push(event);
		expect(events).toEqual([
			{ type: "assistant", text: "hello" },
			{
				type: "result",
				agent_id: "existing-native-id",
				mcp: options().mcpServers,
			},
		]);
		expect(deltas).toEqual([
			{ update: { type: "turn-ended", usage: { inputTokens: 7 } } },
		]);
		await vi.waitFor(() =>
			expect(readFileSync(join(root, "closed"), "utf8")).toBe(
				"existing-native-id",
			),
		);
	});
	it("forwards cancellation to the active SDK run", async () => {
		const agent = await createPreparedCursorAgent(options());
		const run = await agent.send("cancel");
		const stream = run.stream()[Symbol.asyncIterator]();
		expect((await stream.next()).done).toBe(false);
		await run.cancel();
		expect((await stream.next()).done).toBe(false);
		expect((await stream.next()).done).toBe(true);
	});
	it("propagates native failures and disposes the host", async () => {
		const agent = await createPreparedCursorAgent(options());
		const run = await agent.send("error");
		await expect(async () => {
			for await (const _ of run.stream()) {
				/* drain */
			}
		}).rejects.toThrow("native failure");
		await vi.waitFor(() =>
			expect(readFileSync(join(root, "closed"), "utf8")).toBe("native-id"),
		);
	});
	it("fails with guidance before loading an absent or incompatible SDK", async () => {
		vi.stubEnv("BOBS_FACTORY_CURSOR_SDK_PATH", "");
		await expect(createPreparedCursorAgent(options())).rejects.toThrow(
			"BOBS_FACTORY_CURSOR_SDK_PATH",
		);
		vi.stubEnv("BOBS_FACTORY_CURSOR_SDK_PATH", root);
		writeFileSync(
			join(root, "package.json"),
			'{"name":"@cursor/sdk","version":"2.0.0"}',
		);
		await expect(createPreparedCursorAgent(options())).rejects.toThrow(
			"native session compatibility",
		);
	});
});
