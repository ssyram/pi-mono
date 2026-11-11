/**
 * Spinner widget shown while a usage query is actually running. Refcounted so
 * the footer refresh job and the /provider-usage command can share one widget.
 */
import { systemScheduler, type UsageScheduler } from "./controller-contract.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const WIDGET_KEY = "provider-usage:query";

export type WidgetPainter = (key: string, content: string[] | undefined) => void;

export interface UsageQueryWidget {
	begin(label: string): void;
	end(): void;
	clear(): void;
}

export function createUsageQueryWidget(
	paint: WidgetPainter,
	scheduler: UsageScheduler = systemScheduler(),
	frames: readonly string[] = FRAMES,
	intervalMs = 120,
): UsageQueryWidget {
	let active = 0;
	let label = "";
	let frameIndex = 0;
	let timer: { clear(): void } | undefined;

	function draw(): void {
		paint(WIDGET_KEY, [`${frames[frameIndex] ?? ""} ${label}`]);
	}

	function tick(): void {
		if (active === 0 || frames.length === 0) return;
		frameIndex = (frameIndex + 1) % frames.length;
		draw();
		timer = scheduler.after(intervalMs, tick);
	}

	function stop(): void {
		timer?.clear();
		timer = undefined;
		paint(WIDGET_KEY, undefined);
	}

	return {
		begin(nextLabel) {
			active += 1;
			label = nextLabel;
			draw();
			if (timer === undefined && frames.length > 0) timer = scheduler.after(intervalMs, tick);
		},
		end() {
			if (active === 0) return;
			active -= 1;
			if (active === 0) stop();
		},
		clear() {
			active = 0;
			stop();
		},
	};
}
