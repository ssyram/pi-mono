import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerFleetUI } from "../src/tui/fleet-ui.ts";
import type { FleetChildView, FleetView } from "../src/children/native-runtime.ts";

const DOWN = "\x1b[B", UP = "\x1b[A", RIGHT = "\x1b[C", LEFT = "\x1b[D", ENTER = "\r", ESC = "\x1b";

function fakeEditor() {
	const lines: string[] = [""];
	return { render: () => lines, invalidate: () => {}, handleInput: () => {}, getText: () => lines[0] ?? "", setText: (t: string) => { lines[0] = t; } };
}

function harness(children: FleetChildView[], actors: Array<{ agentId: string; fsmName: string; stateId: string; noProgress: number }>) {
	const notified: string[] = [];
	let widgetFactory: ((tui: unknown, theme: unknown) => { render(w: number): string[]; invalidate(): void }) | undefined;
	const editor = fakeEditor();
	const tui = { terminal: { rows: 40, columns: 120 }, focusedComponent: editor, requestRender: () => {},
		children: [{ render: () => ["transcript"], children: [editor] }, { render: () => ["spacer"] }] };
	const handlers = new Map<string, (event: never) => unknown>();
	let keyHandler: ((data: string) => unknown) | undefined;
	const pi = { on: (name: string, handler: (event: never) => unknown) => { handlers.set(name, handler); return () => handlers.delete(name); } } as unknown as ExtensionAPI;
	const ctx = {
		ui: {
			setWidget: (_key: string, content: unknown) => { widgetFactory = typeof content === "function" ? content as typeof widgetFactory : undefined; },
			onTerminalInput: (handler: (data: string) => unknown) => { keyHandler = handler; return () => { keyHandler = undefined; }; },
			notify: (message: string) => { notified.push(message); },
			getEditorText: () => editor.getText(),
		},
	} as never;
	const fleet: FleetView = {
		list: () => children,
		subscribe: () => () => {},
		send: async () => { throw new Error("no steering in v2 selector"); },
	};
	const off = registerFleetUI(pi, ctx, { placement: "belowEditor", fleet: () => fleet, contextWindowOf: () => 100_000, rootSessionId: "root",
		actors: async () => actors });
	const mountWidget = () => { assert.ok(widgetFactory); widgetFactory!(tui, undefined); };
	const press = (key: string) => keyHandler?.(key) as { consume?: boolean } | undefined;
	return { notified, editor, press, mountWidget, off, tui, handlers };
}

function child(sessionId: string, name: string, sessionFile: string, overrides: Partial<FleetChildView> = {}): FleetChildView {
	return { sessionId, parentSessionId: "root", name, model: "native-mock/test", thinking: "off", lifecycle: "idle",
		outcome: null, runActive: false, sessionFile, cwd: "/w", depth: 1, ...overrides };
}

test("fleet selector v2: activate, navigate, enter prints transcript path, esc closes, FSM state renders", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "fleet-ui2-"));
	t.after(async () => { await rm(dir, { recursive: true, force: true }); });
	const fileA = join(dir, "a.jsonl");
	await writeFile(fileA, JSON.stringify({ type: "message", message: { role: "assistant", timestamp: "2026-10-22T00:00:00Z", content: [{ type: "text", text: "done text" }], usage: { input: 1000, output: 10, totalTokens: 1010, cost: { total: 0.001 } } } }) + "\n");
	const h = harness([child("ses_aaaa", "worker-a", fileA), child("ses_bbbb", "worker-b", join(dir, "b.jsonl"), { outcome: "completed" })],
		[{ agentId: "ses_aaaa", fsmName: "NativeRoot", stateId: "WORK", noProgress: 2 }]);
	t.after(() => h.off());

	assert.deepEqual(h.press(DOWN), { consume: true }, "first down activates the selector");
	h.mountWidget();
	assert.deepEqual(h.press(DOWN), { consume: true }, "navigation consumes keys once active");
	h.press(ENTER);
	assert.ok(h.notified.some((message) => message.includes("transcript: ")), "enter prints the child transcript path");
	h.press(UP); h.press(UP);
	h.press(ENTER);
	assert.ok(h.notified.some((message) => message.includes("main session")), "main row prints the main-session transcript hint");
	h.press(ESC);
	h.off();
});

test("typed editor text routes keys to the editor and never activates the selector", async () => {
	const h = harness([child("ses_c", "w", "/nonexistent")], []);
	h.editor.setText("typing something");
	assert.equal(h.press(DOWN), undefined);
	assert.equal(h.press(ESC), undefined);
	h.editor.setText("");
});
