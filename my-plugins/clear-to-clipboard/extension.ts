import { copyToClipboard, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { attachClearAction } from "./attach-clear-action.js";

export default function clearToClipboard(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const release = attachClearAction(ctx.ui, copyToClipboard);
		const stop = pi.on("session_shutdown", () => {
			release();
			stop();
		});
	});
}
