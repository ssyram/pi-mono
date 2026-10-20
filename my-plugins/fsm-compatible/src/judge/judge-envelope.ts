import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";
import type { OcPart } from "../records/oc-shapes.ts";
import type { CaptureTurn } from "./capture-turn.ts";

export function structuredOutputParts(turn: CaptureTurn, sessionId: string, messageEntryId: string): readonly OcPart[] {
	// Step P3: every real capture and failed attempt becomes a part; the driver judges conflicts.
	const parts: OcPart[] = [];
	let index = 0;
	for (const failure of turn.failedAttempts) {
		parts.push({ type: "tool", id: `prt_${messageEntryId}_so_${index++}`, sessionID: sessionId,
			messageID: `msg_${messageEntryId}`, tool: "StructuredOutput", callID: failure.toolCallId,
			state: { input: failure.input, status: "error", error: failure.error, time: failure.time } });
	}
	for (const capture of turn.captures) {
		parts.push({ type: "tool", id: `prt_${messageEntryId}_so_${index++}`, sessionID: sessionId,
			messageID: `msg_${messageEntryId}`, tool: "StructuredOutput", callID: capture.toolCallId,
			state: { input: capture.value, status: "completed", output: JSON.stringify(capture.value),
				time: capture.time } });
	}
	return parts;
}

export function conflictSnapshot(turn: CaptureTurn): { readonly conflicting: boolean; readonly distinctValues: number } {
	const values = new Set<string>();
	for (const capture of turn.captures) values.add(JSON.stringify(capture.value));
	return { conflicting: values.size > 1, distinctValues: values.size };
}

export function requireCaptureInput(value: unknown): Record<string, unknown> {
	if (!isAdmissionObject(value)) throw new RuntimeError("protocol-invalid");
	return value;
}
