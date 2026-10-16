import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { parseTaskCommand, registerTaskCommand } from "../commands/task.js";
import { registerTaskGate } from "../hooks/task-gate.js";
import { createHumanTaskCompletionProvider } from "../tools/task-system/human-completion.js";
import { taskSettingsFixture } from "./task-settings-fixture.js";

type Handler = Parameters<ExtensionAPI["registerCommand"]>[1]["handler"];
type Hook = (event: { toolName: string }, ctx: ExtensionContext) => unknown;

test("both setting commands default to session and accept independent unique persistence flags", () => {
	for (const action of ["show", "no-task-no-tool"]) {
		for (const [flags, targets] of [
			["", {}],
			[" --persistent", { persistent: true }],
			[" --global", { global: true }],
			[" --global --persistent", { persistent: true, global: true }],
		] as const) {
			assert.deepEqual(
				parseTaskCommand(`${action} off${flags}`),
				action === "show"
					? { action, visible: false, targets }
					: { action, enabled: false, targets },
			);
		}
		for (const suffix of [
			"",
			" false",
			" off extra",
			" on --global --global",
			" --global off",
		]) {
			const input = action + suffix;
			assert.deepEqual(parseTaskCommand(input), { action: "invalid", input });
		}
	}
});

test("commands use the real settings service, including off despite bad task history and bad local config", async (t) => {
	const h = await taskSettingsFixture(t);
	let handler: Handler | undefined;
	const hooks = new Map<string, Hook>();
	const outputs: { tone: string; text: string }[] = [];
	const visible: boolean[] = [];
	const pi = {
		events: h.bus,
		registerEntryRenderer() {},
		registerCommand(_name: string, command: { handler: Handler }) {
			handler = command.handler;
		},
		on(name: string, hook: Hook) {
			hooks.set(name, hook);
		},
		appendEntry(_type: string, data: { tone: string; text: string }) {
			outputs.push(data);
		},
	} as unknown as ExtensionAPI;
	registerTaskCommand(pi, {
		getTasks() {
			throw new Error("task history unreadable");
		},
		runHumanTaskCommand() {
			throw new Error("not a task mutation");
		},
		setWidgetVisibility(_ctx, value) {
			visible.push(value);
		},
		updateSetting: h.settings.set,
	});
	registerTaskGate(
		pi,
		() => {
			throw new Error("task history unreadable");
		},
		h.settings.isEnabled,
	);
	assert.ok(handler);
	const gate = hooks.get("tool_call");
	assert.ok(gate);
	const ctx = h.context as Parameters<Handler>[1];
	assert.notEqual(await gate({ toolName: "read" }, ctx), undefined);
	await writeFile(join(h.cwd, ".pi/settings.json"), "{");
	await handler("no-task-no-tool off --persistent", ctx);
	assert.equal(outputs.at(-1)?.tone, "warning");
	assert.match(
		outputs.at(-1)?.text ?? "",
		/applied to session.*Not saved to local/,
	);
	assert.equal(await gate({ toolName: "read" }, ctx), undefined);
	await handler("show off", ctx);
	assert.deepEqual(visible, [false]);
	assert.deepEqual(await h.settings.read(ctx, "omp-task:show"), {
		ok: true,
		value: false,
	});
	await handler("no-task-no-tool on", ctx);
	assert.notEqual(await gate({ toolName: "read" }, ctx), undefined);
	assert.equal(await gate({ toolName: "task" }, ctx), undefined);
});

test("gate contains asynchronous settings rejection and diagnostics, always exempting exact task", async (t) => {
	t.mock.method(console, "error", () => {
		throw new Error("logger failed");
	});
	const hooks = new Map<string, Hook>();
	const pi = {
		on(name: string, hook: Hook) {
			hooks.set(name, hook);
		},
	} as unknown as ExtensionAPI;
	registerTaskGate(
		pi,
		() => {
			throw new Error("history unavailable");
		},
		async () => {
			throw new Error("service unavailable");
		},
	);
	const gate = hooks.get("tool_call");
	assert.ok(gate);
	assert.equal(
		await gate({ toolName: "task" }, {} as ExtensionContext),
		undefined,
	);
	assert.notEqual(
		await gate({ toolName: "read" }, {} as ExtensionContext),
		undefined,
	);
	await assert.doesNotReject(
		Promise.resolve(
			hooks.get("session_start")?.({ toolName: "" }, {} as ExtensionContext),
		),
	);
});

test("both setting commands complete on/off and unused persistence flags without task reads", async () => {
	const fallback: AutocompleteProvider = {
		async getSuggestions() {
			return null;
		},
		applyCompletion(lines, cursorLine, cursorCol) {
			return { lines, cursorLine, cursorCol };
		},
	};
	const provider = createHumanTaskCompletionProvider(fallback, () => {
		throw new Error("must not read task state");
	});
	for (const action of ["show", "no-task-no-tool"]) {
		for (const [suffix, expected] of [
			["", ["on", "off"]],
			["off ", ["--persistent", "--global"]],
			["on --g", ["--global"]],
			["off --global ", ["--persistent"]],
			["off --persistent ", ["--global"]],
		] as const) {
			const line = `/task ${action} ${suffix}`;
			const result = await provider.getSuggestions([line], 0, line.length, {
				signal: new AbortController().signal,
			});
			assert.deepEqual(
				result?.items.map((item) => item.value),
				expected,
			);
		}
	}
});
