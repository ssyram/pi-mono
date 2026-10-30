import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { DockerComponent } from "../component.js";
import dockerExtension from "../index.js";

type Shortcut = { key: string; handler: () => void };

function fixture() {
	const shortcuts = new Map<string, Shortcut>();
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
	const busHandlers = new Map<string, (data: unknown) => void>();
	const calls: string[] = [];
	const theme = { fg: (_color: string, text: string) => text };
	let component: DockerComponent | undefined;
	const tui = {
		requestRender: () => calls.push("render"),
		terminal: { rows: 40, columns: 100 },
	};
	const handles: {
		setHidden: (value: boolean) => void;
		focus: () => void;
		unfocus: () => void;
	}[] = [];
	const pi = {
		registerShortcut: (key: string, options: { handler: () => void }) => {
			shortcuts.set(key, { key, handler: options.handler });
		},
		on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => void) => {
			handlers.set(name, handler);
			return () => handlers.delete(name);
		},
		events: {
			on: (channel: string, handler: (data: unknown) => void) => {
				busHandlers.set(channel, handler);
				return () => busHandlers.delete(channel);
			},
		},
	} as unknown as ExtensionAPI;
	dockerExtension(pi);
	const ctx = {
		ui: {
			custom: (
				factory: (tui: unknown, theme: unknown) => unknown,
				options: { onHandle?: (handle: unknown) => void },
			) => {
				const built = factory(tui, theme);
				if (built instanceof DockerComponent) component = built;
				const handle = {
					setHidden: (value: boolean) => calls.push(`hidden:${value}`),
					focus: () => calls.push("focus"),
					unfocus: () => calls.push("unfocus"),
				};
				handles.push(handle);
				options.onHandle?.(handle);
			},
		},
	} as unknown as ExtensionContext;
	return {
		pi,
		ctx,
		shortcuts,
		busHandlers,
		calls,
		handles,
		get component() {
			return component;
		},
		start: () => {
			const handler = handlers.get("session_start");
			assert.ok(handler);
			handler({ type: "session_start" }, ctx);
		},
		shutdown: () => {
			const handler = handlers.get("session_shutdown");
			assert.ok(handler);
			handler({ type: "session_shutdown" }, ctx);
		},
	};
}

test("sidebar starts hidden and toggling only calls setHidden", () => {
	const setup = fixture();
	setup.start();
	assert.deepEqual(setup.calls, ["hidden:true", "hidden:true"]);
	const toggle = setup.shortcuts.get(Key.ctrlShift("t"));
	assert.ok(toggle);
	toggle.handler();
	toggle.handler();
	assert.deepEqual(setup.calls, [
		"hidden:true",
		"hidden:true",
		"hidden:false",
		"hidden:false",
		"hidden:true",
		"hidden:true",
	]);
});

test("freeze regression: no focus APIs and no ctrl+b registration", () => {
	const setup = fixture();
	setup.start();
	const toggle = setup.shortcuts.get(Key.ctrlShift("t"));
	assert.ok(toggle);
	toggle.handler();
	toggle.handler();
	for (const call of setup.calls)
		assert.doesNotMatch(call, /^focus$|^unfocus$/);
	assert.equal(setup.shortcuts.has("ctrl+b"), false);
	const scrollUp = setup.shortcuts.get(Key.ctrlShift("p"));
	const scrollDown = setup.shortcuts.get(Key.ctrlShift("n"));
	assert.ok(scrollUp);
	assert.ok(scrollDown);
});

test("scroll shortcuts are no-ops while hidden and scroll when visible", () => {
	const setup = fixture();
	setup.start();
	assert.ok(setup.component);
	const rendersBefore = setup.calls.filter((call) => call === "render").length;
	setup.shortcuts.get(Key.ctrlShift("n"))?.handler();
	assert.equal(setup.calls.filter((call) => call === "render").length, rendersBefore);
	setup.shortcuts.get(Key.ctrlShift("t"))?.handler();
	setup.shortcuts.get(Key.ctrlShift("n"))?.handler();
	assert.ok(
		setup.calls.filter((call) => call === "render").length > rendersBefore,
	);
});

test("event bus updates flow into the component and shutdown disposes", () => {
	const setup = fixture();
	setup.start();
	setup.busHandlers.get("docker:update")?.({
		id: "s",
		title: "t",
		order: 1,
		lines: ["x"],
	});
	assert.ok(setup.component);
	const lines = setup.component.render(30).join("\n");
	assert.ok(lines.includes("▸ t"));
	setup.busHandlers.get("docker:clear")?.(undefined);
	assert.match(setup.component.render(30).join("\n"), /empty/);
	setup.shutdown();
});
