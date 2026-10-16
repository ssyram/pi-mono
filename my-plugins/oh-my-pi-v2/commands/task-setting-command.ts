import type { TaskSettingTargets } from "../task-settings.js";

export type TaskSettingCommand =
	| { action: "show"; visible: boolean; targets: TaskSettingTargets }
	| {
			action: "no-task-no-tool";
			enabled: boolean;
			targets: TaskSettingTargets;
	  };

export function parseTaskSettingCommand(
	tokens: string[],
): TaskSettingCommand | undefined {
	const [action, value, ...flags] = tokens;
	if (action !== "show" && action !== "no-task-no-tool") return;
	if (value !== "on" && value !== "off") return;
	if (
		new Set(flags).size !== flags.length ||
		flags.some((flag) => flag !== "--persistent" && flag !== "--global")
	)
		return;
	const targets: TaskSettingTargets = {};
	if (flags.includes("--persistent")) targets.persistent = true;
	if (flags.includes("--global")) targets.global = true;
	return action === "show"
		? { action, visible: value === "on", targets }
		: { action, enabled: value === "on", targets };
}
