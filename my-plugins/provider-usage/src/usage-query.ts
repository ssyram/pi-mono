import { resolveAuth } from "./auth.js";
import { queryCodex } from "./codex-query.js";
import type { QueryResult, Route, Selection, SupportedRouteKind, UsageModelRegistry } from "./usage-contract.js";
import { queryZaiCn } from "./zai-cn-query.js";
import { queryZai } from "./zai-query.js";

export async function executeUsageQuery(
	selection: Selection,
	route: Extract<Route, { kind: SupportedRouteKind }>,
	registry: Pick<UsageModelRegistry, "getApiKeyAndHeaders">,
	signal: AbortSignal,
): Promise<QueryResult> {
	const resolved = await resolveAuth(selection, route, registry, signal);
	if (resolved.kind === "cancelled") return resolved;
	if (resolved.kind === "unsupported") return resolved;
	if (resolved.kind === "error") return resolved;
	if (signal.aborted) return { kind: "cancelled" };
	if (resolved.auth.route === "codex") return queryCodex(resolved.auth, signal);
	if (resolved.auth.route === "zai") return queryZai(resolved.auth, signal);
	return queryZaiCn(resolved.auth, signal);
}
