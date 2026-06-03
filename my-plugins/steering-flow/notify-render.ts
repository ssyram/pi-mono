import type { FSMRuntime } from "./types.js";

export function renderNotifyInfo(text: string): string {
	return text.length > 4000 ? `${text.slice(0, 3990)}…` : text;
}

export function renderInteractivePause(rt: FSMRuntime): string {
	return renderNotifyInfo(renderManualInfo("Interactive steering-flow pause", rt));
}

export function renderManualInfo(header: string, rt: FSMRuntime): string {
	const state = rt.states[rt.current_state_id];
	const lines: string[] = [];
	lines.push(`## ${header}`);
	lines.push(`- Flow: ${rt.flow_name}`);
	lines.push(`- FSM: ${rt.fsm_id}`);
	lines.push(`- Task: ${rt.task_description}`);
	lines.push(`- Current state: ${rt.current_state_id}`);
	if (state) {
		lines.push(`- State: ${state.state_desc}`);
		if (state.interactive) lines.push("- Mode: interactive gated pause");
		if (state.actions.length > 0) {
			lines.push("- Available actions:");
			for (const action of state.actions) {
				const args = action.arguments.map((arg) => `<${arg.arg_name}>`).join(" ");
				lines.push(`  - ${action.action_id}${args ? ` ${args}` : ""}: ${action.action_desc}`);
			}
		}
	}
	lines.push("- This notification was not sent to the model context.");
	return lines.join("\n");
}
