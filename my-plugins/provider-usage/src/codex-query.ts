import { formatCodex, formatCodexCompact } from "./codex-display.js";
import { parseCodex } from "./codex-usage.js";
import { CODEX_USAGE_URL } from "./route.js";
import type { QueryResult, RequestAuth } from "./usage-contract.js";
import { requestJson } from "./usage-http.js";

export async function queryCodex(auth: RequestAuth, signal: AbortSignal): Promise<QueryResult> {
	const response = await requestJson(CODEX_USAGE_URL, auth.headers, signal);
	if (response.kind !== "json") return response;
	const usage = parseCodex(response.value);
	if (!usage) return { kind: "error", code: "invalid-response" };
	return { kind: "available", text: formatCodex(usage), compact: formatCodexCompact(usage) };
}
