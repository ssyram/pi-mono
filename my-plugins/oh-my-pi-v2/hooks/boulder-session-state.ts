import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CountdownHandle } from "./boulder-countdown.js";

export interface BoulderEpisode {
	key: string;
	attemptsSent: number;
}

export interface BoulderActiveWait {
	episodeKey: string;
	externalInputEpoch: number;
	attempt: number;
	handle: CountdownHandle;
}

export interface BoulderSessionState {
	externalInputEpoch: number;
	episode?: BoulderEpisode;
	activeWait?: BoulderActiveWait;
	lastAbortTime: number;
	lastCompactionTime: number;
}

function initialState(): BoulderSessionState {
	return {
		externalInputEpoch: 0,
		lastAbortTime: 0,
		lastCompactionTime: 0,
	};
}

export interface BoulderSessionStateStore {
	get(context: ExtensionContext): BoulderSessionState;
	cancelWait(context: ExtensionContext): void;
	markExternalInformation(context: ExtensionContext): void;
	reset(context: ExtensionContext): void;
	remove(context: ExtensionContext): void;
}

export function createBoulderSessionStateStore(): BoulderSessionStateStore {
	const states = new WeakMap<ExtensionContext["sessionManager"], BoulderSessionState>();
	const get = (context: ExtensionContext): BoulderSessionState => {
		const existing = states.get(context.sessionManager);
		if (existing) return existing;
		const created = initialState();
		states.set(context.sessionManager, created);
		return created;
	};
	const cancelWait = (context: ExtensionContext): void => {
		const state = get(context);
		state.activeWait?.handle.cancel();
		state.activeWait = undefined;
	};

	return {
		get,
		cancelWait,
		markExternalInformation(context) {
			const state = get(context);
			cancelWait(context);
			state.externalInputEpoch += 1;
			state.episode = undefined;
		},
		reset(context) {
			cancelWait(context);
			states.set(context.sessionManager, initialState());
		},
		remove(context) {
			cancelWait(context);
			states.delete(context.sessionManager);
		},
	};
}
