import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { createEventBus } from "../../../packages/coding-agent/src/core/event-bus.ts";
import { BOULDER_INHIBIT_ENTRY_TYPE } from "../boulder-inhibition/protocol.ts";
import { registerTaskCommand } from "../commands/task.js";
import { registerBoulderInhibitionAdapter } from "../hooks/boulder-inhibition-adapter.js";

test("task command contains operation, output and diagnostic failures before Pi", async (t) => {
	const hostile = {
		toString() {
			throw new Error("description failed");
		},
	};
	const original = console.error;
	console.error = () => {
		throw hostile;
	};
	t.after(() => {
		console.error = original;
	});
	for (const args of [
		"info",
		"show on",
		"add work",
		"help",
		"boulder set user true",
		"no-task-no-tool off",
	]) {
		let handler:
			| Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]
			| undefined;
		const pi = {
			registerEntryRenderer() {},
			on() {},
			registerCommand(_name: string, definition: { handler: typeof handler }) {
				handler = definition.handler;
			},
			appendEntry() {
				throw hostile;
			},
			events: createEventBus(),
		} as unknown as ExtensionAPI;
		registerTaskCommand(pi, {
			updateSetting: async () => {
				throw hostile;
			},
			getTasks() {
				throw hostile;
			},
			setWidgetVisibility() {
				throw hostile;
			},
			runHumanTaskCommand() {
				throw hostile;
			},
		});
		assert.ok(handler);
		await assert.doesNotReject(
			handler(args, { sessionManager: {} } as ExtensionCommandContext),
		);
	}
});

test("task output failure does not erase the already persisted inhibition", async (t) => {
	const entries: { type: string; customType: string; data: unknown }[] = [];
	let handler:
		| Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]
		| undefined;
	const starts: ((event: unknown, ctx: ExtensionCommandContext) => void)[] = [];
	const ctx = {
		sessionManager: { getBranch: () => entries },
	} as unknown as ExtensionCommandContext;
	const pi = {
		registerEntryRenderer() {},
		on(
			name: string,
			callback: (event: unknown, ctx: ExtensionCommandContext) => void,
		) {
			if (name === "session_start") starts.push(callback);
		},
		registerCommand(_name: string, definition: { handler: typeof handler }) {
			handler = definition.handler;
		},
		appendEntry(customType: string, data: unknown) {
			if (customType !== BOULDER_INHIBIT_ENTRY_TYPE)
				throw new Error("output failed after signal");
			entries.push({ type: "custom", customType, data });
		},
		events: createEventBus(),
	} as unknown as ExtensionAPI;
	const dispose = registerBoulderInhibitionAdapter(pi, () => undefined);
	t.after(dispose);
	registerTaskCommand(pi, {
		updateSetting: async () => ({ ok: true, applied: true, message: "unused" }),
		getTasks: () => [],
		setWidgetVisibility() {},
		runHumanTaskCommand() {
			throw new Error("not a human task action");
		},
	});
	starts[0]?.({}, ctx);
	const original = console.error;
	console.error = () => undefined;
	t.after(() => {
		console.error = original;
	});
	assert.ok(handler);
	await assert.doesNotReject(handler("boulder set user true", ctx));
	assert.deepEqual(entries, [
		{
			type: "custom",
			customType: BOULDER_INHIBIT_ENTRY_TYPE,
			data: { type: "user", value: true },
		},
	]);
});
