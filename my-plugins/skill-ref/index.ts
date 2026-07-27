/**
 * skill-ref — inline SKILL/prompt references.
 *
 * 1. Mid-sentence "/" + Tab completes skills and prompts instead of filesystem paths.
 * 2. try_load_skill_or_prompt turns such a reference into the resource's own text.
 *
 * Holds no timers, child processes or watchers, so `pi -p` still exits cleanly.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSkillRefProvider, type ThemeLike } from "./src/autocomplete.js";
import { listEntries } from "./src/registry.js";
import { registerTryLoadTool } from "./src/tool.js";

export default function skillRefExtension(pi: ExtensionAPI): void {
	// Lazy thunk: read pi's command list on every use, so /reload is picked up
	// with no cache to invalidate.
	const getEntries = () => listEntries(() => pi.getCommands());

	registerTryLoadTool(pi, getEntries);

	// Autocomplete wrappers are cleared on /reload, so registration must happen
	// on every session_start rather than once at load time.
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.addAutocompleteProvider((current) =>
			createSkillRefProvider(current, getEntries, ctx.ui.theme as unknown as ThemeLike),
		);
	});
}
