/** Private subscription relay policy: zero-rate default group, priced known models, positive wallet. */
import { backendFailure, type BackendResult } from "./backend-failure.js";
import type { JsonValue, NewApiSession } from "./newapi-session.js";
import type { PoolSnapshot } from "./pool-snapshot.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function optionsMap(data: unknown): Record<string, unknown> | undefined {
	const record = asRecord(data);
	if (record) return record;
	if (Array.isArray(data)) {
		const map: Record<string, unknown> = {};
		for (const entry of data) {
			const item = asRecord(entry);
			if (item && typeof item.key === "string") map[item.key] = item.value;
		}
		return map;
	}
	return undefined;
}

function parseRatioMap(value: unknown): Record<string, number> | undefined {
	if (typeof value !== "string") return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return undefined;
	}
	const record = asRecord(parsed);
	if (!record) return undefined;
	const map: Record<string, number> = {};
	for (const [key, ratio] of Object.entries(record)) {
		if (typeof ratio !== "number" || !Number.isFinite(ratio)) return undefined;
		map[key] = ratio;
	}
	return map;
}

async function putOption(session: NewApiSession, key: string, value: string, signal: AbortSignal): Promise<BackendResult<undefined>> {
	const written = await session.write("PUT", "/api/option/", { key, value } as JsonValue, signal);
	if (written.kind !== "ok") return written;
	const reread = await session.read("/api/option/", signal);
	if (reread.kind !== "ok") return reread;
	const map = optionsMap(reread.value);
	if (!map || map[key] !== value) return backendFailure("relay-policy", `option ${key} readback`);
	return { kind: "ok", value: undefined };
}

/** Must only run against this plugin's private new-api (checked via snapshot + session user). */
export async function ensureOwnedRelayPolicy(
	session: NewApiSession,
	snapshot: PoolSnapshot,
	metadataIds: readonly string[],
	signal: AbortSignal,
): Promise<BackendResult<undefined>> {
	if (snapshot.unmanagedChannelIds.length > 0) {
		return backendFailure("relay-policy", `unmanaged channel(s) ${snapshot.unmanagedChannelIds.join(",")} in routing group`);
	}
	const options = await session.read("/api/option/", signal);
	if (options.kind !== "ok") return options;
	const map = optionsMap(options.value);
	if (!map) return backendFailure("invalid-response", "options payload");
	const groupRatio = parseRatioMap(map.GroupRatio);
	if (!groupRatio) return backendFailure("invalid-response", "GroupRatio option");
	if (groupRatio.default !== 0) {
		const updated = await putOption(
			session,
			"GroupRatio",
			JSON.stringify({ ...groupRatio, default: 0 }),
			signal,
		);
		if (updated.kind !== "ok") return updated;
	}
	const modelRatioRaw = parseRatioMap(map.ModelRatio);
	if (!modelRatioRaw) return backendFailure("invalid-response", "ModelRatio option");
	const missing = metadataIds.filter((id) => modelRatioRaw[id] === undefined);
	if (missing.length > 0) {
		const merged = { ...modelRatioRaw };
		for (const id of missing) merged[id] = 0;
		const updated = await putOption(session, "ModelRatio", JSON.stringify(merged), signal);
		if (updated.kind !== "ok") return updated;
	}
	const self = await session.read("/api/user/self", signal);
	if (self.kind !== "ok") return self;
	const user = asRecord(self.value);
	const quota = user?.quota;
	if (typeof quota !== "number" || quota <= 0) {
		return backendFailure("relay-policy", "managed wallet balance is not positive");
	}
	return { kind: "ok", value: undefined };
}
