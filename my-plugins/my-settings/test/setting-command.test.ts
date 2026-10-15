import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createEventBus } from "../../../packages/coding-agent/src/core/event-bus.ts";
import { withFileMutationQueue } from "../../../packages/coding-agent/src/core/tools/file-mutation-queue.ts";
import { MY_SETTINGS_ENTRY_TYPE } from "../protocol.ts";
import { registerMySettingCommand } from "../setting-command.ts";
import { MY_SETTING_HELP, parseSettingCommand } from "../setting-command-parse.ts";
import { registerMySettingsService } from "../settings-service.ts";

function harness(t: { after(callback: () => Promise<void>): void }) {
	return (async () => {
		const root = await mkdtemp(join("/tmp", "my-setting-cmd-"));
		t.after(() => rm(root, { recursive: true, force: true }));
		const globalRoot = join(root, "agent");
		const cwd = join(root, "project");
		await mkdir(globalRoot);
		await mkdir(cwd);
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = globalRoot;
		t.after(() => {
			if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
			return Promise.resolve();
		});
		const bus = createEventBus();
		const entries: { type: string; customType?: string; data?: unknown }[] = [];
		const manager = {
			getSessionId: () => "cmd-1",
			getBranch: () => entries,
		};
		let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
		const pi = {
			events: bus,
			on() {},
			registerCommand(_name: string, definition: { handler: typeof handler }) {
				handler = definition.handler;
			},
		} as unknown as ExtensionAPI;
		registerMySettingsService(
			bus,
			() => ({
				ok: true,
				value: {
					cwd,
					isCurrent: () => ({ ok: true, value: true }),
					getBranch: () => ({ ok: true, value: entries }),
					appendEntry(_t: string, data: { values?: Record<string, unknown>; removed?: string[] }) {
						entries.push({
							type: "custom",
							customType: MY_SETTINGS_ENTRY_TYPE,
							data,
						});
						return { ok: true, value: undefined };
					},
				},
			}),
			globalRoot,
			withFileMutationQueue,
		);
		registerMySettingCommand(pi);
		assert.ok(handler);
		const outputs: string[] = [];
		const context = {
			cwd,
			hasUI: false,
			sessionManager: manager,
		} as unknown as ExtensionCommandContext;
		const original = console.log;
		console.log = (text: string) => {
			outputs.push(String(text));
		};
		t.after(() => {
			console.log = original;
			return Promise.resolve();
		});
		return {
			run: async (args: string) => {
				assert.ok(handler, "command was not registered");
				await handler(args, context);
			},
			outputs,
			globalRoot,
			cwd,
			manager,
		};
	})();
}

test("parse covers flags, strict JSON VAL with spaces, and errors", () => {
	assert.deepEqual(parseSettingCommand(""), { kind: "help" });
	assert.deepEqual(parseSettingCommand("help"), { kind: "help" });
	const set = parseSettingCommand('set --global --local-file p.json k1 {"a": 1, "b": [2]}');
	assert.equal(set.kind, "set");
	if (set.kind !== "set") return;
	assert.deepEqual(set.scopes, ["global"]);
	assert.equal(set.key, "k1");
	assert.equal(set.valueText, '{"a": 1, "b": [2]}');
	assert.equal(set.paths.localFile, "p.json");
	const multi = parseSettingCommand("set --session --global --local k v");
	assert.deepEqual(multi.kind === "set" ? multi.scopes : [], ["global", "local", "session"]);
	for (const bad of [
		"set k v",
		"set --global",
		"set --global k",
		"get",
		"bogus x",
		'set --session "unclosed 1',
		'set --session "my"key 1',
		"get --session k",
		"get --wat k",
	]) {
		assert.equal(parseSettingCommand(bad).kind, "error", bad);
	}
	const quoted = parseSettingCommand('set --session "my key" {"a": 1}');
	assert.equal(quoted.kind, "set");
	if (quoted.kind === "set") {
		assert.equal(quoted.key, "my key");
		assert.equal(quoted.valueText, '{"a": 1}');
	}
	const escaped = parseSettingCommand('set --session "escaped \\"q\\" k" 1');
	assert.equal(escaped.kind, "set");
	if (escaped.kind === "set") assert.equal(escaped.key, 'escaped "q" k');
	const dashKey = parseSettingCommand('set --session "--dash key" 1');
	assert.equal(dashKey.kind, "set");
	if (dashKey.kind === "set") assert.equal(dashKey.key, "--dash key");
	const quotedGet = parseSettingCommand('get "a b" c');
	assert.equal(quotedGet.kind, "get");
	if (quotedGet.kind === "get") assert.deepEqual(quotedGet.keys, ["a b", "c"]);
	const quotedUnset = parseSettingCommand('unset --session "a b"');
	assert.equal(quotedUnset.kind, "unset");
	if (quotedUnset.kind === "unset") assert.deepEqual(quotedUnset.keys, ["a b"]);
	assert.match(String(parseSettingCommand("set k v").kind === "error" ? "" : ""), /^$/);
	assert.ok(MY_SETTING_HELP.includes("set"));
});

test("set writes only the flagged layers with strict JSON typing", async (t) => {
	const h = await harness(t);
	await h.run("set --global --local --session e2e.flag true");
	await h.run('set --session e2e.text "true"');
	assert.deepEqual(JSON.parse(await readFile(join(h.globalRoot, "settings.json"), "utf8")), { "e2e.flag": true });
	assert.deepEqual(JSON.parse(await readFile(join(h.cwd, ".pi/settings.json"), "utf8")), { "e2e.flag": true });
	const patches = h.manager.getBranch().map((entry) => entry.data);
	assert.deepEqual(patches, [{ values: { "e2e.flag": true } }, { values: { "e2e.text": "true" } }]);
	await h.run("set --global bare words");
	assert.match(h.outputs.at(-1) ?? "", /VAL 不是合法 JSON/);
	await h.run("set --global-file custom/g.json --global only.custom 5");
	assert.deepEqual(JSON.parse(await readFile(join(h.globalRoot, "custom/g.json"), "utf8")), { "only.custom": 5 });
	await h.run('set --session "my key" "space value"');
	await h.run("set --session lkj?!:?>% 1");
	await h.run('get "my key" lkj?!:?>%');
	const weird = h.outputs.at(-1) ?? "";
	assert.match(weird, /key my key/);
	assert.match(weird, /session "space value"/);
	assert.ok(weird.includes("key lkj?!:?>%"), weird);
	assert.ok(weird.includes("session 1"), weird);
});

test("get reports each layer and the service-merged value with kind filtering", async (t) => {
	const h = await harness(t);
	await h.run("set --global merge.key false");
	await h.run('set --local merge.key "off"');
	await h.run("get merge.key");
	const text = h.outputs.at(-1) ?? "";
	assert.match(text, /global {2}false/);
	assert.match(text, /local {3}"off"/);
	assert.match(text, /session -/);
	assert.match(text, /merged {2}false/);
	await h.run("get missing.key");
	assert.match(h.outputs.at(-1) ?? "", /merged {2}null/);
});

test("help and unknown subcommands route to documented output", async (t) => {
	const h = await harness(t);
	await h.run("");
	assert.match(h.outputs.at(-1) ?? "", /^\/my-setting/);
	await h.run("frobnicate");
	assert.match(h.outputs.at(-1) ?? "", /Unknown subcommand/);
	await h.run("get --global k");
	assert.match(h.outputs.at(-1) ?? "", /no scope flags/);
	assert.deepEqual(await readdir(h.globalRoot), []);
});
