import type { Action, Condition, State } from "../types.js";
import type { VisualizerAction, VisualizerState } from "./types.js";

function summarizeCondition(condition: Condition): string {
	if ("default" in condition) return "default";
	const parts = [condition.cmd, ...(condition.args ?? [])];
	return parts.join(" ");
}

function detailCondition(condition: Condition): string {
	if ("default" in condition) return "{ default: true }";
	return JSON.stringify(condition, null, 2);
}

function toVisualizerAction(action: Action): VisualizerAction {
	return {
		id: action.action_id,
		description: action.action_desc,
		nextStateId: action.next_state_id,
		arguments: action.arguments.map((arg) => ({
			name: arg.arg_name,
			description: arg.arg_desc,
		})),
		conditionSummary: summarizeCondition(action.condition),
		conditionDetail: detailCondition(action.condition),
		isDefault: "default" in action.condition,
	};
}

export function toVisualizerState(state: State): VisualizerState {
	return {
		id: state.state_id,
		description: state.state_desc,
		isEpsilon: state.is_epsilon,
		actions: state.actions.map(toVisualizerAction),
	};
}
