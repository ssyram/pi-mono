import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function notifyLoop(
	ctx: ExtensionContext,
	message: string,
	type: "info" | "warning" | "error",
): void {
	try {
		if (ctx.hasUI) ctx.ui.notify(message, type);
	} catch {
		// Notification failure cannot change the operation's outcome.
	}
}
