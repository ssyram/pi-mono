import type { ScriptResult, WakeUpSetting } from "./task-spec.js";

export function shouldWakeUp(
	setting: WakeUpSetting,
	results: readonly ScriptResult[],
): boolean {
	if (setting.kind === "never") return false;
	if (setting.kind === "always") return true;
	if (results.length === 0) return false;
	return setting.aggregation === "or"
		? results.some((result) => result.status !== "success")
		: results.every((result) => result.status !== "success");
}
