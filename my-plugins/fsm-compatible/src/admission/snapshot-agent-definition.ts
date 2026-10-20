import type { JsonObject, JsonValue } from "./admission-policy.ts";
import { admitted, rejected, type AdmissionResult } from "./admission-result.ts";
import { isAdmissionObject } from "./parse-policy-input.ts";
import { isDataArray } from "./data-array.ts";

function freezeValue(value: unknown, ancestors: Set<object>): AdmissionResult<JsonValue> {
	if (value === null || typeof value === "string" || typeof value === "boolean") return admitted(value);
	if (typeof value === "number") return Number.isFinite(value) ? admitted(value) : rejected("invalid-input");
	if (typeof value !== "object" || ancestors.has(value)) return rejected("invalid-input");
	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			if (!isDataArray(value)) return rejected("invalid-input");
			const result: JsonValue[] = [];
			for (let i = 0; i < value.length; i++) {
				const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
				if (!descriptor || !("value" in descriptor)) return rejected("invalid-input");
				const frozen = freezeValue(descriptor.value, ancestors);
				if (!frozen.ok) return frozen;
				result.push(frozen.value);
			}
			return admitted(Object.freeze(result));
		}
		if (!isAdmissionObject(value)) return rejected("invalid-input");
		const entries: [string, JsonValue][] = [];
		for (const key of Object.keys(value)) {
			const frozen = freezeValue(value[key], ancestors);
			if (!frozen.ok) return frozen;
			entries.push([key, frozen.value]);
		}
		return admitted(Object.freeze(Object.fromEntries(entries)));
	} finally {
		ancestors.delete(value);
	}
}

export function snapshotAgentDefinition(value: unknown): AdmissionResult<JsonObject> {
	if (!isAdmissionObject(value)) return rejected("invalid-input");
	const frozen = freezeValue(value, new Set());
	if (!frozen.ok) return frozen;
	if (!isAdmissionObject(frozen.value)) return rejected("invalid-input");
	return admitted(frozen.value as JsonObject);
}
