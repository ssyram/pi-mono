import { writeState, loadRuntime } from "./storage.js";

export async function manualSetState(sessionDir: string, fsmId: string, stateId: string): Promise<string> {
	const rt = await loadRuntime(sessionDir, fsmId);
	if (!rt) return `❌ Could not load runtime for FSM '${fsmId}'`;
	if (!rt.states[stateId]) return `❌ State '${stateId}' does not exist in flow '${rt.flow_name}'.`;
	const from = rt.current_state_id;
	rt.current_state_id = stateId;
	rt.transition_log = [{
		from,
		to: stateId,
		action_id: "manual_set_state",
		reason: "Manual state set by user command",
		timestamp: new Date().toISOString(),
	}];
	await writeState(sessionDir, fsmId, rt.current_state_id, rt.transition_log);
	return `✅ Set steering-flow '${rt.flow_name}' from state '${from}' to state '${stateId}'.`;
}
