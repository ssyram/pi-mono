import { MAX_REQUIRED_EXTENSIONS, REQUIRED_EXTENSION_ID_PATTERN, type PolicyInput } from "./admission-policy.ts";
import { admitted, rejected, type AdmissionResult } from "./admission-result.ts";
import { isDataArray } from "./data-array.ts";

export function isAdmissionIdentifier(value: unknown): value is string {
	return typeof value === "string" && /^\S(?:.*\S)?$/.test(value) && !value.includes("\0");
}

export function isAdmissionObject(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
	return Reflect.ownKeys(value).every((key) => {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return typeof key === "string" && descriptor?.enumerable === true && "value" in descriptor;
	});
}

export function parsePolicyInput(value: unknown): AdmissionResult<PolicyInput> {
	// Step P1: reject unknown or non-JSON-shaped authority inputs.
	if (!isAdmissionObject(value)) return rejected("invalid-input");
	if (Object.keys(value).some((key) => !["allowedAgentNames", "requiredExtensions", "maxDepth"].includes(key))) {
		return rejected("invalid-input");
	}
	const { allowedAgentNames, requiredExtensions, maxDepth } = value;
	if (!isDataArray(allowedAgentNames) || !allowedAgentNames.every(isAdmissionIdentifier)) return rejected("invalid-input");
	if (new Set(allowedAgentNames).size !== allowedAgentNames.length) return rejected("invalid-input");
	if (!isDataArray(requiredExtensions) || requiredExtensions.length > MAX_REQUIRED_EXTENSIONS) return rejected("invalid-input");
	if (typeof maxDepth !== "number" || !Number.isInteger(maxDepth) || maxDepth < 1) return rejected("invalid-input");
	const extensions: { readonly id: string; readonly path: string }[] = [];
	const ids = new Set<string>();
	for (const entry of requiredExtensions) {
		if (!isAdmissionObject(entry) || Object.keys(entry).some((key) => key !== "id" && key !== "path")) return rejected("invalid-input");
		if (!isAdmissionIdentifier(entry.id) || !REQUIRED_EXTENSION_ID_PATTERN.test(entry.id) || !isAdmissionIdentifier(entry.path)) {
			return rejected("invalid-input");
		}
		if (ids.has(entry.id)) return rejected("invalid-input");
		ids.add(entry.id);
		extensions.push(Object.freeze({ id: entry.id, path: entry.path }));
	}
	return admitted(Object.freeze({
		allowedAgentNames: Object.freeze([...allowedAgentNames]),
		requiredExtensions: Object.freeze(extensions),
		maxDepth,
	}));
}
