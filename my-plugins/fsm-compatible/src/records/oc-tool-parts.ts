import { RuntimeError } from "../runtime/runtime-error.ts";
import type { OcToolPart, OcToolState } from "./oc-shapes.ts";

interface CallSource {
	readonly name: string;
	readonly arguments: Record<string, unknown>;
	readonly observedStart: number;
}
interface ResultSource {
	readonly toolName: string;
	readonly texts: readonly string[];
	readonly images: readonly { data: string; mimeType: string }[];
	readonly isError: boolean;
	readonly end: number;
	readonly details: unknown;
	readonly nested: unknown;
}

function readableOutput(texts: readonly string[], images: readonly { mimeType: string }[]): string {
	const text = texts.join("\n");
	const imageNotes = images.map((image) => `[image ${image.mimeType}]`);
	return [text, ...imageNotes].filter((value) => value.length > 0).join("\n");
}

export function projectToolPart(
	sessionId: string,
	entryId: string,
	index: number,
	callId: string,
	call: CallSource,
	result: ResultSource | undefined,
): OcToolPart {
	if (result && result.toolName !== call.name) throw new RuntimeError("protocol-invalid");
	const base = { id: `prt_${entryId}_${index}`, sessionID: sessionId, messageID: `msg_${entryId}` };
	let state: OcToolState;
	if (!result) {
		state = { input: call.arguments, status: "running", time: { start: call.observedStart } };
	} else if (result.isError) {
		state = { input: call.arguments, status: "error", error: readableOutput(result.texts, []) || "tool error",
			time: { start: call.observedStart, end: result.end } };
	} else {
		state = { input: call.arguments, status: "completed", output: readableOutput(result.texts, result.images),
			time: { start: call.observedStart, end: result.end } };
	}
	const pi: Record<string, unknown> = { startIsObservation: true };
	if (result) {
		if (result.details !== undefined) pi.details = result.details;
		if (result.nested !== undefined) pi.nestedCalls = result.nested;
		pi.rawContent = [...result.texts, ...result.images];
	}
	return { type: "tool", ...base, tool: call.name, callID: callId, state,
		metadata: { pi: Object.freeze(pi) } };
}

export type { CallSource, ResultSource };
