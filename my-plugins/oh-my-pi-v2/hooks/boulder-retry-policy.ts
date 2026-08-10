import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const BASE_DELAY_MS = 10_000;
const MAX_DELAY_MS = 3_600_000;

export type BoulderExtensionMode = "tui" | "rpc" | "json" | "print";

type ModeAwareContext = ExtensionContext & {
	mode?: BoulderExtensionMode;
	ui: ExtensionContext["ui"] & { mode?: BoulderExtensionMode };
};

export function getBoulderContextMode(context: ExtensionContext): BoulderExtensionMode {
	const modeAware = context as ModeAwareContext;
	return modeAware.mode ?? modeAware.ui.mode ?? "tui";
}

export function getBoulderAttemptLimit(mode: BoulderExtensionMode): number {
	return mode === "print" ? 3 : 10;
}

export function getBoulderAttemptDelayMs(attempt: number): number {
	if (attempt <= 3) return BASE_DELAY_MS;
	return Math.min(BASE_DELAY_MS * 2 ** (attempt - 3), MAX_DELAY_MS);
}

export function formatBoulderDelay(delayMs: number): string {
	if (delayMs < 3_600_000) return `${Math.ceil(delayMs / 1000)}s`;
	return `${Math.ceil(delayMs / 3_600_000)}h`;
}
