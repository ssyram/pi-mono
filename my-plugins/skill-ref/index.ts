/**
 * skill-ref — inline SKILL/prompt references.
 *
 * 1. Mid-sentence "/" + Tab completes skills and prompts instead of filesystem paths.
 * 2. try_load_skill_or_prompt turns such a reference into the resource's own text.
 * 3. :print/:path modifiers cash a reference in at send time (appended text or
 *    absolute path); "/name :" opens the subcommand menu automatically.
 * 4. The list follows the disk: a background rescan through pi's own loader swaps
 *    in changes and announces them, without /reload (see src/entry-store.ts).
 *
 * Holds no timers, child processes or watchers between calls, so `pi -p` still
 * exits cleanly.
 */

import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { createSkillRefProvider, type ThemeLike } from "./src/autocomplete.js";
import { createEntryStore } from "./src/entry-store.js";
import { createModifierProvider } from "./src/modifier-autocomplete.js";
import { createRefreshNotice } from "./src/refresh-notice.js";
import { listEntries } from "./src/registry.js";
import { isPinnedSource, rescanResources } from "./src/rescan-resources.js";
import { registerTryLoadTool } from "./src/tool.js";
import { transformReferences } from "./src/transform-references.js";

/** How long a rescan result stays fresh before the next read triggers another one. */
const RESCAN_TTL_MS = 30_000;

export default function skillRefExtension(pi: ExtensionAPI): void {
	// pi's own list, read on every use, so /reload is picked up with no cache to invalidate.
	const read = () => listEntries(() => pi.getCommands());
	const store = createEntryStore({
		read,
		rescan: () =>
			rescanResources({
				cwd: process.cwd(),
				agentDir: getAgentDir(),
				pinnedCommands: () => pi.getCommands().filter((command) => isPinnedSource(command.sourceInfo.source)),
			}),
		ttlMs: RESCAN_TTL_MS,
	});
	const getEntries = () => store.entries();

	registerTryLoadTool(pi, store);

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
	pi.on("session_start", (event, ctx) => {
		store.begin(event.reason, createRefreshNotice(ctx.ui));
		ctx.ui.addAutocompleteProvider((current) =>
			createModifierProvider(
				createSkillRefProvider(current, getEntries, ctx.ui.theme as unknown as ThemeLike),
				getEntries,
			),
		);
	});
}
