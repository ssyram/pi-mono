import { formatZaiCompact, formatZaiQuota } from "./zai-display.ts";
import { findHeader } from "./header-value.ts";
import { parseZaiQuota } from "./zai-quota.ts";
import { ZAI_CN_USAGE_URL } from "./route.ts";
import type { QueryResult, RequestAuth } from "./usage-contract.ts";
import { requestJson } from "./usage-http.ts";

export async function queryZaiCn(auth: RequestAuth, signal: AbortSignal): Promise<QueryResult> {
	const team = findHeader(auth.headers, "bigmodel-organization") && findHeader(auth.headers, "bigmodel-project");
	const response = await requestJson(team ? `${ZAI_CN_USAGE_URL}?type=2` : ZAI_CN_USAGE_URL, auth.headers, signal);
	if (response.kind !== "json") return response;
	const parsed = parseZaiQuota(response.value, "china");
	if (parsed.kind === "invalid") return { kind: "error", code: "invalid-response" };
	return { kind: "available", text: formatZaiQuota(parsed.quota), compact: formatZaiCompact(parsed.quota) };
}
