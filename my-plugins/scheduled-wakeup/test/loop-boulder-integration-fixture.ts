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
import { readBoulderInhibition } from "../../oh-my-pi-v2/boulder-inhibition/read-inhibition.ts";
import { registerBoulderInhibitionAdapter } from "../../oh-my-pi-v2/hooks/boulder-inhibition-adapter.js";
import scheduledWakeup from "../src/extension.js";
import type { SessionEntryLike } from "../src/v2/session-entry-adapter.js";

type Hook = (event: unknown, ctx: ExtensionContext) => unknown;
type Tool = {
	parameters: unknown;
	execute(
		id: string,
		params: unknown,
		signal: undefined,
		update: undefined,
		ctx: ExtensionContext,
	): Promise<{ details: { ok: boolean } }>;
};

export function loopBoulderFixture(
	t: TestContext,
	loopFirst = false,
	mode = "print",
) {
	const cwd = mkdtempSync(join(tmpdir(), "loop-boulder-lifecycle-"));
	const runner = process.env.PI_SCHEDULED_WAKEUP_RUNNER;
	delete process.env.PI_SCHEDULED_WAKEUP_RUNNER;
	t.after(() => {
		if (runner === undefined) delete process.env.PI_SCHEDULED_WAKEUP_RUNNER;
		else process.env.PI_SCHEDULED_WAKEUP_RUNNER = runner;
	});
	const bus = createEventBus();
	const hooks = new Map<string, Hook[]>();
	const managers = new Map<object, SessionEntryLike[]>();
	const sent: string[] = [];
	let active = [] as SessionEntryLike[];
	let command:
		| ((args: string, ctx: ExtensionCommandContext) => Promise<void>)
		| undefined;
	let tool: Tool | undefined;
	const pi = {
		events: bus,
		on(name: string, handler: Hook) {
			const list = hooks.get(name) ?? [];
			list.push(handler);
			hooks.set(name, list);
			return () => {
				const index = list.indexOf(handler);
				if (index >= 0) list.splice(index, 1);
			};
		},
		registerCommand(_name: string, spec: { handler: typeof command }) {
			command = spec.handler;
		},
		registerTool(spec: unknown) {
			tool = spec as Tool;
		},
		appendEntry(customType: string, data: unknown) {
			active.push({ type: "custom", customType, data });
		},
		sendUserMessage(text: string) {
			sent.push(text);
		},
	} as unknown as ExtensionAPI;
	const session = (id: string): ExtensionContext => {
		const sessionFile = join(cwd, `${id}.jsonl`);
		writeFileSync(sessionFile, "");
		const manager = {
			getSessionId: () => id,
			getSessionFile: () => sessionFile,
			getBranch: () => managers.get(manager) ?? [],
		};
		managers.set(manager, []);
		return {
			cwd,
			mode,
			hasUI: false,
			isIdle: () => true,
			sessionManager: manager,
			ui: {},
		} as unknown as ExtensionContext;
	};
	let ctx = session("first");
	const emit = async (name: string) => {
		active = managers.get(ctx.sessionManager) ?? [];
		for (const hook of hooks.get(name) ?? [])
			await hook({ type: name, reason: "startup" }, ctx);
	};
	let dispose: () => void;
	if (loopFirst) {
		scheduledWakeup(pi);
		dispose = registerBoulderInhibitionAdapter(pi, () => undefined);
	} else {
		dispose = registerBoulderInhibitionAdapter(pi, () => undefined);
		scheduledWakeup(pi);
	}
	t.after(async () => {
		await emit("session_shutdown");
		dispose();
		bus.clear();
		rmSync(cwd, { recursive: true, force: true });
	});
	return {
		sent,
		start: () => emit("session_start"),
		tree: () => emit("session_tree"),
		entries: () => active,
		inhibition: () => readBoulderInhibition(active),
		run: async (args: string) => {
			if (!command) throw new Error("command missing");
			await command(args, ctx as ExtensionCommandContext);
		},
		execute: async (params: unknown) => {
			if (!tool) throw new Error("tool missing");
			return tool.execute("test", params, undefined, undefined, ctx);
		},
		schema: () => tool?.parameters,
		switch: async (id: string) => {
			ctx = session(id);
			await emit("session_start");
		},
	};
}
