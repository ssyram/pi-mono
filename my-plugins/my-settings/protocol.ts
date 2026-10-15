export const MY_SETTINGS_CHANNEL = "my-settings:service:v1";
export const MY_SETTINGS_READY_CHANNEL = "my-settings:ready:v1";
export const MY_SETTINGS_ENTRY_TYPE = "my-settings-v1";
export const MY_SETTINGS_DEFAULT_PATH = "settings.json";

export type SettingValue = null | boolean | number | string | SettingValue[] | { [key: string]: SettingValue };
export type Settings = Record<string, SettingValue>;
export type SettingsScope = "global" | "project" | "session";

export interface SettingsPaths {
	globalPath?: string | null;
	localPath?: string | null;
}

export interface SettingsQuery extends SettingsPaths {
	defaults: Settings;
	scope?: SettingsScope;
}

export interface SettingsSave extends SettingsPaths {
	values: Settings;
}

export interface SettingsUnset extends SettingsPaths {
	keys: string[];
}

export type SettingsSaveOperation =
	| "save-global-only"
	| "save-local-only"
	| "save-global-and-session"
	| "save-local-and-session"
	| "save-session";

export type SettingsUnsetOperation = "unset-global-only" | "unset-local-only" | "unset-session";

export type SettingsOperation =
	| { op: "query"; query: SettingsQuery }
	| { op: SettingsSaveOperation; save: SettingsSave }
	| { op: SettingsUnsetOperation; unset: SettingsUnset };

export type SettingsErrorCode = "SERVICE_UNAVAILABLE" | "SESSION_UNAVAILABLE" | "INVALID_REQUEST" | "OPERATION_FAILED";

export interface SettingsFailure {
	ok: false;
	error: { code: SettingsErrorCode; message: string };
}

export type SettingsOutcome<T> = { ok: true; value: T } | SettingsFailure;
export type SettingsResult = { ok: true; values: Settings } | SettingsFailure;

export interface SettingsRequest {
	session: object;
	sessionId: string;
	operation: SettingsOperation;
	accept(response: Promise<SettingsResult>): void;
}

export interface SettingsEventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

export interface SettingsEntry {
	type: string;
	customType?: string;
	data?: unknown;
}

export interface SettingsLog {
	values?: Settings;
	removed?: string[];
}

export interface SettingsSession {
	cwd: string;
	isCurrent(): SettingsOutcome<boolean>;
	getBranch(): SettingsOutcome<readonly SettingsEntry[]>;
	appendEntry(customType: string, data: SettingsLog): SettingsOutcome<void>;
}

export interface SettingsReady {
	session: object;
	sessionId: string;
}
