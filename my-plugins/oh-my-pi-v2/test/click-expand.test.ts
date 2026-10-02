import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { registerBoulderResumeMessages } from "../hooks/boulder-resume-message.js";
import { registerBoulderScheduleEntryRenderer } from "../hooks/boulder-schedule-entry.js";
import { ClickExpandText, clickExpandable, resetClickExpandState } from "../tools/click-expand.js";

const theme = { fg: (_color: string, text: string) => text };

function click(button: "left" | "right" = "left", type = "click"): TuiMouseEvent {
	return {
		type: type as TuiMouseEvent["type"],
		button,
		x: 0,
		y: 0,
		screenX: 0,
		screenY: 0,
		width: 80,
		height: 1,
		shift: false,
		alt: false,
		ctrl: false,
	};
}

beforeEach(() => resetClickExpandState());

describe("click expand component", () => {
	it("toggles between views on left click through the MouseRegion dispatch path", () => {
		const text = new ClickExpandText({
			key: "t1",
			collapsed: () => "collapsed view",
			expanded: () => "expanded view",
		});
		const wrapped = clickExpandable(text, "t1");
		assert.match(wrapped.render(80).join("\n"), /collapsed view/);
		assert.equal(wrapped.handleMouse?.(click())?.handled, true);
		assert.match(wrapped.render(80).join("\n"), /expanded view/);
		assert.equal(wrapped.handleMouse?.(click())?.handled, true);
		assert.match(wrapped.render(80).join("\n"), /collapsed view/);
	});

	it("ignores non-click and non-left-button events without changing state", () => {
		const text = new ClickExpandText({
			key: "t2",
			collapsed: () => "collapsed view",
			expanded: () => "expanded view",
		});
		const wrapped = clickExpandable(text, "t2");
		for (const event of [click("right"), click("left", "press"), click("left", "move"), click("left", "wheel")]) {
			assert.equal(wrapped.handleMouse?.(event), undefined);
		}
		assert.match(wrapped.render(80).join("\n"), /collapsed view/);
	});

	it("never throws and never returns null from render when views misbehave", () => {
		const throwing = new ClickExpandText({
			key: "t3",
			collapsed: () => {
				throw new Error("boom");
			},
			expanded: () => "never",
		});
		assert.deepEqual(throwing.render(80), [""]);
		const nullView = new ClickExpandText({
			key: "t4",
			collapsed: () => null as unknown as string,
			expanded: () => "never",
		});
		const wrapped = clickExpandable(nullView, "t4");
		assert.doesNotThrow(() => wrapped.render(80));
		assert.equal(wrapped.handleMouse?.(click())?.handled, true);
		assert.doesNotThrow(() => wrapped.render(80));
	});

	it("keeps expand state across component instance rebuilds", () => {
		const make = () =>
			new ClickExpandText({
				key: "t5",
				collapsed: () => "collapsed view",
				expanded: () => "expanded view",
			});
		const first = clickExpandable(make(), "t5");
		assert.equal(first.handleMouse?.(click())?.handled, true);
		const rebuilt = clickExpandable(make(), "t5");
		assert.match(rebuilt.render(80).join("\n"), /expanded view/);
	});
});

describe("boulder schedule entry click rendering", () => {
	it("expands to scheduling details and back", () => {
		let renderer:
			| ((
					entry: { data?: object; id?: number },
					options: { expanded: boolean },
					theme: unknown,
			  ) => { render(width: number): string[] } & {
					handleMouse?(ev: TuiMouseEvent): { handled?: boolean } | undefined;
			  })
			| undefined;
		const pi = {
			registerEntryRenderer: (_type: string, r: typeof renderer) => {
				renderer = r;
			},
		} as unknown as ExtensionAPI;
		registerBoulderScheduleEntryRenderer(pi);
		const component = renderer?.(
			{ data: { attempt: 4, maxAttempts: 10, scheduledDelayMs: 20_000 }, id: 7 },
			{ expanded: false },
			theme,
		);
		const lines = () =>
			component
				?.render(100)
				.map((line) => line.trimEnd())
				.join("\n") ?? "";
		assert.match(lines(), /restarting in 20s \(click to expand\)/);
		assert.equal(
			(component as unknown as { handleMouse(ev: TuiMouseEvent): { handled?: boolean } | undefined }).handleMouse(
				click(),
			)?.handled,
			true,
		);
		assert.match(lines(), /attempt 4\/10 · delay 20s/);
		assert.match(lines(), /automatic resume message listing open tasks/);
		(component as unknown as { handleMouse(ev: TuiMouseEvent): unknown }).handleMouse(click());
		assert.match(lines(), /\(click to expand\)/);
	});

	it("returns undefined without data and never throws on malformed data", () => {
		let renderer: ((entry: unknown, options: unknown, theme: unknown) => unknown) | undefined;
		const pi = {
			registerEntryRenderer: (_type: string, r: typeof renderer) => {
				renderer = r;
			},
		} as unknown as ExtensionAPI;
		registerBoulderScheduleEntryRenderer(pi);
		assert.equal(renderer?.({ data: undefined }, { expanded: false }, theme), undefined);
		const weird = renderer?.(
			{ data: { attempt: {}, maxAttempts: null, scheduledDelayMs: Symbol() }, id: 8 },
			{ expanded: false },
			theme,
		) as { render(width: number): string[] };
		assert.doesNotThrow(() => weird?.render(100));
	});
});

describe("boulder resume message click rendering", () => {
	it("expands to the resume task list and falls back without a resumeId", () => {
		let renderer: ((message: unknown, options: { expanded: boolean }, theme: unknown) => unknown) | undefined;
		const pi = {
			registerMessageRenderer: (_type: string, r: typeof renderer) => {
				renderer = r;
			},
			on: () => undefined,
		} as unknown as ExtensionAPI;
		registerBoulderResumeMessages(pi);
		const message = {
			content: "1. [in_progress] #1: keep going",
			details: { resumeId: "r-1", attempt: 2, maxAttempts: 5, scheduledDelayMs: 1000 },
		};
		const component = renderer?.(message, { expanded: false }, theme) as {
			render(width: number): string[];
			handleMouse?(event: TuiMouseEvent): { handled?: boolean } | undefined;
		};
		const lines = () =>
			component
				?.render(100)
				.map((line) => line.trimEnd())
				.join("\n") ?? "";
		assert.match(lines(), /↻ Automatic Boulder resume \(click to expand\)/);
		assert.equal(component?.handleMouse?.(click())?.handled, true);
		assert.match(lines(), /#1: keep going/);

		const keyless = renderer?.({ content: "1. task", details: undefined }, { expanded: false }, theme) as {
			render(width: number): string[];
			handleMouse?: unknown;
		};
		assert.equal(keyless?.handleMouse, undefined);
		assert.match(
			keyless
				?.render(100)
				.map((line) => line.trimEnd())
				.join("\n") ?? "",
			/↻ Automatic Boulder resume/,
		);
		const keylessExpanded = renderer?.({ content: "1. task", details: undefined }, { expanded: true }, theme) as {
			render(width: number): string[];
		};
		assert.match(
			keylessExpanded
				?.render(100)
				.map((line) => line.trimEnd())
				.join("\n") ?? "",
			/1\. task/,
		);
	});
});
