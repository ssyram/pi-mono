import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RootHealth } from "./root-health.ts";

export function installNotReadyGate(pi: ExtensionAPI, health: RootHealth, diagnostic: () => string): () => void {
	const offInput = pi.on("input", (_event, ctx) => {
		if (health.ready) return undefined;
		ctx.ui.notify(diagnostic(), "error");
		return { action: "handled" };
	});
	const offTool = pi.on("tool_call", () => health.ready ? undefined : { block: true, reason: diagnostic() });
	return () => { offInput(); offTool(); };
}
