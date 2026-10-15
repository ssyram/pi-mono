import type { GlmTeamContext } from "./glm-team-settings.js";
import { ZAI_CN_USAGE_URL } from "./route.js";
import type { QueryResult, ResolvedModelAuth, Selection, UsageModelRegistry } from "./usage-contract.js";
import { queryZaiCn } from "./zai-cn-query.js";

export async function queryGlmTeam(
	selection: Selection,
	team: GlmTeamContext,
	registry: Pick<UsageModelRegistry, "getApiKeyAndHeaders">,
	signal: AbortSignal,
): Promise<QueryResult> {
	if (signal.aborted) return { kind: "cancelled" };
	let resolved: ResolvedModelAuth;
	try {
		resolved = await registry.getApiKeyAndHeaders(selection.model);
	} catch {
		return signal.aborted ? { kind: "cancelled" } : { kind: "error", code: "auth" };
	}
	if (signal.aborted) return { kind: "cancelled" };
	if (!resolved.ok || !resolved.apiKey?.trim()) return { kind: "error", code: "auth" };
	return queryZaiCn(
		{
			route: "zai-cn",
			endpoint: ZAI_CN_USAGE_URL,
			headers: {
				Authorization: resolved.apiKey,
				"bigmodel-organization": team.organization,
				"bigmodel-project": team.project,
			},
		},
		signal,
	);
}
