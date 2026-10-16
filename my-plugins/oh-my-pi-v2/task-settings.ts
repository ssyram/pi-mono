import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createMySettingsClient } from "../my-settings/client.ts";
import type {
	SettingsFailure,
	SettingsOutcome,
} from "../my-settings/protocol.ts";
import { describeThrown } from "./boulder-inhibition/describe-error.js";

export const TASK_SETTING_DEFAULTS = {
	"omp-task:no-task-no-tool": true,
	"omp-task:show": true,
};
export type TaskSettingKey = keyof typeof TASK_SETTING_DEFAULTS;
export interface TaskSettingTargets {
	persistent?: boolean;
	global?: boolean;
}
export interface TaskSettingChange {
	ok: boolean;
	applied: boolean;
	message: string;
}

export function createTaskSettings(pi: Pick<ExtensionAPI, "events">) {
	function client(context: ExtensionContext) {
		return createMySettingsClient(pi.events, {
			session: context.sessionManager,
			sessionId: context.sessionManager.getSessionId(),
		});
	}
	async function read(
		context: ExtensionContext,
		key: TaskSettingKey,
	): Promise<SettingsOutcome<boolean>> {
		try {
			const result = await client(context).query({
				defaults: TASK_SETTING_DEFAULTS,
			});
			if (!result.ok) return result;
			const value = result.values[key];
			if (typeof value === "boolean") return { ok: true, value };
			return {
				ok: false,
				error: { code: "OPERATION_FAILED", message: `Invalid setting ${key}` },
			};
		} catch (error) {
			return {
				ok: false,
				error: { code: "OPERATION_FAILED", message: describeThrown(error) },
			};
		}
	}
	return {
		read,
		async isEnabled(
			context: ExtensionContext,
		): Promise<boolean | SettingsFailure> {
			const result = await read(context, "omp-task:no-task-no-tool");
			return result.ok ? result.value : result;
		},
		async set(
			context: ExtensionContext,
			key: TaskSettingKey,
			value: boolean,
			targets: TaskSettingTargets = {},
		): Promise<TaskSettingChange> {
			try {
				const settings = client(context);
				const save = { values: { [key]: value } };
				const saved: string[] = [];
				const failures: string[] = [];
				if (targets.persistent) {
					const result = await settings.saveLocalOnly(save);
					if (result.ok) saved.push("local");
					else failures.push(`local: ${result.error.message}`);
				}
				if (targets.global) {
					const result = await settings.saveGlobalOnly(save);
					if (result.ok) saved.push("global");
					else failures.push(`global: ${result.error.message}`);
				}
				const result = await settings.saveSession(save);
				if (!result.ok) {
					failures.push(`session: ${result.error.message}`);
					return {
						ok: false,
						applied: false,
						message: `Task setting failed. ${failures.join("; ")}. File or session writes may already have taken effect; no rollback claimed.`,
					};
				}
				return {
					ok: failures.length === 0,
					applied: true,
					message: `${key}=${value ? "on" : "off"} applied to session${saved.length ? `; saved to ${saved.join(" and ")}` : ""}.${failures.length ? ` Not saved to ${failures.join("; ")}.` : ""}`,
				};
			} catch (error) {
				return {
					ok: false,
					applied: false,
					message: `Task setting failed: ${describeThrown(error)}. State may already have changed.`,
				};
			}
		},
	};
}
