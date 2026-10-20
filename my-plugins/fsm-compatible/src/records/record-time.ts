import { RuntimeError } from "../runtime/runtime-error.ts";

export function normalizeIsoTimestamp(value: string): number {
	// Step P1: persisted header/entry timestamps are canonical ISO strings, not wire millis.
	const ms = Date.parse(value);
	if (!Number.isFinite(ms) || !Number.isSafeInteger(ms) || ms < 0 || new Date(ms).toISOString() !== value) {
		throw new RuntimeError("protocol-invalid");
	}
	return ms;
}

export function requireEventMillis(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0) throw new RuntimeError("protocol-invalid");
	return value;
}

export function entryMillis(entry: { readonly timestamp: string }): number {
	return normalizeIsoTimestamp(entry.timestamp);
}

export function messageMillis(message: { readonly timestamp?: number }, fallback: number): number {
	return message.timestamp === undefined ? fallback : requireEventMillis(message.timestamp);
}
