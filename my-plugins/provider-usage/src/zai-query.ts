import { formatZaiCompact, formatZaiQuota } from "./zai-display.js";
import { isEmptyZaiSubscription, isZaiNoPlanResponse } from "./zai-no-plan.js";
import { parseZaiQuota } from "./zai-quota.js";
import { ZAI_USAGE_URL } from "./route.js";
import type { QueryResult, RequestAuth } from "./usage-contract.js";
import { requestJson } from "./usage-http.js";

export async function queryZai(auth: RequestAuth, signal: AbortSignal): Promise<QueryResult> {
	const response = await requestJson(ZAI_USAGE_URL, auth.headers, signal);
	if (response.kind !== "json") return response;
	if (isZaiNoPlanResponse(response.value)) {
		const subscription = await requestJson(
			"https://api.z.ai/api/biz/subscription/list",
			auth.headers,
			signal,
		);
		if (subscription.kind !== "json") return subscription;
		return isEmptyZaiSubscription(subscription.value)
			? { kind: "not-applicable" }
			: { kind: "error", code: "invalid-response" };
	}
	const parsed = parseZaiQuota(response.value, "international");
	if (parsed.kind === "invalid") return { kind: "error", code: "invalid-response" };
	return { kind: "available", text: formatZaiQuota(parsed.quota), compact: formatZaiCompact(parsed.quota) };
}
