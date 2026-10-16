import type { BoulderInhibitSignal } from "./protocol.ts";

export function parseBoulderInhibitSignal(data: unknown): BoulderInhibitSignal | undefined {
	if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
	if (!("type" in data) || typeof data.type !== "string" || data.type.length === 0 || /\s/u.test(data.type)) {
		return undefined;
	}
	if (!("value" in data) || typeof data.value !== "boolean") return undefined;
	return { type: data.type, value: data.value };
}
