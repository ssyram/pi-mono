export { createMySettingsClient } from "./client.ts";
export { default } from "./extension.ts";
export type {
	Settings,
	SettingsErrorCode,
	SettingsEventBus,
	SettingsFailure,
	SettingsOperation,
	SettingsOutcome,
	SettingsPaths,
	SettingsQuery,
	SettingsReady,
	SettingsRequest,
	SettingsResult,
	SettingsSave,
	SettingsSaveOperation,
	SettingsScope,
	SettingsUnset,
	SettingsUnsetOperation,
	SettingValue,
} from "./protocol.ts";
export {
	MY_SETTINGS_CHANNEL,
	MY_SETTINGS_DEFAULT_PATH,
	MY_SETTINGS_ENTRY_TYPE,
	MY_SETTINGS_READY_CHANNEL,
} from "./protocol.ts";
