import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	MouseRegion,
	type TUI,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { loopErrorMessage } from "./loop-error-message.js";
import { notifyLoop } from "./loop-notification.js";
import { type LoopWidgetItem, loopWidgetLines } from "./loop-widget-items.js";
import { createWidgetSpaceProbe } from "./loop-widget-space.js";

export type RunningWidget = {
	refresh(): void;
	show(): Promise<void>;
	setVisible(value: boolean): void;
	dispose(): void;
};
export const LOOP_WIDGET_MAX_LINES = 10;
const KEY = "loop-running-scripts";
const SPINNER_FRAMES = ["◓", "◑", "◒", "◐"] as const;
const SPINNER_INTERVAL_MS = 600;

export function createRunningWidget(
	ctx: ExtensionContext,
	source: () => readonly LoopWidgetItem[],
	initialVisible = true,
): RunningWidget {
	let closed = false;
	let installed = false;
	let visible = initialVisible;
	let expanded = false;
	let items: readonly LoopWidgetItem[] = [];
	let tui: TUI | undefined;
	let width = 0;
	let timer: ReturnType<typeof setInterval> | undefined;
	let spinnerFrame = 0;
	let spinnerTimer: ReturnType<typeof setInterval> | undefined;
	const report = (error: unknown): void =>
		notifyLoop(
			ctx,
			`Loop widget failed: ${loopErrorMessage(error)}`,
			"warning",
		);
	const space = createWidgetSpaceProbe(report);
	const clearTimer = (): void => {
		if (timer !== undefined) clearInterval(timer);
		timer = undefined;
	};
	const requestRender = (): void => {
		try {
			tui?.requestRender();
		} catch (error) {
			clearTimer();
			clearSpinnerTimer();
			report(error);
		}
	};
	const updateTimer = (): void => {
		if (
			!closed &&
			installed &&
			visible &&
			expanded &&
			items.some((item) => !item.running)
		) {
			if (timer === undefined) {
				timer = setInterval(requestRender, 1000);
				timer.unref?.();
			}
		} else clearTimer();
	};
	const clearSpinnerTimer = (): void => {
		if (spinnerTimer !== undefined) clearInterval(spinnerTimer);
		spinnerTimer = undefined;
	};
	const advanceSpinner = (): void => {
		spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
		requestRender();
	};
	const updateSpinnerTimer = (): void => {
		if (!closed && installed && visible && tui !== undefined) {
			if (spinnerTimer === undefined) {
				spinnerTimer = setInterval(advanceSpinner, SPINNER_INTERVAL_MS);
				spinnerTimer.unref?.();
			}
		} else clearSpinnerTimer();
	};
	const toggle = (): void => {
		try {
			if (
				closed ||
				!visible ||
				items.length === 0 ||
				tui?.mode !== "fullscreen"
			)
				return;
			expanded =
				!expanded &&
				space.fits(
					tui,
					width,
					Math.min(LOOP_WIDGET_MAX_LINES - 1, items.length),
				);
			updateTimer();
			requestRender();
		} catch (error) {
			report(error);
		}
	};
	const hide = (): void => {
		clearTimer();
		clearSpinnerTimer();
		expanded = false;
		if (installed) ctx.ui.setWidget(KEY, undefined);
		installed = false;
		tui = undefined;
	};
	const refresh = (): void => {
		if (closed) return;
		try {
			if (!visible) {
				hide();
				return;
			}
			items = source();
			if (!ctx.hasUI || items.length === 0) {
				hide();
				return;
			}
			if (ctx.mode === "rpc") {
				ctx.ui.setWidget(KEY, [` ${SPINNER_FRAMES[0]} Loop · ${items.length} scheduled`], {
					placement: "aboveEditor",
				});
				installed = true;
				return;
			}
			if (ctx.mode !== "tui") return;
			if (!installed) {
				ctx.ui.setWidget(
					KEY,
					(surface, theme) => {
						tui = surface;
						const component: Component = {
							render(columns) {
								try {
									if (closed || !visible || items.length === 0) return [];
									const probing = space.isProbing();
									if (!probing) width = columns;
									space.markSummary();
									const count = Math.min(
										LOOP_WIDGET_MAX_LINES - 1,
										items.length,
									);
									if (!probing && expanded && !space.fits(tui, width, count)) {
										expanded = false;
										updateTimer();
									}
									const label = ` ${SPINNER_FRAMES[spinnerFrame]} Loop · ${items.length} scheduled`;
									const summary = theme.fg(
										"accent",
										truncateToWidth(label, columns),
									);
									return [
										summary,
										...(!probing && expanded
											? loopWidgetLines(items.slice(0, count), columns)
											: []),
									];
								} catch (error) {
									report(error);
									return [];
								}
							},
							invalidate() {},
						};
						return surface.mode === "fullscreen"
							? new MouseRegion(component, (event) => {
									if (
										event.type === "click" &&
										event.button === "left" &&
										event.y === 0
									) {
										toggle();
										return { handled: true };
									}
									return undefined;
								})
							: component;
					},
					{ placement: "aboveEditor" },
				);
				installed = true;
			}
			updateTimer();
			updateSpinnerTimer();
			requestRender();
		} catch (error) {
			report(error);
		}
	};
	return {
		refresh,
		show: async () => toggle(),
		setVisible(value) {
			visible = value;
			refresh();
		},
		dispose() {
			if (closed) return;
			closed = true;
			try {
				hide();
			} catch (error) {
				report(error);
			}
		},
	};
}
