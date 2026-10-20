import { existsSync, statSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function sessionPersistenceError(
	ctx: ExtensionContext,
): string | undefined {
	const file = ctx.sessionManager.getSessionFile();
	if (file !== undefined && existsSync(file) && statSync(file).isFile())
		return undefined;
	return "This session has not been saved yet. Send a real message before creating persistent Loop tasks.";
}
