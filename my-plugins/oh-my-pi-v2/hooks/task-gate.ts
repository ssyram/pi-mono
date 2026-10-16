import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { SettingsFailure } from "../../my-settings/protocol.ts";
import { describeThrown } from "../boulder-inhibition/describe-error.js";
import { reportBoulderDiagnostic } from "../boulder-inhibition/report-error.js";
import {
	type TaskAdmissionReadState,
	taskAdmission,
	taskAvailabilityProblem,
} from "../tools/task-system/admission.js";

export function registerTaskGate(
	pi: ExtensionAPI,
	getTaskState: (context: ExtensionContext) => TaskAdmissionReadState,
	isEnabled: (
		context: ExtensionContext,
	) => boolean | SettingsFailure | Promise<boolean | SettingsFailure>,
): void {
	pi.on("tool_call", async (event, context) => {
		if (event.toolName === "task") return undefined;
		try {
			const enabled = await isEnabled(context);
			if (typeof enabled !== "boolean")
				return { block: true, reason: enabled.error.message };
			if (!enabled) return undefined;
		} catch (error) {
			reportBoulderDiagnostic(
				`[oh-my-pi task] Gate setting unavailable: ${describeThrown(error)}; keeping the gate enabled.`,
			);
		}
		try {
			const state = getTaskState(context);
			if ("error" in state) return { block: true, reason: state.error };
			return taskAdmission(event.toolName, () => state.tasks);
		} catch {
			return {
				block: true,
				reason:
					"Task state could not be checked. Non-task tool refused; use task to inspect or restore state.",
			};
		}
	});
	pi.on("session_start", async (_event, context) => {
		try {
			const enabled = await isEnabled(context);
			if (typeof enabled !== "boolean") {
				reportBoulderDiagnostic(`[oh-my-pi task] ${enabled.error.message}`);
				return;
			}
			if (!enabled) return;
			const names = [
				...pi.getActiveTools(),
				...pi.getAllTools().map((tool) => tool.name),
			];
			const problem = taskAvailabilityProblem(names);
			if (problem) reportBoulderDiagnostic(`[oh-my-pi task] ${problem}`);
		} catch (error) {
			reportBoulderDiagnostic(
				`[oh-my-pi task] Task gate availability check failed: ${describeThrown(error)}`,
			);
		}
	});
}
