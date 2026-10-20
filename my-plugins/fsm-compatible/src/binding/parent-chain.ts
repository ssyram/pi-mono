import { admitted, rejected, type AdmissionResult } from "../admission/admission-result.ts";
import type { BindingRecords } from "./actor-binding.ts";

export function parentDepth(
	rootSessionId: string,
	sessionId: string,
	records: BindingRecords,
	forbiddenSessionId?: string,
): AdmissionResult<number> {
	const seen = new Set<string>(forbiddenSessionId === undefined ? [] : [forbiddenSessionId]);
	let current = sessionId;
	let depth = 0;
	for (;;) {
		if (seen.has(current)) return rejected("parent-cycle");
		seen.add(current);
		const record = records.find(current);
		if (!record) return rejected("parent-not-found");
		const binding = record.binding;
		if (binding.sessionId !== current || binding.rootSessionId !== rootSessionId) return rejected("binding-mismatch");
		if (binding.kind === "execution-root") {
			return current === rootSessionId && binding.agentId === "main" && binding.parentSessionId === null
				? admitted(depth)
				: rejected("binding-mismatch");
		}
		if (binding.agentId !== current || binding.agentId === "main" || current === rootSessionId) return rejected("binding-mismatch");
		current = binding.parentSessionId;
		depth++;
	}
}
