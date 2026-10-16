import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describeThrown } from "../boulder-inhibition/describe-error.js";
import { reportBoulderDiagnostic } from "../boulder-inhibition/report-error.js";
import { BOULDER_INHIBITION_READY_CHANNEL } from "../boulder-inhibition/service-protocol.js";
import { registerBoulderInhibitionService } from "../boulder-inhibition/service.js";
import { appendBoulderInfoEntry } from "./boulder-info-entry.js";

export function registerBoulderInhibitionAdapter(
	pi: ExtensionAPI,
	cancelWait: (context: ExtensionContext) => void,
): () => void {
	let current: ExtensionContext | undefined;
	const disposeService = registerBoulderInhibitionService(pi.events, (session) => {
		const context = current;
		if (!context || context.sessionManager !== session) return undefined;
		return {
			port: {
				getBranch: () => context.sessionManager.getBranch(),
				appendEntry: (customType, data) => pi.appendEntry(customType, data),
			},
			effects: {
				cancelWait: () => cancelWait(context),
				reportInfo: (text) => appendBoulderInfoEntry(pi, { tone: "info", text }),
			},
		};
	});
	const bind = (_event: unknown, context: ExtensionContext): void => {
		try {
			current = context;
			pi.events.emit(BOULDER_INHIBITION_READY_CHANNEL, { session: context.sessionManager });
		} catch (error) {
			reportBoulderDiagnostic(`[oh-my-pi boulder] Service binding failed: ${describeThrown(error)}`);
		}
	};
	pi.on("session_start", bind);
	pi.on("session_tree", bind);
	pi.on("session_shutdown", () => { current = undefined; });
	return () => {
		current = undefined;
		try {
			disposeService();
		} catch (error) {
			reportBoulderDiagnostic(`[oh-my-pi boulder] Service cleanup failed: ${describeThrown(error)}`);
		}
	};
}
