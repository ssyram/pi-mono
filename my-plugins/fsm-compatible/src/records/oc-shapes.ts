export interface OcTime {
	readonly created: number;
	readonly completed?: number;
}
export interface OcError {
	readonly name: string;
	readonly data: Record<string, unknown>;
}
export interface OcInfo {
	readonly role: "user" | "assistant";
	readonly id: string;
	readonly sessionID: string;
	readonly time: OcTime;
	readonly finish?: "stop" | "tool-calls" | "length" | "error";
	readonly error?: OcError;
}
interface OcPartBase {
	readonly id: string;
	readonly sessionID: string;
	readonly messageID: string;
}
export interface OcTextPart extends OcPartBase {
	readonly type: "text";
	readonly text: string;
}
export interface OcReasoningPart extends OcPartBase {
	readonly type: "reasoning";
	readonly text: string;
}
export interface OcFilePart extends OcPartBase {
	readonly type: "file";
	readonly mime: string;
	readonly url: string;
}
export interface OcToolState {
	readonly input: Record<string, unknown>;
	readonly status: "pending" | "running" | "completed" | "error";
	readonly output?: string;
	readonly error?: string;
	readonly time: { readonly start: number; readonly end?: number };
}
export interface OcToolPart extends OcPartBase {
	readonly type: "tool";
	readonly tool: string;
	readonly callID: string;
	readonly state: OcToolState;
	readonly metadata?: { readonly pi?: Record<string, unknown> };
}
export type OcPart = OcTextPart | OcReasoningPart | OcFilePart | OcToolPart;
export interface OcMessage {
	readonly info: OcInfo;
	readonly parts: readonly OcPart[];
	readonly metadata?: { readonly pi?: Record<string, unknown> };
}
