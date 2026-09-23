import { sanitizeDisplayText } from "./sanitize-display-text.js";
import type { DisplayState } from "./usage-contract.js";

export function formatDisplayState(state: DisplayState): string | undefined {
	if (state.kind === "empty") return undefined;
	if (state.kind === "loading") return "(…)";
	if (state.result.kind === "not-applicable") return undefined;
	if (state.result.kind === "unsupported") return "(N/S)";
	if (state.result.kind === "available") {
		const text = sanitizeDisplayText(state.result.compact);
		return text ? `(${text}${state.staleError ? " (err)" : ""})` : "(ERR)";
	}
	if (state.result.code === "auth") return "(AUTH)";
	if (state.result.code === "timeout") return "(TIMEOUT)";
	return "(ERR)";
}
