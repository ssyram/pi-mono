import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TUI } from "@earendil-works/pi-tui";

export const GLOBAL_KEY = "__cooldownRedraw";

export interface CooldownState {
	active: boolean;
	lastFullRedrawMs: number;
	originalDoRender: (() => void) | null;
	tuiRef: TUI | null;
}

export interface CooldownConfig {
	enabled: boolean;
	intervalMs: number;
}

export function loadConfig(): CooldownConfig {
	const defaults: CooldownConfig = { enabled: true, intervalMs: 10000 };

	const tryParse = (filePath: string): Record<string, unknown> | null => {
		try {
			return JSON.parse(readFileSync(filePath, "utf-8"));
		} catch {
			return null;
		}
	};

	const global = tryParse(join(homedir(), ".pi", "agent", "settings.json"));
	const project = tryParse(join(process.cwd(), ".pi", "settings.json"));

	const merged = {
		...((global?.cooldownRedraw as object) ?? {}),
		...((project?.cooldownRedraw as object) ?? {}),
	};
	return {
		enabled: (merged as Partial<CooldownConfig>).enabled ?? defaults.enabled,
		intervalMs: (merged as Partial<CooldownConfig>).intervalMs ?? defaults.intervalMs,
	};
}

export function getState(): CooldownState {
	const g = globalThis as Record<string, unknown>;
	if (!g[GLOBAL_KEY]) {
		g[GLOBAL_KEY] = { active: false, lastFullRedrawMs: 0, originalDoRender: null, tuiRef: null };
	}
	return g[GLOBAL_KEY] as CooldownState;
}

export function patchTui(tui: TUI, state: CooldownState, config: CooldownConfig, createPatchedDoRender: (s: CooldownState, c: CooldownConfig) => (this: any) => void): void {
	if (state.originalDoRender && state.tuiRef === tui) return;

	if (state.originalDoRender && state.tuiRef) {
		(state.tuiRef as any).doRender = state.originalDoRender;
	}

	state.tuiRef = tui;
	state.originalDoRender = (tui as any).doRender.bind(tui);
	(tui as any).doRender = createPatchedDoRender(state, config).bind(tui);
}

export function unpatchTui(state: CooldownState): void {
	if (state.originalDoRender && state.tuiRef) {
		(state.tuiRef as any).doRender = state.originalDoRender;
		state.originalDoRender = null;
		state.tuiRef = null;
	}
}
