import {
	MY_SETTINGS_CHANNEL,
	type SettingsEventBus,
	type SettingsFailure,
	type SettingsOperation,
	type SettingsQuery,
	type SettingsReady,
	type SettingsRequest,
	type SettingsResult,
	type SettingsSave,
	type SettingsUnset,
} from "./protocol.ts";
import { reportSettingsError, settingsFailure } from "./settings-error.ts";

export function createMySettingsClient(bus: SettingsEventBus, owner: SettingsReady) {
	let session: object = {};
	let sessionId = "";
	let initialFailure: SettingsFailure | undefined;
	try {
		session = owner.session;
		sessionId = owner.sessionId;
		if (!session || typeof session !== "object" || !sessionId || typeof sessionId !== "string") {
			initialFailure = settingsFailure("INVALID_REQUEST", "A session identity and ID are required");
		}
	} catch (error) {
		initialFailure = settingsFailure("INVALID_REQUEST", error);
	}
	async function invoke(operation: SettingsOperation): Promise<SettingsResult> {
		let response: Promise<SettingsResult> | undefined;
		let closed = false;
		try {
			if (initialFailure) return settingsFailure(initialFailure.error.code, initialFailure.error.message);
			const request: SettingsRequest = {
				session,
				sessionId,
				operation,
				accept(result) {
					try {
						const selected = !closed && response === undefined;
						const observed = Promise.resolve(result).catch((error: unknown) => {
							if (!selected) reportSettingsError(error);
							return settingsFailure("OPERATION_FAILED", error);
						});
						if (selected) response = observed;
					} catch (error) {
						reportSettingsError(error);
					}
				},
			};
			bus.emit(MY_SETTINGS_CHANNEL, request);
			if (!response) {
				return settingsFailure(
					"SERVICE_UNAVAILABLE",
					"my-settings service unavailable for this session; please install and enable the my-settings plugin.",
				);
			}
			const returned = await response;
			if (!returned.ok) return settingsFailure(returned.error.code, returned.error.message);
			return { ok: true, values: returned.values };
		} catch (error) {
			return settingsFailure("OPERATION_FAILED", error);
		} finally {
			closed = true;
		}
	}
	return {
		query: (query: SettingsQuery) => invoke({ op: "query", query }),
		saveGlobalOnly: (save: SettingsSave) => invoke({ op: "save-global-only", save }),
		saveLocalOnly: (save: SettingsSave) => invoke({ op: "save-local-only", save }),
		saveGlobalAndSession: (save: SettingsSave) => invoke({ op: "save-global-and-session", save }),
		saveLocalAndSession: (save: SettingsSave) => invoke({ op: "save-local-and-session", save }),
		saveSession: (save: SettingsSave) => invoke({ op: "save-session", save }),
		unsetGlobalOnly: (unset: SettingsUnset) => invoke({ op: "unset-global-only", unset }),
		unsetLocalOnly: (unset: SettingsUnset) => invoke({ op: "unset-local-only", unset }),
		unsetSession: (unset: SettingsUnset) => invoke({ op: "unset-session", unset }),
	};
}
