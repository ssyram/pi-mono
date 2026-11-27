import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { createRefreshNotice } from "./refresh-notice.js";

type NoticeUI = Parameters<typeof createRefreshNotice>[0];
type WidgetContent = string[] | ((tui: TUI) => Component) | undefined;
type HostMode = "fullscreen" | "regular" | "none";

function harness(mode: HostMode): {
	notice: (message: string) => void;
	flashes: unknown[];
	toasts: unknown[];
	widgets: unknown[];
} {
	const flashes: unknown[] = [];
	const toasts: unknown[] = [];
	const widgets: unknown[] = [];
	const tui: TUI | undefined =
		mode === "none"
			? undefined
			: ({ mode, flash: (message: string, ms?: number) => flashes.push([message, ms]) } as unknown as TUI);
	const ui = {
		setWidget(key: string, content: WidgetContent) {
			widgets.push(content === undefined ? undefined : key);
			if (typeof content === "function" && tui) content(tui);
		},
		notify(message: string, type?: string) {
			toasts.push([message, type]);
		},
	};
	return { notice: createRefreshNotice(ui as unknown as NoticeUI), flashes, toasts, widgets };
}

describe("createRefreshNotice", () => {
	it("flashes in fullscreen and never toasts", () => {
		const h = harness("fullscreen");
		h.notice("Skill list changed: +1/-0 skill(s)");
		assert.deepEqual(h.flashes, [["Skill list changed: +1/-0 skill(s)", 1800]]);
		assert.deepEqual(h.toasts, []);
	});

	it("toasts in the regular screen and never flashes", () => {
		const h = harness("regular");
		h.notice("Skill list changed");
		assert.deepEqual(h.toasts, [["Skill list changed", "info"]]);
		assert.deepEqual(h.flashes, []);
	});

	it("toasts when the host hands over no TUI", () => {
		const h = harness("none");
		h.notice("Skill list changed");
		assert.deepEqual(h.toasts, [["Skill list changed", "info"]]);
	});

	it("registers and removes one throwaway widget under its own key", () => {
		const h = harness("none");
		assert.deepEqual(h.widgets, ["skill-ref:terminal", undefined]);
	});
});
