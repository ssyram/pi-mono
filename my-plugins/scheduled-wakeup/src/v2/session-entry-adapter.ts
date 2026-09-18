import { cloneSessionState, type SessionLoopState } from "./model.js";
import { parseSessionLoopState } from "./session-state-codec.js";
import { emptySessionLoopState, reduceSessionLoopState, type SessionStateAction } from "./session-state-reducer.js";

export const SESSION_LOOP_STATE_ENTRY_TYPE = "scheduled-wakeup/v2/session-state";

export type SessionEntryLike = {
	type: string;
	customType?: string;
	data?: unknown;
};

export type SessionEntryPort = {
	getBranch(): readonly SessionEntryLike[];
	appendEntry(customType: string, data: unknown): void;
};

export class SessionEntryAdapter {
	private state: SessionLoopState;
	private readonly port: SessionEntryPort;

	constructor(port: SessionEntryPort) {
		this.port = port;
		this.state = emptySessionLoopState();
		this.reload();
	}

	reload(): SessionLoopState {
		let recovered = emptySessionLoopState();
		for (const entry of this.port.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== SESSION_LOOP_STATE_ENTRY_TYPE) continue;
			const parsed = parseSessionLoopState(entry.data);
			if (parsed !== undefined) recovered = parsed;
		}
		this.state = cloneSessionState(recovered);
		return this.snapshot();
	}

	snapshot(): SessionLoopState {
		return cloneSessionState(this.state);
	}

	dispatch(action: SessionStateAction): SessionLoopState {
		const next = reduceSessionLoopState(this.state, action);
		const snapshot = cloneSessionState(next);
		this.port.appendEntry(SESSION_LOOP_STATE_ENTRY_TYPE, snapshot);
		this.state = snapshot;
		return this.snapshot();
	}
}
