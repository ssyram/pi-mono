import { homedir } from "node:os";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { LoopV2Core } from "./v2/loop-core.js";
import type { SessionEntryPort } from "./v2/session-entry-adapter.js";

export function createLoopCore(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): LoopV2Core {
	const sessionEntries: SessionEntryPort = {
		getBranch: () => ctx.sessionManager.getBranch(),
		appendEntry: (customType, data) => pi.appendEntry(customType, data),
	};
	return new LoopV2Core({
		sessionId: ctx.sessionManager.getSessionId(),
		sessionEntries,
		workspaceRoot: ctx.cwd,
		globalRoot: homedir(),
	});
}
