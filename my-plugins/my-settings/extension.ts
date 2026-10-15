import {
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { MY_SETTINGS_READY_CHANNEL, type SettingsReady } from "./protocol.ts";
import { registerMySettingCommand } from "./setting-command.ts";
import { reportSettingsError, settingsFailure } from "./settings-error.ts";
import { registerMySettingsService } from "./settings-service.ts";

export default function mySettings(pi: ExtensionAPI): void {
	let active: { context: ExtensionContext; sessionId: string } | undefined;
	try {
		const registration = registerMySettingsService(
			pi.events,
			(session, sessionId) => {
				try {
					const owner = active;
					if (!owner || owner.context.sessionManager !== session || owner.sessionId !== sessionId) {
						return { ok: true, value: undefined };
					}
					return {
						ok: true,
						value: {
							cwd: owner.context.cwd,
							isCurrent() {
								try {
									return {
										ok: true,
										value: active === owner && owner.context.sessionManager.getSessionId() === sessionId,
									};
								} catch (error) {
									return settingsFailure("OPERATION_FAILED", error);
								}
							},
							getBranch() {
								try {
									return {
										ok: true,
										value: owner.context.sessionManager.getBranch(),
									};
								} catch (error) {
									return settingsFailure("OPERATION_FAILED", error);
								}
							},
							appendEntry(type, data) {
								try {
									pi.appendEntry(type, data);
									return { ok: true, value: undefined };
								} catch (error) {
									return settingsFailure("OPERATION_FAILED", error);
								}
							},
						},
					};
				} catch (error) {
					return settingsFailure("OPERATION_FAILED", error);
				}
			},
			getAgentDir(),
			withFileMutationQueue,
		);
		if (!registration.ok) {
			reportSettingsError(registration.error.message);
			return;
		}
		const bind = (_event: unknown, context: ExtensionContext): void => {
			try {
				active = { context, sessionId: context.sessionManager.getSessionId() };
				const ready: SettingsReady = {
					session: context.sessionManager,
					sessionId: active.sessionId,
				};
				pi.events.emit(MY_SETTINGS_READY_CHANNEL, ready);
			} catch (error) {
				active = undefined;
				reportSettingsError(error);
			}
		};
		pi.on("session_start", bind);
		pi.on("session_tree", bind);
		pi.on("session_shutdown", () => {
			active = undefined;
		});
	} catch (error) {
		active = undefined;
		reportSettingsError(error);
	}
	registerMySettingCommand(pi);
}
