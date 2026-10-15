import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createMySettingsClient } from "./client.ts";
import type { SettingsEventBus, SettingsResult, SettingValue } from "./protocol.ts";
import { runSettingGet, type SettingCommandSession } from "./setting-command-get.ts";
import { MY_SETTING_HELP, type ParsedSettingCommand, parseSettingCommand } from "./setting-command-parse.ts";
import { reportSettingsError } from "./settings-error.ts";

function report(context: ExtensionCommandContext, text: string, tone: "info" | "warning"): void {
	try {
		if (context.hasUI) context.ui.notify(text, tone);
		else console.log(text);
	} catch {
		try {
			console.log(text);
		} catch {}
	}
}

function sessionIdentity(context: ExtensionCommandContext): SettingCommandSession | string {
	try {
		const manager = (
			context as unknown as {
				sessionManager?: { getSessionId?: () => unknown };
			}
		).sessionManager;
		const sessionId = manager?.getSessionId?.();
		if (manager && typeof sessionId === "string" && sessionId) return { session: manager, sessionId };
		return "无法取得当前会话身份；/my-setting 需要活动会话。";
	} catch (error) {
		return `无法取得当前会话身份：${error instanceof Error ? error.message : String(error)}`;
	}
}

async function runSet(
	bus: SettingsEventBus,
	identity: SettingCommandSession,
	command: Extract<ParsedSettingCommand, { kind: "set" }>,
): Promise<string[]> {
	let parsed: SettingValue;
	try {
		parsed = JSON.parse(command.valueText) as SettingValue;
	} catch (error) {
		return [
			`VAL 不是合法 JSON 值：${command.valueText}`,
			`JSON.parse 失败：${error instanceof Error ? error.message : String(error)}`,
			'字符串请带引号（"true" 是字符串，true 是布尔）。',
		];
	}
	const client = createMySettingsClient(bus, identity);
	const save = {
		values: { [command.key]: parsed },
		globalPath: command.paths.globalFile,
		localPath: command.paths.localFile,
	};
	const lines: string[] = [];
	for (const scope of command.scopes) {
		const result: SettingsResult =
			scope === "global"
				? await client.saveGlobalOnly(save)
				: scope === "local"
					? await client.saveLocalOnly(save)
					: await client.saveSession(save);
		lines.push(
			result.ok
				? `save-${scope}-only ok  ${command.key} = ${JSON.stringify(parsed)}`
				: `save-${scope}-only FAILED  ${result.error.code}: ${result.error.message}`,
		);
	}
	return lines;
}

async function runUnset(
	bus: SettingsEventBus,
	identity: SettingCommandSession,
	command: Extract<ParsedSettingCommand, { kind: "unset" }>,
): Promise<string[]> {
	const client = createMySettingsClient(bus, identity);
	const unset = {
		keys: command.keys,
		globalPath: command.paths.globalFile,
		localPath: command.paths.localFile,
	};
	const lines: string[] = [];
	for (const scope of command.scopes) {
		const result =
			scope === "global"
				? await client.unsetGlobalOnly(unset)
				: scope === "local"
					? await client.unsetLocalOnly(unset)
					: await client.unsetSession(unset);
		lines.push(
			result.ok
				? `unset-${scope}-only ok  ${command.keys.join(", ")}`
				: `unset-${scope}-only FAILED  ${result.error.code}: ${result.error.message}`,
		);
	}
	return lines;
}

export function registerMySettingCommand(pi: ExtensionAPI): void {
	pi.registerCommand("my-setting", {
		description: "Manual e2e surface for the my-settings service (set/get, no model tool)",
		handler: async (args, context) => {
			try {
				const command = parseSettingCommand(args);
				if (command.kind === "help") {
					report(context, MY_SETTING_HELP, "info");
					return;
				}
				if (command.kind === "error") {
					report(context, `${command.message}\n\n${MY_SETTING_HELP}`, "warning");
					return;
				}
				const identity = sessionIdentity(context);
				if (typeof identity === "string") {
					report(context, identity, "warning");
					return;
				}
				const lines =
					command.kind === "set"
						? await runSet(pi.events, identity, command)
						: command.kind === "unset"
							? await runUnset(pi.events, identity, command)
							: await runSettingGet(pi.events, identity, context, command.paths, command.keys);
				report(context, lines.join("\n"), lines.some((line) => line.includes("FAILED")) ? "warning" : "info");
			} catch (error) {
				reportSettingsError(error);
			}
		},
	});
}
