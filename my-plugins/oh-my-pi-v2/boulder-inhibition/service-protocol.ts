import type {
	BoulderInhibitSignal,
	BoulderInhibitionEffects,
	BoulderInhibitionPort,
	BoulderInhibitionSnapshot,
} from "./protocol.ts";

export const BOULDER_INHIBITION_SERVICE_CHANNEL = "omp:boulder:inhibition:v1";
export const BOULDER_INHIBITION_READY_CHANNEL = "omp:boulder:inhibition-ready:v1";

export interface BoulderInhibitionEventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

export type BoulderInhibitionOperation = { op: "get" } | { op: "set"; signal: BoulderInhibitSignal };

export interface BoulderInhibitionFailure {
	message: string;
	cause?: unknown;
}

export type BoulderClientResult =
	| { ok: true; snapshot: BoulderInhibitionSnapshot }
	| { ok: false; failure: BoulderInhibitionFailure };

export type BoulderInhibitionServiceResponse = BoulderClientResult;

export type BoulderInhibitionServiceRequest = BoulderInhibitionOperation & {
	session: object;
	reply(result: BoulderInhibitionServiceResponse): void;
};

export interface BoulderInhibitionClient {
	get(): BoulderClientResult;
	set(signal: BoulderInhibitSignal): BoulderClientResult;
}

export interface BoulderInhibitionServiceBinding {
	port: BoulderInhibitionPort;
	effects: BoulderInhibitionEffects;
}

export type BoulderInhibitionSessionResolver = (
	session: object,
) => BoulderInhibitionServiceBinding | undefined;
