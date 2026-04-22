export interface ActionArg {
	arg_name: string;
	arg_desc: string;
}

/**
 * A condition is either the "default transition" marker (only valid as the
 * last action of an epsilon state) or a concrete command invocation with
 * fixed positional args.
 *
 * If a condition script needs the tape file, reference it explicitly via
 * the `${$TAPE_FILE}` interpolation token in the `args` array.
 *
 * Stdout contract: first line is "true" or "false"; remaining lines are
 * the human-readable reason.
 */
export type Condition =
	| { default: true }
	| { cmd: string; args?: string[] };

export interface Action {
	action_id: string;
	action_desc: string;
	arguments: ActionArg[];
	condition: Condition;
	next_state_id: string;
}

export interface State {
	state_id: string;
	state_desc: string;
	is_epsilon: boolean;
	actions: Action[];
}

export interface FlowConfig {
	task_description: string;
	states: State[];
}

export interface ParsedFSM {
	task_description: string;
	states: Map<string, State>;
}

export interface FSMRuntime {
	fsm_id: string;
	flow_name: string;
	/** Directory of the flow config file; relative cmd/args in conditions resolve against this. */
	flow_dir: string;
	task_description: string;
	states: Record<string, State>;
	current_state_id: string;
	tape: Record<string, TapeValue>;
	transition_log: TransitionRecord[];
}

export interface TransitionRecord {
	from: string;
	to: string;
	action_id: string;
	reason: string;
	timestamp: string;
}

/** Tape values can be any JSON-serializable value; the plugin does not interpret them. */
export type TapeValue = string | number | boolean | null | TapeValue[] | { [key: string]: TapeValue };

export interface TransitionResult {
	success: boolean;
	chain: TransitionRecord[];
	final_state_id: string;
	reasons: string[];
	reached_end: boolean;
	end_desc?: string;
}
