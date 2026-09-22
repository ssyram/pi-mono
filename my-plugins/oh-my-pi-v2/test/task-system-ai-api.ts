import type { Message } from "../../../packages/ai/dist/index.js";

// Source agent-core needs these newer source-only types; the remaining type surface is published.
export type * from "../../../packages/ai/dist/index.js";
export type JsonValue =
	| null
	| boolean
	| number
	| string
	| readonly JsonValue[]
	| { [key: string]: JsonValue };

declare const transcriptContextBrand: unique symbol;
export type TranscriptContext = {
	messages: Message[];
	readonly [transcriptContextBrand]: true;
};
