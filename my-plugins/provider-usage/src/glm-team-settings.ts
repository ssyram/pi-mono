import type { SettingsResult } from "../../my-settings/index.ts";

export const GLM_TEAMS_SETTING = "provider-usage.glmTeams";
export type ReadGlmTeams = () => Promise<SettingsResult>;

export interface GlmTeamContext {
	organization: string;
	project: string;
}

export type GlmTeamResolution =
	| { kind: "absent" }
	| { kind: "team"; context: GlmTeamContext }
	| { kind: "error"; code: "configuration" };

function validText(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.trim() === value && !/[\r\n\0]/.test(value);
}

export function resolveGlmTeam(value: unknown, providerId: string): GlmTeamResolution {
	if (!Array.isArray(value)) return { kind: "error", code: "configuration" };
	const providers = new Set<string>();
	let context: GlmTeamContext | undefined;
	for (const entry of value) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			return { kind: "error", code: "configuration" };
		}
		const team = entry as Record<string, unknown>;
		if (
			!Array.isArray(team.providers) ||
			team.providers.length === 0 ||
			Object.hasOwn(team, "key") ||
			!validText(team.organization) ||
			!validText(team.project)
		) {
			return { kind: "error", code: "configuration" };
		}
		for (const provider of team.providers) {
			if (!validText(provider) || providers.has(provider)) return { kind: "error", code: "configuration" };
			providers.add(provider);
			if (provider === providerId) {
				context = { organization: team.organization, project: team.project };
			}
		}
	}
	return context ? { kind: "team", context } : { kind: "absent" };
}
