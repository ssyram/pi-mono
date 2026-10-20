import { captureWakeupPrompt } from "./capture-wakeup-prompt.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createEventBus } from "../../../packages/coding-agent/src/core/event-bus.ts";
import scheduledWakeup from "../src/extension.js";
import type { AiSessionActionResult } from "../src/v2/ai-session-actions.js";
import type { SessionEntryLike } from "../src/v2/session-entry-adapter.js";

export type BoundaryTool = {
	execute(
		id: string,
		params: Record<string, unknown>,
		signal: AbortSignal,
		update: undefined,
		ctx: ExtensionContext,
	): Promise<{ details: AiSessionActionResult }>;
};

export function createBoundaryFixture(t: TestContext) {
	const cwd = mkdtempSync(join(tmpdir(), "loop-boundary-"));
	const sessionFile = join(cwd, "session.jsonl");
	writeFileSync(sessionFile, "");
	const entries: SessionEntryLike[] = [];
	const notifications: string[] = [];
	const sent: string[] = [];
	const messages: { customType: string; content: unknown; details?: unknown; options?: { triggerTurn?: boolean } }[] = [];
	const failures = { branch: false, append: false, notify: false };
	const hooks = new Map<
		string,
		(event: unknown, ctx: ExtensionContext) => Promise<void>
	>();
	let command:
		| ((args: string, ctx: ExtensionCommandContext) => Promise<void>)
		| undefined;
	let tool: BoundaryTool | undefined;
	const pi = {
		registerMessageRenderer: () => undefined,
		on: (
			name: string,
			handler: (event: unknown, ctx: ExtensionContext) => Promise<void>,
		) => hooks.set(name, handler),
		registerCommand: (_name: string, spec: { handler: typeof command }) => {
			command = spec.handler;
		},
		registerTool: (spec: unknown) => {
			tool = spec as BoundaryTool;
		},
		sendUserMessage: () => assert.fail("automatic delivery must use custom messages"),
		sendMessage: (message: { customType: string; content: unknown; details?: unknown }, options?: { triggerTurn?: boolean }) => { messages.push({ ...message, ...(options ? { options } : {}) }); sent.push(captureWakeupPrompt(message)); },
		appendEntry: (customType: string, data: unknown) => {
			if (failures.append) throw new Error("append failed");
			entries.push({ type: "custom", customType, data });
		},
		events: createEventBus(),
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd,
		mode: "print",
		hasUI: true,
		isIdle: () => true,
		sessionManager: {
			getSessionId: () => `boundary-${cwd}`,
			getSessionFile: () => sessionFile,
			getBranch: () => {
				if (failures.branch) throw new Error("branch unavailable");
				return entries;
			},
		},
		ui: {
			notify: (text: string) => {
				if (failures.notify) throw new Error("notify unavailable");
				notifications.push(text);
			},
		},
	} as unknown as ExtensionContext;
	scheduledWakeup(pi);
	const invoke = async (name: string) => {
		const hook = hooks.get(name);
		assert.ok(hook);
		await hook({ type: name }, ctx);
	};
	t.after(async () => {
		await invoke("session_shutdown");
		rmSync(cwd, { recursive: true, force: true });
	});
	return {
		cwd,
		sessionFile,
		entries,
		notifications,
		sent,
		messages,
		failures,
		ctx,
		pi,
		get registeredTool(): BoundaryTool {
			assert.ok(tool);
			return tool;
		},
		start: () => invoke("session_start"),
		shutdown: () => invoke("session_shutdown"),
		run: async (args: string) => {
			assert.ok(command);
			await command(args, ctx as ExtensionCommandContext);
		},
		execute: async (params: Record<string, unknown>) => {
			assert.ok(tool);
			return tool.execute(
				"test",
				params,
				new AbortController().signal,
				undefined,
				ctx,
			);
		},
	};
}
