import { resolveAuth } from "./auth.js";
import { queryCodex } from "./codex-query.js";
import { queryGlmTeam } from "./glm-team-query.js";
import { GLM_TEAMS_SETTING, type ReadGlmTeams, resolveGlmTeam } from "./glm-team-settings.js";
import type { QueryResult, Route, Selection, UsageModelRegistry } from "./usage-contract.js";
import { queryZaiCn } from "./zai-cn-query.js";
import { queryZai } from "./zai-query.js";

export async function executeUsageQuery(
	selection: Selection,
	route: Route,
	registry: Pick<UsageModelRegistry, "getApiKeyAndHeaders">,
	signal: AbortSignal,
	readTeams?: ReadGlmTeams,
): Promise<QueryResult> {
	if (signal.aborted) return { kind: "cancelled" };
	if (readTeams) {
		let settings: Awaited<ReturnType<ReadGlmTeams>>;
		try {
			settings = await readTeams();
		} catch {
			return signal.aborted ? { kind: "cancelled" } : { kind: "error", code: "configuration" };
		}
		if (signal.aborted) return { kind: "cancelled" };
		if (!settings.ok) return { kind: "error", code: "configuration" };
		const team = resolveGlmTeam(settings.values[GLM_TEAMS_SETTING], selection.providerId);
		if (team.kind === "error") return team;
		if (team.kind === "team") return queryGlmTeam(selection, team.context, registry, signal);
	}
	if (route.kind === "error") return route;
	if (route.kind === "unsupported") return route;
	const resolved = await resolveAuth(selection, route, registry, signal);
	if (resolved.kind === "cancelled") return resolved;
	if (resolved.kind === "unsupported") return resolved;
	if (resolved.kind === "error") return resolved;
	if (signal.aborted) return { kind: "cancelled" };
	if (resolved.auth.route === "codex") return queryCodex(resolved.auth, signal);
	if (resolved.auth.route === "zai") return queryZai(resolved.auth, signal);
	return queryZaiCn(resolved.auth, signal);
}
