/**
 * /omp-ultrawork — Enable/disable UltraWork maximalist execution mode.
 *
 * State is persisted as a session-log custom entry ("omp-ultrawork-state").
 * Reading state back happens in hooks/ultrawork-prompt.ts via ctx.sessionManager.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

export const ULTRAWORK_ENTRY_TYPE = "omp-ultrawork-state";

export interface UltraWorkStateData {
	enabled: boolean;
	activatedAt: string;
}

export function registerUltrawork(pi: ExtensionAPI): void {
	pi.registerCommand("ultrawork", {
		description: "Enable/disable UltraWork maximalist execution mode",
		handler: async (args: string, _ctx: ExtensionCommandContext) => {
			const input = args.trim();

			if (input === "off") {
				pi.appendEntry<UltraWorkStateData>(ULTRAWORK_ENTRY_TYPE, {
					enabled: false,
					activatedAt: new Date().toISOString(),
				});
				pi.sendUserMessage("[UltraWork mode disabled]");
				return;
			}

			const message = input.startsWith("off ") ? input.slice(4) : input;
			pi.appendEntry<UltraWorkStateData>(ULTRAWORK_ENTRY_TYPE, {
				enabled: true,
				activatedAt: new Date().toISOString(),
			});
			pi.sendUserMessage(
				`[UltraWork mode enabled]${message ? `\n${message}` : ""}`,
			);
		},
	});
}
