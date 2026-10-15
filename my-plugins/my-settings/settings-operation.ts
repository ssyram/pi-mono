import { copySettings } from "./json-settings.ts";
import type {
	SettingsOperation,
	SettingsOutcome,
	SettingsPaths,
	SettingsSaveOperation,
	SettingsUnsetOperation,
} from "./protocol.ts";
import { settingsFailure } from "./settings-error.ts";

const SAVE_OPS: ReadonlySet<unknown> = new Set([
	"save-global-only",
	"save-local-only",
	"save-global-and-session",
	"save-local-and-session",
	"save-session",
]);

const UNSET_OPS: ReadonlySet<unknown> = new Set(["unset-global-only", "unset-local-only", "unset-session"]);

function readDataFields(value: unknown, keys: readonly string[]): SettingsOutcome<Record<string, unknown>> {
	try {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			return settingsFailure("INVALID_REQUEST", "Invalid my-settings arguments");
		}
		const fields: Record<string, unknown> = {};
		for (const key of keys) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (descriptor?.get || descriptor?.set)
				return settingsFailure("INVALID_REQUEST", "Settings arguments must contain data properties only");
			fields[key] = descriptor?.value;
		}
		return { ok: true, value: fields };
	} catch (error) {
		return settingsFailure("INVALID_REQUEST", error);
	}
}

function readPaths(input: Record<string, unknown>): SettingsOutcome<SettingsPaths> {
	const paths: SettingsPaths = {};
	for (const key of ["globalPath", "localPath"] as const) {
		const path = input[key];
		if (path !== undefined && path !== null && typeof path !== "string") {
			return settingsFailure("INVALID_REQUEST", `${key} must be a relative file path`);
		}
		paths[key] = path;
	}
	return { ok: true, value: paths };
}

export function parseSettingsOperation(value: unknown): SettingsOutcome<SettingsOperation> {
	try {
		const envelope = readDataFields(value, ["op", "query", "save", "unset"]);
		if (!envelope.ok) return envelope;
		const op = envelope.value.op;
		if (op !== "query" && !SAVE_OPS.has(op) && !UNSET_OPS.has(op)) {
			return settingsFailure("INVALID_REQUEST", "Unknown my-settings operation");
		}
		if (UNSET_OPS.has(op)) {
			const fields = readDataFields(envelope.value.unset, ["globalPath", "localPath", "keys"]);
			if (!fields.ok) return fields;
			const keys = fields.value.keys;
			if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string")) {
				return settingsFailure("INVALID_REQUEST", "Unset requires an array of string keys");
			}
			const paths = readPaths(fields.value);
			if (!paths.ok) return paths;
			return {
				ok: true,
				value: {
					op: op as SettingsUnsetOperation,
					unset: { ...paths.value, keys },
				},
			};
		}
		const fields = readDataFields(op === "query" ? envelope.value.query : envelope.value.save, [
			"globalPath",
			"localPath",
			"scope",
			"defaults",
			"values",
		]);
		if (!fields.ok) return fields;
		const input = fields.value;
		const paths = readPaths(input);
		if (!paths.ok) return paths;
		if (op === "query") {
			const scope = input.scope;
			if (scope !== undefined && scope !== "global" && scope !== "project" && scope !== "session") {
				return settingsFailure("INVALID_REQUEST", "Query scope must be global, project or session");
			}
			const defaults = copySettings(input.defaults);
			if (!defaults.ok) return defaults;
			return {
				ok: true,
				value: {
					op,
					query: { ...paths.value, scope, defaults: defaults.value },
				},
			};
		}
		const values = copySettings(input.values);
		if (!values.ok) return values;
		return {
			ok: true,
			value: {
				op: op as SettingsSaveOperation,
				save: { ...paths.value, values: values.value },
			},
		};
	} catch (error) {
		return settingsFailure("INVALID_REQUEST", error);
	}
}
