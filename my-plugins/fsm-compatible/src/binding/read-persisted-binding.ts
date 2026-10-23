import { isAbsolute } from "node:path";
import { protocolSessionId } from "./create-root-binding.ts";
import { FSM_COMPATIBLE_EXTENSION_ID, MAX_REQUIRED_EXTENSIONS, REQUIRED_EXTENSION_ID_PATTERN } from "../admission/admission-policy.ts";
import { admitted, rejected, type AdmissionResult } from "../admission/admission-result.ts";
import { isAdmissionIdentifier, isAdmissionObject } from "../admission/parse-policy-input.ts";
import { isDataArray } from "../admission/data-array.ts";
import { BINDING_CUSTOM_TYPE, type BindingEntry, type PersistedBinding } from "./actor-binding.ts";

export function readPersistedBinding(
	entries: readonly BindingEntry[],
	actualSessionId: string,
): AdmissionResult<PersistedBinding | null> {
	// Step P7: absence and corruption are distinct, including the original mandatory baseline.
	let found = false;
	let data: unknown;
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === BINDING_CUSTOM_TYPE) {
			found = true;
			data = entry.data;
		}
	}
	if (!found) return admitted(null);
	if (!isAdmissionObject(data)) return rejected("binding-mismatch");
	const keys = ["version", "rootSessionId", "sessionId", "parentSessionId", "agentId", "kind", "agentName", "bootstrapRef", "requiredExtensions"];
	if (Object.keys(data).some((key) => !keys.includes(key)) || data.version !== 1) return rejected("binding-mismatch");
	if (!isAdmissionIdentifier(data.rootSessionId) || !isAdmissionIdentifier(data.sessionId) || !isAdmissionIdentifier(data.agentId)) {
		return rejected("binding-mismatch");
	}
	if (data.sessionId !== actualSessionId || !isDataArray(data.requiredExtensions)
		|| data.requiredExtensions.length < 1 || data.requiredExtensions.length > MAX_REQUIRED_EXTENSIONS) return rejected("binding-mismatch");
	const extensions: { readonly id: string; readonly path: string }[] = [];
	const ids = new Set<string>();
	const paths = new Set<string>();
	for (const item of data.requiredExtensions) {
		if (!isAdmissionObject(item) || Object.keys(item).some((key) => key !== "id" && key !== "path")) return rejected("binding-mismatch");
		if (!isAdmissionIdentifier(item.id) || !REQUIRED_EXTENSION_ID_PATTERN.test(item.id)
			|| !isAdmissionIdentifier(item.path) || !isAbsolute(item.path) || ids.has(item.id) || paths.has(item.path)) return rejected("binding-mismatch");
		ids.add(item.id);
		paths.add(item.path);
		extensions.push(Object.freeze({ id: item.id, path: item.path }));
	}
	if (!ids.has(FSM_COMPATIBLE_EXTENSION_ID)) return rejected("binding-mismatch");
	const identity = {
		version: 1 as const,
		rootSessionId: data.rootSessionId,
		sessionId: data.sessionId,
		agentId: data.agentId,
		requiredExtensions: Object.freeze(extensions),
	};
	if (data.kind === "execution-root") {
		if (data.rootSessionId !== protocolSessionId(data.sessionId) || data.agentId !== "main" || data.parentSessionId !== null
			|| data.agentName !== null || data.bootstrapRef !== null) return rejected("binding-mismatch");
		return admitted(Object.freeze({ ...identity, kind: "execution-root", parentSessionId: null, agentName: null, bootstrapRef: null }));
	}
	if (data.kind !== "execution-child" || data.agentId !== data.sessionId || data.agentId === "main" || data.sessionId === data.rootSessionId
		|| !isAdmissionIdentifier(data.parentSessionId) || data.parentSessionId === data.sessionId
		|| !isAdmissionIdentifier(data.agentName) || !isAdmissionIdentifier(data.bootstrapRef)) return rejected("binding-mismatch");
	return admitted(Object.freeze({
		...identity,
		kind: "execution-child",
		parentSessionId: data.parentSessionId,
		agentName: data.agentName,
		bootstrapRef: data.bootstrapRef,
	}));
}
