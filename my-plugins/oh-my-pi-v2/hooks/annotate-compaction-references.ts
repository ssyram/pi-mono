import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	escapeCompactionReferenceLiterals,
	formatCompactionReference,
} from "./compaction-reference-codec.js";
import type { CompactionReferenceState } from "./compaction-reference-state.js";

export function renderCompactionReferenceSummary(
	state: CompactionReferenceState,
): string {
	const parts: string[] = [];
	for (let index = 0; index < state.summarySourceCount; index++) {
		const source = state.sources[index];
		parts.push(
			formatCompactionReference(source.ordinal),
			escapeCompactionReferenceLiterals(source.text),
		);
	}
	if (state.summarySourceCount > 0) parts.push("@!@");
	parts.push(escapeCompactionReferenceLiterals(state.fileSuffix));
	return parts.join("");
}

export function serializeCompactionReferenceConversation(
	messages: readonly AgentMessage[],
	state: CompactionReferenceState,
	serialize: (messages: AgentMessage[]) => string,
): string {
	if (messages.length !== state.userOrdinals.length)
		throw new Error("Reference message occurrence mismatch");
	const parts: string[] = [];
	for (let index = 0; index < messages.length; index++) {
		const native = serialize([messages[index]]);
		const ordinal = state.userOrdinals[index];
		if (ordinal !== undefined) {
			const source = state.sources[ordinal - 1];
			if (native !== `[User]: ${source.text}`)
				throw new Error("Expected native user serialization");
			parts.push(
				`[User]: ${formatCompactionReference(ordinal)}${escapeCompactionReferenceLiterals(source.text)}@!@`,
			);
		} else if (native.length > 0) {
			parts.push(escapeCompactionReferenceLiterals(native));
		}
	}
	return parts.join("\n\n");
}
