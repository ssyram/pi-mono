import type { SettingsErrorCode, SettingsFailure } from "./protocol.ts";

export function settingsFailure(code: SettingsErrorCode, error: unknown): SettingsFailure {
	let message = "Unknown settings error";
	try {
		const value: unknown = error instanceof Error ? error.message : error;
		message = typeof value === "string" ? value : String(value);
	} catch {}
	return { ok: false, error: { code, message } };
}

export function reportSettingsError(error: unknown): void {
	try {
		console.error(`[my-settings] ${settingsFailure("OPERATION_FAILED", error).error.message}`);
	} catch {}
}
