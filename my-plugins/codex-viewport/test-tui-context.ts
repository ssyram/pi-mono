import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Component, Container, type Terminal, TUI } from "@earendil-works/pi-tui";

interface TestTuiContext {
	tui: TUI;
	ctx: ExtensionContext;
	setIdle(idle: boolean): void;
	abortCalls(): number;
	notifications(): string[];
}

function createTestTuiContext(): TestTuiContext {
	const terminal = {
		columns: 80,
		rows: 24,
		write: () => {},
		hideCursor: () => {},
	} as unknown as Terminal;
	const tui = new TUI(terminal);
	for (let index = 0; index < 4; index++) tui.addChild(new Container());
	let idle = true;
	let abortCount = 0;
	const notifications: string[] = [];
	const ui = {
		setWidget: (_key: string, content: unknown) => {
			if (typeof content === "function") {
				(content as (instance: TUI, theme: unknown) => Component)(tui, {});
			}
		},
		getToolsExpanded: () => false,
		notify: (message: string) => notifications.push(message),
	};
	const ctx = {
		hasUI: true,
		mode: "tui",
		ui,
		isIdle: () => idle,
		abort: () => abortCount++,
	} as unknown as ExtensionContext;
	return {
		tui,
		ctx,
		setIdle: (value) => {
			idle = value;
		},
		abortCalls: () => abortCount,
		notifications: () => [...notifications],
	};
}

export { createTestTuiContext };
export type { TestTuiContext };
