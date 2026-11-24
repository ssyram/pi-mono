import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { loadConfig, getState, patchTui, unpatchTui } from "./config-and-state.js";
import { createPatchedDoRender } from "./forked-do-render.js";

export default async function cooldownRedraw(pi: ExtensionAPI): Promise<void> {
	const config = loadConfig();
	if (!config.enabled) return;

	const state = getState();

	// Clean up previous instance (reload safety per G6)
	unpatchTui(state);
	state.active = false;

	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;

		ctx.ui.custom<void>(
			(tui) => {
				patchTui(tui as TUI, state, config, createPatchedDoRender);
				return { render: () => [] } as any;
			},
			{ overlay: false },
		);
	});

	pi.on("agent_start", () => {
		state.active = true;
		state.lastFullRedrawMs = Date.now();
	});

	pi.on("agent_end", () => {
		state.active = false;
		if (state.tuiRef) {
			(state.tuiRef as any).requestRender(true);
		}
	});

	pi.on("session_shutdown", () => {
		state.active = false;
		unpatchTui(state);
	});
}
