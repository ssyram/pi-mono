import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createEventBus } from "../../../packages/coding-agent/src/core/event-bus.ts";
import { withFileMutationQueue } from "../../../packages/coding-agent/src/core/tools/file-mutation-queue.ts";
import { MY_SETTINGS_ENTRY_TYPE } from "../protocol.ts";
import { registerMySettingCommand } from "../setting-command.ts";
import { registerMySettingsService } from "../settings-service.ts";

export interface CommandHarness {
	run(args: string): Promise<void>;
	outputs: string[];
	globalRoot: string;
	cwd: string;
	entries: { type: string; customType?: string; data?: unknown }[];
}

export async function commandFixture(t: { after(callback: () => Promise<void>): void }): Promise<CommandHarness> {
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
				appendEntry(_type: string, data: { values?: Record<string, unknown>; removed?: string[] }) {
					entries.push({
						type: "custom",
						customType: MY_SETTINGS_ENTRY_TYPE,
						data: structuredClone(data),
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
		entries,
	};
}

export async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"));
}
