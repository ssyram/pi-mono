import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { completeSimple as NativeCompleteSimple } from "../../../packages/ai/dist/stream.js";
import { assistant } from "./compaction-reference-fixtures.js";

type CompletionResult = Awaited<ReturnType<typeof NativeCompleteSimple>>;
export const completionCalls: Parameters<typeof NativeCompleteSimple>[] = [];
let result: CompletionResult | Error = completedResponse([
	{ type: "text", text: "default summary" },
]);

export function completedResponse(content: AssistantMessage["content"]) {
	return { ...assistant(content), stopReason: "stop" as const };
}

export function resetCompletion(next: CompletionResult | Error): void {
	completionCalls.length = 0;
	result = next;
}

// Only the actual handler's model call is replaced. No real provider is registered or called.
export const completeSimple: typeof NativeCompleteSimple = async (...args) => {
	completionCalls.push(args);
	if (args[2]?.signal?.aborted)
		throw new Error("Controlled completion aborted");
	if (result instanceof Error) throw result;
	return result;
};
