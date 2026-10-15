import {
	MY_SETTINGS_CHANNEL,
	type SettingsEventBus,
	type SettingsOutcome,
	type SettingsResult,
	type SettingsSession,
} from "./protocol.ts";
import { reportSettingsError, settingsFailure } from "./settings-error.ts";
import type { SettingsMutationQueue } from "./settings-files.ts";
import { parseSettingsOperation } from "./settings-operation.ts";
import { executeSettingsQuery } from "./settings-query.ts";
import { executeSettingsSave, executeSettingsUnset } from "./settings-save.ts";

export function registerMySettingsService(
	bus: SettingsEventBus,
	resolveSession: (session: object, sessionId: string) => SettingsOutcome<SettingsSession | undefined>,
	globalRoot: string,
	queue: SettingsMutationQueue,
): SettingsOutcome<() => SettingsOutcome<void>> {
	try {
		const dispose = bus.on(MY_SETTINGS_CHANNEL, (data) => {
			let accept: ((response: Promise<SettingsResult>) => void) | undefined;
			try {
				if (!data || typeof data !== "object" || !("accept" in data) || typeof data.accept !== "function") return;
				accept = data.accept.bind(data) as (response: Promise<SettingsResult>) => void;
				if (!("session" in data) || !data.session || typeof data.session !== "object" || Array.isArray(data.session)) {
					accept(Promise.resolve(settingsFailure("INVALID_REQUEST", "A session identity is required")));
					return;
				}
				if (!("sessionId" in data) || typeof data.sessionId !== "string" || !data.sessionId) {
					accept(Promise.resolve(settingsFailure("INVALID_REQUEST", "A session ID is required")));
					return;
				}
				const session = resolveSession(data.session, data.sessionId);
				if (!session.ok) {
					accept(Promise.resolve(session));
					return;
				}
				if (!session.value) {
					accept(Promise.resolve(settingsFailure("SESSION_UNAVAILABLE", "no active session for this identity")));
					return;
				}
				const operation = parseSettingsOperation("operation" in data ? data.operation : undefined);
				let result: Promise<SettingsResult>;
				if (!operation.ok) {
					result = Promise.resolve(operation);
				} else {
					const parsed = operation.value;
					if (parsed.op === "query") {
						result = executeSettingsQuery(parsed.query, session.value, globalRoot);
					} else if ("unset" in parsed) {
						result = executeSettingsUnset(parsed.op, parsed.unset, session.value, globalRoot, queue);
					} else {
						result = executeSettingsSave(parsed.op, parsed.save, session.value, globalRoot, queue);
					}
				}
				accept(result);
			} catch (error) {
				try {
					accept?.(Promise.resolve(settingsFailure("OPERATION_FAILED", error)));
				} catch (replyError) {
					reportSettingsError(replyError);
				}
			}
		});
		return {
			ok: true,
			value: () => {
				try {
					dispose();
					return { ok: true, value: undefined };
				} catch (error) {
					return settingsFailure("OPERATION_FAILED", error);
				}
			},
		};
	} catch (error) {
		return settingsFailure("OPERATION_FAILED", error);
	}
}
