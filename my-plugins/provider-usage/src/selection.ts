import { isJsonRecord } from "./json-record.js";
import type { Selection, UsageModel, UsageModelRegistry } from "./usage-contract.js";

export interface SelectionContext {
	sessionManager: { getSessionId(): string };
	modelRegistry: Pick<UsageModelRegistry, "getProvider">;
}

export function captureSelection(context: SelectionContext, model: UsageModel | undefined): Selection | undefined {
	if (!model || (model.provider === "unknown" && model.id === "unknown" && model.api === "unknown")) return undefined;
	const provider = context.modelRegistry.getProvider(model.provider);
	const providerEndpoint = isJsonRecord(provider) && typeof provider.baseUrl === "string" ? provider.baseUrl : undefined;
	return {
		sessionId: context.sessionManager.getSessionId(),
		model,
		modelId: model.id,
		providerId: model.provider,
		api: model.api,
		endpoint: model.baseUrl || providerEndpoint || "",
	};
}

export function sameSelection(left: Selection | undefined, right: Selection | undefined): boolean {
	if (!left || !right) return left === right;
	return (
		left.sessionId === right.sessionId &&
		left.providerId === right.providerId &&
		left.modelId === right.modelId &&
		left.api === right.api &&
		left.endpoint === right.endpoint
	);
}
