// GC criteria configuration over the my-settings protocol: shared settings
// files (~/.pi/agent/settings.json + <cwd>/.pi/settings.json), prefixed key
// loop.gcCriteria, project layer overriding the global one.
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createMySettingsClient } from "../../../my-settings/client.ts";
import { parseDuration } from "../parse-duration.js";
import { DEFAULT_GC_CRITERIA_MS } from "./run-catalog-state.js";

export type GcCriteriaResolution = {
	criteriaMs: number;
	/** Human-readable effective value for command feedback. */
	label: string;
	fromConfig: boolean;
};

/** "instant" | "0" | "now" -> 0; Nd/Nh/Nmin/Ns; Nmon/Nmonth = N*30d. */
export function parseGcCriteria(value: string): number | undefined {
	const token = value.trim().toLowerCase();
	if (token === "instant" || token === "0" || token === "now") return 0;
	const month = /^(\d+)(mon|month)$/.exec(token);
	if (month !== null) {
		const months = Number.parseInt(month[1]!, 10);
		const ms = months * 30 * 86_400_000;
		return Number.isSafeInteger(ms) ? ms : undefined;
	}
	return parseDuration(token);
}

export function describeGcCriteria(criteriaMs: number): string {
	if (criteriaMs === 0) return "instant";
	const days = criteriaMs / 86_400_000;
	if (Number.isInteger(days)) return `${days}d`;
	return `${criteriaMs}ms`;
}

export async function loadGcCriteria(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): Promise<GcCriteriaResolution> {
	const settings = createMySettingsClient(pi.events, {
		session: ctx.sessionManager,
		sessionId: ctx.sessionManager.getSessionId(),
	});
	const result = await settings.query({
		defaults: { "loop.gcCriteria": describeGcCriteria(DEFAULT_GC_CRITERIA_MS) },
		scope: "project",
	});
	const fallback: GcCriteriaResolution = {
		criteriaMs: DEFAULT_GC_CRITERIA_MS,
		label: describeGcCriteria(DEFAULT_GC_CRITERIA_MS),
		fromConfig: false,
	};
	if (!result.ok) return fallback;
	const raw = result.values["loop.gcCriteria"];
	if (typeof raw !== "string") return fallback;
	const parsed = parseGcCriteria(raw);
	if (parsed === undefined) return fallback;
	return { criteriaMs: parsed, label: raw, fromConfig: true };
}
