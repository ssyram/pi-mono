import { copyToClipboard, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

import { attachClearAction } from "./attach-clear-action.js";

export default function clearToClipboard(pi: ExtensionAPI): void {
	const clearActions = new WeakMap<ExtensionContext["sessionManager"], () => void>();
	pi.registerShortcut(Key.ctrlAlt("c"), {
		description: "Clear editor without copying",
		handler: (ctx) => clearActions.get(ctx.sessionManager)?.(),
	});
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const { release, clearOnly } = attachClearAction(ctx.ui, copyToClipboard);
		clearActions.set(ctx.sessionManager, clearOnly);
		const stop = pi.on("session_shutdown", (_event, shutdownCtx) => {
			if (shutdownCtx.sessionManager !== ctx.sessionManager) return;
			release();
			clearActions.delete(ctx.sessionManager);
			stop();
		});
	});
}
