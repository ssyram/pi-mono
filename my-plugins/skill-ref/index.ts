/**
 * skill-ref — inline SKILL/prompt references.
 *
 * 1. Mid-sentence "/" + Tab completes skills and prompts instead of filesystem paths.
 * 2. try_load_skill_or_prompt turns such a reference into the resource's own text.
 * 3. :print/:path modifiers cash a reference in at send time (appended text or
 *    absolute path); "/name :" opens the subcommand menu automatically.
 *
 * Holds no timers, child processes or watchers, so `pi -p` still exits cleanly.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSkillRefProvider, type ThemeLike } from "./src/autocomplete.js";
import { createModifierProvider } from "./src/modifier-autocomplete.js";
import { listEntries } from "./src/registry.js";
import { registerTryLoadTool } from "./src/tool.js";
import { transformReferences } from "./src/transform-references.js";

export default function skillRefExtension(pi: ExtensionAPI): void {
	// Lazy thunk: read pi's command list on every use, so /reload is picked up
	// with no cache to invalidate.
	const getEntries = () => listEntries(() => pi.getCommands());

	registerTryLoadTool(pi, getEntries);

	// Send-time cash-in, before pi's native skill/prompt expansion. The call is a
	// no-op string round-trip unless the text holds a loadable modifier reference;
	// the first meaningful line's leading reference stays verbatim (P10). Returning
	// only text keeps any attached images untouched.
	pi.on("input", (event) => {
		const transformed = transformReferences(event.text, getEntries());
		return transformed === event.text ? undefined : { action: "transform", text: transformed };
	});

	// Autocomplete wrappers are cleared on /reload, so registration must happen
	// on every session_start rather than once at load time. The modifier layer
	// wraps the name layer: modifier contexts are strictly more specific.
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.addAutocompleteProvider((current) =>
			createModifierProvider(
				createSkillRefProvider(current, getEntries, ctx.ui.theme as unknown as ThemeLike),
				getEntries,
			),
		);
	});
}
