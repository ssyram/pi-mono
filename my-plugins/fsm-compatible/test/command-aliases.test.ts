import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { IMPLEMENTED_COMMANDS, registerCommandAliases } from "../src/commands/command-aliases.ts";

interface Recorded {
	kind: "newSession" | "navigateTree" | "shutdown";
	target?: string;
	cancelled?: boolean;
	throwError?: Error;
}

function fakePi() {
	const commands = new Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
	const pi = {
		registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) => {
			commands.set(name, { handler: options.handler });
		},
	} as unknown as ExtensionAPI;
	return { pi, commands };
}

function fakeCtx(manager: SessionManager, script: Recorded[] = [], usage?: object) {
	const notifications: string[] = [];
	const record = (entry: Recorded) => { script.push(entry); return { cancelled: entry.cancelled ?? false }; };
	const ctx = {
		sessionManager: manager,
		waitForIdle: async () => {},
		newSession: async () => record({ kind: "newSession" }),
		navigateTree: async (target: string) => {
			if (script.some((item) => item.kind === "navigateTree" && item.throwError)) throw script.find((item) => item.throwError)!.throwError!;
			return record({ kind: "navigateTree", target });
		},
		getContextUsage: () => usage,
		shutdown: () => record({ kind: "shutdown" }),
		ui: { notify: (message: string) => { notifications.push(message); } },
	} as unknown as ExtensionCommandContext;
	return { ctx, notifications };
}

function multiTurnTree(): { manager: SessionManager; second: string } {
	const manager = SessionManager.inMemory("/work", { id: "cmd-tree" });
	manager.appendMessage({ role: "user", content: "one", timestamp: Date.now() });
	const second = manager.appendMessage({ role: "user", content: "two", timestamp: Date.now() });
	manager.appendMessage({ role: "user", content: "three", timestamp: Date.now() });
	return { manager, second };
}

test("undo steps to the parent entry and redo restores exactly once", async () => {
	const { pi, commands } = fakePi();
	const state = registerCommandAliases(pi);
	const { manager } = multiTurnTree();
	const script: Recorded[] = [];
	const { ctx, notifications } = fakeCtx(manager, script);
	await commands.get("undo")!.handler("", ctx);
	assert.deepEqual(script.map((entry) => entry.target), [multiTurnTreeLeafParent(manager)]);
	assert.equal(state.previousLeaf, manager.getLeafId() === null ? null : leafBeforeUndo(manager, script));
	await commands.get("redo")!.handler("", ctx);
	assert.equal(script.length, 2);
	await commands.get("redo")!.handler("", ctx);
	assert.equal(script.length, 2, "second redo must be refused");
	assert.ok(notifications.some((message) => message.includes("nothing to redo")));
	void notifications;
});

function multiTurnTreeLeafParent(manager: SessionManager): string | undefined {
	const leaf = manager.getLeafId();
	const entry = leaf === null ? undefined : manager.getEntry(leaf);
	return entry?.parentId ?? undefined;
}

function leafBeforeUndo(manager: SessionManager, script: Recorded[]): string | null {
	void script;
	return manager.getLeafId();
}

test("undo at the root refuses; navigateTree errors surface verbatim", async () => {
	const { pi, commands } = fakePi();
	registerCommandAliases(pi);
	const empty = SessionManager.inMemory("/work", { id: "cmd-empty" });
	const rootScript: Recorded[] = [];
	const root = fakeCtx(empty, rootScript);
	await commands.get("undo")!.handler("", root.ctx);
	assert.equal(rootScript.length, 0);
	assert.ok(root.notifications.some((message) => message.includes("nothing to undo")));
	const { manager } = multiTurnTree();
	const failing: Recorded[] = [{ kind: "navigateTree", target: "x", throwError: new Error("session is compacting") }];
	const failingCtx = fakeCtx(manager, failing);
	await commands.get("undo")!.handler("", failingCtx.ctx);
	assert.ok(failingCtx.notifications.some((message) => message.includes("session is compacting")));
});

test("new resets undo state, usage renders real data or its absence, exit shuts down, help lists both sets", async () => {
	const { pi, commands } = fakePi();
	const state = registerCommandAliases(pi);
	const { manager } = multiTurnTree();
	const script: Recorded[] = [];
	const withUsage = fakeCtx(manager, script, { usedTokens: 10, contextWindow: 100 });
	await commands.get("usage")!.handler("", withUsage.ctx);
	assert.ok(withUsage.notifications.some((message) => message.includes("usedTokens")));
	const noUsage = fakeCtx(manager, script, undefined);
	await commands.get("usage")!.handler("", noUsage.ctx);
	assert.ok(noUsage.notifications.some((message) => message.includes("no context usage data")));
	state.previousLeaf = "stale";
	await commands.get("new")!.handler("", withUsage.ctx);
	assert.equal(state.previousLeaf, null);
	assert.ok(script.some((entry) => entry.kind === "newSession"));
	await commands.get("exit")!.handler("", withUsage.ctx);
	assert.ok(script.some((entry) => entry.kind === "shutdown"));
	const help = fakeCtx(manager, script);
	await commands.get("fsm-commands")!.handler("", help.ctx);
	const helpText = help.notifications.join("\n");
	for (const name of IMPLEMENTED_COMMANDS) assert.ok(helpText.includes(name), name);
	assert.ok(helpText.includes("/share"));
	assert.ok(helpText.includes("native pi commands are unaffected"));
});

test("cancelled outcomes are reported verbatim and registration covers exactly the fixed set once", async () => {
	const { pi, commands } = fakePi();
	registerCommandAliases(pi);
	assert.deepEqual([...commands.keys()].sort(), ["exit", "fsm-commands", "new", "redo", "undo", "usage"]);
	const before = commands.size;
	registerCommandAliases(pi as never);
	assert.equal(commands.size, before, "re-registration overwrites host map entries instead of duplicating");
	const { manager } = multiTurnTree();
	const cancelledScript: Recorded[] = [];
	const cancelledCtx = fakeCtx(manager, cancelledScript);
	(cancelledCtx.ctx as unknown as { newSession: () => Promise<{ cancelled: boolean }> }).newSession =
		async () => ({ cancelled: true });
	await commands.get("new")!.handler("", cancelledCtx.ctx);
	assert.ok(cancelledCtx.notifications.some((message) => message.includes("new session cancelled")));
	const help = fakeCtx(manager, cancelledScript);
	await commands.get("fsm-commands")!.handler("", help.ctx);
	assert.ok(help.notifications.join("\n").includes("/models"));
});
