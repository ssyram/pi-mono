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
		// The root is addressable both by its host session id and by the protocol
		// sid the FSM knows it as; both must resolve to the same binding.
		const rootByProtocol = binding.kind === "execution-root" && current === binding.rootSessionId;
		if ((binding.sessionId !== current && !rootByProtocol) || binding.rootSessionId !== rootSessionId) return rejected("binding-mismatch");
		if (binding.kind === "execution-root") {
			return binding.agentId === "main" && binding.parentSessionId === null
				? admitted(depth)
				: rejected("binding-mismatch");
		}
		if (binding.agentId !== current || binding.agentId === "main" || current === rootSessionId) return rejected("binding-mismatch");
		current = binding.parentSessionId;
		depth++;
	}
}
