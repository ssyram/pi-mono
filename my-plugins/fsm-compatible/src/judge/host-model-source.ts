import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { JudgeModelSource } from "./judge-session.ts";

/**
 * Judge model source backed by the host session: the reviewer runs through the
 * host's current model and provider runtime (registry.stream resolves
 * request-time auth), matching OC where reviewers use the session's provider.
 */
export function hostModelSource(model: Model<any> | undefined, registry: ModelRegistry): JudgeModelSource | undefined {
	if (!model || !registry) return undefined;
	return {
		model,
		getApiKey: () => undefined,
		streamFn: (requestModel: Model<any>, context: never, options?: never) =>
			registry.stream(requestModel, context, options as never),
	};
}
